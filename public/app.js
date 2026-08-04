// LIFF Customer App Logic - Reusable Loyality and e-Stamp Architecture
let userProfile = null;
let serviceRates = [];
let promptPayNumber = '0812345678';

// DOM Elements
const loadingIndicator = document.getElementById('loading-indicator');
const loadingText = document.getElementById('loading-text');
const userNameEl = document.getElementById('user-name');
const userAvatarEl = document.getElementById('user-avatar');
const mockLoginBar = document.getElementById('mock-login-bar');
const servicesContainer = document.getElementById('services-checkbox-container');
const costDisplay = document.getElementById('cost-display');
const gpsDisplay = document.getElementById('gps-display');
const latitudeInput = document.getElementById('latitude');
const longitudeInput = document.getElementById('longitude');
const deliveryTimeInput = document.getElementById('delivery-time');
const ordersListContainer = document.getElementById('orders-list');

// Loyalty DOM elements
const stampGrid = document.getElementById('loyalty-stamp-grid');
const stampTextSummary = document.getElementById('stamp-text-summary');
const btnRedeem = document.getElementById('btn-redeem');
const pricingListContainer = document.getElementById('pricing-list-container');

// Initialize LIFF
document.addEventListener('DOMContentLoaded', async () => {
  setupDefaultDeliveryTime();
  await loadServiceRates();

  try {
    const configRes = await fetch('/api/config').catch(() => null);
    let liffId = '';
    
    if (configRes && configRes.ok) {
      const configData = await configRes.json();
      liffId = configData.liffId;
      promptPayNumber = configData.promptPayNumber || '0812345678';
    }

    if (liffId && liffId !== 'YOUR_LIFF_ID' && liffId !== 'MOCK_LIFF_ID') {
      await liff.init({ liffId });
      if (liff.isLoggedIn()) {
        await handleLiffLogin();
      } else {
        liff.login();
      }
    } else {
      console.warn('LINE LIFF_ID is not configured in .env. Falling back to Mock Mode.');
      initializeMockMode();
    }
  } catch (error) {
    console.error('LIFF initialization failed:', error);
    initializeMockMode();
  }

  // Check URL parameters for tab routing (e.g. redirected from Rich Menu)
  const urlParams = new URLSearchParams(window.location.search);
  const targetTab = urlParams.get('tab');
  if (targetTab === 'rates') {
    navigateToTab('page-rates');
  }
});

// Handle successful LIFF login
async function handleLiffLogin() {
  try {
    const profile = await liff.getProfile();
    userProfile = {
      id: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl || 'https://cdn-icons-png.flaticon.com/512/847/847969.png'
    };

    userNameEl.innerText = userProfile.displayName;
    userAvatarEl.src = userProfile.pictureUrl;

    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userProfile)
    });
    const result = await res.json();
    
    const userPoints = result.points || 0;
    document.getElementById('user-points').innerText = userPoints;
    renderStampCard(userPoints);
    updateCouponUI(result.couponCount);

    hideLoading();
    loadUserOrders();
  } catch (err) {
    console.error('Error fetching profile:', err);
    initializeMockMode();
  }
}

// Mock Mode for browser testing without LINE
function initializeMockMode() {
  mockLoginBar.style.display = 'flex';
  
  let savedUser = localStorage.getItem('mock_user');
  if (!savedUser) {
    savedUser = JSON.stringify({
      id: 'MOCK-USER-' + Math.floor(1000 + Math.random() * 9000),
      displayName: 'สมชาย รักดี (Mock)',
      pictureUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80'
    });
    localStorage.setItem('mock_user', savedUser);
  }
  
  userProfile = JSON.parse(savedUser);
  
  userNameEl.innerText = userProfile.displayName;
  userAvatarEl.src = userProfile.pictureUrl;

  fetch('/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userProfile)
  })
  .then(res => res.json())
  .then(result => {
    const userPoints = result.points || 0;
    document.getElementById('user-points').innerText = userPoints;
    renderStampCard(userPoints);
    updateCouponUI(result.couponCount);

    hideLoading();
    loadUserOrders();
  });
}

