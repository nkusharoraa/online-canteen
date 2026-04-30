const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const storage = require('./storage');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);
const PORT   = process.env.PORT || 3000;

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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/menu', (_req, res) => res.json(MENU));

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
    const orders = await storage.getActiveOrders();
    res.json(orders.slice().reverse());
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

io.on('connection', async socket => {
  try {
    const orders = await storage.getActiveOrders();
    socket.emit('initial_orders', orders);
  } catch {}
});

storage.init().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🍽️  Canteen Ordering System`);
    console.log(`   Customer ordering : http://localhost:${PORT}/`);
    console.log(`   Kitchen dashboard : http://localhost:${PORT}/kitchen.html`);
    console.log(`   Status board      : http://localhost:${PORT}/status.html\n`);
  });
}).catch(err => {
  console.error('Failed to initialise storage:', err);
  process.exit(1);
});
