/**
 * scripts/bump-version.js — เพิ่มเลขเวอร์ชันระบบ (Semantic Versioning: MAJOR.MINOR.PATCH)
 *
 *   npm run version:bump -- patch "แก้บั๊กปุ่มถ่ายภาพค้าง" "ปรับข้อความแจ้งเตือน"
 *   npm run version:bump -- minor "เพิ่มเมนูรายงาน"
 *   npm run version:bump -- major "เปลี่ยนโครงสร้างฐานข้อมูล"
 *
 * patch = แก้บั๊ก • minor = เพิ่มความสามารถ (ใช้ร่วมกับของเดิมได้) • major = เปลี่ยนแปลงใหญ่/ไม่เข้ากับของเดิม
 * จะอัปเดต version.json, package.json และเขียน CHANGELOG.md ใหม่
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const [kind = 'patch', ...notes] = process.argv.slice(2);
const changelogOnly = kind === '--changelog-only';
if (!changelogOnly && !['patch', 'minor', 'major'].includes(kind)) {
  console.error('ใช้: npm run version:bump -- <patch|minor|major> "รายละเอียด 1" "รายละเอียด 2"');
  process.exit(1);
}

const vPath = path.join(root, 'version.json');
const info = JSON.parse(fs.readFileSync(vPath, 'utf8'));
let [ma, mi, pa] = info.version.split('.').map(Number);
if (changelogOnly) { /* เขียน CHANGELOG.md ใหม่จาก version.json โดยไม่เพิ่มเวอร์ชัน */ } else if (kind === 'major') { ma++; mi = 0; pa = 0; } else if (kind === 'minor') { mi++; pa = 0; } else { pa++; }
const version = `${ma}.${mi}.${pa}`;
const date = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

if (!changelogOnly) {
info.version = version;
info.build = date;
info.releases = [{ version, date, title: notes[0] || `อัปเดต ${kind}`, notes: notes.length ? notes : ['ปรับปรุงระบบ'] }, ...(info.releases || [])];
fs.writeFileSync(vPath, JSON.stringify(info, null, 2) + '\n');

const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

// แอป Android: versionName = เวอร์ชันระบบ, versionCode = MAJOR*10000 + MINOR*100 + PATCH (ต้องเพิ่มขึ้นทุกครั้งที่ส่งขึ้น Play Store)
const gradle = path.join(root, 'android', 'app', 'build.gradle');
if (fs.existsSync(gradle)) {
  const g = fs.readFileSync(gradle, 'utf8')
    .replace(/versionCode \d+/, `versionCode ${ma * 10000 + mi * 100 + pa}`)
    .replace(/versionName "[^"]*"/, `versionName "${version}"`);
  fs.writeFileSync(gradle, g);
}

const md = ['# ประวัติการอัปเดตระบบ (Changelog)', '', 'สร้างอัตโนมัติจาก `version.json` ด้วย `npm run version:bump`', ''];
for (const r of info.releases) {
  md.push(`## v${r.version} — ${r.date}`, '', `**${r.title || ''}**`, '');
  for (const n of r.notes || []) md.push(`- ${n}`);
  md.push('');
}
fs.writeFileSync(path.join(root, 'CHANGELOG.md'), md.join('\n'));
console.log(`✅ เวอร์ชันใหม่: v${version} (บันทึกลง version.json, package.json, CHANGELOG.md)`);
