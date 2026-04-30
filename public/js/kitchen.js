'use strict';

const socket = io();
let orders = [];
let activeFilter = 'active';

const $ = id => document.getElementById(id);

// ── Time ───────────────────────────────────────────────────────────────────
function updateClock() {
  $('live-time').textContent = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ` ${type}` : '');
  el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Elapsed time ───────────────────────────────────────────────────────────
function elapsedLabel(createdAt) {
  const mins = Math.floor((Date.now() - new Date(createdAt)) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

function isUrgent(createdAt) {
  return (Date.now() - new Date(createdAt)) > 10 * 60 * 1000; // > 10 min
}

// ── Filter ─────────────────────────────────────────────────────────────────
$('filter-tabs').querySelectorAll('.cat-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $('filter-tabs').querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderOrders();
  });
});

function filteredOrders() {
  const all = [...orders].reverse();
  switch (activeFilter) {
    case 'active':    return all.filter(o => o.status !== 'completed');
    case 'completed': return all.filter(o => o.status === 'completed');
    case 'all':       return all;
    default:          return all.filter(o => o.status === activeFilter);
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────
function updateStats() {
  const pending   = orders.filter(o => o.status === 'pending').length;
  const preparing = orders.filter(o => o.status === 'preparing').length;
  $('stat-pending').textContent   = `${pending} Pending`;
  $('stat-preparing').textContent = `${preparing} Preparing`;
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderOrders(flashId = null) {
  const container = $('orders-container');
  const visible = filteredOrders();

  if (visible.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      <h3>No orders here</h3>
      <p>${activeFilter === 'active' ? 'Orders will appear in real-time' : 'Nothing in this category yet'}</p>
    </div>`;
    return;
  }

  container.innerHTML = visible.map(o => orderCardHTML(o)).join('');

  if (flashId) {
    const card = container.querySelector(`[data-order-id="${flashId}"]`);
    if (card) { card.classList.add('flash-new'); setTimeout(() => card.classList.remove('flash-new'), 2000); }
  }

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => updateStatus(+btn.dataset.orderId, btn.dataset.action));
  });

  updateStats();
}

function orderCardHTML(order) {
  const urgent = isUrgent(order.created_at) && order.status !== 'completed';
  const time = new Date(order.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  const actions = {
    pending:   [{ label: '👨‍🍳 Start Preparing', action: 'preparing', cls: 'btn-blue' }],
    preparing: [{ label: '✅ Mark Ready', action: 'ready', cls: 'btn-success' }],
    ready:     [{ label: '📦 Mark Completed', action: 'completed', cls: 'btn-gray' }],
    completed: [],
  }[order.status] || [];

  return `
  <div class="order-card status-${order.status}" data-order-id="${order.id}">
    <div class="order-card-header">
      <div>
        <div class="order-token-label">#${order.id}</div>
        <div class="order-customer-name">${order.customer_name}</div>
        <div class="order-desk">📍 Desk ${order.desk_number}</div>
      </div>
      <div class="order-meta">
        <span class="badge badge-${order.status}">${order.status}</span>
        <div class="order-time">${time}</div>
        <div class="order-elapsed${urgent ? ' urgent' : ''}">${urgent ? '⚠️ ' : ''}${elapsedLabel(order.created_at)}</div>
      </div>
    </div>
    <div class="order-items">
      ${order.items.map(i => `
        <div class="order-item-row">
          <span class="order-item-name">${i.emoji} ${i.name}</span>
          <span class="order-item-qty">× ${i.quantity}</span>
        </div>`).join('')}
    </div>
    <div class="order-total-bar">
      <span>${order.items.reduce((s, i) => s + i.quantity, 0)} item${order.items.reduce((s, i) => s + i.quantity, 0) !== 1 ? 's' : ''}</span>
      <span>₹${order.total}</span>
    </div>
    ${actions.length ? `
    <div class="order-actions">
      ${actions.map(a => `
        <button class="btn ${a.cls}" data-action="${a.action}" data-order-id="${order.id}">${a.label}</button>
      `).join('')}
    </div>` : ''}
  </div>`;
}

// ── Status update ──────────────────────────────────────────────────────────
async function updateStatus(orderId, status) {
  const btn = document.querySelector(`[data-action="${status}"][data-order-id="${orderId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  try {
    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error('Failed');
  } catch {
    showToast('Could not update order', 'error');
    if (btn) { btn.disabled = false; }
  }
}

// ── Socket events ──────────────────────────────────────────────────────────
socket.on('initial_orders', data => {
  orders = data;
  renderOrders();
  updateStats();
});

socket.on('new_order', order => {
  orders.push(order);
  renderOrders(order.id);
  updateStats();
  showToast(`🆕 New order #${order.id} from ${order.customer_name} (Desk ${order.desk_number})`, 'success');
  if (Notification.permission === 'granted') {
    new Notification(`New Order #${order.id}`, { body: `${order.customer_name} – Desk ${order.desk_number}` });
  }
});

socket.on('order_updated', updated => {
  const idx = orders.findIndex(o => o.id === updated.id);
  if (idx !== -1) orders[idx] = updated;
  renderOrders();
  updateStats();
});

// ── Elapsed time refresh ───────────────────────────────────────────────────
setInterval(() => {
  document.querySelectorAll('[data-order-id]').forEach(card => {
    const id = +card.dataset.orderId;
    const order = orders.find(o => o.id === id);
    if (!order) return;
    const el = card.querySelector('.order-elapsed');
    if (el) {
      const urgent = isUrgent(order.created_at) && order.status !== 'completed';
      el.textContent = (urgent ? '⚠️ ' : '') + elapsedLabel(order.created_at);
      el.className = 'order-elapsed' + (urgent ? ' urgent' : '');
    }
  });
}, 30000);

// Request notification permission
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}
