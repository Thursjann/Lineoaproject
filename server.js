require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const line = require("@line/bot-sdk");
const { dbQuery, initDatabase } = require("./db");

const app = express();
const PORT = process.env.PORT || 5678;

// Initialize Database
initDatabase();

// LINE SDK Configuration
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || "MOCK_TOKEN",
  channelSecret: process.env.LINE_CHANNEL_SECRET || "MOCK_SECRET",
};

// Create LINE SDK client
let lineClient;
const hasCredentials =
  process.env.LINE_CHANNEL_ACCESS_TOKEN &&
  process.env.LINE_CHANNEL_ACCESS_TOKEN !== "YOUR_CHANNEL_ACCESS_TOKEN" &&
  process.env.LINE_CHANNEL_SECRET &&
  process.env.LINE_CHANNEL_SECRET !== "YOUR_CHANNEL_SECRET";

if (hasCredentials) {
  lineClient = new line.Client(lineConfig);
  console.log("LINE Client initialized with active credentials.");
} else {
  console.warn(
    "⚠️ WARNING: LINE credentials are not set. Running in MOCK LINE mode.",
  );
  lineClient = {
    pushMessage: async (to, messages) => {
      console.log(
        `[MOCK LINE PUSH] To: ${to}`,
        JSON.stringify(messages, null, 2),
      );
      return { mock: true };
    },
    replyMessage: async (replyToken, messages) => {
      console.log(
        `[MOCK LINE REPLY] Token: ${replyToken}`,
        JSON.stringify(messages, null, 2),
      );
      return { mock: true };
    },
    getProfile: async (userId) => {
      console.log(`[MOCK LINE GET PROFILE] User ID: ${userId}`);
      return {
        userId,
        displayName: `LINE User (${userId.substring(0, 5)})`,
        pictureUrl: "https://cdn-icons-png.flaticon.com/512/847/847969.png",
        statusMessage: "Mock LINE user",
      };
    },
  };
}

// Admin Authentication Middleware
function verifyAdminToken(req, res, next) {
  // If the request contains a userId query parameter, it is a customer LIFF client call -> bypass admin token check
  if (req.query.userId) {
    return next();
  }

  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return res.status(401).json({ error: "Unauthorized: Missing token" });
  }

  const token = authHeader.split(" ")[1];
  const expectedToken = process.env.ADMIN_TOKEN || "admin-session-secure-token";

  if (token !== expectedToken) {
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }

  next();
}