function simulateLogin() {
  const names = ['สมหญิง ยิ้มแย้ม', 'วันดี มีสุข', 'มานะ อดทน', 'ปิติ ชูใจ'];
  const avatars = [
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80',
    'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=150&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150&q=80'
  ];
  const index = Math.floor(Math.random() * names.length);
  
  const mockUser = {
    id: 'MOCK-USER-' + Math.floor(1000 + Math.random() * 9000),
    displayName: names[index] + ' (Mock)',
    pictureUrl: avatars[index]
  };
  
  localStorage.setItem('mock_user', JSON.stringify(mockUser));
  showLoading('กำลังสลับบัญชีทดสอบ...');
  window.location.reload();
}

function hideLoading() {
  loadingIndicator.style.display = 'none';
}

function updateCouponUI(couponCount) {
  if (userProfile) {
    userProfile.couponCount = couponCount || 0;
  }
  const couponContainer = document.getElementById('coupon-selection-container');
  const couponsCountEl = document.getElementById('owned-coupons-count');
  
  if (couponCount > 0) {
    if (couponsCountEl) couponsCountEl.innerText = couponCount;
    if (couponContainer) couponContainer.style.display = 'block';
  } else {
    if (couponContainer) couponContainer.style.display = 'none';
    const checkbox = document.getElementById('use-coupon-checkbox');
    if (checkbox) checkbox.checked = false;
  }
}

function showLoading(text) {
  loadingIndicator.style.display = 'flex';
  loadingText.innerText = text || 'กำลังโหลด...';
}

// Navigation between bottom tabs (SPA routing)
window.navigateToTab = function(pageId) {
  // Update view visibility
  document.querySelectorAll('.page-section').forEach(section => {
    section.classList.remove('active');
  });
  document.getElementById(pageId).classList.add('active');

  // Update nav item highlighting
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
  });
  
  const navHome = document.getElementById('nav-home');
  const navRates = document.getElementById('nav-rates');
  const navForm = document.getElementById('nav-form');
  
  if (pageId === 'page-home' && navHome) navHome.classList.add('active');
  if (pageId === 'page-rates' && navRates) navRates.classList.add('active');
  if (pageId === 'page-form' && navForm) navForm.classList.add('active');
};

// Render e-Stamp Loyalty Card visual circles
function renderStampCard(points) {
  // Stamps are points modulo 10 (or complete stamps sheet)
  const stampCount = points % 10;
  stampTextSummary.innerText = `${stampCount}/10 ดวง`;

  let gridHtml = '';
  for (let i = 1; i <= 10; i++) {
    if (i <= stampCount) {
      gridHtml += `<div class="stamp-slot stamp-active">⭐</div>`;
    } else {
      gridHtml += `<div class="stamp-slot stamp-inactive">${i}</div>`;
    }
  }
  stampGrid.innerHTML = gridHtml;

  // Show coupon redeem button if customer has at least 10 points
  if (points >= 10) {
    btnRedeem.style.display = 'flex';
  } else {
    btnRedeem.style.display = 'none';
  }
}

