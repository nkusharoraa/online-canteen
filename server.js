const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const storage = require('./storage');

// Shared UTR validation — same rules enforced on client too
function validateUTR(utr) {
  if (!utr || typeof utr !== 'string') return 'UTR is required.';
  const v = utr.trim();
  if (v.length < 8)  return 'UTR must be at least 8 characters.';
  if (v.length > 30) return 'UTR must be at most 30 characters.';
  if (!/^[a-zA-Z0-9]+$/.test(v)) return 'UTR must contain only letters and numbers — no spaces or symbols.';
  if (/^(.)\1+$/.test(v)) return 'UTR looks invalid (all same character).';
  if (/^(0123456789|1234567890|9876543210|0987654321)/.test(v) && v.length <= 12)
    return 'UTR looks invalid (sequential digits).';
  return null; // valid
}

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);
const PORT   = process.env.PORT || 3000;

// Admin PIN — set ADMIN_PIN env var in Railway, default is 1234
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

const MENU = [
  { id: 1,  category: 'Beverages', name: 'Chai',               price: 10,  emoji: '☕' },
  { id: 2,  category: 'Beverages', name: 'Coffee',             price: 20,  emoji: '☕' },
  { id: 3,  category: 'Beverages', name: 'Cold Coffee',        price: 35,  emoji: '🧋' },
  { id: 4,  category: 'Beverages', name: 'Nimbu Pani',         price: 20,  emoji: '🍋' },
  { id: 5,  category: 'Beverages', name: 'Cold Drink',         price: 30,  emoji: '🥤' },
  { id: 6,  category: 'Snacks',    name: 'Samosa (2 pcs)',     price: 15,  emoji: '🥟' },
  { id: 7,  category: 'Snacks',    name: 'Bread Pakoda',       price: 20,  emoji: '🫓' },
  { id: 8,  category: 'Snacks',    name: 'Veg Sandwich',       price: 40,  emoji: '🥪' },
  { id: 9,  category: 'Snacks',    name: 'Grilled Sandwich',   price: 55,  emoji: '🥪' },
  { id: 10, category: 'Snacks',    name: 'Veg Burger',         price: 70,  emoji: '🍔' },
  { id: 11, category: 'Meals',     name: 'Dal Rice',           price: 80,  emoji: '🍛' },
  { id: 12, category: 'Meals',     name: 'Paneer Rice',        price: 100, emoji: '🍛' },
  { id: 13, category: 'Meals',     name: 'Roti Sabzi (2 pcs)', price: 60,  emoji: '🫓' },
  { id: 14, category: 'Meals',     name: 'Full Thali',         price: 120, emoji: '🍽️' },
  { id: 15, category: 'Desserts',  name: 'Gulab Jamun',        price: 30,  emoji: '🍮' },
  { id: 16, category: 'Desserts',  name: 'Rasgulla (2 pcs)',   price: 30,  emoji: '🍮' },
];

app.use(express.json({ limit: '5mb' })); // allow base64 QR image uploads
app.use(express.static(path.join(__dirname, 'public')));

// ── Menu ───────────────────────────────────────────────────────────────────
app.get('/api/menu', (_req, res) => res.json(MENU));

// ── Payment config ─────────────────────────────────────────────────────────
app.get('/api/payment-config', async (_req, res) => {
  try {
    const qrImage = await storage.getConfig('qr_image');
    const upiName = await storage.getConfig('upi_name');
    res.json({ qrImage, upiName });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load payment config' });
  }
});

app.post('/api/payment-config', async (req, res) => {
  const { pin, qrImage, upiName } = req.body;
  if (pin !== ADMIN_PIN) return res.status(403).json({ error: 'Wrong PIN' });
  if (!qrImage) return res.status(400).json({ error: 'QR image required' });
  try {
    await storage.setConfig('qr_image', qrImage);
    await storage.setConfig('upi_name', upiName || '');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save config' });
  }
});

