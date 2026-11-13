/**
 * lib/auth.js — รหัสผ่าน (scrypt) และ session token (HMAC-SHA256) ฝั่งเซิร์ฟเวอร์
 * ไม่ต้องพึ่ง package ภายนอก ใช้ node:crypto ล้วน
 */
const crypto = require('crypto');

const TOKEN_TTL_SEC = 60 * 60 * 24 * 30; // 30 วัน (เจ้าหน้าที่ภาคสนามอาจออฟไลน์นาน)

function getSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return process.env.SESSION_SECRET;
  }
  if (!process.env.DATABASE_URL) throw new Error('SESSION_SECRET is not configured');
  // ทางสำรอง: สร้าง secret จาก DATABASE_URL (ซึ่งเป็นความลับอยู่แล้ว) — ควรตั้ง SESSION_SECRET เอง
  return crypto.createHash('sha256').update('slts-session:' + process.env.DATABASE_URL).digest('hex');
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const hash = crypto.scryptSync(String(plain), salt, 32, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(plain, stored) {
  try {
    const [algo, N, r, p, saltB64, hashB64] = String(stored || '').split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(plain), Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch (_) {
    return false;
  }
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function signToken(user) {
  const body = {
    u: user.username,
    r: user.role,
    v: user.token_version || 1,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC,
  };
  const payload = b64u(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** คืนค่า { u, r, v, exp } หรือ null ถ้าไม่ถูกต้อง/หมดอายุ */
function readToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch (_) {
    return null;
  }
}

/** รหัสแชร์ที่อ่านง่าย ไม่มีตัวที่สับสน (0/O, 1/I/L) */
function randomCode(len = 8) {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

module.exports = { hashPassword, verifyPassword, signToken, readToken, randomCode, TOKEN_TTL_SEC };