// ----------------------------------------------------
// 1. LINE Webhook Endpoint (Must be BEFORE express.json())
// ----------------------------------------------------
app.post(
  "/webhook",
  (req, res, next) => {
    if (!hasCredentials) {
      return next();
    }
    line.middleware(lineConfig)(req, res, next);
  },
  async (req, res) => {
    try {
      const events = req.body.events || [];
      console.log(`Received Webhook event count: ${events.length}`);

      for (const event of events) {
        await handleLineEvent(event);
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error handling webhook events:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

// If mock webhook is called in development
app.post("/webhook/mock", express.json(), async (req, res) => {
  try {
    const events = req.body.events || [];
    console.log(`Received MOCK Webhook event count: ${events.length}`);
    for (const event of events) {
      await handleLineEvent(event);
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Error handling mock webhook:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ----------------------------------------------------
// 2. Middlewares (Applied after webhook)
// ----------------------------------------------------
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ----------------------------------------------------
// 3. API Endpoints
// ----------------------------------------------------

// Admin Login authentication API
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;
  const expectedUser = process.env.ADMIN_USERNAME || "admin";
  const expectedPass = process.env.ADMIN_PASSWORD || "laundry123";
  const token = process.env.ADMIN_TOKEN || "admin-session-secure-token";

  if (username === expectedUser && password === expectedPass) {
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: "ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง" });
  }
});

// Get configuration settings (e.g. LIFF ID)
app.get("/api/config", (req, res) => {
  res.json({
    liffId: process.env.LIFF_ID || "MOCK_LIFF_ID",
    promptPayNumber: process.env.PROMPTPAY_NUMBER || "0661129727",
  });
});

// Upsert Customer profile (triggered when LIFF loads)
app.post("/api/customers", async (req, res) => {
  try {
    const { id, displayName, pictureUrl } = req.body;
    if (!id) return res.status(400).json({ error: "Missing customer ID" });

    const existing = await dbQuery.get(
      "SELECT id, points, couponCount FROM customers WHERE id = ?",
      [id],
    );
    const now = new Date().toISOString();
    let currentPoints = 0;
    let couponCount = 0;

    if (existing) {
      currentPoints = existing.points;
      couponCount = existing.couponCount || 0;
      await dbQuery.run(
        "UPDATE customers SET displayName = ?, pictureUrl = ? WHERE id = ?",
        [displayName, pictureUrl, id],
      );
      console.log(
        `Updated customer profile: ${displayName} (${id}) - Points: ${currentPoints}, Coupons: ${couponCount}`,
      );
    } else {
      await dbQuery.run(
        "INSERT INTO customers (id, displayName, pictureUrl, points, couponCount, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
        [id, displayName, pictureUrl, 0, 0, now],
      );
      console.log(`Created new customer profile: ${displayName} (${id})`);
    }

    res.json({ success: true, points: currentPoints, couponCount });
  } catch (error) {
    console.error("Error in POST /api/customers:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get all service rates
app.get("/api/rates", async (req, res) => {
  try {
    const rates = await dbQuery.all("SELECT * FROM service_rates");
    res.json(rates);
  } catch (error) {
    console.error("Error in GET /api/rates:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get orders (protected for admin dashboard, unprotected for client history)
app.get("/api/orders", verifyAdminToken, async (req, res) => {
  try {
    const { userId } = req.query;
    let query, params;

    if (userId) {
      query =
        "SELECT * FROM orders WHERE customerId = ? ORDER BY createdAt DESC";
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
      const items = await dbQuery.all(
        "SELECT * FROM order_items WHERE orderId = ?",
        [order.id],
      );
      order.items = items;
    }

    res.json(orders);
  } catch (error) {
    console.error("Error in GET /api/orders:", error);
    res.status(500).json({ error: error.message });
  }
});

// Public order lookup by order number (used by the customer status page)
// ไม่ต้องใช้ admin token แต่ส่งคืนเฉพาะฟิลด์ที่จำเป็น ไม่รวม customerId (LINE userId)
app.get("/api/orders/:id", async (req, res) => {
  try {
    const order = await dbQuery.get("SELECT * FROM orders WHERE id = ?", [
      req.params.id,
    ]);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const items = await dbQuery.all(
      "SELECT serviceType, itemCount, price FROM order_items WHERE orderId = ?",
      [order.id],
    );

    res.json({
      id: order.id,
      status: order.status,
      deliveryDateTime: order.deliveryDateTime,
      deliveryMethod: order.deliveryMethod,
      paymentMethod: order.paymentMethod,
      totalPrice: order.totalPrice,
      discountApplied: order.discountApplied,
      createdAt: order.createdAt,
      items,
    });
  } catch (error) {
    console.error("Error in GET /api/orders/:id:", error);
    res.status(500).json({ error: error.message });
  }
});

// Create a new order (with multiple items)
app.post("/api/orders", async (req, res) => {
  try {
    const {
      customerId,
      latitude,
      longitude,
      deliveryDateTime,
      items,
      deliveryMethod,
      paymentMethod,
      useCoupon,
    } = req.body;

    if (
      !customerId ||
      !deliveryDateTime ||
      !items ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res
        .status(400)
        .json({ error: "Missing required order fields or items array" });
    }

    const orderId = `ORD-${Math.floor(10000 + Math.random() * 90000)}`;
    const now = new Date().toISOString();
    let totalPrice = 0;
    let totalCount = 0;

    const rates = await dbQuery.all("SELECT * FROM service_rates");
    const ratesMap = {};
    rates.forEach((r) => {
      ratesMap[r.name] = r.pricePerUnit;
    });

    const validatedItems = [];
    for (const item of items) {
      const pricePerUnit = ratesMap[item.serviceType];
      if (pricePerUnit === undefined) {
        return res
          .status(400)
          .json({ error: `Invalid service type: ${item.serviceType}` });
      }
      const itemSubtotal = item.itemCount * pricePerUnit;
      totalPrice += itemSubtotal;
      totalCount += item.itemCount;

      validatedItems.push({
        serviceType: item.serviceType,
        itemCount: item.itemCount,
        price: itemSubtotal,
      });
    }

    // Apply wholesale discount (20% off) if total items count is >= 50
    let discountApplied = 0;
    if (totalCount >= 50) {
      discountApplied = Math.round(totalPrice * 0.2 * 100) / 100;
      totalPrice = Math.max(0, totalPrice - discountApplied);
    }

    // Apply Coupon discount if checked and user has active coupons
    if (useCoupon) {
      const customer = await dbQuery.get(
        "SELECT couponCount FROM customers WHERE id = ?",
        [customerId],
      );
      if (customer && customer.couponCount > 0) {
        // Deduct 1 coupon from user balance
        const newCouponCount = customer.couponCount - 1;
        await dbQuery.run("UPDATE customers SET couponCount = ? WHERE id = ?", [
          newCouponCount,
          customerId,
        ]);

        // Add 100 Baht discount
        discountApplied += 100;
        totalPrice = Math.max(0, totalPrice - 100);
        console.log(
          `Applied 100 Baht discount coupon for customer ${customerId}. Unused coupons left: ${newCouponCount}`,
        );
      }
    }

    // Insert Order Parent
    await dbQuery.run(
      `
      INSERT INTO orders (id, customerId, latitude, longitude, deliveryDateTime, totalPrice, status, pointsEarned, deliveryMethod, paymentMethod, discountApplied, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        orderId,
        customerId,
        latitude ? parseFloat(latitude) : null,
        longitude ? parseFloat(longitude) : null,
        deliveryDateTime,
        totalPrice,
        "pending",
        0,
        deliveryMethod || "pickup",
        paymentMethod || "cash",
        discountApplied,
        now,
      ],
    );

    // Insert Order Children
    for (const item of validatedItems) {
      await dbQuery.run(
        `
        INSERT INTO order_items (orderId, serviceType, itemCount, price)
        VALUES (?, ?, ?, ?)
      `,
        [orderId, item.serviceType, item.itemCount, item.price],
      );
    }

    console.log(
      `Created Order ${orderId} with ${validatedItems.length} items (Total: ${totalCount} pcs). Discount: ${discountApplied}. Method: ${deliveryMethod}, Payment: ${paymentMethod}`,
    );

    const orderData = await dbQuery.get("SELECT * FROM orders WHERE id = ?", [
      orderId,
    ]);
    orderData.items = validatedItems;

    await sendStatusFlexMessage(customerId, orderData);

    res.json({ success: true, orderId, totalPrice, discountApplied });
  } catch (error) {
    console.error("Error in POST /api/orders:", error);
    res.status(500).json({ error: error.message });
  }
});

// Update order (PUT /api/orders/:id) -> protected
app.put("/api/orders/:id", verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { deliveryDateTime, items } = req.body;

    const order = await dbQuery.get("SELECT * FROM orders WHERE id = ?", [id]);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (
      !deliveryDateTime ||
      !items ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({ error: "Missing required update fields" });
    }

    const rates = await dbQuery.all("SELECT * FROM service_rates");
    const ratesMap = {};
    rates.forEach((r) => {
      ratesMap[r.name] = r.pricePerUnit;
    });

    let newTotalPrice = 0;
    const validatedItems = [];
    for (const item of items) {
      const pricePerUnit = ratesMap[item.serviceType];
      if (pricePerUnit === undefined) {
        return res
          .status(400)
          .json({ error: `Invalid service type: ${item.serviceType}` });
      }
      const itemSubtotal = item.itemCount * pricePerUnit;
      newTotalPrice += itemSubtotal;

      validatedItems.push({
        serviceType: item.serviceType,
        itemCount: item.itemCount,
        price: itemSubtotal,
      });
    }

    // Begin updates
    await dbQuery.run("DELETE FROM order_items WHERE orderId = ?", [id]);

    for (const item of validatedItems) {
      await dbQuery.run(
        `
        INSERT INTO order_items (orderId, serviceType, itemCount, price)
        VALUES (?, ?, ?, ?)
      `,
        [id, item.serviceType, item.itemCount, item.price],
      );
    }

    // Recalculate points if order is already completed
    let newPointsEarned = order.pointsEarned;

    await dbQuery.run(
      `
      UPDATE orders
      SET deliveryDateTime = ?, totalPrice = ?, pointsEarned = ?
      WHERE id = ?
    `,
      [deliveryDateTime, newTotalPrice, newPointsEarned, id],
    );

    console.log(`Updated Order ${id} to new total: ฿${newTotalPrice}`);

    const updatedOrder = await dbQuery.get(
      "SELECT * FROM orders WHERE id = ?",
      [id],
    );
    updatedOrder.items = validatedItems;
    await sendStatusFlexMessage(updatedOrder.customerId, updatedOrder);

    res.json({ success: true, totalPrice: newTotalPrice });
  } catch (error) {
    console.error(`Error updating order ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Update order status only (PUT /api/orders/:id/status) -> protected
app.put("/api/orders/:id/status", verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = [
      "pending",
      "picked_up",
      "washing",
      "completed",
      "delivered",
    ];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const order = await dbQuery.get("SELECT * FROM orders WHERE id = ?", [id]);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Stamps calculation logic (1 delivered order = 1 stamp)
    if (
      status === "delivered" &&
      order.status !== "delivered" &&
      order.pointsEarned === 0
    ) {
      await dbQuery.run(
        "UPDATE customers SET points = points + 1 WHERE id = ?",
        [order.customerId],
      );
      await dbQuery.run("UPDATE orders SET pointsEarned = 1 WHERE id = ?", [
        id,
      ]);
      console.log(
        `🏆 Credited e-Stamp: +1 stamp to customer ${order.customerId} for delivered Order ${id}`,
      );
    }

    await dbQuery.run("UPDATE orders SET status = ? WHERE id = ?", [
      status,
      id,
    ]);
    console.log(`Updated Order ${id} status to: ${status}`);

    const updatedOrder = await dbQuery.get(
      "SELECT * FROM orders WHERE id = ?",
      [id],
    );
    const items = await dbQuery.all(
      "SELECT * FROM order_items WHERE orderId = ?",
      [id],
    );
    updatedOrder.items = items;

    await sendStatusFlexMessage(updatedOrder.customerId, updatedOrder);

    res.json({ success: true });
  } catch (error) {
    console.error("Error in PUT /api/orders/:id/status:", error);
    res.status(500).json({ error: error.message });
  }
});

// Delete order -> protected
app.delete("/api/orders/:id", verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;

    const order = await dbQuery.get("SELECT * FROM orders WHERE id = ?", [id]);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // If deleting a delivered order, subtract the points earned from the customer (cap at 0)
    if (order.status === "delivered" && order.pointsEarned > 0) {
      await dbQuery.run(
        "UPDATE customers SET points = max(0, points - ?) WHERE id = ?",
        [order.pointsEarned, order.customerId],
      );
      console.log(
        `Subtracted ${order.pointsEarned} loyalty stamps from customer ${order.customerId} due to deletion of Delivered Order ${id}`,
      );
    }

    await dbQuery.run("DELETE FROM order_items WHERE orderId = ?", [id]);
    await dbQuery.run("DELETE FROM orders WHERE id = ?", [id]);

    console.log(`Deleted Order ${id} from database.`);
    res.json({ success: true });
  } catch (error) {
    console.error(`Error deleting order ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Redeem e-Stamp coupon
app.post("/api/customers/:id/redeem", async (req, res) => {
  try {
    const { id } = req.params;
    const customer = await dbQuery.get(
      "SELECT points, displayName, couponCount FROM customers WHERE id = ?",
      [id],
    );
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    if (customer.points < 10) {
      return res.status(400).json({
        error:
          "แสตมป์สะสมไม่เพียงพอสำหรับการแลกรางวัล (ต้องการขั้นต่ำ 10 แสตมป์)",
      });
    }

    const newPoints = customer.points - 10;
    const newCouponCount = (customer.couponCount || 0) + 1;
    await dbQuery.run(
      "UPDATE customers SET points = ?, couponCount = ? WHERE id = ?",
      [newPoints, newCouponCount, id],
    );
    console.log(
      `Redeemed coupon for customer ${customer.displayName} (${id}). Remaining stamps: ${newPoints}, Coupons: ${newCouponCount}`,
    );

    // Send congratulations push message
    try {
      if (id.startsWith("MOCK") || !hasCredentials) {
        console.log(
          `[MOCK LINE PUSH REDEEM] To: ${id} - Coupon redeemed successfully. Remaining stamps: ${newPoints}`,
        );
      } else {
        await lineClient.pushMessage(id, {
          type: "text",
          text: `🎉 ยินดีด้วยครับ! คุณ ${customer.displayName} ได้ทำการแลกรับคูปองส่วนลดพิเศษ 100 บาท สำเร็จเรียบร้อยแล้ว!\n🌟 แสตมป์สะสมคงเหลือ: ${newPoints} ดวง`,
        });
      }
    } catch (e) {
      console.error("Error sending redeem notification:", e);
    }

    res.json({ success: true, points: newPoints, couponCount: newCouponCount });
  } catch (error) {
    console.error("Error in POST /api/customers/:id/redeem:", error);
    res.status(500).json({ error: error.message });
  }
});

// Broadcast promotion to all registered customers -> protected
app.post("/api/broadcast", verifyAdminToken, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || message.trim() === "") {
      return res.status(400).json({ error: "Missing broadcast message text" });
    }

    const customers = await dbQuery.all(
      "SELECT id, displayName FROM customers",
    );
    console.log(
      `Sending broadcast message to ${customers.length} customers...`,
    );

    let successCount = 0;
    for (const customer of customers) {
      try {
        if (customer.id.startsWith("MOCK") || !hasCredentials) {
          console.log(
            `[MOCK LINE PUSH BROADCAST] To: ${customer.id} - Msg: ${message}`,
          );
          successCount++;
          continue;
        }
        await lineClient.pushMessage(customer.id, {
          type: "text",
          text: `📢 ข่าวสาร & โปรโมชั่นพิเศษสุดคุ้มจาก Fitcheck Laundry!\n\n${message}\n\n🧺 สอบถามเพิ่มเติมหรือจองคิวซักรีดผ่านเมนูด้านล่างได้เลยครับ`,
        });
        successCount++;
      } catch (err) {
        console.error(
          `Failed to push broadcast to user ${customer.id}:`,
          err.message,
        );
      }
    }

    res.json({ success: true, count: successCount });
  } catch (error) {
    console.error("Error in POST /api/broadcast:", error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------
// 4. LINE Webhook Handling logic
// ----------------------------------------------------
async function handleLineEvent(event) {
  if (event.type === "follow") {
    const userId = event.source.userId;
    try {
      const profile = await lineClient.getProfile(userId);
      const now = new Date().toISOString();

      const existing = await dbQuery.get(
        "SELECT id FROM customers WHERE id = ?",
        [userId],
      );
      if (existing) {
        await dbQuery.run(
          "UPDATE customers SET displayName = ?, pictureUrl = ? WHERE id = ?",
          [profile.displayName, profile.pictureUrl, userId],
        );
      } else {
        await dbQuery.run(
          "INSERT INTO customers (id, displayName, pictureUrl, points, createdAt) VALUES (?, ?, ?, ?, ?)",
          [userId, profile.displayName, profile.pictureUrl, 0, now],
        );
      }

      await lineClient.replyMessage(event.replyToken, {
        type: "text",
        text: `สวัสดีคุณ ${profile.displayName} ยินดีต้อนรับสู่ Fitcheck Laundry อัจฉริยะ! 🎉\nคุณสามารถกดปุ่มเมนูสั่งซักรีดได้ผ่านหน้าต่างแชทนี้เลยครับ`,
      });
    } catch (err) {
      console.error("Error processing follow event:", err);
    }
  }

  // ปุ่มแลกคูปองบนการ์ดบัตรสะสม
  if (event.type === "postback") {
    const userId = event.source.userId;
    const params = new URLSearchParams(event.postback?.data || "");

    if (params.get("action") === "redeem_coupon") {
      try {
        const customer = await dbQuery.get(
          "SELECT points, displayName, couponCount FROM customers WHERE id = ?",
          [userId],
        );

        if (!customer || customer.points < STAMP_GOAL) {
          await lineClient.replyMessage(event.replyToken, {
            type: "text",
            text: `แสตมป์สะสมยังไม่ครบ ${STAMP_GOAL} ดวงครับ (ตอนนี้มี ${customer?.points || 0} ดวง)`,
          });
          return;
        }

        const newPoints = customer.points - STAMP_GOAL;
        const newCouponCount = (customer.couponCount || 0) + 1;
        await dbQuery.run(
          "UPDATE customers SET points = ?, couponCount = ? WHERE id = ?",
          [newPoints, newCouponCount, userId],
        );
        console.log(
          `Redeemed coupon via LINE for ${customer.displayName} (${userId}). Stamps left: ${newPoints}, Coupons: ${newCouponCount}`,
        );

        // ตอบด้วยการ์ดใบใหม่ที่อัปเดตแต้มแล้ว
        await lineClient.replyMessage(event.replyToken, [
          {
            type: "text",
            text: `🎉 ยินดีด้วยครับ! แลกคูปองส่วนลด 100 บาท สำเร็จแล้ว\nใช้ได้ตอนจองคิวครั้งถัดไปเลยนะครับ`,
          },
          buildRewardCardFlex({
            ...customer,
            points: newPoints,
            couponCount: newCouponCount,
          }),
        ]);
      } catch (err) {
        console.error("Error redeeming coupon via LINE postback:", err);
      }
    }
    return;
  }

  if (event.type === "message" && event.message.type === "text") {
    const text = event.message.text.trim();
    const userId = event.source.userId;

    if (text === "เช็คสถานะ" || text === "สถานะออเดอร์") {
      try {
        const lastOrder = await dbQuery.get(
          "SELECT * FROM orders WHERE customerId = ? ORDER BY createdAt DESC LIMIT 1",
          [userId],
        );
        if (!lastOrder) {
          await lineClient.replyMessage(event.replyToken, {
            type: "text",
            text: "คุณยังไม่มีออเดอร์ในระบบ ณ ขณะนี้ สะดวกจองคิวซักรีดผ่านระบบ LIFF ได้ตลอดเวลาเลยนะครับ",
          });
        } else {
          const items = await dbQuery.all(
            "SELECT * FROM order_items WHERE orderId = ?",
            [lastOrder.id],
          );
          lastOrder.items = items;

          await sendStatusFlexMessage(userId, lastOrder, event.replyToken);
        }
      } catch (err) {
        console.error("Error checking status via text command:", err);
      }
    } else {
      await lineClient.replyMessage(event.replyToken, {
        type: "text",
        text: `ขออภัยครับ ตอนนี้ผมกำลังเรียนรู้ หากต้องการใช้บริการสั่งซักผ้าหรือดูสถานะปัจจุบัน สามารถกดที่แถบเมนูด้านล่างเพื่อเข้าใช้งานระบบได้เลยครับ 👔👕`,
      });
    }
  }
}

// ----------------------------------------------------
// 5. Flex Message Builder & Push Function
// ----------------------------------------------------
// สร้าง Flex bubble ของสถานะออเดอร์ (ใช้ร่วมกันระหว่าง LINE push/reply และ Dialogflow fulfillment)
async function buildStatusFlexContents(customerId, order) {
  let statusText = "";
  let statusColor = "";
  let statusDescription = "";

  // Public HTTPS image URLs accessible anywhere on LINE platform
  const statusCloudImages = {
    pending: "https://cdn.discordapp.com/attachments/1126575683032854538/1534941595516797100/Pending.jpg?ex=6a75f542&is=6a74a3c2&hm=cbc0ca61e4b9f10feb7c4e7d3375506460817b56f123169109f2501beb6e746f&",
    picked_up: "https://cdn.discordapp.com/attachments/1126575683032854538/1534941595751813364/Picked_Up.jpg?ex=6a75f542&is=6a74a3c2&hm=c111a416748efc8955a1aeb4cafeabb82b20abd34b076ed65406825c8e2c6ea7&",
    washing: "https://cdn.discordapp.com/attachments/1126575683032854538/1534941595974107196/Washing.jpg?ex=6a75f542&is=6a74a3c2&hm=bdff6bff86faa6005cbfc7c311e22991fa90b8cbeb752639a3c15ca8d356ca58&",
    completed: "https://cdn.discordapp.com/attachments/1126575683032854538/1534941594996703452/Completed.jpg?ex=6a75f542&is=6a74a3c2&hm=3684828a9a702e969f460251dc0a364c98d4c965e98fb4183d3d92f3120b4367&",
    delivered: "https://cdn.discordapp.com/attachments/1126575683032854538/1534941595269337099/Delivered.jpg?ex=6a75f542&is=6a74a3c2&hm=3de92455095fbc1aa5621b119de68a3de188e4eec2bc476aa044d88ecf7e8e83&"
  };

  const statusHeroImage = statusCloudImages[order.status] || statusCloudImages.pending;

  switch (order.status) {
    case "pending":
      statusText = "รอรับผ้า";
      statusColor = "#F39C12";
      statusDescription =
        "ร้านค้าได้รับออเดอร์เรียบร้อยแล้ว กำลังจัดส่งเจ้าหน้าที่ไปรับผ้าตามพิกัดและเวลานัดหมาย";
      break;
    case "picked_up":
      statusText = "รับผ้าแล้ว";
      statusColor = "#3498DB";
      statusDescription =
        "พนักงานเข้ารับตะกร้าผ้าของท่านเรียบร้อยแล้ว กำลังนำส่งไปยังโรงซัก";
      break;
    case "washing":
      statusText = "กำลังซัก";
      statusColor = "#9B59B6";
      statusDescription =
        "ผ้าของคุณอยู่ในขั้นตอนกระบวนการซัก อบ และรีด อย่างสะอาดปราณีต";
      break;
    case "completed":
      statusText = "ซักเสร็จสิ้น";
      statusColor = "#1ABC9C";
      statusDescription =
        "การซักเสร็จสมบูรณ์เรียบร้อยแล้ว เตรียมพร้อมทำการจัดส่งคืนลูกค้า";
      break;
    case "delivered":
      statusText = "จัดส่งแล้ว";
      statusColor = "#2ECC71";
      statusDescription =
        "ร้านค้าได้ทำการจัดส่งเสื้อผ้าสะอาดคืนสู่มือคุณเรียบร้อยแล้ว ขอบคุณที่ใช้บริการครับ";
      break;
    default:
      statusText = "ไม่ระบุสถานะ";
      statusColor = "#7F8C8D";
      statusDescription = "-";
  }

  let dateFormatted = order.deliveryDateTime;
  try {
    const dateObj = new Date(order.deliveryDateTime);
    if (!isNaN(dateObj)) {
      dateFormatted = dateObj.toLocaleString("th-TH", { hour12: false });
    }
  } catch (e) {}

  const items = order.items || [];
  const flexItemsList = items.map((item) => {
    return {
      type: "box",
      layout: "horizontal",
      contents: [
        {
          type: "text",
          text: item.serviceType,
          size: "sm",
          color: "#555555",
          flex: 3,
          wrap: true,
        },
        {
          type: "text",
          text: `${item.itemCount} ชิ้น`,
          size: "sm",
          color: "#111111",
          align: "end",
          flex: 2,
        },
      ],
    };
  });

  let customerPoints = 0;
  try {
    const customer = await dbQuery.get(
      "SELECT points FROM customers WHERE id = ?",
      [customerId],
    );
    if (customer) {
      customerPoints = customer.points;
    }
  } catch (err) {}

  const flexPointsContents = [];
  if (order.status === "delivered") {
    flexPointsContents.push(
      {
        type: "separator",
        margin: "md",
      },
      {
        type: "box",
        layout: "vertical",
        margin: "md",
        backgroundColor: "#FCF3CF",
        paddingAll: "10px",
        cornerRadius: "8px",
        contents: [
          {
            type: "text",
            text: `🎉 ได้รับแสตมป์สะสม: +1 ดวง`,
            weight: "bold",
            size: "sm",
            color: "#B9770E",
          },
          {
            type: "text",
            text: `🌟 แสตมป์สะสมทั้งหมดของคุณ: ${customerPoints} ดวง`,
            size: "xs",
            color: "#7E5109",
            margin: "xs",
          },
        ],
      },
    );
  }

  const discountContents = [];
  if (order.discountApplied && order.discountApplied > 0) {
    discountContents.push({
      type: "box",
      layout: "horizontal",
      contents: [
        {
          type: "text",
          text: "ส่วนลดราคาส่ง (20%)",
          size: "sm",
          color: "#E74C3C",
          flex: 3,
        },
        {
          type: "text",
          text: `- ฿ ${order.discountApplied.toFixed(2)}`,
          size: "sm",
          color: "#E74C3C",
          align: "end",
          flex: 4,
          weight: "bold",
        },
      ],
    });
  }

  const flexContents = {
    type: "bubble",
    hero: {
      type: "image",
      url: statusHeroImage,
      size: "full",
      aspectRatio: "20:13",
      aspectMode: "cover",
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "Laundry Service Update",
          weight: "bold",
          color: "#8E44AD",
          size: "sm",
        },
        {
          type: "text",
          text: statusText,
          weight: "bold",
          size: "xxl",
          margin: "md",
          color: statusColor,
        },
        {
          type: "text",
          text: `เลขออเดอร์: ${order.id}`,
          size: "xs",
          color: "#aaaaaa",
          margin: "xs",
        },
        {
          type: "separator",
          margin: "lg",
        },
        {
          type: "box",
          layout: "vertical",
          margin: "lg",
          spacing: "sm",
          contents: [
            ...flexItemsList,
            {
              type: "box",
              layout: "horizontal",
              margin: "md",
              contents: [
                {
                  type: "text",
                  text: "นัดหมายรับผ้า",
                  size: "sm",
                  color: "#555555",
                  flex: 3,
                },
                {
                  type: "text",
                  text: dateFormatted,
                  size: "sm",
                  color: "#111111",
                  align: "end",
                  flex: 4,
                  wrap: true,
                },
              ],
            },
            {
              type: "box",
              layout: "horizontal",
              contents: [
                {
                  type: "text",
                  text: "การจัดส่ง",
                  size: "sm",
                  color: "#555555",
                  flex: 3,
                },
                {
                  type: "text",
                  text:
                    order.deliveryMethod === "dropoff"
                      ? "ลูกค้ามาส่ง/รับเอง"
                      : "ให้ร้านไปรับ/ส่งคืน",
                  size: "sm",
                  color: "#111111",
                  align: "end",
                  flex: 4,
                },
              ],
            },
            {
              type: "box",
              layout: "horizontal",
              contents: [
                {
                  type: "text",
                  text: "การชำระเงิน",
                  size: "sm",
                  color: "#555555",
                  flex: 3,
                },
                {
                  type: "text",
                  text:
                    order.paymentMethod === "transfer"
                      ? "โอนเงินผ่านธนาคาร"
                      : "เงินสด",
                  size: "sm",
                  color: "#111111",
                  align: "end",
                  flex: 4,
                },
              ],
            },
            ...discountContents,
            {
              type: "box",
              layout: "horizontal",
              contents: [
                {
                  type: "text",
                  text: "ยอดรวมทั้งสิ้น",
                  size: "sm",
                  color: "#555555",
                  flex: 3,
                },
                {
                  type: "text",
                  text: `฿ ${order.totalPrice.toFixed(2)}`,
                  size: "sm",
                  weight: "bold",
                  color: "#8E44AD",
                  align: "end",
                  flex: 4,
                },
              ],
            },
            ...flexPointsContents,
          ],
        },
        {
          type: "separator",
          margin: "lg",
        },
        {
          type: "box",
          layout: "vertical",
          margin: "lg",
          contents: [
            {
              type: "text",
              text: statusDescription,
              size: "xs",
              color: "#777777",
              wrap: true,
            },
          ],
        },
      ],
    },
  };

  return {
    type: "flex",
    altText: `อัปเดตสถานะออเดอร์ซักรีด: ${statusText}`,
    contents: flexContents,
  };
}

// ส่ง Flex สถานะออเดอร์ผ่าน LINE Messaging API (reply ถ้ามี replyToken, ไม่งั้น push)
async function sendStatusFlexMessage(customerId, order, replyToken = null) {
  const message = await buildStatusFlexContents(customerId, order);

  try {
    if (customerId.startsWith("MOCK") || !hasCredentials) {
      console.log(
        `[MOCK LINE PUSH] To: ${customerId}`,
        JSON.stringify(message, null, 2),
      );
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
    console.error("Error sending Flex message via LINE Messaging API:", err);
  }
}

// ----------------------------------------------------
// 5.1 Reward Card (บัตรสะสมแสตมป์) Flex Builder
// ----------------------------------------------------
const STAMP_GOAL = 10; // สะสมครบกี่ดวงถึงแลกรางวัลได้

// สร้างวงกลมแสตมป์ 1 ดวง — ดวงที่สะสมแล้วเป็นสีน้ำตาลมีเครื่องหมาย ดวงที่ยังไม่ได้เป็นตัวเลขจาง
function buildStampSlot(index, earned, isGoal = false) {
  if (isGoal) {
    return {
      type: "box",
      layout: "vertical",
      width: "44px",
      height: "44px",
      cornerRadius: "22px",
      backgroundColor: earned ? "#F1C40F" : "#EFEBE7",
      justifyContent: "center",
      alignItems: "center",
      contents: [
        {
          type: "text",
          text: "GOAL",
          size: "xxs",
          weight: "bold",
          align: "center",
          color: earned ? "#FFFFFF" : "#B5A99E",
        },
      ],
    };
  }

  return {
    type: "box",
    layout: "vertical",
    width: "44px",
    height: "44px",
    cornerRadius: "22px",
    backgroundColor: earned ? "#83695B" : "#F7F4F1",
    borderWidth: earned ? "none" : "2px",
    borderColor: "#E8E0D9",
    justifyContent: "center",
    alignItems: "center",
    contents: [
      {
        type: "text",
        text: earned ? "🧺" : String(index),
        size: earned ? "lg" : "sm",
        weight: "bold",
        align: "center",
        color: earned ? "#FFFFFF" : "#C4B8AE",
      },
    ],
  };
}

// สร้างการ์ดบัตรสะสมแสตมป์
function buildRewardCardFlex(customer) {
  const points = customer.points || 0;
  const coupons = customer.couponCount || 0;
  const canRedeem = points >= STAMP_GOAL;
  const remaining = Math.max(0, STAMP_GOAL - points);

  // แถวที่ 1: ดวงที่ 1-5 | แถวที่ 2: ดวงที่ 6-9 + ช่อง GOAL
  const row1 = [];
  for (let i = 1; i <= 5; i++) {
    row1.push(buildStampSlot(i, points >= i));
  }

  const row2 = [];
  for (let i = 6; i <= 9; i++) {
    row2.push(buildStampSlot(i, points >= i));
  }
  row2.push(buildStampSlot(10, points >= STAMP_GOAL, true));

  const stampRow = (contents) => ({
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    margin: "md",
    contents,
  });

  // ข้อความสถานะใต้บัตร
  const statusMessage = canRedeem
    ? `🎉 สะสมครบแล้ว! กดปุ่มด้านล่างเพื่อแลกคูปองส่วนลด 100 บาท`
    : `สะสมอีก ${remaining} ดวง เพื่อแลกคูปองส่วนลด 100 บาท`;

  const bodyContents = [
    {
      type: "text",
      text: "บัตรสะสมแสตมป์",
      size: "xs",
      color: "#A89A8F",
      weight: "bold",
    },
    {
      type: "box",
      layout: "baseline",
      margin: "xs",
      contents: [
        {
          type: "text",
          text: `${points}`,
          size: "3xl",
          weight: "bold",
          color: "#83695B",
          flex: 0,
        },
        {
          type: "text",
          text: ` / ${STAMP_GOAL} ดวง`,
          size: "md",
          color: "#A89A8F",
          margin: "sm",
        },
      ],
    },
    stampRow(row1),
    stampRow(row2),
    {
      type: "separator",
      margin: "xl",
      color: "#EFEBE7",
    },
    {
      type: "text",
      text: statusMessage,
      size: "sm",
      color: canRedeem ? "#B9770E" : "#8A7B70",
      weight: canRedeem ? "bold" : "regular",
      wrap: true,
      margin: "lg",
    },
  ];

  // แสดงจำนวนคูปองที่ถืออยู่ (ถ้ามี)
  if (coupons > 0) {
    bodyContents.push({
      type: "box",
      layout: "vertical",
      margin: "md",
      backgroundColor: "#FCF3CF",
      paddingAll: "10px",
      cornerRadius: "8px",
      contents: [
        {
          type: "text",
          text: `🎁 คูปองส่วนลดที่ถืออยู่: ${coupons} ใบ`,
          size: "sm",
          weight: "bold",
          color: "#B9770E",
          wrap: true,
        },
        {
          type: "text",
          text: "ใช้เป็นส่วนลดได้ตอนจองคิวครั้งถัดไป",
          size: "xxs",
          color: "#9C7A1E",
          margin: "xs",
        },
      ],
    });
  }

  const flexContents = {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#83695B",
      paddingAll: "16px",
      contents: [
        {
          type: "text",
          text: "FITCHECK LAUNDRY",
          color: "#FFFFFF",
          size: "sm",
          weight: "bold",
        },
        {
          type: "text",
          text: customer.displayName || "ลูกค้า",
          color: "#E8DDD5",
          size: "xs",
          margin: "xs",
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "18px",
      contents: bodyContents,
    },
  };

  // ปุ่มแลกคูปอง แสดงเฉพาะตอนสะสมครบ
  if (canRedeem) {
    flexContents.footer = {
      type: "box",
      layout: "vertical",
      paddingAll: "12px",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#83695B",
          height: "sm",
          action: {
            type: "postback",
            label: "🎁 แลกคูปองส่วนลด 100 บาท",
            data: "action=redeem_coupon",
            displayText: "แลกคูปองส่วนลด",
          },
        },
      ],
    };
  }

  return {
    type: "flex",
    altText: `บัตรสะสมแสตมป์: ${points}/${STAMP_GOAL} ดวง`,
    contents: flexContents,
  };
}

// ส่งการ์ดบัตรสะสมให้ลูกค้า
async function sendRewardCard(customerId, replyToken = null) {
  const customer = await dbQuery.get(
    "SELECT id, displayName, points, couponCount FROM customers WHERE id = ?",
    [customerId],
  );

  if (!customer) {
    const notFound = {
      type: "text",
      text: "ยังไม่พบข้อมูลสมาชิกของคุณ กรุณาเริ่มใช้บริการผ่านเมนูจองคิวก่อนนะครับ",
    };
    if (replyToken) await lineClient.replyMessage(replyToken, notFound);
    else await lineClient.pushMessage(customerId, notFound);
    return;
  }

  const message = buildRewardCardFlex(customer);

  try {
    if (customerId.startsWith("MOCK") || !hasCredentials) {
      console.log(
        `[MOCK LINE PUSH REWARD CARD] To: ${customerId}`,
        JSON.stringify(message, null, 2),
      );
      return;
    }

    if (replyToken) {
      await lineClient.replyMessage(replyToken, message);
      console.log(`[LINE] Replying reward card to user ${customerId}`);
    } else {
      await lineClient.pushMessage(customerId, message);
      console.log(`[LINE] Pushing reward card to user ${customerId}`);
    }
  } catch (err) {
    console.error("Error sending reward card via LINE:", err);
  }
}

// ----------------------------------------------------
// 6. Dialogflow Fulfillment Webhook
// ----------------------------------------------------
// Dialogflow ยังคงเป็นเจ้าของ Webhook URL ของ LINE เหมือนเดิม
// Intent ที่เปิด "Enable webhook call for this intent" จะยิงเข้ามาที่นี่
// เพื่อดึงข้อมูลจริงจากฐานข้อมูล แล้วส่งกลับไปให้ Dialogflow ตอบผู้ใช้
app.post("/dialogflow-webhook", async (req, res) => {
  try {
    const body = req.body || {};
    const queryResult = body.queryResult || {};
    const intentName = queryResult.intent?.displayName || "(unknown)";

    // ดึง LINE userId + replyToken ออกจาก payload ที่ Dialogflow แนบมาจาก LINE
    const linePayload = body.originalDetectIntentRequest?.payload?.data || {};
    const userId = linePayload.source?.userId;
    const replyToken = linePayload.replyToken;

    console.log(
      `[Dialogflow] Intent: "${intentName}" | userId: ${userId || "N/A"}`,
    );

    // ตอบเป็นข้อความธรรมดา (ใช้กับกรณี error / ไม่มีออเดอร์)
    const reply = (text) => res.json({ fulfillmentText: text });

    // ส่ง Flex เองผ่าน LINE Messaging API แทนการฝากผ่าน Dialogflow
    // เพราะ Dialogflow LINE integration ไม่รองรับ Flex Message
    // ใช้ replyToken ก่อน (ไม่กินโควตาข้อความ) ถ้าไม่มีค่อย push
    // แล้วตอบ Dialogflow ด้วย response ว่าง เพื่อไม่ให้มีข้อความซ้อนกัน
    const sendFlexDirect = async (order) => {
      await sendStatusFlexMessage(userId, order, replyToken || null);
      return res.json({ fulfillmentMessages: [] });
    };

    if (!userId) {
      return reply(
        "ขออภัยครับ ระบบไม่สามารถระบุตัวตนของคุณได้ กรุณาทักผ่านแอป LINE อีกครั้งนะครับ",
      );
    }

    // intent บัตรสะสมแสตมป์ — ส่งการ์ด reward card
    const rewardIntents = ["แสตมป์", "บัตรสะสม", "สะสมแต้ม", "RewardCard"];
    const isRewardIntent = rewardIntents.some((name) =>
      intentName.includes(name),
    );

    if (isRewardIntent) {
      console.log(`[Dialogflow] Sending reward card to ${userId}`);
      await sendRewardCard(userId, replyToken || null);
      return res.json({ fulfillmentMessages: [] });
    }

    const lastOrder = await dbQuery.get(
      "SELECT * FROM orders WHERE customerId = ? ORDER BY createdAt DESC LIMIT 1",
      [userId],
    );

    if (!lastOrder) {
      return reply(
        "คุณยังไม่มีออเดอร์ในระบบ ณ ขณะนี้ สะดวกจองคิวซักรีดผ่านเมนูด้านล่างได้ตลอดเวลาเลยนะครับ",
      );
    }

    lastOrder.items = await dbQuery.all(
      "SELECT * FROM order_items WHERE orderId = ?",
      [lastOrder.id],
    );

    console.log(
      `[Dialogflow] Sending Flex directly for order ${lastOrder.id} (${replyToken ? "reply" : "push"})`,
    );
    return await sendFlexDirect(lastOrder);
  } catch (error) {
    console.error("Error handling Dialogflow fulfillment:", error);
    return res.json({
      fulfillmentText:
        "ขออภัยครับ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งนะครับ",
    });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(
    `🚀 Laundry backend server is running on http://localhost:${PORT}`,
  );
  console.log(`=======================================================`);
});
