/**
 * api/photo.js — แสดงไฟล์ภาพที่เก็บใน Neon
 * GET /api/photo?f=db-<id>-<sig>   (ลิงก์มีลายเซ็น เดาเลขภาพของผู้อื่นไม่ได้)
 */
const photos = require('../lib/photos');

module.exports = async function photo(req, res) {
  try {
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    const row = await photos.getPhoto(q.f);
    if (!row) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); return res.end('not found'); }
    res.statusCode = 200;
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Content-Length', row.data.length);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (q.download) res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`);
    res.end(row.data);
  } catch (e) {
    console.error('[api/photo]', e);
    res.statusCode = 500; res.end('error');
  }
};
