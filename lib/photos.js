/**
 * lib/photos.js — เก็บไฟล์ภาพถ่ายใน Neon Postgres (ไม่ต้องใช้ Google Drive / Google Sheet)
 *
 * fileId รูปแบบ: db-<id>-<sig>  (sig = HMAC กันการเดาเลขรูปของผู้อื่น)
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
function makeFileId(id) { return `db-${id}-${sign(id)}`; }

/** คืน id (ตัวเลข) ถ้า fileId ถูกต้อง ไม่เช่นนั้นคืน null */
function parseFileId(fileId) {
  const m = String(fileId || '').match(/^db-(\d+)-([A-Za-z0-9]{16})$/);
  if (!m) return null;
  const expected = Buffer.from(sign(m[1]));
  const got = Buffer.from(m[2]);
  return expected.length === got.length && crypto.timingSafeEqual(expected, got) ? Number(m[1]) : null;
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
    'INSERT INTO photo_files (file_name, mime_type, size_bytes, data) VALUES ($1,$2,$3,$4) RETURNING id',
    [String(fileName || 'photo.jpg').slice(0, 200), mime, buf.length, buf]);
  const fileId = makeFileId(rows[0].id);
  return { fileId, fileUrl: photoUrl(fileId, origin) };
}

async function getPhoto(fileId) {
  const id = parseFileId(fileId);
  if (!id) return null;
  const { rows } = await db.query('SELECT file_name, mime_type, data, created_at FROM photo_files WHERE id = $1', [id]);
  return rows[0] || null;
}

async function deletePhoto(fileId) {
  const id = parseFileId(fileId);
  if (!id) return false;
  const { rowCount } = await db.query('DELETE FROM photo_files WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = { savePhoto, getPhoto, deletePhoto, isDbFileId, parseFileId, photoUrl };
