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

/**
 * หา connection string ของฐานข้อมูล (v2.7.4)
 * Vercel Storage (Neon) บังคับตั้ง prefix — ชื่อตัวแปรอาจไม่ใช่ DATABASE_URL ตรง ๆ เช่น SLTS_DATABASE_URL, STORAGE_URL
 * ลำดับ: SLTS_DATABASE_ENV (ระบุชื่อตัวแปรเอง) → DATABASE_URL → <PREFIX>_DATABASE_URL → <PREFIX>_URL (มีคู่ _URL_UNPOOLED) → POSTGRES_URL → <PREFIX>_POSTGRES_URL
 */
function resolveDatabaseUrl(env = process.env) {
  const isPg = (v) => /^postgres(ql)?:\/\//i.test(String(v || ''));
  const pick = (name) => (name && isPg(env[name]) ? { name, url: env[name] } : null);
  const keys = Object.keys(env).sort();
  const candidates = [];
  if (env.SLTS_DATABASE_ENV) candidates.push(env.SLTS_DATABASE_ENV);
  candidates.push('DATABASE_URL');
  keys.filter((k) => /^[A-Z0-9_]+_DATABASE_URL$/.test(k)).forEach((k) => candidates.push(k));
  keys.filter((k) => /^[A-Z0-9_]+_URL$/.test(k) && env[k + '_UNPOOLED'] !== undefined).forEach((k) => candidates.push(k));
  candidates.push('POSTGRES_URL');
  keys.filter((k) => /^[A-Z0-9_]+_POSTGRES_URL$/.test(k)).forEach((k) => candidates.push(k));
  for (const c of candidates) { const r = pick(c); if (r) return r; }
  return null;
}
/** ชื่อตัวแปรที่เป็น connection string ทั้งหมด (ไม่เปิดเผยค่า) — ใช้ตรวจเมื่อมีหลายฐานข้อมูลผูกกับโปรเจกต์ */
function databaseEnvNames(env = process.env) {
  return Object.keys(env).filter((k) => /^postgres(ql)?:\/\//i.test(String(env[k] || '')) && !/UNPOOLED|NON_POOLING|NO_SSL/.test(k)).sort();
}

function getPool() {
  if (pool) return pool;
  const found = resolveDatabaseUrl();
  const connectionString = found && found.url;
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

module.exports = { resolveDatabaseUrl, databaseEnvNames, query, tx, ensureSchema, getPool, close };
