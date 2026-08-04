require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const line = require('@line/bot-sdk');
const { dbQuery, initDatabase } = require('./db');

const app = express();
const PORT = process.env.PORT || 5678;

// Initialize Database
initDatabase();

// LINE SDK Configuration
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'MOCK_TOKEN',
  channelSecret: process.env.LINE_CHANNEL_SECRET || 'MOCK_SECRET'
};

// Create LINE SDK client
let lineClient;
const hasCredentials = 
  process.env.LINE_CHANNEL_ACCESS_TOKEN && 
  process.env.LINE_CHANNEL_ACCESS_TOKEN !== 'YOUR_CHANNEL_ACCESS_TOKEN' && 
  process.env.LINE_CHANNEL_SECRET && 
  process.env.LINE_CHANNEL_SECRET !== 'YOUR_CHANNEL_SECRET';

if (hasCredentials) {
  lineClient = new line.Client(lineConfig);
  console.log('LINE Client initialized with active credentials.');
} else {
  console.warn('⚠️ WARNING: LINE credentials are not set. Running in MOCK LINE mode.');
  lineClient = {
    pushMessage: async (to, messages) => {
      console.log(`[MOCK LINE PUSH] To: ${to}`, JSON.stringify(messages, null, 2));
      return { mock: true };
    },
    replyMessage: async (replyToken, messages) => {
      console.log(`[MOCK LINE REPLY] Token: ${replyToken}`, JSON.stringify(messages, null, 2));
      return { mock: true };
    },
    getProfile: async (userId) => {
      console.log(`[MOCK LINE GET PROFILE] User ID: ${userId}`);
      return {
        userId,
        displayName: `LINE User (${userId.substring(0, 5)})`,
        pictureUrl: 'https://cdn-icons-png.flaticon.com/512/847/847969.png',
        statusMessage: 'Mock LINE user'
      };
    }
  };
}

