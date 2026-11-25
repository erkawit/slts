/**
 * api/photo.js — แสดงไฟล์ภาพที่เก็บใน Neon
 * GET /api/photo?f=db-<id>-<sig>   (ลิงก์มีลายเซ็น เดาเลขภาพของผู้อื่นไม่ได้)
 */
const photos = require('../lib/photos');

module.exports = async function photo(req, res) {
  try {
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    const inm = (req.headers && req.headers['if-none-match']) || '';
    const head = await photos.getPhoto(q.f, { withData: false });
    if (!head) { res.statusCode = 404; res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'text/plain'); return res.end('not found'); }
    // ลิงก์รูปแบบใหม่ (token สุ่ม) ไม่ซ้ำกันเลย → แคชถาวรได้
    // ลิงก์รูปแบบเดิม (db-<id>-<sig>) เลข id ซ้ำกันได้เมื่อสลับฐานข้อมูล → ให้เบราว์เซอร์ตรวจกับเซิร์ฟเวอร์ทุกครั้ง (ETag)
    const cacheCtl = head.kind === 'token' ? 'private, max-age=31536000, immutable' : 'private, no-cache';
    res.setHeader('ETag', head.etag);
    res.setHeader('Cache-Control', cacheCtl);
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (inm && inm === head.etag) { res.statusCode = 304; return res.end(); }
    const row = await photos.getPhoto(q.f);
    if (!row) { res.statusCode = 404; res.setHeader('Cache-Control', 'no-store'); return res.end('not found'); }
    res.statusCode = 200;
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Content-Length', row.data.length);
    if (q.download) res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`);
    res.end(row.data);
  } catch (e) {
    console.error('[api/photo]', e);
    res.statusCode = 500; res.end('error');
  }
};
