/**
 * lib/db.js — การเชื่อมต่อ Neon (Lakebase Postgres) สำหรับ Vercel Functions
 *
 * - ใช้ node-postgres (pg) + Pool ตามคำแนะนำของ Neon สำหรับ Vercel (Fluid compute)
 * - ใช้ DATABASE_URL แบบ pooled (-pooler) สำหรับทราฟฟิกของแอป
 * - attachDatabasePool() ช่วยปิด connection ที่ idle ก่อนฟังก์ชันถูก suspend
 * - สร้างตาราง (migration) อัตโนมัติครั้งแรกที่ instance เริ่มทำงาน (idempotent)
 */
const { Pool } = require('pg');
const { SCHEMA_SQL } = require('./schema');

let pool = null;
let schemaReady = null;

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    const err = new Error('DATABASE_URL is not set (run `neon deploy` / `neon env pull` or add it in Vercel env)');
    err.code = 'NO_DATABASE_URL';
    throw err;
  }
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX || 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: isLocal ? false : { rejectUnauthorized: true },
  });
  pool.on('error', (e) => console.error('[db] idle client error', e.message));
  try {
    // มีเฉพาะบน Vercel; ถ้าไม่มี package นี้ (เช่นรันทดสอบในเครื่อง) ให้ข้ามไป
    const { attachDatabasePool } = require('@vercel/functions');
    attachDatabasePool(pool);
  } catch (_) { /* optional */ }
  return pool;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getPool()
      .query(SCHEMA_SQL)
      .catch((e) => {
        schemaReady = null; // ให้ลองใหม่ในคำขอถัดไป
        throw e;
      });
  }
  return schemaReady;
}

async function query(text, params) {
  await ensureSchema();
  return getPool().query(text, params);
}

/** รันหลายคำสั่งใน transaction เดียว */
async function tx(fn) {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

async function close() {
  if (pool) { await pool.end(); pool = null; schemaReady = null; }
}

module.exports = { query, tx, ensureSchema, getPool, close };
