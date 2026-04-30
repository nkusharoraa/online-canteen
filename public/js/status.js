'use strict';

const socket = io();
let orders = [];

// ── Clock ──────────────────────────────────────────────────────────────────
function updateClock() {
  document.getElementById('clock').textContent =
    new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// ── Render ─────────────────────────────────────────────────────────────────
function render(flashId = null) {
  const preparing = orders.filter(o => o.status === 'preparing');
  const ready     = orders.filter(o => o.status === 'ready');
  const pending   = orders.filter(o => o.status === 'pending');

  document.getElementById('count-preparing').textContent =
    `${preparing.length} order${preparing.length !== 1 ? 's' : ''}`;
  document.getElementById('count-ready').textContent =
    `${ready.length} order${ready.length !== 1 ? 's' : ''}`;

  renderColumn('col-preparing', preparing, 'preparing', flashId, 'No orders being prepared');
  renderColumn('col-ready',     ready,     'ready',     flashId, 'No orders ready yet');
  renderPendingStrip(pending);
}

function renderColumn(colId, list, status, flashId, emptyMsg) {
  const col = document.getElementById(colId);
  if (list.length === 0) {
    col.innerHTML = `<div class="no-orders">${emptyMsg}</div>`;
    return;
  }

  col.innerHTML = list.slice().reverse().map(o => {
    const itemsSummary = o.items.map(i => `${i.emoji}${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`).join(' · ');
    return `
    <div class="status-card status-${status}${flashId === o.id ? ' new-card' : ''}" data-id="${o.id}">
      <div class="card-token">#${o.id}</div>
      <div class="card-info">
        <div class="card-name">${o.customer_name}</div>
        <div class="card-desk">📍 Desk ${o.desk_number}</div>
        <div class="card-items">${itemsSummary}</div>
      </div>
      ${status === 'ready' ? '<div class="card-ready-badge">READY!</div>' : ''}
    </div>`;
  }).join('');
}

function renderPendingStrip(pending) {
  const strip = document.getElementById('pending-strip');
  if (pending.length === 0) {
    strip.innerHTML = '';
    return;
  }
  strip.innerHTML = `
    <span class="pending-label">⏳ Waiting (${pending.length})</span>
    ${pending.slice().reverse().map(o =>
      `<span class="pending-pill">#${o.id} ${o.customer_name}</span>`
    ).join('')}`;
}

// ── Socket events ──────────────────────────────────────────────────────────
socket.on('initial_orders', data => {
  orders = data.filter(o => o.status !== 'completed');
  render();
});

socket.on('new_order', order => {
  orders.push(order);
  render(order.id);
});

socket.on('order_updated', updated => {
  const idx = orders.findIndex(o => o.id === updated.id);
  if (updated.status === 'completed') {
    if (idx !== -1) orders.splice(idx, 1);
  } else {
    if (idx !== -1) orders[idx] = updated;
    else orders.push(updated);
  }
  render(updated.id);
});