// ── Orders ─────────────────────────────────────────────────────────────────
app.post('/api/orders', async (req, res) => {
  const { customer_name, desk_number, items } = req.body;
  if (!customer_name?.trim() || !desk_number?.toString().trim() || !items?.length) {
    return res.status(400).json({ error: 'Name, desk number and at least one item are required.' });
  }

  const enrichedItems = items.map(item => {
    const m = MENU.find(m => m.id === item.menu_item_id);
    return { menu_item_id: item.menu_item_id, name: m?.name ?? 'Item', emoji: m?.emoji ?? '🍽️', price: m?.price ?? 0, quantity: item.quantity };
  });
  const total = enrichedItems.reduce((s, i) => s + i.price * i.quantity, 0);

  try {
    const order = await storage.createOrder({ customer_name: customer_name.trim(), desk_number: desk_number.toString().trim(), items: enrichedItems, total });
    io.emit('new_order', order);
    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not place order' });
  }
});

app.get('/api/orders', async (_req, res) => {
  try {
    res.json((await storage.getActiveOrders()).slice().reverse());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch orders' });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await storage.getOrderById(+req.params.id);
    order ? res.json(order) : res.status(404).json({ error: 'Not found' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch order' });
  }
});

app.patch('/api/orders/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['pending', 'preparing', 'ready', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const order = await storage.updateOrderStatus(+req.params.id, status);
    if (!order) return res.status(404).json({ error: 'Not found' });
    io.emit('order_updated', order);
    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update order' });
  }
});

app.patch('/api/orders/:id/payment', async (req, res) => {
  const utr = req.body.utr?.toString().trim();

  const formatErr = validateUTR(utr);
  if (formatErr) return res.status(400).json({ error: formatErr });

  try {
    const order = await storage.getOrderById(+req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (order.payment_status === 'paid') return res.status(409).json({ error: 'This order is already marked as paid.' });

    const duplicate = await storage.findOrderByUTR(utr);
    if (duplicate && duplicate.id !== order.id) {
      return res.status(409).json({ error: `This UTR was already used for order #${duplicate.id}. Each payment can only be applied once.` });
    }

    const updated = await storage.updatePaymentStatus(order.id, 'paid', utr);
    io.emit('order_updated', updated);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update payment' });
  }
});

// ── Reconciliation ─────────────────────────────────────────────────────────
app.post('/api/admin/reconcile', async (req, res) => {
  const { pin, utrs } = req.body;
  if (pin !== ADMIN_PIN) return res.status(403).json({ error: 'Wrong PIN' });
  if (!Array.isArray(utrs)) return res.status(400).json({ error: 'utrs must be an array' });

  try {
    const orders = await storage.getOrdersWithUTR();
    // Normalise: trim and lowercase for comparison
    const paytmSet = new Set(utrs.map(u => u.trim().toLowerCase()));
    const result = orders.map(o => ({
      id:            o.id,
      customer_name: o.customer_name,
      desk_number:   o.desk_number,
      total:         o.total,
      utr:           o.utr,
      status:        o.status,
      created_at:    o.created_at,
      matched:       paytmSet.has(o.utr.trim().toLowerCase()),
    }));
    res.json({ checked: utrs.length, orders: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Reconciliation failed' });
  }
});

// ── Socket ─────────────────────────────────────────────────────────────────
io.on('connection', async socket => {
  try {
    socket.emit('initial_orders', await storage.getActiveOrders());
  } catch {}
});

// ── Start ──────────────────────────────────────────────────────────────────
storage.init().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🍽️  Canteen Ordering System`);
    console.log(`   Customer ordering : http://localhost:${PORT}/`);
    console.log(`   Kitchen dashboard : http://localhost:${PORT}/kitchen.html`);
    console.log(`   Status board      : http://localhost:${PORT}/status.html`);
    console.log(`   Admin (QR setup)  : http://localhost:${PORT}/admin.html\n`);
  });
}).catch(err => {
  console.error('Failed to initialise storage:', err);
  process.exit(1);
});
