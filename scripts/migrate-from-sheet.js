/**
 * scripts/migrate-from-sheet.js — ย้ายข้อมูลเดิมจาก Google Sheet (ผ่าน Apps Script) เข้า Neon
 *
 *   npm run migrate:sheet            → ย้ายจริง
 *   npm run migrate:sheet -- --dry   → ทดลองอ่านและแสดงสรุป ไม่เขียนฐานข้อมูล
 *
 * ต้องมี env: DATABASE_URL (จาก neon deploy), GAS_DRIVE_URL, GAS_BRIDGE_SECRET
 * รันซ้ำได้ปลอดภัย (ข้ามแถวที่เคยย้ายแล้ว) • รหัสผ่านถูกแปลงเป็น scrypt hash ก่อนบันทึก
 * ผู้ใช้ที่รหัสผ่านเป็นค่าตั้งต้นที่เคยเปิดเผย (เช่น 123456) จะถูกบังคับเปลี่ยนรหัสเมื่อเข้าระบบ
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

for (const f of ['.env.local', '.env']) {
  const p = path.join(__dirname, '..', f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const db = require('../lib/db');
const { hashPassword } = require('../lib/auth');
const DRY = process.argv.includes('--dry') || process.argv.includes('--dry-run');
const WEAK = new Set(['123456', '1234', 'password', 'caogikojt02', 'admin']);

async function gas(body) {
  const url = process.env.GAS_DRIVE_URL;
  if (!url) throw new Error('ต้องตั้งค่า GAS_DRIVE_URL (URL ของ Apps Script Web App เดิม)');
  const res = await fetch(url, {
    method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, secret: process.env.GAS_BRIDGE_SECRET || '' }),
  });
  const json = JSON.parse(await res.text());
  if (json.status !== 'success') throw new Error(`${body.action}: ${json.message}`);
  return json;
}

const num = (v) => { const n = Number(String(v ?? '').trim()); return String(v ?? '').trim() && Number.isFinite(n) ? n : null; };
const { parseThaiDateTime } = require('../api/slts')._internal;

async function main() {
  console.log(DRY ? '🔎 DRY RUN (ไม่เขียนฐานข้อมูล)' : '🚚 เริ่มย้ายข้อมูล Google Sheet → Neon');
  const usersRes = await gas({ action: 'get_users', includePasswords: true });
  const dataRes = await gas({ action: 'get_data' });
  const users = usersRes.users || [];
  const rows = dataRes.data || [];
  const missingPw = users.filter((u) => !u.password).length;
  console.log(`พบผู้ใช้ ${users.length} คน, บันทึกส่งหมาย ${rows.length} แถว`);
  if (missingPw) {
    console.warn(`⚠️  ${missingPw} ผู้ใช้ไม่มีรหัสผ่านในผลลัพธ์ — ตรวจสอบว่าตั้ง BRIDGE_SECRET ใน Apps Script และ GAS_BRIDGE_SECRET ตรงกัน และ Deploy Code.gs เวอร์ชันใหม่แล้ว`);
  }
  if (DRY) { console.log('ตัวอย่างแถว:', rows[0]); return; }

  let uNew = 0, uSkip = 0;
  for (const u of users) {
    const username = String(u.username || '').trim().toLowerCase();
    if (!username) continue;
    const pw = String(u.password || '');
    const mustChange = !pw || WEAK.has(pw);
    const hash = hashPassword(pw || crypto.randomBytes(9).toString('base64url'));
    const r = await db.query(`INSERT INTO app_users (username, password_hash, role, name, court_category, assigned_court, assigned_province, must_change_password, created_at_text)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (username) DO NOTHING`,
    [username, hash, ['admin', 'local_advisor'].includes(u.role) ? u.role : 'user', u.name || username, u.courtCategory || 'ศาลจังหวัด',
      u.assignedCourt || null, u.assignedProvince || 'อุดรธานี', mustChange, u.createdAt || null]);
    if (r.rowCount) uNew++; else uSkip++;
  }

  let sNew = 0, sSkip = 0;
  for (const r of rows) {
    const ts = String(r['วัน-เวลาบันทึก'] || '').trim();
    const caseNo = String(r['เลขคดี'] || '').trim();
    const fileId = String(r['Drive File ID'] || '').trim();
    const key = 'sheet:' + crypto.createHash('sha1').update([ts, caseNo, fileId, r['ชื่อไฟล์รูปภาพ'] || ''].join('|')).digest('hex').slice(0, 24);
    const q = await db.query(`INSERT INTO summons (client_upload_id, recorded_at_text, recorded_at, case_number, court_type, province, district, subdistrict,
        location_type, location_text, lat, lng, heading, file_name, drive_url, text_url, drive_file_id, uploader)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT (client_upload_id) DO NOTHING`,
    [key, ts, parseThaiDateTime(ts), caseNo, r['ประเภทศาล'] || '', r['จังหวัด'] || '', r['อำเภอ'] || '', r['ตำบล'] || '',
      r['ประเภทสถานที่'] || '', r['ที่ตั้งส่งหมาย (เต็ม)'] || '', num(r['ละติจูด (Lat)']), num(r['ลองจิจูด (Lng)']),
      String(r['ทิศองศา'] ?? ''), r['ชื่อไฟล์รูปภาพ'] || '', r['ลิงก์รูปภาพใน Google Drive'] || '', r['ลิงก์ Text File ใน Google Drive'] || '',
      fileId, String(r['ผู้บันทึก'] || '').trim().toLowerCase()]);
    if (q.rowCount) sNew++; else sSkip++;
  }
  await db.query(`INSERT INTO activity_logs (username, role, action_type, details) VALUES ('system','admin','MIGRATION',$1)`,
    [`ย้ายจาก Google Sheet: ผู้ใช้ใหม่ ${uNew} (ข้าม ${uSkip}), บันทึกใหม่ ${sNew} (ข้าม ${sSkip})`]);
  console.log(`✅ ผู้ใช้: เพิ่ม ${uNew}, ข้าม (มีอยู่แล้ว) ${uSkip}`);
  console.log(`✅ บันทึกส่งหมาย: เพิ่ม ${sNew}, ข้าม (มีอยู่แล้ว) ${sSkip}`);
}

main().catch((e) => { console.error('❌', e.message); process.exitCode = 1; }).finally(() => db.close());
