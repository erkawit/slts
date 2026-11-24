/**
 * tests/report.test.js — ทดสอบตรรกะระบบรายงานผลหมาย (ไม่ต้องใช้ฐานข้อมูล)
 *   node --test tests/report.test.js
 * ข้อมูลทดสอบเป็นข้อมูลสมมติ (ไม่ใช่ข้อมูลคดีจริง)
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../js/report-logic.js');

const ISSUED_ROWS = [
  ['ศาลจังหวัดอุดรธานี'],
  ['บัญชีจ่ายหมาย พนักงานศาลนี้ส่ง'],
  ['ตั้งแต่วันที่ 9 พฤศจิกายน 2569 ถึงวันที่ 20 พฤศจิกายน 2569'],
  ['', 'ที่', '', 'เลขดำที่', '', '', 'เลขแดงที่', 'โจทก์', '', '', 'จำเลย', '', '', 'หมายอะไร', 'หมายถึงใคร', '', 'ที่อยู่', 'ตำบล', 'อำเภอ', '', 'ราคา', 'ผู้ส่งหมาย', 'ผู้วางเงิน', 'ผลการส่งหมาย'],
  ['', '1', '', 'ต1001/2569\nพ55/2569', '', '', ' ', 'บริษัท ทดสอบ จำกัด', '', '', 'นายสมมติ ทดลอง', '', '', 'คำบังคับ', 'นายสมมติ  ทดลอง  จำเลยที่ 1', '', '33 ม. 10 ซ. - ถ. -', 'เสอเพลอ', 'กุมภวาปี', '', '900.00', 'นายเจ้าหน้าที่ ทดสอบ', 'ศาลแพ่ง', ''],
  // "ผู้" เก็บแบบวรรณยุกต์ก่อนสระ (พบในไฟล์จริงจากระบบงานศาล)
  ['', '2', '', 'ผบ77/2569', '', '', 'ผบ88/2569', 'ธนาคารทดสอบ', '', '', 'นางทดสอบ', '', '', 'หมายนัด', 'นายสมมติ  ผู้คัดค้านที่ 2', '', '394/2  หมู่บ้านทดสอบ ม. 2 ซ. - ถ. -', 'ห้วยสามพาด', 'ประจักษ์ศิลปาคม', '', '0.00', 'นายเจ้าหน้าที่ ทดสอบ', ' ', 'ส่งได้โดยวิธีปิดประกาศ'],
];
const ACC_ROWS = [
  ['ศาลจังหวัดอุดรธานี'], ['ตั้งแต่วันที่ 16 พฤศจิกายน 2569 ถึงวันที่ 20 พฤศจิกายน 2569'],
  ['ที่', '', 'วันที่ลงข้อมูล', 'เลขดำที่', 'เลขแดงที่', '', 'หมายอะไร', 'ส่งหมายให้ใคร', '', 'ตำบล', 'อำเภอ', '', 'ราคาหมาย', '', 'ผู้ส่งหมาย', 'ใบเสร็จ จ่ายออก', '', '', 'ใบเสร็จ รับมา'],
  ['1', '', '17-พ.ย. -69', 'ต1001/2569\nพ55/2569', ' ', '', 'คำบังคับ', 'นายสมมติ ทดลอง จำเลยที่ 1', '', 'เสอเพลอ', 'กุมภวาปี', '', '900.00', '', 'นายเจ้าหน้าที่', '97335/110(900)', '', '', '97335/110(900)'],
];

test('อ่านบัญชีจ่ายหมาย: หมาย ต. / หมายศาล, ที่อยู่, ราคา, ช่วงวันที่', () => {
  const r = L.parseCourtExcel(ISSUED_ROWS);
  assert.strictEqual(r.kind, 'issued');
  assert.deepStrictEqual(r.period, { start: '2026-11-09', end: '2026-11-20' });
  const [a, b] = r.items;
  assert.strictEqual(a.kind, 'T'); assert.strictEqual(a.t_no, 'ต1001/2569'); assert.strictEqual(a.black_no, 'พ55/2569');
  assert.strictEqual(a.money_type, 'paid'); assert.strictEqual(a.price, 900); assert.strictEqual(a.payer_court, 'ศาลแพ่ง');
  assert.strictEqual(a.house_no, '33'); assert.strictEqual(a.moo, '10'); assert.strictEqual(a.soi, ''); assert.strictEqual(a.road, '');
  assert.strictEqual(b.kind, 'LOCAL'); assert.strictEqual(b.money_type, 'free'); assert.strictEqual(b.red_no, 'ผบ88/2569');
  assert.strictEqual(b.house_no, '394/2 หมู่บ้านทดสอบ'); assert.strictEqual(b.moo, '2');
  assert.ok(b.recipient.includes('ผู้คัดค้าน'), 'จัดลำดับสระ/วรรณยุกต์ให้ค้นหาได้');
  assert.strictEqual(L.resultCodeOf(b.result_text), '003');
});

test('อ่านบัญชีใบเสร็จ + จับคู่กับหมาย', () => {
  const acc = L.parseCourtExcel(ACC_ROWS);
  assert.strictEqual(acc.kind, 'accexpense');
  assert.strictEqual(acc.items[0].entry_date, '2026-11-17');
  assert.strictEqual(acc.items[0].receipt_ref, 'ใบเสร็จเล่มที่ 97335 เลขที่ 110');
  const iss = L.parseCourtExcel(ISSUED_ROWS).items;
  const m = L.matchReceipts(iss, acc.items);
  assert.strictEqual(m.length, 1); assert.strictEqual(m[0].index, 0);
});

test('วันที่/ตัวเลขไทย และจำนวนเงินเป็นตัวหนังสือ', () => {
  assert.strictEqual(L.bahtText(950), 'เก้าร้อยห้าสิบบาทถ้วน');
  assert.strictEqual(L.bahtText(1021.5), 'หนึ่งพันยี่สิบเอ็ดบาทห้าสิบสตางค์');
  assert.strictEqual(L.thaiDateLong('2026-11-22'), '๒๒  พฤศจิกายน  ๒๕๖๙');
  assert.strictEqual(L.thaiDateLong('2026-11-22', { arabic: true }), '22  พฤศจิกายน  2569');
  assert.strictEqual(L.toIso(L.parseThaiTextDate('17-พ.ย. -69')), '2026-11-17');
});

test('อัตราค่านำหมาย: ค้นหาตามอำเภอ/ตำบล + ข้อยกเว้นหมู่', () => {
  const rates = [
    { rate_type: 'free', district: 'น้ำโสม', subdistrict: 'น้ำโสม', exception_note: '', rate_amount: 1000 },
    { rate_type: 'free', district: 'น้ำโสม', subdistrict: 'น้ำโสม', exception_note: 'ยกเว้นหมู่ 18', rate_amount: 1200 },
    { rate_type: 'free', district: 'เมืองอุดรธานี', subdistrict: 'หมากแข้ง', exception_note: '', rate_amount: 300 },
  ];
  assert.strictEqual(L.findRate(rates, 'free', 'อำเภอน้ำโสม', 'ตำบลน้ำโสม', '3').rate_amount, 1000);
  assert.strictEqual(L.findRate(rates, 'free', 'น้ำโสม', 'น้ำโสม', '18').rate_amount, 1200);
  assert.strictEqual(L.findRate(rates, 'free', 'เมือง', 'หมากแข้ง', '').rate_amount, 300);
  assert.strictEqual(L.findRate(rates, 'paid', 'เมือง', 'หมากแข้ง', ''), null);
});

test('เลือกแม่แบบ: หมาย ต./หมายศาล × ปิดประกาศ/ปกติ', () => {
  assert.strictEqual(L.templateFor('T', '001'), 't_normal');
  assert.strictEqual(L.templateFor('T', '003'), 't_notice');
  assert.strictEqual(L.templateFor('LOCAL', '017'), 'local_normal');
  assert.strictEqual(L.templateFor('LOCAL', '003'), 'local_notice');
  for (const n of ['t_normal', 't_notice', 'local_normal', 'local_notice', 'memo_free', 'memo_paid']) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'templates', 'report', n + '.docx')), n);
  }
});

test('เงินในแบบรายงาน: หมายเงิน / หมายฟรีเบิก (เงินงบประมาณ) / หมายฟรีไม่เบิก (เว้นว่าง)', () => {
  const base = { kind: 'LOCAL', black_no: 'ผบ1/2569', result_code: '001', serve_date: '2026-11-22', record_date: '2026-11-23', receipt_date: '2026-11-23' };
  let d = L.buildDocData({ ...base, money_type: 'paid', amount: 950, receipt_ref: 'ใบเสร็จเล่มที่ 1 เลขที่ 2' });
  assert.strictEqual(d.amount, '๙๕๐.๐๐'); assert.strictEqual(d.amount_text, 'เก้าร้อยห้าสิบบาทถ้วน'); assert.strictEqual(d.pay_source, 'ใบเสร็จเล่มที่ ๑ เลขที่ ๒');
  d = L.buildDocData({ ...base, money_type: 'free', claim: true, claim_amount: 800 });
  assert.strictEqual(d.amount, '๘๐๐.๐๐'); assert.strictEqual(d.pay_source, 'เงินงบประมาณ'); assert.strictEqual(d.amount_text, 'แปดร้อยบาทถ้วน');
  d = L.buildDocData({ ...base, money_type: 'free', claim: false, claim_amount: 800 });
  assert.strictEqual(d.amount, ''); assert.strictEqual(d.pay_source, ''); assert.strictEqual(d.amount_text, '');
  d = L.buildDocData({ ...base, kind: 'T', money_type: 'paid', amount: 900, payer_court: 'ศาลแพ่ง', receipt_ref: '' });
  assert.strictEqual(d.pay_source2, 'ศาลแพ่ง');
  assert.strictEqual(d.cb_file, '52'); assert.strictEqual(d.cb_post, 'a3'); assert.strictEqual(d.cb2_2, 'f0fe'); assert.strictEqual(d.cb2_1, 'f06f');
});

test('หมายฟรีหลายรายการ: ซ้ำบ้านเดียวกัน = ห้ามเบิก, หมู่เดียวกันคนละบ้าน = 50%', () => {
  const r = L.evaluateFreeSummonItems([
    { house_no: '1', moo: '2', subdistrict: 'ก', district: 'ข', base_rate: 800 },
    { house_no: '3', moo: '2', subdistrict: 'ก', district: 'ข', base_rate: 800 },
    { house_no: '9', moo: '5', subdistrict: 'ก', district: 'ข', base_rate: 800 },
  ]);
  assert.deepStrictEqual(r.items.map((x) => x.calc_rule), ['half', 'half', 'full']);
  assert.strictEqual(r.total_amount, 1600);
  const d = L.evaluateFreeSummonItems([{ house_no: '1', moo: '2', subdistrict: 'ก', district: 'ข', base_rate: 800 }, { house_no: '1', moo: '2', subdistrict: 'ก', district: 'ข', base_rate: 800 }]);
  assert.strictEqual(d.has_duplicates, true);
});

// เติมแม่แบบ Word จริง (ต้องมี jszip — ข้ามถ้าไม่มีในเครื่อง)
let JSZip = null;
try { JSZip = require('jszip'); } catch (_) { /* optional */ }
test('เติมแม่แบบ Word: ไม่เหลือ {{placeholder}} และแนบภาพได้', { skip: !JSZip && 'ไม่มี jszip' }, async () => {
  const D = require('../js/report-docx.js');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEklEQVR4nGP4z8AARAwM/xkYAA0EAf+NuvZoAAAAAElFTkSuQmCC', 'base64');
  for (const name of ['t_normal', 't_notice', 'local_normal', 'local_notice']) {
    const tpl = fs.readFileSync(path.join(__dirname, '..', 'templates', 'report', name + '.docx'));
    const data = L.buildDocData({ kind: name[0] === 't' ? 'T' : 'LOCAL', t_no: 'ต1/2569', black_no: 'พ1/2569', money_type: 'free', claim: true, claim_amount: 800, result_code: name.includes('notice') ? '003' : '001', serve_date: '2026-11-22' });
    const buf = await D.fillReportDocx(tpl, data, [{ bytes: png, width: 4, height: 3, ext: 'png' }], { JSZip, node: true });
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml').async('string');
    assert.ok(!/\{\{[a-z0-9_]+\}\}/i.test(xml), name + ': placeholder เหลือ');
    assert.ok(!xml.includes('5LT5F0T0'), name + ': marker เหลือ');
    assert.ok(zip.file('word/media/slts_photo1.png'), name + ': ไม่มีภาพ');
    assert.ok(xml.includes('เงินงบประมาณ'));
  }
});