// Admin Authentication Middleware
function verifyAdminToken(req, res, next) {
  // If the request contains a userId query parameter, it is a customer LIFF client call -> bypass admin token check
  if (req.query.userId) {
    return next();
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.split(' ')[1];
  const expectedToken = process.env.ADMIN_TOKEN || 'admin-session-secure-token';

  if (token !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }

  next();
}

// ----------------------------------------------------
// 1. LINE Webhook Endpoint (Must be BEFORE express.json())
// ----------------------------------------------------
app.post('/webhook', (req, res, next) => {
  if (!hasCredentials) {
    return next();
  }
  line.middleware(lineConfig)(req, res, next);
}, async (req, res) => {
  try {
    const events = req.body.events || [];
    console.log(`Received Webhook event count: ${events.length}`);
    
    for (const event of events) {
      await handleLineEvent(event);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error handling webhook events:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// If mock webhook is called in development
app.post('/webhook/mock', express.json(), async (req, res) => {
  try {
    const events = req.body.events || [];
    console.log(`Received MOCK Webhook event count: ${events.length}`);
    for (const event of events) {
      await handleLineEvent(event);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error handling mock webhook:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ----------------------------------------------------
// 2. Middlewares (Applied after webhook)
// ----------------------------------------------------
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------------------
// 3. API Endpoints
// ----------------------------------------------------

// Admin Login authentication API
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const expectedUser = process.env.ADMIN_USERNAME || 'admin';
  const expectedPass = process.env.ADMIN_PASSWORD || 'laundry123';
  const token = process.env.ADMIN_TOKEN || 'admin-session-secure-token';

  if (username === expectedUser && password === expectedPass) {
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
  }
});

// Get configuration settings (e.g. LIFF ID)
app.get('/api/config', (req, res) => {
  res.json({
    liffId: process.env.LIFF_ID || 'MOCK_LIFF_ID'
  });
});

// Upsert Customer profile (triggered when LIFF loads)
app.post('/api/customers', async (req, res) => {
  try {
    const { id, displayName, pictureUrl } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing customer ID' });

    const existing = await dbQuery.get('SELECT id, points FROM customers WHERE id = ?', [id]);
    const now = new Date().toISOString();
    let currentPoints = 0;

    if (existing) {
      currentPoints = existing.points;
      await dbQuery.run(
        'UPDATE customers SET displayName = ?, pictureUrl = ? WHERE id = ?',
        [displayName, pictureUrl, id]
      );
      console.log(`Updated customer profile: ${displayName} (${id}) - Points: ${currentPoints}`);
    } else {
      await dbQuery.run(
        'INSERT INTO customers (id, displayName, pictureUrl, points, createdAt) VALUES (?, ?, ?, ?, ?)',
        [id, displayName, pictureUrl, 0, now]
      );
      console.log(`Created new customer profile: ${displayName} (${id})`);
    }

    res.json({ success: true, points: currentPoints });
  } catch (error) {
    console.error('Error in POST /api/customers:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all service rates
app.get('/api/rates', async (req, res) => {
  try {
    const rates = await dbQuery.all('SELECT * FROM service_rates');
    res.json(rates);
  } catch (error) {
    console.error('Error in GET /api/rates:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get orders (protected for admin dashboard, unprotected for client history)
app.get('/api/orders', verifyAdminToken, async (req, res) => {
  try {
    const { userId } = req.query;
    let query, params;

    if (userId) {
      query = 'SELECT * FROM orders WHERE customerId = ? ORDER BY createdAt DESC';
      params = [userId];
    } else {
      query = `
        SELECT o.*, c.displayName, c.pictureUrl, c.points 
        FROM orders o 
        LEFT JOIN customers c ON o.customerId = c.id 
        ORDER BY o.createdAt DESC
      `;
      params = [];
    }

    const orders = await dbQuery.all(query, params);

    for (let order of orders) {
      const items = await dbQuery.all('SELECT * FROM order_items WHERE orderId = ?', [order.id]);
      order.items = items;
    }

    res.json(orders);
  } catch (error) {
    console.error('Error in GET /api/orders:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create a new order (with multiple items)
app.post('/api/orders', async (req, res) => {
  try {
    const { customerId, latitude, longitude, deliveryDateTime, items, deliveryMethod, paymentMethod } = req.body;

    if (!customerId || !deliveryDateTime || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Missing required order fields or items array' });
    }

    const orderId = `ORD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date().toISOString();
    let totalPrice = 0;
    let totalCount = 0;

    const rates = await dbQuery.all('SELECT * FROM service_rates');
    const ratesMap = {};
    rates.forEach(r => { ratesMap[r.name] = r.pricePerUnit; });

    const validatedItems = [];
    for (const item of items) {
      const pricePerUnit = ratesMap[item.serviceType];
      if (pricePerUnit === undefined) {
        return res.status(400).json({ error: `Invalid service type: ${item.serviceType}` });
      }
      const itemSubtotal = item.itemCount * pricePerUnit;
      totalPrice += itemSubtotal;
      totalCount += item.itemCount;
      
      validatedItems.push({
        serviceType: item.serviceType,
        itemCount: item.itemCount,
        price: itemSubtotal
      });
    }

    // Apply wholesale discount (20% off) if total items count is >= 50
    let discountApplied = 0;
    if (totalCount >= 50) {
      discountApplied = Math.round(totalPrice * 0.20 * 100) / 100;
      totalPrice = Math.max(0, totalPrice - discountApplied);
    }

    // Insert Order Parent
    await dbQuery.run(`
      INSERT INTO orders (id, customerId, latitude, longitude, deliveryDateTime, totalPrice, status, pointsEarned, deliveryMethod, paymentMethod, discountApplied, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      orderId, 
      customerId, 
      latitude ? parseFloat(latitude) : null, 
      longitude ? parseFloat(longitude) : null, 
      deliveryDateTime, 
      totalPrice, 
      'pending', 
      0, 
      deliveryMethod || 'pickup', 
      paymentMethod || 'cash', 
      discountApplied, 
      now
    ]);

    // Insert Order Children
    for (const item of validatedItems) {
      await dbQuery.run(`
        INSERT INTO order_items (orderId, serviceType, itemCount, price)
        VALUES (?, ?, ?, ?)
      `, [orderId, item.serviceType, item.itemCount, item.price]);
    }

    console.log(`Created Order ${orderId} with ${validatedItems.length} items (Total: ${totalCount} pcs). Discount: ${discountApplied}. Method: ${deliveryMethod}, Payment: ${paymentMethod}`);

    const orderData = await dbQuery.get('SELECT * FROM orders WHERE id = ?', [orderId]);
    orderData.items = validatedItems;

    await sendStatusFlexMessage(customerId, orderData);

    res.json({ success: true, orderId, totalPrice, discountApplied });
  } catch (error) {
    console.error('Error in POST /api/orders:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update order (PUT /api/orders/:id) -> protected
app.put('/api/orders/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { deliveryDateTime, items } = req.body;

    const order = await dbQuery.get('SELECT * FROM orders WHERE id = ?', [id]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (!deliveryDateTime || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Missing required update fields' });
    }

    const rates = await dbQuery.all('SELECT * FROM service_rates');
    const ratesMap = {};
    rates.forEach(r => { ratesMap[r.name] = r.pricePerUnit; });

    let newTotalPrice = 0;
    const validatedItems = [];
    for (const item of items) {
      const pricePerUnit = ratesMap[item.serviceType];
      if (pricePerUnit === undefined) {
        return res.status(400).json({ error: `Invalid service type: ${item.serviceType}` });
      }
      const itemSubtotal = item.itemCount * pricePerUnit;
      newTotalPrice += itemSubtotal;
      
      validatedItems.push({
        serviceType: item.serviceType,
        itemCount: item.itemCount,
        price: itemSubtotal
      });
    }

    // Begin updates
    await dbQuery.run('DELETE FROM order_items WHERE orderId = ?', [id]);

    for (const item of validatedItems) {
      await dbQuery.run(`
        INSERT INTO order_items (orderId, serviceType, itemCount, price)
        VALUES (?, ?, ?, ?)
      `, [id, item.serviceType, item.itemCount, item.price]);
    }

    // Recalculate points if order is already completed
    let newPointsEarned = order.pointsEarned;

    await dbQuery.run(`
      UPDATE orders 
      SET deliveryDateTime = ?, totalPrice = ?, pointsEarned = ?
      WHERE id = ?
    `, [deliveryDateTime, newTotalPrice, newPointsEarned, id]);

    console.log(`Updated Order ${id} to new total: ฿${newTotalPrice}`);
    
    const updatedOrder = await dbQuery.get('SELECT * FROM orders WHERE id = ?', [id]);
    updatedOrder.items = validatedItems;
    await sendStatusFlexMessage(updatedOrder.customerId, updatedOrder);

    res.json({ success: true, totalPrice: newTotalPrice });
  } catch (error) {
    console.error(`Error updating order ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Update order status only (PUT /api/orders/:id/status) -> protected
app.put('/api/orders/:id/status', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'picked_up', 'washing', 'completed', 'delivered'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const order = await dbQuery.get('SELECT * FROM orders WHERE id = ?', [id]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Stamps calculation logic (1 delivered order = 1 stamp)
    if (status === 'delivered' && order.status !== 'delivered' && order.pointsEarned === 0) {
      await dbQuery.run('UPDATE customers SET points = points + 1 WHERE id = ?', [order.customerId]);
      await dbQuery.run('UPDATE orders SET pointsEarned = 1 WHERE id = ?', [id]);
      console.log(`🏆 Credited e-Stamp: +1 stamp to customer ${order.customerId} for delivered Order ${id}`);
    }

    await dbQuery.run('UPDATE orders SET status = ? WHERE id = ?', [status, id]);
    console.log(`Updated Order ${id} status to: ${status}`);

    const updatedOrder = await dbQuery.get('SELECT * FROM orders WHERE id = ?', [id]);
    const items = await dbQuery.all('SELECT * FROM order_items WHERE orderId = ?', [id]);
    updatedOrder.items = items;

    await sendStatusFlexMessage(updatedOrder.customerId, updatedOrder);

    res.json({ success: true });
  } catch (error) {
    console.error('Error in PUT /api/orders/:id/status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete order -> protected
app.delete('/api/orders/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;

    const order = await dbQuery.get('SELECT * FROM orders WHERE id = ?', [id]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // If deleting a delivered order, subtract the points earned from the customer
    if (order.status === 'delivered' && order.pointsEarned > 0) {
      await dbQuery.run('UPDATE customers SET points = points - ? WHERE id = ?', [order.pointsEarned, order.customerId]);
      console.log(`Subtracted ${order.pointsEarned} loyalty stamps from customer ${order.customerId} due to deletion of Delivered Order ${id}`);
    }

    await dbQuery.run('DELETE FROM order_items WHERE orderId = ?', [id]);
    await dbQuery.run('DELETE FROM orders WHERE id = ?', [id]);

    console.log(`Deleted Order ${id} from database.`);
    res.json({ success: true });
  } catch (error) {
    console.error(`Error deleting order ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Redeem e-Stamp coupon
app.post('/api/customers/:id/redeem', async (req, res) => {
  try {
    const { id } = req.params;
    const customer = await dbQuery.get('SELECT points, displayName FROM customers WHERE id = ?', [id]);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    if (customer.points < 10) {
      return res.status(400).json({ error: 'แสตมป์สะสมไม่เพียงพอสำหรับการแลกรางวัล (ต้องการขั้นต่ำ 10 แสตมป์)' });
    }

    const newPoints = customer.points - 10;
    await dbQuery.run('UPDATE customers SET points = ? WHERE id = ?', [newPoints, id]);
    console.log(`Redeemed coupon for customer ${customer.displayName} (${id}). Remaining stamps: ${newPoints}`);

    // Send congratulations push message
    try {
      if (id.startsWith('MOCK') || !hasCredentials) {
        console.log(`[MOCK LINE PUSH REDEEM] To: ${id} - Coupon redeemed successfully. Remaining stamps: ${newPoints}`);
      } else {
        await lineClient.pushMessage(id, {
          type: 'text',
          text: `🎉 ยินดีด้วยครับ! คุณ ${customer.displayName} ได้ทำการแลกรับคูปองส่วนลดพิเศษ 100 บาท สำเร็จเรียบร้อยแล้ว!\n🌟 แสตมป์สะสมคงเหลือ: ${newPoints} ดวง`
        });
      }
    } catch (e) {
      console.error('Error sending redeem notification:', e);
    }

    res.json({ success: true, points: newPoints });
  } catch (error) {
    console.error('Error in POST /api/customers/:id/redeem:', error);
    res.status(500).json({ error: error.message });
  }
});

// Broadcast promotion to all registered customers -> protected
app.post('/api/broadcast', verifyAdminToken, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Missing broadcast message text' });
    }

    const customers = await dbQuery.all('SELECT id, displayName FROM customers');
    console.log(`Sending broadcast message to ${customers.length} customers...`);

    let successCount = 0;
    for (const customer of customers) {
      try {
        if (customer.id.startsWith('MOCK') || !hasCredentials) {
          console.log(`[MOCK LINE PUSH BROADCAST] To: ${customer.id} - Msg: ${message}`);
          successCount++;
          continue;
        }
        await lineClient.pushMessage(customer.id, {
          type: 'text',
          text: `📢 ข่าวสาร & โปรโมชั่นพิเศษสุดคุ้มจากร้านซักรีด!\n\n${message}\n\n🧺 สอบถามเพิ่มเติมหรือจองคิวซักรีดผ่านเมนูด้านล่างได้เลยครับ`
        });
        successCount++;
      } catch (err) {
        console.error(`Failed to push broadcast to user ${customer.id}:`, err.message);
      }
    }

    res.json({ success: true, count: successCount });
  } catch (error) {
    console.error('Error in POST /api/broadcast:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------
// 4. LINE Webhook Handling logic
// ----------------------------------------------------
async function handleLineEvent(event) {
  if (event.type === 'follow') {
    const userId = event.source.userId;
    try {
      const profile = await lineClient.getProfile(userId);
      const now = new Date().toISOString();
      
      const existing = await dbQuery.get('SELECT id FROM customers WHERE id = ?', [userId]);
      if (existing) {
        await dbQuery.run('UPDATE customers SET displayName = ?, pictureUrl = ? WHERE id = ?', [profile.displayName, profile.pictureUrl, userId]);
      } else {
        await dbQuery.run('INSERT INTO customers (id, displayName, pictureUrl, points, createdAt) VALUES (?, ?, ?, ?, ?)', [userId, profile.displayName, profile.pictureUrl, 0, now]);
      }
      
      await lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `สวัสดีคุณ ${profile.displayName} ยินดีต้อนรับสู่ร้านซักรีดอัจฉริยะ! 🎉\nคุณสามารถกดปุ่มเมนูสั่งซักรีดได้ผ่านหน้าต่างแชทนี้เลยครับ`
      });
    } catch (err) {
      console.error('Error processing follow event:', err);
    }
  }

  if (event.type === 'message' && event.message.type === 'text') {
    const text = event.message.text.trim();
    const userId = event.source.userId;

    if (text === 'เช็คสถานะ' || text === 'สถานะออเดอร์') {
      try {
        const lastOrder = await dbQuery.get('SELECT * FROM orders WHERE customerId = ? ORDER BY createdAt DESC LIMIT 1', [userId]);
        if (!lastOrder) {
          await lineClient.replyMessage(event.replyToken, {
            type: 'text',
            text: 'คุณยังไม่มีออเดอร์ในระบบ ณ ขณะนี้ สะดวกจองคิวซักรีดผ่านระบบ LIFF ได้ตลอดเวลาเลยนะครับ'
          });
        } else {
          const items = await dbQuery.all('SELECT * FROM order_items WHERE orderId = ?', [lastOrder.id]);
          lastOrder.items = items;
          
          await sendStatusFlexMessage(userId, lastOrder, event.replyToken);
        }
      } catch (err) {
        console.error('Error checking status via text command:', err);
      }
    } else {
      await lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `ขออภัยครับ ตอนนี้ผมกำลังเรียนรู้ หากต้องการใช้บริการสั่งซักผ้าหรือดูสถานะปัจจุบัน สามารถกดที่แถบเมนูด้านล่างเพื่อเข้าใช้งานระบบได้เลยครับ 👔👕`
      });
    }
  }
}

// ----------------------------------------------------
// 5. Flex Message Builder & Push Function
// ----------------------------------------------------
async function sendStatusFlexMessage(customerId, order, replyToken = null) {
  let statusText = '';
  let statusColor = '';
  let statusDescription = '';
  
  switch (order.status) {
    case 'pending':
      statusText = 'รอรับผ้า (Pending)';
      statusColor = '#F39C12';
      statusDescription = 'ร้านค้าได้รับออเดอร์เรียบร้อยแล้ว กำลังจัดส่งเจ้าหน้าที่ไปรับผ้าตามพิกัดและเวลานัดหมาย';
      break;
    case 'picked_up':
      statusText = 'รับผ้าแล้ว (Picked Up)';
      statusColor = '#3498DB';
      statusDescription = 'พนักงานเข้ารับตะกร้าผ้าของท่านเรียบร้อยแล้ว กำลังนำส่งไปยังโรงซัก';
      break;
    case 'washing':
      statusText = 'กำลังซัก (Washing)';
      statusColor = '#9B59B6';
      statusDescription = 'ผ้าของคุณอยู่ในขั้นตอนกระบวนการซัก อบ และรีด อย่างสะอาดปราณีต';
      break;
    case 'completed':
      statusText = 'ซักเสร็จสิ้น (Completed)';
      statusColor = '#1ABC9C';
      statusDescription = 'การซักเสร็จสมบูรณ์เรียบร้อยแล้ว เตรียมพร้อมทำการจัดส่งคืนลูกค้า';
      break;
    case 'delivered':
      statusText = 'จัดส่งแล้ว (Delivered)';
      statusColor = '#2ECC71';
      statusDescription = 'ร้านค้าได้ทำการจัดส่งเสื้อผ้าสะอาดคืนสู่มือคุณเรียบร้อยแล้ว ขอบคุณที่ใช้บริการครับ';
      break;
    default:
      statusText = 'ไม่ระบุสถานะ';
      statusColor = '#7F8C8D';
      statusDescription = '-';
  }

  let dateFormatted = order.deliveryDateTime;
  try {
    const dateObj = new Date(order.deliveryDateTime);
    if (!isNaN(dateObj)) {
      dateFormatted = dateObj.toLocaleString('th-TH', { hour12: false });
    }
  } catch (e) {}

  const items = order.items || [];
  const flexItemsList = items.map(item => {
    return {
      type: 'box',
      layout: 'horizontal',
      contents: [
        {
          type: 'text',
          text: item.serviceType,
          size: 'sm',
          color: '#555555',
          flex: 3,
          wrap: true
        },
        {
          type: 'text',
          text: `${item.itemCount} ชิ้น`,
          size: 'sm',
          color: '#111111',
          align: 'end',
          flex: 2
        }
      ]
    };
  });

  let customerPoints = 0;
  try {
    const customer = await dbQuery.get('SELECT points FROM customers WHERE id = ?', [customerId]);
    if (customer) {
      customerPoints = customer.points;
    }
  } catch (err) {}

  const flexPointsContents = [];
  if (order.status === 'delivered') {
    flexPointsContents.push(
      {
        type: 'separator',
        margin: 'md'
      },
      {
        type: 'box',
        layout: 'vertical',
        margin: 'md',
        backgroundColor: '#FCF3CF',
        padding: '10px',
        borderRadius: '8px',
        contents: [
          {
            type: 'text',
            text: `🎉 ได้รับแสตมป์สะสม: +1 ดวง`,
            weight: 'bold',
            size: 'sm',
            color: '#B9770E'
          },
          {
            type: 'text',
            text: `🌟 แสตมป์สะสมทั้งหมดของคุณ: ${customerPoints} ดวง`,
            size: 'xs',
            color: '#7E5109',
            margin: 'xs'
          }
        ]
      }
    );
  }

  const discountContents = [];
  if (order.discountApplied && order.discountApplied > 0) {
    discountContents.push({
      type: 'box',
      layout: 'horizontal',
      contents: [
        {
          type: 'text',
          text: 'ส่วนลดราคาส่ง (20%)',
          size: 'sm',
          color: '#E74C3C',
          flex: 3
        },
        {
          type: 'text',
          text: `- ฿ ${order.discountApplied.toFixed(2)}`,
          size: 'sm',
          color: '#E74C3C',
          align: 'end',
          flex: 4,
          weight: 'bold'
        }
      ]
    });
  }

  const flexContents = {
    type: 'bubble',
    hero: {
      type: 'image',
      url: 'https://images.unsplash.com/photo-1545173168-9f1947eebd01?auto=format&fit=crop&w=1000&q=80',
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover'
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: 'Laundry Service Update',
          weight: 'bold',
          color: '#8E44AD',
          size: 'sm'
        },
        {
          type: 'text',
          text: statusText,
          weight: 'bold',
          size: 'xxl',
          margin: 'md',
          color: statusColor
        },
        {
          type: 'text',
          text: `เลขออเดอร์: ${order.id}`,
          size: 'xs',
          color: '#aaaaaa',
          margin: 'xs'
        },
        {
          type: 'separator',
          margin: 'lg'
        },
        {
          type: 'box',
          layout: 'vertical',
          margin: 'lg',
          spacing: 'sm',
          contents: [
            ...flexItemsList,
            {
              type: 'box',
              layout: 'horizontal',
              margin: 'md',
              contents: [
                {
                  type: 'text',
                  text: 'นัดหมายรับผ้า',
                  size: 'sm',
                  color: '#555555',
                  flex: 3
                },
                {
                  type: 'text',
                  text: dateFormatted,
                  size: 'sm',
                  color: '#111111',
                  align: 'end',
                  flex: 4,
                  wrap: true
                }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'text',
                  text: 'การจัดส่ง',
                  size: 'sm',
                  color: '#555555',
                  flex: 3
                },
                {
                  type: 'text',
                  text: order.deliveryMethod === 'dropoff' ? 'ลูกค้ามาส่ง/รับเอง' : 'ให้ร้านไปรับ/ส่งคืน',
                  size: 'sm',
                  color: '#111111',
                  align: 'end',
                  flex: 4
                }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'text',
                  text: 'การชำระเงิน',
                  size: 'sm',
                  color: '#555555',
                  flex: 3
                },
                {
                  type: 'text',
                  text: order.paymentMethod === 'transfer' ? 'โอนเงินผ่านธนาคาร' : 'เงินสด',
                  size: 'sm',
                  color: '#111111',
                  align: 'end',
                  flex: 4
                }
              ]
            },
            ...discountContents,
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'text',
                  text: 'ยอดรวมทั้งสิ้น',
                  size: 'sm',
                  color: '#555555',
                  flex: 3
                },
                {
                  type: 'text',
                  text: `฿ ${order.totalPrice.toFixed(2)}`,
                  size: 'sm',
                  weight: 'bold',
                  color: '#8E44AD',
                  align: 'end',
                  flex: 4
                }
              ]
            },
            ...flexPointsContents
          ]
        },
        {
          type: 'separator',
          margin: 'lg'
        },
        {
          type: 'box',
          layout: 'vertical',
          margin: 'lg',
          contents: [
            {
              type: 'text',
              text: statusDescription,
              size: 'xs',
              color: '#777777',
              wrap: true
            }
          ]
        }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'button',
          style: 'secondary',
          action: {
            type: 'uri',
            label: 'ติดต่อเจ้าหน้าที่',
            uri: 'https://line.me'
          }
        }
      ]
    }
  };

  const message = {
    type: 'flex',
    altText: `อัปเดตสถานะออเดอร์ซักรีด: ${statusText}`,
    contents: flexContents
  };

  try {
    if (customerId.startsWith('MOCK') || !hasCredentials) {
      console.log(`[MOCK LINE PUSH] To: ${customerId}`, JSON.stringify(message, null, 2));
      return;
    }

    if (replyToken) {
      await lineClient.replyMessage(replyToken, message);
      console.log(`[LINE] Replying status Flex message to user ${customerId}`);
    } else {
      await lineClient.pushMessage(customerId, message);
      console.log(`[LINE] Pushing status Flex message to user ${customerId}`);
    }
  } catch (err) {
    console.error('Error sending Flex message via LINE Messaging API:', err);
  }
}

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Laundry backend server is running on http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
