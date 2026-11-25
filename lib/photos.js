/**
 * lib/photos.js — เก็บไฟล์ภาพถ่ายใน Neon Postgres (ไม่ต้องใช้ Google Drive / Google Sheet)
 *
 * fileId รูปแบบใหม่: db-<id>-<token 24 ตัว>  (token สุ่มเก็บในแถว — ลิงก์ไม่ซ้ำแม้สลับฐานข้อมูล/branch)
 * fileId รูปแบบเดิม: db-<id>-<sig 16 ตัว>  (sig = HMAC ของ id — เลข id ซ้ำกันได้ระหว่างฐานข้อมูลคนละชุด)
 * URL แสดงรูป:  https://<โดเมน>/api/photo?f=db-<id>-<sig>
 *
 * หมายเหตุขนาด: ภาพถูกบีบอัดจากมือถือเหลือ ~100–500 KB/ภาพ
 * Neon Free plan มีพื้นที่ 0.5 GB ≈ 1,500–4,000 ภาพ — ถ้าใช้งานมากให้อัปเกรดแผน
 */
const crypto = require('crypto');
const db = require('./db');

function secret() {
  return process.env.SESSION_SECRET || ('slts-photo:' + (process.env.DATABASE_URL || ''));
}
function sign(id) {
  return crypto.createHmac('sha256', secret()).update('photo:' + id).digest('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
}

/** แยก fileId → { id, kind: 'token'|'legacy', key } หรือ null */
function splitFileId(fileId) {
  const m = String(fileId || '').match(/^db-(\d+)-([A-Za-z0-9]{16}|[A-Za-z0-9]{24})$/);
  if (!m) return null;
  return { id: Number(m[1]), kind: m[2].length === 24 ? 'token' : 'legacy', key: m[2] };
}
function safeEq(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
/** คืน id (ตัวเลข) ถ้า fileId รูปแบบเดิมถูกต้อง (รูปแบบใหม่ต้องตรวจ token กับฐานข้อมูล) */
function parseFileId(fileId) {
  const p = splitFileId(fileId);
  if (!p) return null;
  if (p.kind === 'legacy') return safeEq(sign(p.id), p.key) ? p.id : null;
  return p.id;
}
function newToken() {
  return crypto.randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g, '').padEnd(24, 'x').slice(0, 24);
}
function isDbFileId(fileId) { return /^db-\d+-/.test(String(fileId || '')); }

function photoUrl(fileId, origin) {
  return `${origin || ''}/api/photo?f=${encodeURIComponent(fileId)}`;
}

async function savePhoto({ fileName, imageBase64, origin }) {
  let b64 = String(imageBase64 || '');
  let mime = 'image/jpeg';
  const head = b64.match(/^data:([^;]+);base64,/);
  if (head) { mime = head[1]; b64 = b64.slice(head[0].length); }
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw new Error('ไฟล์ภาพว่างเปล่า');
  if (buf.length > 4 * 1024 * 1024) throw new Error('ไฟล์ภาพใหญ่เกิน 4 MB');
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new Error('รองรับเฉพาะไฟล์ภาพ JPEG/PNG/WebP');
  const { rows } = await db.query(
    'INSERT INTO photo_files (file_name, mime_type, size_bytes, data, token) VALUES ($1,$2,$3,$4,$5) RETURNING id, token',
    [String(fileName || 'photo.jpg').slice(0, 200), mime, buf.length, buf, newToken()]);
  const fileId = `db-${rows[0].id}-${rows[0].token}`;
  return { fileId, fileUrl: photoUrl(fileId, origin) };
}

/** ตรวจ fileId กับแถวในฐานข้อมูล; withData=false ใช้ตอบ 304 โดยไม่ต้องอ่านไฟล์ */
async function getPhoto(fileId, { withData = true } = {}) {
  const p = splitFileId(fileId);
  if (!p) return null;
  if (p.kind === 'legacy' && !safeEq(sign(p.id), p.key)) return null;
  const cols = withData ? 'file_name, mime_type, data, size_bytes, created_at, token' : 'file_name, mime_type, size_bytes, created_at, token';
  const { rows } = await db.query(`SELECT ${cols} FROM photo_files WHERE id = $1`, [p.id]);
  const row = rows[0];
  if (!row) return null;
  if (p.kind === 'token' && !(row.token && safeEq(row.token, p.key))) return null;
  row.kind = p.kind;
  row.etag = '"' + crypto.createHash('sha1').update(`${p.id}:${row.size_bytes}:${new Date(row.created_at).getTime()}:${row.token || ''}`).digest('hex').slice(0, 20) + '"';
  return row;
}

async function deletePhoto(fileId) {
  const row = await getPhoto(fileId, { withData: false });
  if (!row) return false;
  const { rowCount } = await db.query('DELETE FROM photo_files WHERE id = $1', [splitFileId(fileId).id]);
  return rowCount > 0;
}

module.exports = { savePhoto, getPhoto, deletePhoto, isDbFileId, parseFileId, splitFileId, photoUrl };