test('เลขคดี: หมาย ต. ใช้เลขที่ขึ้นต้นด้วย ต / พิจารณาถึงปี พ.ศ. หลัง "/" เท่านั้น', () => {
  assert.deepEqual(L.caseNos('ฟ41/2567\nต๓๐๘๖/๒๕๖๙ (ฟ.)').map((x) => x.text), ['ฟ41/2567', 'ต3086/2569']);
  assert.equal(L.caseKey('ต3086/2569ก'), 'ต3086/2569');
  assert.equal(L.caseKey('ต 3086 / 69'), 'ต3086/2569');
  assert.equal(L.caseKey('ผบe2749/2568 เพิ่มเติม'), 'ผบE2749/2568');
  const H = [null, 'ที่', 'เลขดำที่', 'หมายอะไร', 'หมายถึงใคร', 'ราคา'];
  const r = L.parseIssuedSheet([H,
    [null, '1', 'ฟ41/2567\nต2980/2569 (ต่อ)', 'หมายนัด', 'นาย ก', '0.00'],
    [null, '2', 'อ12/2569', 'คำบังคับ', 'นาย ข', '900.00'],
    [null, '', '', 'หมายเรียก', 'นาย ค', '0'],
  ]);
  assert.deepEqual(r.items.map((x) => [x.seq, x.kind, x.t_no, x.black_no]), [[1, 'T', 'ต2980/2569', 'ฟ41/2567'], [2, 'LOCAL', '', 'อ12/2569'], [3, 'LOCAL', '', 'อ12/2569']]);
});

