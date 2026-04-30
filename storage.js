'use strict';

const fs   = require('fs');
const path = require('path');

const usePostgres = !!process.env.DATABASE_URL;
let pool;

if (usePostgres) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
}

// ── JSON file fallback (local dev) ─────────────────────────────────────────
const DB_FILE = path.join(__dirname, 'data.json');
let jsonDb;

function loadJson() {
  if (jsonDb) return jsonDb;
  if (fs.existsSync(DB_FILE)) {
    try { jsonDb = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); return jsonDb; } catch {}
  }
  jsonDb = { orders: [], nextOrderId: 1, config: {} };
  return jsonDb;
}

function saveJson() { fs.writeFileSync(DB_FILE, JSON.stringify(jsonDb, null, 2)); }

// ── Row normalisers ────────────────────────────────────────────────────────
function toOrder(row) {
  return {
    id:             Number(row.id),
    customer_name:  row.customer_name,
    desk_number:    row.desk_number,
    items:          typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
    total:          Number(row.total),
    status:         row.status,
    payment_status: row.payment_status,
    utr:            row.utr ?? null,
    created_at:     row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at:     row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  if (usePostgres) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id             SERIAL PRIMARY KEY,
        customer_name  TEXT        NOT NULL,
        desk_number    TEXT        NOT NULL,
        items          JSONB       NOT NULL,
        total          INTEGER     NOT NULL DEFAULT 0,
        status         TEXT        NOT NULL DEFAULT 'pending',
        payment_status TEXT        NOT NULL DEFAULT 'awaiting',
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS config (
        key   TEXT PRIMARY KEY,
        value TEXT
      )
    `);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'awaiting'`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS utr TEXT`);
    console.log('Connected to PostgreSQL');
  } else {
    const db = loadJson();
    if (!db.config) { db.config = {}; saveJson(); }
    console.log('Using local JSON storage (data.json)');
  }
}

// ── Orders ─────────────────────────────────────────────────────────────────
async function getActiveOrders() {
  if (usePostgres) {
    const { rows } = await pool.query(`SELECT * FROM orders WHERE status != 'completed' ORDER BY id`);
    return rows.map(toOrder);
  }
  return loadJson().orders.filter(o => o.status !== 'completed');
}

async function getOrderById(id) {
  if (usePostgres) {
    const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    return rows[0] ? toOrder(rows[0]) : null;
  }
  return loadJson().orders.find(o => o.id === id) ?? null;
}

async function createOrder({ customer_name, desk_number, items, total }) {
  if (usePostgres) {
    const { rows } = await pool.query(
      `INSERT INTO orders (customer_name, desk_number, items, total) VALUES ($1,$2,$3,$4) RETURNING *`,
      [customer_name, desk_number, JSON.stringify(items), total]
    );
    return toOrder(rows[0]);
  }
  const db = loadJson();
  const order = { id: db.nextOrderId++, customer_name, desk_number, items, total, status: 'pending', payment_status: 'awaiting', utr: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  db.orders.push(order);
  saveJson();
  return order;
}

async function updateOrderStatus(id, status) {
  if (usePostgres) {
    const { rows } = await pool.query(
      `UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [status, id]
    );
    return rows[0] ? toOrder(rows[0]) : null;
  }
  const db = loadJson();
  const order = db.orders.find(o => o.id === id);
  if (!order) return null;
  order.status = status;
  order.updated_at = new Date().toISOString();
  saveJson();
  return order;
}

async function updatePaymentStatus(id, payment_status, utr = null) {
  if (usePostgres) {
    const { rows } = await pool.query(
      `UPDATE orders SET payment_status=$1, utr=$2, updated_at=NOW() WHERE id=$3 RETURNING *`,
      [payment_status, utr, id]
    );
    return rows[0] ? toOrder(rows[0]) : null;
  }
  const db = loadJson();
  const order = db.orders.find(o => o.id === id);
  if (!order) return null;
  order.payment_status = payment_status;
  order.utr = utr;
  order.updated_at = new Date().toISOString();
  saveJson();
  return order;
}

// ── Config ─────────────────────────────────────────────────────────────────
async function getConfig(key) {
  if (usePostgres) {
    const { rows } = await pool.query('SELECT value FROM config WHERE key=$1', [key]);
    return rows[0]?.value ?? null;
  }
  return loadJson().config[key] ?? null;
}

async function setConfig(key, value) {
  if (usePostgres) {
    await pool.query(
      `INSERT INTO config (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`,
      [key, value]
    );
  } else {
    const db = loadJson();
    db.config[key] = value;
    saveJson();
  }
}

async function getOrdersWithUTR() {
  if (usePostgres) {
    const { rows } = await pool.query(`SELECT * FROM orders WHERE utr IS NOT NULL ORDER BY id DESC`);
    return rows.map(toOrder);
  }
  return loadJson().orders.filter(o => o.utr).slice().reverse();
}

module.exports = { init, getActiveOrders, getOrderById, createOrder, updateOrderStatus, updatePaymentStatus, getConfig, setConfig, getOrdersWithUTR };
