const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data.json');

const MENU = [
  { id: 1,  category: 'Beverages', name: 'Chai',              price: 10,  emoji: '☕' },
  { id: 2,  category: 'Beverages', name: 'Coffee',            price: 20,  emoji: '☕' },
  { id: 3,  category: 'Beverages', name: 'Cold Coffee',       price: 35,  emoji: '🧋' },
  { id: 4,  category: 'Beverages', name: 'Nimbu Pani',        price: 20,  emoji: '🍋' },
  { id: 5,  category: 'Beverages', name: 'Cold Drink',        price: 30,  emoji: '🥤' },
  { id: 6,  category: 'Snacks',    name: 'Samosa (2 pcs)',    price: 15,  emoji: '🥟' },
  { id: 7,  category: 'Snacks',    name: 'Bread Pakoda',      price: 20,  emoji: '🫓' },
  { id: 8,  category: 'Snacks',    name: 'Veg Sandwich',      price: 40,  emoji: '🥪' },
  { id: 9,  category: 'Snacks',    name: 'Grilled Sandwich',  price: 55,  emoji: '🥪' },
  { id: 10, category: 'Snacks',    name: 'Veg Burger',        price: 70,  emoji: '🍔' },
  { id: 11, category: 'Meals',     name: 'Dal Rice',          price: 80,  emoji: '🍛' },
  { id: 12, category: 'Meals',     name: 'Paneer Rice',       price: 100, emoji: '🍛' },
  { id: 13, category: 'Meals',     name: 'Roti Sabzi (2 pcs)',price: 60,  emoji: '🫓' },
  { id: 14, category: 'Meals',     name: 'Full Thali',        price: 120, emoji: '🍽️' },
  { id: 15, category: 'Desserts',  name: 'Gulab Jamun',       price: 30,  emoji: '🍮' },
  { id: 16, category: 'Desserts',  name: 'Rasgulla (2 pcs)',  price: 30,  emoji: '🍮' },
];

function loadData() {
  if (fs.existsSync(DB_FILE)) {
    try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
  }
  return { orders: [], nextOrderId: 1 };
}

function saveData() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let db = loadData();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/menu', (_req, res) => res.json(MENU));

app.post('/api/orders', (req, res) => {
  const { customer_name, desk_number, items } = req.body;
  if (!customer_name?.trim() || !desk_number?.toString().trim() || !items?.length) {
    return res.status(400).json({ error: 'Name, desk number and at least one item are required.' });
  }

  const enrichedItems = items.map(item => {
    const m = MENU.find(m => m.id === item.menu_item_id);
    return { menu_item_id: item.menu_item_id, name: m?.name ?? 'Item', emoji: m?.emoji ?? '🍽️', price: m?.price ?? 0, quantity: item.quantity };
  });

  const order = {
    id: db.nextOrderId++,
    customer_name: customer_name.trim(),
    desk_number: desk_number.toString().trim(),
    items: enrichedItems,
    total: enrichedItems.reduce((s, i) => s + i.price * i.quantity, 0),
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  db.orders.push(order);
  saveData();
  io.emit('new_order', order);
  res.json(order);
});

app.get('/api/orders', (_req, res) => {
  const active = db.orders.filter(o => o.status !== 'completed').slice().reverse();
  res.json(active);
});

app.get('/api/orders/:id', (req, res) => {
  const order = db.orders.find(o => o.id === +req.params.id);
  order ? res.json(order) : res.status(404).json({ error: 'Not found' });
});

app.patch('/api/orders/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['pending', 'preparing', 'ready', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const order = db.orders.find(o => o.id === +req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });

  order.status = status;
  order.updated_at = new Date().toISOString();
  saveData();
  io.emit('order_updated', order);
  res.json(order);
});

io.on('connection', socket => {
  const active = db.orders.filter(o => o.status !== 'completed');
  socket.emit('initial_orders', active);
});

server.listen(PORT, () => {
  console.log(`\n🍽️  Canteen Ordering System`);
  console.log(`   Customer ordering : http://localhost:${PORT}/`);
  console.log(`   Kitchen dashboard : http://localhost:${PORT}/kitchen.html`);
  console.log(`   Status board      : http://localhost:${PORT}/status.html\n`);
});
