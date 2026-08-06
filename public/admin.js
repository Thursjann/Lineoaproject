// Admin Dashboard Controller - Reusable One-to-Many Architecture
const API_URL = '/api/orders';
let allServiceRates = [];

// Auth check at the very beginning
const adminToken = localStorage.getItem('admin_token');
if (!adminToken) {
  window.location.href = 'admin-login.html';
}

// Reusable authenticated fetch helper
async function fetchWithAuth(url, options = {}) {
  const token = localStorage.getItem('admin_token');
  if (!token) {
    window.location.href = 'admin-login.html';
    return;
  }

  if (!options.headers) {
    options.headers = {};
  }
  options.headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(url, options);
  if (response.status === 401) {
    localStorage.removeItem('admin_token');
    window.location.href = 'admin-login.html';
    throw new Error('Unauthorized');
  }
  return response;
}

window.handleLogout = function() {
  localStorage.removeItem('admin_token');
  window.location.href = 'admin-login.html';
};

// DOM Elements
const editModal = document.getElementById('edit-modal');
const editOrderIdInput = document.getElementById('edit-order-id');
const editDeliveryTimeInput = document.getElementById('edit-delivery-time');
const editServicesContainer = document.getElementById('edit-services-container');

// Run on page load
document.addEventListener('DOMContentLoaded', async () => {
  await fetchServiceRates();
  await fetchAndRenderOrders();
  
  // Auto-refresh interval (polling) every 4 seconds for instant real-time sync
  setInterval(fetchAndRenderOrders, 4000);
});

// Fetch rates once to populate Edit modal checkboxes
async function fetchServiceRates() {
  try {
    const res = await fetch('/api/rates');
    if (res.ok) {
      allServiceRates = await res.json();
    }
  } catch (err) {
    console.error('Error fetching service rates:', err);
  }
}