test('โซนจ่ายหมาย: Pre-set ที่ผู้ใช้ตั้งเอง + หมุนเวียนทุก 2 สัปดาห์', () => {
  const w = L.reportWindow(new Date(2026, 10, 24));
  assert.equal(w.startIso, '2026-11-16'); assert.equal(w.endIso, '2026-11-27');
  const data = { อุดรธานี: { เมืองอุดรธานี: ['หมากแข้ง', 'บ้านเลื่อม', 'หนองบัว'], กุดจับ: ['ปะโค'], กุมภวาปี: ['แชแล'], ประจักษ์ศิลปาคม: ['นาม่วง'] } };
  const A = L.provinceAreas('จ.อุดรธานี', data);
  assert.equal(A.muang, 'เมืองอุดรธานี');
  assert.deepEqual(A.districts, ['กุดจับ', 'กุมภวาปี', 'ประจักษ์ศิลปาคม']);
  const preset = { province: 'อุดรธานี', zones: [
    { id: 'a', name: '', subdistricts: ['หมากแข้ง', 'หนองบัว'], districts: [] },
    { id: 'b', name: 'กุมภวาปี-ประจักษ์', subdistricts: [], districts: ['กุมภวาปี', 'ประจักษ์ศิลปาคม'] },
    { id: 'c', name: '', subdistricts: ['บ้านเลื่อม'], districts: ['กุดจับ'] },
  ] };
  assert.deepEqual(L.validatePreset(preset), []);
  assert.ok(L.validatePreset({ zones: [{ subdistricts: ['หมากแข้ง'] }, { subdistricts: ['หมากแข้ง'] }] }).length);
  const g = L.presetZones(preset, data);
  assert.equal(g[0].label, 'อ.เมืองอุดรธานี (ต.หมากแข้ง, ต.หนองบัว)');
  const c1 = L.currentZone({ zone_key: 'b', anchor: '2026-11-16' }, g, new Date(2026, 10, 27));
  assert.equal(c1.zone.key, 'b');
  assert.equal(L.currentZone({ zone_key: 'b', anchor: '2026-11-16' }, g, new Date(2026, 10, 30)).zone.key, 'c');
  assert.equal(L.currentZone({ zone_key: 'c', anchor: '2026-11-16' }, g, new Date(2026, 10, 30)).zone.key, 'a'); // วนกลับโซนแรก
  assert.ok(L.inZone(g[0], 'อ.เมือง', 'ต.หมากแข้ง'));
  assert.ok(!L.inZone(g[0], 'เมืองอุดรธานี', 'บ้านเลื่อม'));
  assert.ok(L.inZone(g[1], 'ประจักษ์ศิลปาคม', 'นาม่วง'));
  assert.ok(L.inZone(g[2], '', '', '5 ม.2 ต.ปะโค อ.กุดจับ จ.อุดรธานี'));
});

