'use strict';

const socket = io();
let menu = [];
let cart = {};          // { menuItemId: quantity }
let currentUser = null; // { name, desk }
let trackedOrder = null;

const $ = id => document.getElementById(id);

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ` ${type}` : '');
  el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Screen switching ───────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
  window.scrollTo(0, 0);
}

// ── Identity screen ────────────────────────────────────────────────────────
$('btn-start').addEventListener('click', () => {
  const name = $('customer-name').value.trim();
  const desk = $('desk-number').value.trim();
  let ok = true;

  [$('customer-name'), $('desk-number')].forEach(el => el.classList.remove('error'));

  if (!name) { $('customer-name').classList.add('error'); ok = false; }
  if (!desk)  { $('desk-number').classList.add('error');  ok = false; }
  if (!ok) { showToast('Please fill in all fields', 'error'); return; }

  currentUser = { name, desk };
  $('header-greeting').textContent = `${name} · Desk ${desk}`;
  showScreen('screen-menu');
  if (menu.length === 0) loadMenu();
});

// ── Menu ───────────────────────────────────────────────────────────────────
async function loadMenu() {
  try {
    const res = await fetch('/api/menu');
    menu = await res.json();
    renderMenu(menu);
    renderCategoryTabs(menu);
  } catch {
    showToast('Could not load menu', 'error');
  }
}

function getCategories(items) {
  const seen = new Set();
  return items.reduce((acc, item) => {
    if (!seen.has(item.category)) { seen.add(item.category); acc.push(item.category); }
    return acc;
  }, []);
}

function renderCategoryTabs(items) {
  const categories = getCategories(items);
  const tabs = $('category-tabs');
  tabs.innerHTML = ['All', ...categories].map(cat => `
    <button class="cat-tab${cat === 'All' ? ' active' : ''}" data-cat="${cat}">${cat}</button>
  `).join('');

  tabs.querySelectorAll('.cat-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cat = btn.dataset.cat;
      if (cat === 'All') {
        renderMenu(menu);
      } else {
        renderMenu(menu.filter(i => i.category === cat));
      }
    });
  });
}

function renderMenu(items) {
  const container = $('menu-container');
  const categories = getCategories(items);

  container.innerHTML = categories.map(cat => `
    <div class="menu-section">
      <div class="menu-category-title">${cat}</div>
      ${items.filter(i => i.category === cat).map(item => menuItemHTML(item)).join('')}
    </div>
  `).join('');

  container.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => addToCart(+btn.dataset.add));
  });
  container.querySelectorAll('[data-minus]').forEach(btn => {
    btn.addEventListener('click', () => changeQty(+btn.dataset.minus, -1));
  });
  container.querySelectorAll('[data-plus]').forEach(btn => {
    btn.addEventListener('click', () => changeQty(+btn.dataset.plus, +1));
  });
}

function menuItemHTML(item) {
  const qty = cart[item.id] || 0;
  return `
    <div class="menu-item">
      <div class="menu-item-left">
        <span class="menu-item-emoji">${item.emoji}</span>
        <div class="menu-item-info">
          <div class="menu-item-name">${item.name}</div>
          <div class="menu-item-price">₹${item.price}</div>
        </div>
      </div>
      <div class="menu-item-right">
        ${qty === 0
          ? `<button class="add-btn" data-add="${item.id}">+ Add</button>`
          : `<div class="qty-control">
               <button class="qty-btn qty-btn-minus" data-minus="${item.id}">−</button>
               <span class="qty-value">${qty}</span>
               <button class="qty-btn qty-btn-plus"  data-plus="${item.id}">+</button>
             </div>`
        }
      </div>
    </div>`;
}

function addToCart(id) {
  cart[id] = (cart[id] || 0) + 1;
  refreshMenuAndCart();
}

function changeQty(id, delta) {
  cart[id] = (cart[id] || 0) + delta;
  if (cart[id] <= 0) delete cart[id];
  refreshMenuAndCart();
}

function refreshMenuAndCart() {
  const activeTab = document.querySelector('.cat-tab.active');
  const cat = activeTab?.dataset.cat || 'All';
  renderMenu(cat === 'All' ? menu : menu.filter(i => i.category === cat));

  const total = cartTotal();
  const count = cartCount();
  $('cart-count').textContent = count;
  $('cart-total-header').textContent = `₹${total}`;
  $('cart-bar-count').textContent = `${count} item${count !== 1 ? 's' : ''}`;
  $('cart-bar-total').textContent = `₹${total}`;

  const bar = $('cart-bar');
  count > 0 ? bar.classList.remove('hidden') : bar.classList.add('hidden');

  renderCartDrawer();
}