// Fetch all orders and distribute into columns
async function fetchAndRenderOrders() {
  try {
    const response = await fetchWithAuth(API_URL);
    if (!response) return;
    if (!response.ok) throw new Error('Failed to fetch orders');
    const orders = await response.json();
    
    const columns = {
      pending: { el: document.getElementById('col-pending'), orders: [], countEl: document.getElementById('count-pending') },
      picked_up: { el: document.getElementById('col-picked_up'), orders: [], countEl: document.getElementById('count-picked_up') },
      washing: { el: document.getElementById('col-washing'), orders: [], countEl: document.getElementById('count-washing') },
      completed: { el: document.getElementById('col-completed'), orders: [], countEl: document.getElementById('count-completed') },
      delivered: { el: document.getElementById('col-delivered'), orders: [], countEl: document.getElementById('count-delivered') }
    };

    Object.keys(columns).forEach(status => {
      columns[status].el.innerHTML = '';
    });

    orders.forEach(order => {
      if (columns[order.status]) {
        columns[order.status].orders.push(order);
      }
    });

    Object.keys(columns).forEach(status => {
      const col = columns[status];
      col.countEl.innerText = col.orders.length;
      
      if (col.orders.length === 0) {
        col.el.innerHTML = `
          <div class="empty-state">
            ไม่มีออเดอร์ในสถานะนี้
          </div>
        `;
        return;
      }

      col.orders.forEach(order => {
        const card = document.createElement('div');
        card.className = 'order-card';
        
        let dateFormatted = order.deliveryDateTime;
        try {
          const dateObj = new Date(order.deliveryDateTime);
          if (!isNaN(dateObj)) {
            dateFormatted = dateObj.toLocaleString('th-TH', { 
              dateStyle: 'medium', 
              timeStyle: 'short' 
            });
          }
        } catch (e) {}

        const elapsedText = timeAgo(order.createdAt);
        const customerName = order.displayName || `ลูกค้าทั่วไป (${order.customerId.substring(0, 5)})`;
        const customerPoints = order.points !== undefined ? order.points : 0;
        
        const customerAvatar = order.pictureUrl || 'https://cdn-icons-png.flaticon.com/512/847/847969.png';

        // Format items list inside the card
        const itemsHtml = order.items && order.items.length > 0
          ? order.items.map(item => `
              <div class="detail-row">
                <span class="detail-label">${item.serviceType}</span>
                <span class="detail-val">${item.itemCount} ชิ้น</span>
              </div>
            `).join('')
          : '<div style="color:var(--danger)">ไม่มีรายการผ้า</div>';

        // Prepare actions based on status column
        let actionButtons = '';
        if (order.status === 'pending') {
          actionButtons = `
            <button class="btn-action btn-pending" onclick="updateOrderStatus('${order.id}', 'picked_up')">
              รับผ้าแล้ว ➔
            </button>
          `;
        } else if (order.status === 'picked_up') {
          actionButtons = `
            <button class="btn-action btn-picked_up" onclick="updateOrderStatus('${order.id}', 'washing')">
              ส่งซัก ➔
            </button>
          `;
        } else if (order.status === 'washing') {
          actionButtons = `
            <button class="btn-action" style="background-color:#17A589" onclick="updateOrderStatus('${order.id}', 'completed')">
              เสร็จสิ้น ➔
            </button>
          `;
        } else if (order.status === 'completed') {
          actionButtons = `
            <button class="btn-action" style="background-color:#2ECC71" onclick="updateOrderStatus('${order.id}', 'delivered')">
              จัดส่งแล้ว ➔
            </button>
          `;
        }

        // Map link if coordinates exist
        let mapsHtml = '';
        if (order.latitude && order.longitude) {
          mapsHtml = `
            <div class="detail-row" style="margin-top: 4px;">
              <span class="detail-label">ตำแหน่งรับผ้า:</span>
              <span class="detail-val">
                <a href="https://www.google.com/maps/search/?api=1&query=${order.latitude},${order.longitude}" target="_blank" class="location-link">
                  Google Maps 📍
                </a>
              </span>
            </div>
          `;
        }

        const encodedItems = encodeURIComponent(JSON.stringify(order.items || []));

        let displayOrderId = order.id;
        if (displayOrderId.includes('-')) {
          const parts = displayOrderId.split('-');
          displayOrderId = `ORD-${parts[parts.length - 1].substring(0, 5)}`;
        } else {
          displayOrderId = `ORD-${displayOrderId.substring(0, 5)}`;
        }

        card.innerHTML = `
          <div class="card-header">
            <div class="customer-avatar-group">
              <img src="${customerAvatar}" class="customer-avatar" alt="Avatar">
              <div class="customer-name-group">
                <div class="customer-name">${customerName}</div>
                <div class="customer-points">🌟 ${customerPoints} แสตมป์</div>
              </div>
            </div>
            <span class="card-time">${elapsedText}</span>
          </div>
          
          <div class="order-details">
            <div class="detail-row">
              <span class="detail-label">เลขออเดอร์:</span>
              <span class="detail-val" style="font-size:12px; color:var(--primary); font-weight:700; font-family:var(--font-heading);">${displayOrderId}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">นัดรับผ้า:</span>
              <span class="detail-val" style="color:var(--text-main); font-weight:600;">${dateFormatted}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">การจัดส่ง:</span>
              <span class="detail-val" style="font-weight:500;">${order.deliveryMethod === 'dropoff' ? 'ลูกค้ามาส่ง/รับเอง' : 'ให้ร้านไปรับ/ส่งคืน'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">การชำระเงิน:</span>
              <span class="detail-val" style="font-weight:500;">${order.paymentMethod === 'transfer' ? 'โอนเงิน' : 'เงินสด'}</span>
            </div>
            ${mapsHtml}
            <div style="border-top:1px dashed var(--border); margin:8px 0; padding-top:8px;">
              ${itemsHtml}
            </div>
            ${order.discountApplied > 0 ? `
            <div class="detail-row" style="color:#E74C3C; font-size:12px; font-weight:600;">
              <span>ส่วนลดราคาส่ง (20%):</span>
              <span>- ฿${order.discountApplied.toFixed(2)}</span>
            </div>
            ` : ''}
            <div class="detail-row" style="font-weight:700; font-size:14px; margin-top:8px; border-top:1px solid var(--border); padding-top:6px;">
              <span style="color:var(--text-muted)">ราคารวม:</span>
              <span style="color:var(--primary)">฿${order.totalPrice.toFixed(2)}</span>
            </div>
          </div>

          <div class="card-footer-actions">
            <button class="btn-card-util btn-edit" onclick="openEditModal('${order.id}', '${order.deliveryDateTime}', '${encodedItems}')">แก้ไข</button>
            <button class="btn-card-util btn-delete" onclick="deleteOrder('${order.id}')">ลบ</button>
            <div style="flex:1; text-align:right;">
              ${actionButtons}
            </div>
          </div>
        `;

        col.el.appendChild(card);
      });
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
  }
}

// ----------------------------------------------------
// Admin Action handlers
// ----------------------------------------------------

async function updateOrderStatus(orderId, newStatus) {
  try {
    const response = await fetchWithAuth(`/api/orders/${orderId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });

    if (response && !response.ok) throw new Error('Failed to update status');
    await fetchAndRenderOrders();
  } catch (error) {
    console.error('Error updating status:', error);
    alert('ไม่สามารถอัปเดตสถานะได้ในขณะนี้');
  }
}

async function deleteOrder(orderId) {
  if (!confirm('⚠️ คุณต้องการลบออเดอร์นี้และประวัติทั้งหมดใช่หรือไม่? (การดำเนินการนี้ไม่สามารถย้อนกลับได้)')) {
    return;
  }

  try {
    const response = await fetchWithAuth(`/api/orders/${orderId}`, {
      method: 'DELETE'
    });

    if (response && !response.ok) throw new Error('Failed to delete order');
    await fetchAndRenderOrders();
  } catch (err) {
    console.error('Error deleting order:', err);
    alert('ไม่สามารถลบออเดอร์นี้ได้ กรุณาลองใหม่อีกครั้ง');
  }
}

// Edit Modal functions (One-to-Many updates)
window.openEditModal = function(orderId, deliveryTime, encodedItems) {
  const items = JSON.parse(decodeURIComponent(encodedItems));
  
  editOrderIdInput.value = orderId;
  editDeliveryTimeInput.value = deliveryTime;
  
  // Group rates by category for the Edit modal checklist
  const grouped = {};
  allServiceRates.forEach(rate => {
    if (!grouped[rate.category]) {
      grouped[rate.category] = [];
    }
    grouped[rate.category].push(rate);
  });

  let editHtml = '';
  for (const category in grouped) {
    editHtml += `
      <div style="margin-top: 10px; margin-bottom: 6px;">
        <h4 style="font-size:12px; font-weight:600; color:var(--primary); border-left: 2px solid var(--primary); padding-left: 6px; margin-bottom: 6px;">
          ${category}
        </h4>
        <div style="display:flex; flex-direction:column; gap:8px;">
    `;
    
    grouped[category].forEach(rate => {
      // Check if this rate exists in order
      const orderedItem = items.find(item => item.serviceType === rate.name);
      const isChecked = !!orderedItem;
      const qty = isChecked ? orderedItem.itemCount : 1;
      
      editHtml += `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; border:1px solid var(--border); border-radius:8px; background:#FAFAFA;">
          <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:500; cursor:pointer; flex:1; margin:0;">
            <input type="checkbox" class="edit-service-checkbox" value="${rate.name}" ${isChecked ? 'checked' : ''} onchange="toggleEditServiceQty(this)" style="width:16px; height:16px; accent-color:var(--primary);">
            <span>${rate.name}</span>
          </label>
          <div style="display:flex; align-items:center; gap:4px;">
            <button type="button" class="edit-qty-btn-minus" data-service="${rate.name}" onclick="adjustEditQty('${rate.name}', -1)" ${isChecked ? '' : 'disabled'} style="width: 24px; height: 24px; border-radius: 4px; border: 1px solid var(--border); background: ${isChecked ? '#FFF' : '#EEE'}; color: ${isChecked ? 'var(--text-main)' : 'var(--text-muted)'}; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; font-weight: bold; border-style: solid;">-</button>
            <input type="number" class="edit-service-qty" data-service="${rate.name}" min="1" max="100" value="${qty}" ${isChecked ? '' : 'disabled'} style="width:36px; padding:2px; font-size:13px; text-align:center; border:1px solid var(--border); border-radius:6px; outline:none; background: ${isChecked ? '#FFF' : '#EEE'}; -webkit-appearance: none; -moz-appearance: textfield; margin: 0;">
            <button type="button" class="edit-qty-btn-plus" data-service="${rate.name}" onclick="adjustEditQty('${rate.name}', 1)" ${isChecked ? '' : 'disabled'} style="width: 24px; height: 24px; border-radius: 4px; border: 1px solid var(--border); background: ${isChecked ? '#FFF' : '#EEE'}; color: ${isChecked ? 'var(--text-main)' : 'var(--text-muted)'}; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; font-weight: bold; border-style: solid;">+</button>
          </div>
        </div>
      `;
    });

    editHtml += `
        </div>
      </div>
    `;
  }
  
  editServicesContainer.innerHTML = editHtml;
  editModal.style.display = 'flex';
};

window.closeEditModal = function() {
  editModal.style.display = 'none';
};

window.toggleEditServiceQty = function(checkbox) {
  const serviceName = checkbox.value;
  const qtyInput = document.querySelector(`.edit-service-qty[data-service="${serviceName}"]`);
  const btnMinus = document.querySelector(`.edit-qty-btn-minus[data-service="${serviceName}"]`);
  const btnPlus = document.querySelector(`.edit-qty-btn-plus[data-service="${serviceName}"]`);
  
  if (checkbox.checked) {
    qtyInput.disabled = false;
    qtyInput.style.background = '#FFF';
    if (btnMinus) {
      btnMinus.disabled = false;
      btnMinus.style.background = '#FFF';
      btnMinus.style.color = 'var(--text-main)';
    }
    if (btnPlus) {
      btnPlus.disabled = false;
      btnPlus.style.background = '#FFF';
      btnPlus.style.color = 'var(--text-main)';
    }
  } else {
    qtyInput.disabled = true;
    qtyInput.style.background = '#EEE';
    if (btnMinus) {
      btnMinus.disabled = true;
      btnMinus.style.background = '#EEE';
      btnMinus.style.color = 'var(--text-muted)';
    }
    if (btnPlus) {
      btnPlus.disabled = true;
      btnPlus.style.background = '#EEE';
      btnPlus.style.color = 'var(--text-muted)';
    }
  }
};

window.adjustEditQty = function(serviceName, change) {
  const qtyInput = document.querySelector(`.edit-service-qty[data-service="${serviceName}"]`);
  if (!qtyInput || qtyInput.disabled) return;
  let val = parseInt(qtyInput.value) || 1;
  val = Math.max(1, Math.min(100, val + change));
  qtyInput.value = val;
};

window.submitOrderEdit = async function() {
  const orderId = editOrderIdInput.value;
  const deliveryTime = editDeliveryTimeInput.value;
  
  const items = [];
  const checkboxes = document.querySelectorAll('.edit-service-checkbox');
  checkboxes.forEach(cb => {
    if (cb.checked) {
      const qtyInput = document.querySelector(`.edit-service-qty[data-service="${cb.value}"]`);
      items.push({
        serviceType: cb.value,
        itemCount: parseInt(qtyInput.value) || 0
      });
    }
  });

  if (items.length === 0) {
    alert('กรุณาเลือกบริการซักรีดอย่างน้อย 1 รายการ');
    return;
  }

  try {
    const response = await fetchWithAuth(`/api/orders/${orderId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        deliveryDateTime: deliveryTime,
        items: items
      })
    });

    if (response && !response.ok) throw new Error('Failed to update order');
    
    alert('แก้ไขข้อมูลออเดอร์สำเร็จเรียบร้อยแล้ว!');
    closeEditModal();
    await fetchAndRenderOrders();
  } catch (error) {
    console.error('Error submitting order edit:', error);
    alert('ไม่สามารถบันทึกการแก้ไขได้ กรุณาลองใหม่อีกครั้ง');
  }
};