test('ตารางโซนจาก Excel: เขตพื้นที่ / มีหมู่-ไม่มีหมู่ / หน่วยงาน / ผู้ส่งเลื่อนทุก 2 สัปดาห์', () => {
  const data = { อุดรธานี: { เมืองอุดรธานี: ['หมากแข้ง', 'บ้านเลื่อม', 'หนองบัว'], กุมภวาปี: ['แชแล'], ประจักษ์ศิลปาคม: ['นาม่วง'], กู่แก้ว: ['ค้อใหญ่'], วังสามหมอ: ['ผาสุก'], ศรีธาตุ: ['จำปี'] } };
  const rows = [
    ['วันที่  16 พฤศจิกายน  2569  ถึง  วันที่  27  พฤศจิกายน  2569'],
    ['โซน', 'เขตตำบล/อำเภอ', 'ผู้ส่ง', 'ผู้ส่งสำรอง'],
    ['โซน 1', 'ตำบลหมากแข้งไม่มีหมู่', 'ประกายดาว', ''],
    ['โซน 2', 'อัยการ-เรือนจำ-จพค.-คุมประพฤติ', 'ประภาพร', ''],
    ['โซน 3', 'ตำบลหมากแข้ง มีหมู่', 'ขนิษฐา', ''],
    ['โซน 4', 'อำเภอประจักษ์ฯ,    ตำบลกู่แก้ว', 'ณัฐรินันก์', ''],
    ['โซน 5', 'อำเภอศรีธาตุ,   ตำบลวังสามหมอ ', 'อมรรัตน์', 'ณัฐรินันก์ (แทน)'],
  ];
  const P = L.parseZoneSheet(rows, 'อุดรธานี', data);
  assert.equal(P.period_start, '2026-11-16'); assert.equal(P.period_end, '2026-11-27');
  assert.deepEqual(P.zones[0].moo, { หมากแข้ง: 'without' });
  assert.deepEqual(P.zones[1].keywords, ['อัยการ', 'เรือนจำ', 'จพค', 'คุมประพฤติ']);
  assert.deepEqual(P.zones[3].districts, ['ประจักษ์ศิลปาคม', 'กู่แก้ว']); // "ตำบลกู่แก้ว" พิมพ์ผิด → อำเภอ
  assert.deepEqual(P.zones[4].districts, ['ศรีธาตุ', 'วังสามหมอ']);
  assert.equal(P.zones[4].backup, 'ณัฐรินันก์ (แทน)');
  const zones = P.zones.map((z, i) => ({ ...z, id: 'z' + (i + 1), name: z.raw }));
  assert.deepEqual(L.validatePreset({ zones }), []); // หมากแข้ง แบ่ง มีหมู่/ไม่มีหมู่ ได้
  const g = L.presetZones({ province: 'อุดรธานี', zones }, data);
  assert.equal(L.zoneFor(g, { district: 'เมืองอุดรธานี', subdistrict: 'หมากแข้ง', moo: '', text: '12 ถ.โพศรี ต.หมากแข้ง' }).key, 'z1');
  assert.equal(L.zoneFor(g, { district: 'เมืองอุดรธานี', subdistrict: 'หมากแข้ง', moo: '5', text: '' }).key, 'z3');
  assert.equal(L.zoneFor(g, { district: 'เมืองอุดรธานี', subdistrict: 'หมากแข้ง', text: 'เรือนจำกลางอุดรธานี ต.หมากแข้ง' }).key, 'z2');
  assert.equal(L.zoneFor(g, { district: 'ประจักษ์ศิลปาคม', subdistrict: 'นาม่วง' }).key, 'z4');
  // ผู้ส่ง ↔ ผู้ใช้ในระบบ (ชื่อตัว)
  const staff = [{ username: 'ekk', name: 'นายเอกวิทย์  ลาดล้าย' }, { username: 'a1', name: 'นางสาวอมรรัตน์ ใจดี' }];
  assert.equal(L.matchStaff('เอกวิทย์', staff).username, 'ekk');
  assert.equal(L.matchStaff('อมรรัตน์', staff).username, 'a1');
  assert.equal(L.matchStaff('ประภาพร', staff), null);
  // เลื่อนผู้ส่งลง 1 โซน (โซนสุดท้าย → โซน 1) + ล้างผู้ส่งสำรอง
  const ids = zones.map((z) => z.id);
  const roster = { period_start: '2026-11-16', period_end: '2026-11-27', assign: Object.fromEntries(zones.map((z) => [z.id, { sender: z.sender, sender_username: z.sender === 'อมรรัตน์' ? 'a1' : '', backup: z.backup, backup_username: '' }])) };
  const nx = L.shiftRoster(ids, roster, 1);
  assert.equal(nx.period_start, '2026-11-30'); assert.equal(nx.period_end, '2026-12-11');
  assert.equal(nx.assign.z1.sender, 'อมรรัตน์'); assert.equal(nx.assign.z2.sender, 'ประกายดาว'); assert.equal(nx.assign.z5.backup, '');
  // รอบ: สัปดาห์ที่ 3 = ถึงรอบเลื่อน แต่ยังอยู่ช่วงรายงานผลถึงวันพุธ
  assert.equal(L.rosterStatus(roster, new Date(2026, 10, 27)).due, false);
  const w3 = L.rosterStatus(roster, new Date(2026, 11, 1)); // อังคาร สัปดาห์ที่ 3
  assert.equal(w3.due, true); assert.equal(w3.afterReport, false); assert.equal(L.dIso(w3.reportUntil), '2026-12-02');
  assert.equal(L.rosterStatus(roster, new Date(2026, 11, 3)).afterReport, true);
  assert.equal(L.rosterStatus(roster, new Date(2026, 11, 15)).steps, 2);
  // โซนของผู้ใช้ตามรอบ (บัญชีจ่ายหมายรอบถัดไป → โซนถัดไป)
  assert.equal(L.userZoneAt(g, roster, 'a1', '2026-11-20').key, 'z5');
  assert.equal(L.userZoneAt(g, roster, 'a1', '2026-12-04').key, 'z1');
});
