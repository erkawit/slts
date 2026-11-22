/**
 * build-public.js — คัดลอกไฟล์หน้าเว็บไปโฟลเดอร์ public/ (ใช้ทั้ง Vercel และ Capacitor)
 * และฝังเลขเวอร์ชันจาก version.json ลงใน sw.js / index.html (cache-busting อัตโนมัติ)
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const publicDir = path.join(root, 'public');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(publicDir, { recursive: true, force: true });
fs.mkdirSync(publicDir, { recursive: true });

for (const file of ['manifest.json', 'version.json']) {
  fs.copyFileSync(path.join(root, file), path.join(publicDir, file));
}
for (const folder of ['css', 'js', 'img']) copyDir(path.join(root, folder), path.join(publicDir, folder));

// แทนที่ __APP_VERSION__ เพื่อให้มือถือได้ไฟล์ใหม่ทุกครั้งที่อัปเดตเวอร์ชัน
const stamp = (file) => {
  const src = fs.readFileSync(path.join(root, file), 'utf8').replace(/__APP_VERSION__/g, version);
  fs.writeFileSync(path.join(publicDir, file), src);
};
stamp('index.html');
stamp('sw.js');

// แอป Android/iOS (Capacitor): ไฟล์หน้าเว็บอยู่ในเครื่อง จึงต้องฝังโดเมนเซิร์ฟเวอร์ให้เรียก API ได้
// ใช้: SLTS_API_BASE=https://slts-ochre.vercel.app node build-public.js
if (process.env.SLTS_API_BASE) {
  const base = process.env.SLTS_API_BASE.replace(/\/+$/, '');
  const pub = (process.env.SLTS_PUBLIC_WEB_URL || base).replace(/\/+$/, '');
  const cfgPath = path.join(publicDir, 'js', 'config.js');
  let cfg = fs.readFileSync(cfgPath, 'utf8');
  cfg = cfg.replace(/API_BASE:\s*''/, `API_BASE: '${base}'`).replace(/PUBLIC_WEB_URL:\s*''/, `PUBLIC_WEB_URL: '${pub}'`);
  if (!cfg.includes(`API_BASE: '${base}'`)) throw new Error('ไม่พบ API_BASE ใน js/config.js');
  fs.writeFileSync(cfgPath, cfg);
  console.log(`Native build: API_BASE = ${base}`);
}

console.log(`Successfully synced web assets into public/ (v${version})`);