// Redeem stamp coupon calling POST API
window.handleStampRedemption = async function() {
  if (!userProfile) return;
  
  if (!confirm('🎁 คุณต้องการแลกสะสมแสตมป์ 10 ดวง เพื่อรับคูปองส่วนลด 100 บาท ใช่หรือไม่?')) {
    return;
  }

  showLoading('กำลังดำเนินการแลกคูปอง...');

  try {
    const res = await fetch(`/api/customers/${userProfile.id}/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await res.json();
    if (res.ok && data.success) {
      alert('🎉 แลกรับคูปองส่วนลด 100 บาท สำเร็จเรียบร้อยแล้ว! ระบบได้ส่งข้อมูลยืนยันไปยังแชท LINE ของคุณแล้ว');
      
      // Update UI with new points balance
      document.getElementById('user-points').innerText = data.points;
      renderStampCard(data.points);
      updateCouponUI(data.couponCount);
    } else {
      alert(`ล้มเหลว: ${data.error || 'เกิดข้อผิดพลาดในการแลกแสตมป์'}`);
    }
  } catch (err) {
    console.error('Redeem error:', err);
    alert('ไม่สามารถทำรายการได้ในขณะนี้');
  } finally {
    hideLoading();
  }
};

// Fetch rates from API and build checkboxes + price list
async function loadServiceRates() {
  try {
    const res = await fetch('/api/rates');
    if (!res.ok) throw new Error('Cannot fetch rates');
    serviceRates = await res.json();
    
    // Group rates by category
    const grouped = {};
    serviceRates.forEach(rate => {
      if (!grouped[rate.category]) {
        grouped[rate.category] = [];
      }
      grouped[rate.category].push(rate);
    });

    // 1. Render checkboxes in order form grouped by categories
    let checkboxesHtml = '';
    for (const category in grouped) {
      checkboxesHtml += `
        <div style="margin-top: 12px; margin-bottom: 8px;">
          <h4 style="font-size:14px; font-weight:600; color:var(--primary); border-left: 3px solid var(--primary); padding-left: 8px; margin-bottom: 8px;">
            ${category}
          </h4>
          <div style="display:flex; flex-direction:column; gap:10px;">
      `;
      
      grouped[category].forEach(rate => {
        checkboxesHtml += `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border: 1px solid var(--border); border-radius: 12px; background-color: #FAFAFA;">
            <label style="display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 500; cursor: pointer; flex: 1; margin: 0;">
              <input type="checkbox" class="service-checkbox" value="${rate.name}" data-price="${rate.pricePerUnit}" onchange="toggleServiceQty(this)" style="width: 18px; height: 18px; accent-color: var(--primary);">
              <span>${rate.name} (฿${rate.pricePerUnit}/${rate.unit})</span>
            </label>
            <div style="display: flex; align-items: center; gap: 4px;">
              <button type="button" class="qty-btn-minus" data-service="${rate.name}" onclick="adjustQty('${rate.name}', -1)" disabled style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--border); background: #EEE; color: var(--text-muted); cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; font-weight: bold; border-style: solid;">-</button>
              <input type="number" class="service-qty" data-service="${rate.name}" min="1" max="100" value="1" disabled oninput="calculateEstimate()" style="width: 45px; padding: 4px 2px; font-size: 14px; text-align: center; border: 1px solid var(--border); border-radius: 8px; outline: none; background: #EEE; -webkit-appearance: none; -moz-appearance: textfield; margin: 0;">
              <button type="button" class="qty-btn-plus" data-service="${rate.name}" onclick="adjustQty('${rate.name}', 1)" disabled style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--border); background: #EEE; color: var(--text-muted); cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; font-weight: bold; border-style: solid;">+</button>
            </div>
          </div>
        `;
      });

      checkboxesHtml += `
          </div>
        </div>
      `;
    }
    servicesContainer.innerHTML = checkboxesHtml;

    // 2. Render price list under Rates & Promos tab grouped by categories
    let ratesListHtml = '';
    for (const category in grouped) {
      ratesListHtml += `
        <div style="margin-bottom: 18px;">
          <h4 style="font-size:14px; font-weight:600; color:var(--text-main); background-color:#F2F4F4; padding:6px 12px; border-radius:6px; margin-bottom:10px;">
            ${category}
          </h4>
      `;
      
      grouped[category].forEach(rate => {
        ratesListHtml += `
          <div class="price-item">
            <span class="price-service-name" style="font-size:14px;">${rate.name}</span>
            <span class="price-service-val" style="font-size:14px; color:var(--primary); font-weight:600;">฿${rate.pricePerUnit.toFixed(2)} / ${rate.unit}</span>
          </div>
        `;
      });
      
      ratesListHtml += `</div>`;
    }
    pricingListContainer.innerHTML = ratesListHtml;

    calculateEstimate();
  } catch (error) {
    console.error('Error loading service rates:', error);
  }
}

// Toggle quantity field enabled
window.toggleServiceQty = function(checkbox) {
  const serviceName = checkbox.value;
  const qtyInput = document.querySelector(`.service-qty[data-service="${serviceName}"]`);
  const btnMinus = document.querySelector(`.qty-btn-minus[data-service="${serviceName}"]`);
  const btnPlus = document.querySelector(`.qty-btn-plus[data-service="${serviceName}"]`);
  
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
  calculateEstimate();
};

window.adjustQty = function(serviceName, change) {
  const qtyInput = document.querySelector(`.service-qty[data-service="${serviceName}"]`);
  if (!qtyInput || qtyInput.disabled) return;
  let val = parseInt(qtyInput.value) || 1;
  val = Math.max(1, Math.min(100, val + change));
  qtyInput.value = val;
  calculateEstimate();
};

// Toggle delivery options UI
window.toggleDeliveryMethod = function(radio) {
  const gpsGroup = document.getElementById('gps-form-group');
  const shopGroup = document.getElementById('shop-address-group');
  const gpsDisplay = document.getElementById('gps-display');
  const deliveryLabel = document.getElementById('delivery-time-label');

  if (radio.value === 'pickup') {
    gpsGroup.style.display = 'block';
    shopGroup.style.display = 'none';
    gpsDisplay.setAttribute('required', 'true');
    deliveryLabel.innerText = 'วันเวลาที่นัดเข้ารับผ้า';
  } else {
    gpsGroup.style.display = 'none';
    shopGroup.style.display = 'flex';
    gpsDisplay.removeAttribute('required');
    deliveryLabel.innerText = 'วันเวลาที่นัดส่งคืนผ้า (เมื่อซักเสร็จ)';
  }
};

// Calculate estimated price of all checked items
window.calculateEstimate = function() {
  let subtotal = 0;
  let totalCount = 0;
  
  const checkboxes = document.querySelectorAll('.service-checkbox');
  checkboxes.forEach(cb => {
    if (cb.checked) {
      const price = parseFloat(cb.getAttribute('data-price')) || 0;
      const qtyInput = document.querySelector(`.service-qty[data-service="${cb.value}"]`);
      const qty = parseInt(qtyInput.value) || 0;
      subtotal += qty * price;
      totalCount += qty;
    }
  });

  const costDetailItems = document.getElementById('cost-detail-items');
  const useCouponCheckbox = document.getElementById('use-coupon-checkbox');
  const useCoupon = useCouponCheckbox && useCouponCheckbox.checked;

  let wholesaleDiscount = 0;
  if (totalCount >= 50) {
    wholesaleDiscount = Math.round(subtotal * 0.20 * 100) / 100;
  }

  let couponDiscount = 0;
  if (useCoupon) {
    couponDiscount = 100;
  }

  const finalTotal = Math.max(0, subtotal - wholesaleDiscount - couponDiscount);

  if (costDetailItems) {
    let html = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 2px;">
        <span>จำนวนผ้ารวม:</span>
        <span>${totalCount} ชิ้น</span>
      </div>
    `;

    if (wholesaleDiscount > 0 || couponDiscount > 0) {
      html += `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 2px;">
          <span>ราคาปกติ:</span>
          <span>฿ ${subtotal.toFixed(2)}</span>
        </div>
      `;
    }

    if (wholesaleDiscount > 0) {
      html += `
        <div style="display:flex; justify-content:space-between; align-items:center; color:#E74C3C; font-weight:600; margin-bottom: 2px;">
          <span>ส่วนลดราคาส่ง (20%):</span>
          <span>- ฿ ${wholesaleDiscount.toFixed(2)}</span>
        </div>
      `;
    }

    if (couponDiscount > 0) {
      html += `
        <div style="display:flex; justify-content:space-between; align-items:center; color:#E74C3C; font-weight:600; margin-bottom: 2px;">
          <span>คูปองส่วนลดสมาชิก:</span>
          <span>- ฿ ${couponDiscount.toFixed(2)}</span>
        </div>
      `;
    }

    if (totalCount >= 30 && totalCount < 50) {
      html += `
        <div style="font-size:11px; color:#E67E22; text-align:right; margin-top:4px;">
          💡 อีก ${50 - totalCount} ชิ้น จะได้รับส่วนลดราคาส่ง 20%
        </div>
      `;
    } else if (totalCount >= 50) {
      html += `
        <div style="font-size:11px; color:#1E8449; font-weight:600; text-align:right; margin-top:2px;">
          🎉 พิเศษ! ซักผ้าครบ 50 ชิ้น ได้ส่วนลดราคาส่ง 20%
        </div>
      `;
    }

    costDetailItems.innerHTML = html;
  }

  costDisplay.innerText = `฿ ${finalTotal.toFixed(2)}`;
};

