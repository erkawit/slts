/**
 * scripts/dev-server.js — เซิร์ฟเวอร์ทดสอบในเครื่อง (ไม่ต้องใช้ vercel dev)
 *   node scripts/dev-server.js            → http://localhost:3000
 * เสิร์ฟไฟล์หน้าเว็บจากโฟลเดอร์ public/ (รัน npm run build ก่อน) และ /api/* จากโฟลเดอร์ api/
 * อ่านค่า env จาก .env.local / .env (ที่ `neon deploy` สร้างให้)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

for (const f of ['.env.local', '.env']) {
  const p = path.join(__dirname, '..', f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const ROOT = path.join(__dirname, '..', process.env.STATIC_DIR || 'public');
const PORT = Number(process.env.PORT || 3000);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.ttf': 'font/ttf', '.pdf': 'application/pdf', '.ico': 'image/x-icon',
};

const apiHandlers = {
  '/api/slts': require('../api/slts'),
  '/api/health': require('../api/health'),
  '/api/photo': require('../api/photo'),
  '/api/report': require('../api/report'),
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const api = apiHandlers[url.pathname];
  if (api) {
    req.query = Object.fromEntries(url.searchParams);
    try { await api(req, res); } catch (e) { res.statusCode = 500; res.end(String(e)); }
    return;
  }
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) file = path.join(ROOT, 'index.html');
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`SLTS dev server: http://localhost:${PORT}  (static: ${ROOT})`));