// Helper: Time Ago calculation
function timeAgo(isoString) {
  try {
    const prev = new Date(isoString);
    const now = new Date();
    const diffMs = now - prev;
    
    if (isNaN(diffMs)) return '';

    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'เมื่อครู่';
    if (diffMins < 60) return `${diffMins} นาทีที่แล้ว`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} ชั่วโมงที่แล้ว`;
    
    return prev.toLocaleDateString('th-TH', { month: 'short', day: 'numeric' });
  } catch (e) {
    return '';
  }
}

// Send Broadcast message via POST API
window.sendBroadcastPromotion = async function() {
  const messageInput = document.getElementById('broadcast-message');
  const message = messageInput.value.trim();

  if (!message) {
    alert('กรุณากรอกข้อความโปรโมชั่นที่ต้องการบรอดแคสต์');
    return;
  }

  if (!confirm('📢 คุณแน่ใจหรือไม่ว่าต้องการบรอดแคสต์ส่งข้อความนี้หาลูกค้าทุกคนในระบบ?')) {
    return;
  }

  try {
    const res = await fetchWithAuth('/api/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message })
    });

    if (res && res.ok) {
      const data = await res.json();
      alert(`🎉 บรอดแคสต์ส่งข้อความหาลูกค้าสำเร็จเรียบร้อย! (ส่งถึง ${data.count} คน)`);
      messageInput.value = '';
    } else {
      const data = await res.json().catch(() => ({}));
      alert(`ล้มเหลว: ${data.error || 'เกิดข้อผิดพลาดในการบรอดแคสต์'}`);
    }
  } catch (error) {
    console.error('Broadcast error:', error);
    alert('ไม่สามารถส่งบรอดแคสต์ได้ในขณะนี้');
  }
};