function cartTotal() {
  return Object.entries(cart).reduce((s, [id, qty]) => {
    const item = menu.find(m => m.id === +id);
    return s + (item ? item.price * qty : 0);
  }, 0);
}

function cartCount() {
  return Object.values(cart).reduce((s, q) => s + q, 0);
}

// ── Cart drawer ────────────────────────────────────────────────────────────
function openCart() {
  renderCartDrawer();
  $('cart-drawer').classList.remove('hidden');
  $('drawer-overlay').classList.remove('hidden');
}

function closeCart() {
  $('cart-drawer').classList.add('hidden');
  $('drawer-overlay').classList.add('hidden');
}

function renderCartDrawer() {
  const list = $('cart-items-list');
  const cartEntries = Object.entries(cart).filter(([, q]) => q > 0);

  if (cartEntries.length === 0) {
    list.innerHTML = `<div class="empty-state" style="padding:30px 0"><div class="empty-icon">🛒</div><p>Your cart is empty</p></div>`;
  } else {
    list.innerHTML = cartEntries.map(([id, qty]) => {
      const item = menu.find(m => m.id === +id);
      if (!item) return '';
      return `<div class="cart-item">
        <span class="cart-item-emoji">${item.emoji}</span>
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-price">₹${item.price} each</div>
        </div>
        <div class="cart-item-controls">
          <button class="qty-btn qty-btn-minus" data-minus="${id}">−</button>
          <span class="qty-value">${qty}</span>
          <button class="qty-btn qty-btn-plus"  data-plus="${id}">+</button>
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('[data-minus]').forEach(btn => btn.addEventListener('click', () => { changeQty(+btn.dataset.minus, -1); }));
    list.querySelectorAll('[data-plus]').forEach(btn =>  btn.addEventListener('click', () => { changeQty(+btn.dataset.plus,  +1); }));
  }

  $('cart-total-drawer').textContent = `₹${cartTotal()}`;
}

$('cart-toggle-btn').addEventListener('click', openCart);
$('cart-bar-btn').addEventListener('click', openCart);
$('cart-close').addEventListener('click', closeCart);
$('drawer-overlay').addEventListener('click', closeCart);

// ── Place order ────────────────────────────────────────────────────────────
$('btn-place-order').addEventListener('click', async () => {
  const cartEntries = Object.entries(cart).filter(([, q]) => q > 0);
  if (cartEntries.length === 0) { showToast('Add items first!', 'error'); return; }

  const btn = $('btn-place-order');
  btn.disabled = true;
  btn.textContent = 'Placing order…';

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: currentUser.name,
        desk_number: currentUser.desk,
        items: cartEntries.map(([id, quantity]) => ({ menu_item_id: +id, quantity })),
      }),
    });
    const order = await res.json();
    if (!res.ok) throw new Error(order.error || 'Failed');

    trackedOrder = order;
    cart = {};
    closeCart();
    showTrackingScreen(order);
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Place Order';
  }
});

// ── Payment QR ─────────────────────────────────────────────────────────────
let paymentConfig = null;

async function loadPaymentConfig() {
  try {
    const res = await fetch('/api/payment-config');
    paymentConfig = await res.json();
  } catch { paymentConfig = {}; }
}

function renderPaymentCard(order) {
  $('pay-amount').textContent = `₹${order.total}`;
  $('pay-ref').textContent = order.id;

  const qrWrap = $('qr-wrap');
  if (paymentConfig?.qrImage) {
    qrWrap.innerHTML = `<img src="${paymentConfig.qrImage}" alt="Paytm QR">`;
  } else {
    qrWrap.innerHTML = `<div class="qr-missing">QR not set up yet.<br>Ask admin to upload via /admin.html</div>`;
  }

  $('upi-name-display').textContent = paymentConfig?.upiName || '';
  updatePaymentBadge(order.payment_status, order.utr);
}

function validateUTR(v) {
  if (!v) return 'Please enter your UTR.';
  if (v.length < 8)  return 'UTR must be at least 8 characters.';
  if (v.length > 30) return 'UTR must be at most 30 characters.';
  if (!/^[a-zA-Z0-9]+$/.test(v)) return 'Only letters and numbers — no spaces or symbols.';
  if (/^(.)\1+$/.test(v)) return 'UTR looks invalid (all same character).';
  return null;
}

$('btn-submit-utr').addEventListener('click', async () => {
  const utr = $('utr-input').value.trim();
  const err = validateUTR(utr);
  if (err) {
    $('utr-input').style.borderColor = '#EF4444';
    showToast(err, 'error');
    $('utr-input').focus();
    return;
  }
  $('utr-input').style.borderColor = '';

  const btn = $('btn-submit-utr');
  btn.disabled = true;
  btn.textContent = '…';

  try {
    const res = await fetch(`/api/orders/${trackedOrder.id}/payment`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ utr }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    // UI updates come via socket event
  } catch (e) {
    showToast(e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Done';
  }
});

function updatePaymentBadge(payment_status, utr) {
  const badge      = $('payment-badge');
  const banner     = $('payment-done-banner');
  const utrSection = document.querySelector('.utr-section');

  if (payment_status === 'paid') {
    badge.textContent = '✅ Payment Submitted';
    badge.classList.add('paid');
    banner.classList.remove('hidden');
    if (utrSection) utrSection.innerHTML = `<p class="utr-submitted">UTR: <code>${utr}</code> — submitted</p>`;
  } else {
    badge.textContent = '💳 Pay to confirm order';
    badge.classList.remove('paid');
    banner.classList.add('hidden');
  }
}

// ── Tracking screen ────────────────────────────────────────────────────────
async function showTrackingScreen(order) {
  $('tracking-order-id').textContent = order.id;
  $('tracking-items').innerHTML = order.items.map(i =>
    `<div class="summary-item"><span>${i.emoji} ${i.name} × ${i.quantity}</span><span>₹${i.price * i.quantity}</span></div>`
  ).join('');
  $('tracking-total').textContent = `₹${order.total}`;
  if (!paymentConfig) await loadPaymentConfig();
  renderPaymentCard(order);
  updateTrackingStatus(order.status, order.payment_status);
  showScreen('screen-tracking');
}

function updateTrackingStatus(status, payment_status) {
  const steps = { pending: 0, preparing: 1, ready: 2 };
  const current = steps[status] ?? 0;

  ['pending', 'preparing', 'ready'].forEach((s, i) => {
    const el = $(`step-${s}`);
    el.classList.remove('active', 'done');
    if (i < current)        el.classList.add('done');
    else if (i === current) el.classList.add('active');
  });

  document.querySelectorAll('.timeline-line').forEach((line, i) => {
    line.classList.toggle('done', i < current);
  });

  const messages = {
    pending:   payment_status === 'paid'
                 ? '⏳ Payment confirmed — waiting for canteen to start preparing…'
                 : '💳 Please scan the QR and pay. Canteen will prepare after payment.',
    preparing: '👨‍🍳 Your order is being prepared!',
    ready:     '🎉 Your order is ready! Please collect it.',
    completed: '✅ Order collected. Enjoy your meal!',
  };
  $('status-message').textContent = messages[status] || messages.pending;

  if (status === 'ready') {
    $('tracking-status-card').style.border = '2px solid var(--ready)';
    $('tracking-status-card').style.background = 'var(--ready-bg)';
  } else {
    $('tracking-status-card').style.border = '';
    $('tracking-status-card').style.background = '';
  }
}

$('btn-new-order').addEventListener('click', () => {
  trackedOrder = null;
  cart = {};
  refreshMenuAndCart();
  showScreen('screen-menu');
  loadMenu();
});

// ── Real-time socket updates ───────────────────────────────────────────────
socket.on('order_updated', order => {
  if (trackedOrder && order.id === trackedOrder.id) {
    trackedOrder = order;
    updatePaymentBadge(order.payment_status);
    updateTrackingStatus(order.status, order.payment_status);
    if (order.payment_status === 'paid' && order.status === 'pending') {
      showToast('✅ UTR submitted! Canteen will start preparing soon.', 'success');
    }
    if (order.status === 'ready') {
      showToast('🎉 Your order is ready for pickup!', 'success');
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }
  }
});

$('utr-input').addEventListener('input', () => { $('utr-input').style.borderColor = ''; });

// Pre-load payment config in background so QR shows instantly
loadPaymentConfig();