function setupDefaultDeliveryTime() {
  const now = new Date();
  now.setHours(now.getHours() + 2);
  
  const currentHour = now.getHours();
  if (currentHour < 9) {
    now.setHours(9, 0, 0, 0);
  } else if (currentHour >= 19) {
    now.setDate(now.getDate() + 1);
    now.setHours(9, 0, 0, 0);
  }
  
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  
  deliveryTimeInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
}

function getLocation() {
  if (navigator.geolocation) {
    gpsDisplay.placeholder = 'กำลังตรวจหาพิกัด...';
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        
        latitudeInput.value = lat;
        longitudeInput.value = lng;
        gpsDisplay.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      },
      (error) => {
        console.error('Geolocation error:', error);
        const fallbackLat = 13.7563;
        const fallbackLng = 100.5018;
        latitudeInput.value = fallbackLat;
        longitudeInput.value = fallbackLng;
        gpsDisplay.value = `${fallbackLat.toFixed(6)}, ${fallbackLng.toFixed(6)} (พิกัดจำลอง)`;
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  } else {
    alert('เบราว์เซอร์ของคุณไม่สนับสนุนบริการระบุตำแหน่ง Geolocation');
  }
}

// Submit Order Request via JSON fetch
async function handleOrderSubmit(e) {
  e.preventDefault();
  
  if (!userProfile) {
    alert('กรุณารอการตรวจสอบข้อมูลโปรไฟล์ผู้ใช้สักครู่');
    return;
  }

  const items = [];
  const checkboxes = document.querySelectorAll('.service-checkbox');
  checkboxes.forEach(cb => {
    if (cb.checked) {
      const qtyInput = document.querySelector(`.service-qty[data-service="${cb.value}"]`);
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

  const deliveryMethod = document.querySelector('input[name="delivery-method"]:checked').value;
  const paymentMethod = document.querySelector('input[name="payment-method"]:checked').value;

  if (deliveryMethod === 'pickup' && (!latitudeInput.value || !longitudeInput.value)) {
    alert('กรุณาดึงพิกัด GPS สำหรับให้เจ้าหน้าที่ไปรับผ้า');
    return;
  }

  const useCouponCheckbox = document.getElementById('use-coupon-checkbox');
  const useCoupon = useCouponCheckbox && useCouponCheckbox.checked;

  const payload = {
    customerId: userProfile.id,
    latitude: deliveryMethod === 'pickup' ? parseFloat(latitudeInput.value) : null,
    longitude: deliveryMethod === 'pickup' ? parseFloat(longitudeInput.value) : null,
    deliveryDateTime: deliveryTimeInput.value,
    deliveryMethod: deliveryMethod,
    paymentMethod: paymentMethod,
    useCoupon: useCoupon,
    items: items
  };

  const selectedDate = new Date(deliveryTimeInput.value);
  const selectedHour = selectedDate.getHours();
  const selectedMin = selectedDate.getMinutes();
  const mins = selectedHour * 60 + selectedMin;
  
  if (mins < 540 || mins > 1140) {
    alert('⚠️ ขออภัยค่ะ Fitcheck Laundry เปิดให้บริการรับ-ส่งผ้าเฉพาะเวลา 09:00 - 19:00 น. เท่านั้น กรุณาเลือกเวลาใหม่ด้วยค่ะ');
    return;
  }

  showLoading('กำลังส่งใบจองบริการซักรีด...');

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    
    if (res.ok && result.success) {
      setupDefaultDeliveryTime();
      latitudeInput.value = '';
      longitudeInput.value = '';
      gpsDisplay.value = '';
      gpsDisplay.placeholder = 'ยังไม่ได้รับพิกัด';
      
      // Reset radio selections to default
      document.querySelector('input[name="delivery-method"][value="pickup"]').checked = true;
      toggleDeliveryMethod({ value: 'pickup' });
      document.querySelector('input[name="payment-method"][value="cash"]').checked = true;
      
      if (useCouponCheckbox) {
        useCouponCheckbox.checked = false;
      }
      
      // Update local coupons count
      if (useCoupon) {
        userProfile.couponCount = Math.max(0, (userProfile.couponCount || 0) - 1);
      }
      updateCouponUI(userProfile.couponCount);

      checkboxes.forEach(cb => {
        cb.checked = false;
        toggleServiceQty(cb);
      });
      
      await loadUserOrders();
      navigateToTab('page-home');

      // If bank transfer is chosen, show the payment QR code modal
      if (paymentMethod === 'transfer') {
        document.getElementById('payment-qr').src = `https://promptpay.io/${promptPayNumber}/${result.totalPrice}.png`;
        document.getElementById('payment-amount').innerText = `฿ ${result.totalPrice.toFixed(2)}`;
        document.getElementById('payment-modal').style.display = 'flex';
      } else {
        alert('จองบริการคิวซักรีดสำเร็จเรียบร้อยแล้ว!');
      }
    } else {
      alert(`ล้มเหลว: ${result.error || 'เกิดข้อผิดพลาดในการทำรายการ'}`);
    }
  } catch (error) {
    console.error('Error submitting order:', error);
    alert('การจองคิวซักผ้าล้มเหลว กรุณาตรวจสอบการเชื่อมต่อเครือข่าย');
  } finally {
    hideLoading();
  }
}

// Fetch customer's orders
async function loadUserOrders() {
  if (!userProfile) return;
  
  try {
    const res = await fetch(`/api/orders?userId=${userProfile.id}`);
    if (!res.ok) throw new Error('Cannot load orders');
    
    const orders = await res.json();
    
    if (orders.length === 0) {
      ordersListContainer.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 40px 0; font-size:14px;">
          ไม่มีประวัติการส่งซักในขณะนี้
        </div>
      `;
      return;
    }

    ordersListContainer.innerHTML = orders.map(order => {
      let statusLabel = '';
      let statusClass = '';

      switch (order.status) {
        case 'pending':
          statusLabel = 'รอรับผ้า';
          statusClass = 'status-pending';
          break;
        case 'picked_up':
          statusLabel = 'รับผ้าแล้ว';
          statusClass = 'status-picked_up';
          break;
        case 'washing':
          statusLabel = 'กำลังซัก';
          statusClass = 'status-washing';
          break;
        case 'completed':
          statusLabel = 'ซักเสร็จสิ้น';
          statusClass = 'status-completed';
          break;
        case 'delivered':
          statusLabel = 'จัดส่งแล้ว';
          statusClass = 'status-delivered';
          break;
      }

      let dateString = order.deliveryDateTime;
      try {
        const dateObj = new Date(order.deliveryDateTime);
        if (!isNaN(dateObj)) {
          dateString = dateObj.toLocaleString('th-TH', { 
            dateStyle: 'medium', 
            timeStyle: 'short' 
          });
        }
      } catch (err) {}

      const itemsList = order.items && order.items.length > 0
        ? order.items.map(item => `${item.serviceType} (${item.itemCount} ชิ้น)`).join(', ')
        : 'ไม่ระบุรายการ';

      return `
        <div class="order-item">
          <div class="order-header">
            <span>ID: ${order.id.substring(0, 15)}...</span>
            <span>${dateString}</span>
          </div>
          <div class="order-body" style="flex-direction: column; align-items: flex-start; gap: 6px;">
            <div class="order-service" style="font-size: 14px; color: var(--text-main); font-weight: normal;">
              ${itemsList}
            </div>
            <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
              <div class="order-price">฿${order.totalPrice.toFixed(2)}</div>
              <span class="status-badge ${statusClass}">${statusLabel}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

  } catch (error) {
    console.error('Error rendering orders list:', error);
    ordersListContainer.innerHTML = `
      <div style="text-align: center; color: #E74C3C; padding: 20px 0; font-size:14px;">
        ไม่สามารถโหลดข้อมูลประวัติได้ในขณะนี้
      </div>
    `;
  }
}

window.closePaymentModal = function() {
  document.getElementById('payment-modal').style.display = 'none';
};
