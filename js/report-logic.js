/**
 * report-logic.js — ตรรกะของระบบรายงานผลหมาย (ไม่มี DOM ใช้ได้ทั้งเบราว์เซอร์และ Node สำหรับทดสอบ)
 *
 *  - วันที่/ตัวเลขไทย, จำนวนเงินเป็นตัวหนังสือ
 *  - อ่านไฟล์ Excel "บัญชีจ่ายหมาย พนักงานศาลนี้ส่ง" และ "บัญชีรับ-จ่ายค่านำหมาย (accexpense)"
 *  - อัตราค่านำหมาย (หมายเงิน/หมายฟรี) + นำเข้าจาก Excel แบบ 4 บล็อก/ตาราง (พอร์ตจาก summon-report)
 *  - เลือกแม่แบบ Word และเตรียมข้อมูลสำหรับ {{placeholder}}
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------
  // วันที่ / ตัวเลข
  // ---------------------------------------------------------------
  const THAI_MONTHS = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const THAI_MONTHS_SHORT = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

  /** จัดลำดับสระ-วรรณยุกต์ไทยให้เป็นมาตรฐาน (ข้อมูลจากระบบงานศาลบางครั้งเก็บ "ผู้" แทน "ผู้") */
  const thNorm = (s) => String(s == null ? '' : s).replace(/([\u0E48-\u0E4B])([\u0E31\u0E34-\u0E3A\u0E47])/g, '$2$1');
  const toThaiDigits = (s) => String(s == null ? '' : s).replace(/[0-9]/g, (d) => THAI_DIGITS[d]);
  const toArabicDigits = (s) => String(s == null ? '' : s).replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));

  /** "2026-11-23" | Date → {y(ค.ศ.), m, d} */
  function ymd(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v) ? null : { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
    if (typeof v === 'object' && v.y && v.m && v.d) return { y: v.y, m: v.m, d: v.d };
    const s = toArabicDigits(String(v).trim());
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      let y = +m[1]; if (y > 2400) y -= 543;
      return { y, m: +m[2], d: +m[3] };
    }
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) {
      let y = +m[3]; if (y < 100) y += 2500; if (y > 2400) y -= 543;
      return { y, m: +m[2], d: +m[1] };
    }
    const th = parseThaiTextDate(s);
    return th;
  }

  /** "9 พฤศจิกายน 2569" / "17-พ.ย. -69" / "22 พ.ย. 2026" → {y,m,d} */
  function parseThaiTextDate(s) {
    s = toArabicDigits(String(s || '')).replace(/\s+/g, ' ').trim();
    const m = s.match(/(\d{1,2})\s*-?\s*([ก-๙.]+?)\s*-?\s*(\d{2,4})/);
    if (!m) return null;
    const name = m[2].replace(/\s/g, '');
    let mo = THAI_MONTHS.indexOf(name);
    if (mo < 1) mo = THAI_MONTHS_SHORT.indexOf(name);
    if (mo < 1) mo = THAI_MONTHS_SHORT.findIndex((x) => x && x.replace(/\./g, '') === name.replace(/\./g, ''));
    if (mo < 1) return null;
    let y = +m[3];
    if (y < 100) y += 2500;
    if (y > 2400) y -= 543;
    return { y, m: mo, d: +m[1] };
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const isoOf = (p) => (p ? `${p.y}-${pad2(p.m)}-${pad2(p.d)}` : '');
  const toIso = (v) => isoOf(ymd(v));
  const todayIso = () => { const t = new Date(Date.now() + 7 * 3600e3); return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`; };

  /** วันที่แบบยาวในแบบฟอร์ม: "๑๑  ธันวาคม  ๒๕๖๘" (เว้น 2 ช่องตามแม่แบบศาล) */
  function thaiDateLong(v, opt) {
    const p = ymd(v); if (!p) return '';
    const s = `${p.d}  ${THAI_MONTHS[p.m]}  ${p.y + 543}`;
    return opt && opt.arabic ? s : toThaiDigits(s);
  }
  function thaiDateParts(v, opt) {
    const p = ymd(v); if (!p) return { d: '', m: '', y: '' };
    const f = (x) => (opt && opt.arabic ? String(x) : toThaiDigits(x));
    return { d: f(p.d), m: THAI_MONTHS[p.m], y: f(p.y + 543) };
  }
  /** "23 พฤศจิกายน 2569" (เลขอารบิก ใช้ในตาราง/หน้าจอ) */
  function thaiDateText(v) { const p = ymd(v); return p ? `${p.d} ${THAI_MONTHS[p.m]} ${p.y + 543}` : ''; }
  function thaiDateShort(v) { const p = ymd(v); return p ? `${p.d} ${THAI_MONTHS_SHORT[p.m]} ${String(p.y + 543).slice(-2)}` : ''; }

  // ---------------------------------------------------------------
  // จำนวนเงิน
  // ---------------------------------------------------------------
  function intToThai(num) {
    num = Math.floor(num);
    if (num === 0) return '';
    const digits = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
    const pos = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
    const s = String(num);
    if (s.length > 6) return intToThai(+s.slice(0, s.length - 6)) + 'ล้าน' + intToThai(+s.slice(s.length - 6));
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const d = +s[i]; const p = s.length - i - 1;
      if (d === 0) continue;
      if (p === 0 && d === 1 && s.length > 1) out += 'เอ็ด';
      else if (p === 1 && d === 2) out += 'ยี่สิบ';
      else if (p === 1 && d === 1) out += 'สิบ';
      else out += digits[d] + pos[p];
    }
    return out;
  }
  function bahtText(amount) {
    const n = Math.round((Number(amount) || 0) * 100) / 100;
    if (n === 0) return 'ศูนย์บาทถ้วน';
    const [b, st] = Math.abs(n).toFixed(2).split('.');
    let out = n < 0 ? 'ลบ' : '';
    if (+b > 0) out += intToThai(+b) + 'บาท';
    out += +st === 0 ? 'ถ้วน' : intToThai(+st) + 'สตางค์';
    return out;
  }
  const money2 = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const moneyShort = (n) => {
    const v = Number(n) || 0;
    return Math.abs(v - Math.round(v)) < 0.005 ? v.toLocaleString('en-US') : money2(v);
  };
  function parseMoney(v) {
    const s = toArabicDigits(String(v == null ? '' : v)).replace(/[,บาท\s]/g, '');
    const n = Number(s);
    return Number.isFinite(n) && s !== '' ? Math.round(n * 100) / 100 : null;
  }

  // ---------------------------------------------------------------
  // ข้อมูลอ้างอิง
  // ---------------------------------------------------------------
  /** รหัสผลการส่งหมาย (ตามระบบงานศาล) */
  const RESULT_CODES = [
    ['001', 'ส่งได้โดยวิธีปิดหมาย'],
    ['002', 'ส่งได้ รับได้ด้วยตัวเอง'],
    ['003', 'ส่งได้โดยวิธีปิดประกาศ'],
    ['004', 'ส่งได้โดยมีผู้แทน ซึ่งอายุกว่า 20 ปี และอยู่บ้าน/สำนักงานเดียวกันรับไว้แทน'],
    ['005', 'ส่งไม่ได้เพราะไม่มีผู้รับตามจำหน้า'],
    ['006', 'ส่งไม่ได้เพราะบ้านรื้อถอน'],
    ['007', 'ส่งได้เพราะ'],
    ['008', 'ส่งไม่ได้เพราะ'],
    ['009', 'อื่นๆ'],
    ['010', 'ประกาศหนังสือพิมพ์'],
    ['011', 'รอผลหมายต่างจังหวัด'],
    ['012', 'ส่งได้ โดยวิธีรับหมายด้วยตนเอง'],
    ['013', 'ส่งได้โดยมีผู้รับแทน'],
    ['014', 'ส่งไม่ได้ เพราะ จ่าหน้าไม่ชัดเจน'],
    ['015', 'ส่งไม่ได้ เพราะ ไม่มารับภายในกำหนด'],
    ['016', 'ส่งไม่ได้ เพราะ ไม่มีเลขที่บ้านตามจ่าหน้า'],
    ['017', 'ส่งไม่ได้ เพราะ ไม่ยอมรับ'],
    ['018', 'ส่งไม่ได้ เพราะ ย้ายไม่ทราบที่อยู่ใหม่'],
    ['019', 'ส่งไม่ได้ เพราะ เลิกกิจการ'],
  ];
  const resultText = (code) => (RESULT_CODES.find((r) => r[0] === code) || [])[1] || '';
  function resultCodeOf(text) {
    const t = String(text || '').replace(/\s+/g, '');
    if (!t) return '';
    const hit = RESULT_CODES.find((r) => r[1].replace(/\s+/g, '') === t);
    if (hit) return hit[0];
    if (/ปิดประกาศ/.test(t)) return '003';
    if (/ปิดหมาย/.test(t)) return '001';
    if (/ตัวเอง/.test(t)) return '002';
    return '';
  }
  /** "ปิดประกาศ" = หมายประกาศศาล → ใช้แบบรายงานประกาศ */
  const isNoticeResult = (code) => code === '003';

  /** ประเภทการส่งหมาย (กล่องเลือกท้ายหน้า 1 ของแบบหมายศาล) */
  const FILE_TYPES = [
    ['file', 'รวมหลักฐานไว้ในสำนวน'],
    ['it', 'ส่งหมายใหม่อีกครั้ง ประกาศหนังสือเทคโนโลยีสารสนเทศ'],
    ['post', 'ส่งหมายใหม่อีกครั้ง โดยวิธีส่งทางไปรษณีย์'],
    ['walk', 'ส่งหมายใหม่อีกครั้ง โดยวิธีให้เจ้าพนักงานศาลเดินหมาย'],
    ['sendto', 'ส่งหมายไปที่'],
    ['court', 'เห็นควรเสนอศาลเพื่อมีคำสั่ง'],
  ];

  /** บันทึกการปิดหมาย (หน้า 2) */
  const POSTING_CHOICES = [
    ['1', 'ไม่พบจำเลย พบบ้านปิดประตูใส่กุญแจ สอบถามบุคคลบ้านข้างเคียง... จึงทำการปิดหมายไว้ที่เปิดเผยมองเห็นได้ง่าย'],
    ['2', 'ไม่พบ(ผู้รับหมาย) พบบ้านปิดประตูใส่กุญแจ จึงทำการปิดหมายตามคำสั่งศาล'],
    ['3', 'ไม่พบ(ระบุชื่อ) สอบถามบุคคลในบ้าน... จึงทำการปิดหมายไว้ที่เปิดเผยมองเห็นได้ง่าย'],
    ['4', 'ไม่พบจำเลย พบบ้านปิดประตูใส่กุญแจ สอบถามบุคคลบ้านข้างเคียงไม่แจ้งชื่อให้ทราบ ได้ความว่า จำเลยออกไป'],
    ['5', 'อื่นๆ (ระบุ)'],
  ];

  const SEND_METHODS = ['ส่งโดยเจ้าพนักงาน', 'ส่งทางไปรษณีย์', 'ส่งโดยวิธีอื่น'];

  /** รหัสไปรษณีย์ จ.อุดรธานี ตามอำเภอ (แก้ไขได้ในแบบฟอร์ม) */
  const UDON_POSTCODES = {
    'เมืองอุดรธานี': '41000', 'กุดจับ': '41250', 'หนองวัวซอ': '41360', 'กุมภวาปี': '41110', 'โนนสะอาด': '41240',
    'หนองหาน': '41130', 'ทุ่งฝน': '41310', 'ไชยวาน': '41290', 'ศรีธาตุ': '41230', 'วังสามหมอ': '41280',
    'บ้านดุง': '41190', 'บ้านผือ': '41160', 'น้ำโสม': '41210', 'เพ็ญ': '41150', 'สร้างคอม': '41260',
    'หนองแสง': '41340', 'นายูง': '41380', 'พิบูลย์รักษ์': '41130', 'พิบูลรักษ์': '41130', 'กู่แก้ว': '41130',
    'ประจักษ์ศิลปาคม': '41110',
  };
  const cleanDistrict = (s) => thNorm(s).trim().replace(/\s+/g, ' ').replace(/^(อำเภอ|อ\.)\s*/, '');
  const cleanSubdistrict = (s) => thNorm(s).trim().replace(/\s+/g, ' ').replace(/^(ตำบล|ต\.)\s*/, '');
  /** เทียบชื่ออำเภอ: "เมือง" = "เมืองอุดรธานี", พิบูลรักษ์/พิบูลย์รักษ์ */
  function districtKey(s) {
    let d = cleanDistrict(s).replace(/\s/g, '');
    if (d === 'เมือง' || d === 'เมืองอุดร') d = 'เมืองอุดรธานี';
    return d.replace('พิบูลย์', 'พิบูล');
  }
  const subKey = (s) => cleanSubdistrict(s).replace(/\s/g, '');
  function postcodeFor(district) {
    const k = districtKey(district);
    for (const [name, code] of Object.entries(UDON_POSTCODES)) if (districtKey(name) === k) return code;
    return '';
  }

  /** ความแพ่ง/ความอาญา จากอักษรนำหน้าเลขคดี */
  function caseKindOf(caseNo) {
    const p = String(caseNo || '').trim().replace(/\s/g, '');
    if (/^(อ|ย|ขร|ฝ|อย|อท|อทย|ยช|ฟย)/.test(p)) return 'อาญา';
    return 'แพ่ง';
  }

  /** "80 ม. 6 ซ. - ถ. -" → {house_no, moo, soi, road} */
  function parseAddress(addr) {
    const s = String(addr || '').replace(/\s+/g, ' ').trim();
    const out = { house_no: '', moo: '', soi: '', road: '' };
    if (!s) return out;
    const grab = (re) => { const m = s.match(re); return m ? m[1].trim() : ''; };
    const clean = (v) => (v === '-' ? '' : v);
    out.moo = clean(grab(/(?:^|\s)ม\.\s*([^\s]+)/) || grab(/(?:^|\s)หมู่(?:ที่)?\s*(\d+|-)/));
    out.soi = clean(grab(/(?:^|\s)(?:ซ\.|ซอย)\s*(.*?)(?=\s+(?:ถ\.|ถนน)|$)/));
    out.road = clean(grab(/(?:^|\s)(?:ถ\.|ถนน)\s*(.*)$/));
    const cut = s.search(/\s(?:ม\.|หมู่|ซ\.|ซอย|ถ\.|ถนน)(?:\s|\d|$)/);
    out.house_no = (cut >= 0 ? s.slice(0, cut) : s).trim();
    if (out.house_no === '-') out.house_no = '';
    return out;
  }

  /** แยกบรรทัดของเซลล์ Excel ("ต2980/2569\nฟ41/2567") */
  const lines = (v) => String(v == null ? '' : v).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  /**
   * ดึงเลขคดีทุกชุดในช่อง (เช่น "ต2980/2569\nฟ41/2567") — พิจารณาถึงปี พ.ศ. หลัง "/" เท่านั้น
   * ข้อความหลังปี (เช่น "ต3086/2569 (ฟ.)", "ผบE2749/2568ก") ไม่นำมาพิจารณา
   * คืน [{ prefix, num, year, text: 'ต3086/2569', key: 'ต3086/2569', isT }]
   */
  const CASE_RE = /([ก-ฮA-Za-z][ก-ฮA-Za-z.]{0,7}?)\s*\.?\s*(\d{1,7})\s*\/\s*(\d{4}|\d{2})(?!\d)/g;
  function caseNos(v) {
    const src = toArabicDigits(thNorm(String(v == null ? '' : v)));
    const out = [];
    let m;
    CASE_RE.lastIndex = 0;
    while ((m = CASE_RE.exec(src))) {
      const prefix = m[1].replace(/\./g, '').replace(/[a-z]/g, (c) => c.toUpperCase());
      const num = String(parseInt(m[2], 10));
      const year = m[3].length === 2 ? '25' + m[3] : m[3];
      const text = `${prefix}${num}/${year}`;
      out.push({ prefix, num, year, text, key: text, isT: prefix === 'ต' });
    }
    return out;
  }
  /** คีย์เปรียบเทียบเลขคดี: ตัวอักษรนำหน้า + เลข + / + ปี (ไม่สนใจข้อความหลังปี) */
  const caseKey = (s) => { const c = caseNos(s)[0]; return c ? c.key : toArabicDigits(String(s || '')).replace(/\s+/g, '').toUpperCase(); };
  const isTNo = (s) => { const c = caseNos(s); return c.length > 0 && c[0].isT; };

  // ---------------------------------------------------------------
  // นำเข้า Excel: บัญชีจ่ายหมาย พนักงานศาลนี้ส่ง (litigant_rpt_issued_sendbyofficer)
  // rows = array ของแถว (array ของค่าในเซลล์) จาก SheetJS sheet_to_json({header:1})
  // ---------------------------------------------------------------
  function findHeader(rows, mustHave) {
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const cells = (rows[i] || []).map((c) => String(c == null ? '' : c).replace(/\s+/g, ''));
      if (mustHave.every((h) => cells.some((c) => c === h || c.includes(h)))) return { index: i, cells };
    }
    return null;
  }
  const colOf = (cells, ...names) => {
    for (const n of names) { const i = cells.findIndex((c) => c === n); if (i >= 0) return i; }
    for (const n of names) { const i = cells.findIndex((c) => c.includes(n)); if (i >= 0) return i; }
    return -1;
  };
  function parsePeriod(rows) {
    for (const r of rows.slice(0, 8)) {
      const t = (r || []).map((c) => String(c == null ? '' : c)).join(' ');
      const m = t.match(/ตั้งแต่วันที่\s*(.+?)\s*ถึงวันที่\s*(.+?)$/);
      if (m) return { start: toIso(parseThaiTextDate(m[1])), end: toIso(parseThaiTextDate(m[2])) };
    }
    return { start: '', end: '' };
  }

  function parseIssuedSheet(rows) {
    const h = findHeader(rows, ['เลขดำที่', 'หมายอะไร']);
    if (!h || !h.cells.some((c) => c.includes('หมายถึงใคร'))) {
      throw new Error('ไม่ใช่ไฟล์ "บัญชีจ่ายหมาย พนักงานศาลนี้ส่ง" (ไม่พบหัวตาราง เลขดำที่/หมายอะไร/หมายถึงใคร)');
    }
    const c = h.cells;
    const col = {
      seq: colOf(c, 'ที่'), black: colOf(c, 'เลขดำที่'), red: colOf(c, 'เลขแดงที่'),
      plaintiff: colOf(c, 'โจทก์'), defendant: colOf(c, 'จำเลย'), stype: colOf(c, 'หมายอะไร'),
      recipient: colOf(c, 'หมายถึงใคร'), addr: colOf(c, 'ที่อยู่'), sub: colOf(c, 'ตำบล'), dist: colOf(c, 'อำเภอ'),
      price: colOf(c, 'ราคา'), server: colOf(c, 'ผู้ส่งหมาย'), payer: colOf(c, 'ผู้วางเงิน'), result: colOf(c, 'ผลการส่งหมาย'),
    };
    const get = (r, k) => (col[k] >= 0 ? thNorm(String(r[col[k]] == null ? '' : r[col[k]])).trim() : '');
    const items = [];
    for (let i = h.index + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const cells = r.map((x) => String(x == null ? '' : x).replace(/\s+/g, ''));
      // หัวตารางซ้ำ (ไฟล์หลายหน้า) / ท้ายตาราง → ข้าม
      if (cells.some((x) => x === 'เลขดำที่') || cells.some((x) => x === 'หมายถึงใคร')) continue;
      const seqRaw = toArabicDigits(get(r, 'seq'));
      const seq = /^\d+$/.test(seqRaw.replace(/\.$/, '')) ? parseInt(seqRaw, 10) : 0;
      const nos = caseNos(r[col.black]);
      const recipient = get(r, 'recipient').replace(/\s+/g, ' ').trim();
      const stype = get(r, 'stype').replace(/\s+/g, ' ');
      // แถวต่อเนื่อง (เซลล์เลขคดีถูกแยกเป็น 2 แถว): ไม่มีลำดับ/ผู้รับ → เติมเลขคดีให้รายการก่อนหน้า
      if (!seq && !recipient && !stype) {
        const prev = items[items.length - 1];
        if (prev && nos.length) {
          const t = nos.find((n) => n.isT);
          if (t && !prev.t_no) { prev.t_no = t.text; prev.kind = 'T'; }
          const o = nos.find((n) => !n.isT);
          if (o && !prev.black_no) prev.black_no = o.text;
        }
        continue;
      }
      if (!nos.length && !recipient) continue;
      // หมายต่างจังหวัด = ช่องเลขดำมีเลขที่ขึ้นต้นด้วย "ต" (ใช้เลข ต. เป็นเลขหลักของหมาย)
      let tNo = nos.find((n) => n.isT);
      let other = nos.find((n) => !n.isT);
      // ช่องเลขคดีว่าง (เซลล์ผสาน/คดีเดียวกันหลายผู้รับ) → ใช้เลขคดีของรายการก่อนหน้า
      if (!nos.length && items.length) {
        const prev = items[items.length - 1];
        if (prev.t_no) tNo = { text: prev.t_no, isT: true };
        if (prev.black_no) other = { text: prev.black_no, isT: false };
      }
      const isT = !!tNo;
      const addr = parseAddress(get(r, 'addr'));
      const price = parseMoney(get(r, 'price')) || 0;
      items.push({
        seq: seq || (items.length ? items[items.length - 1].seq + 1 : 1),
        kind: isT ? 'T' : 'LOCAL',
        t_no: isT ? tNo.text : '',
        // หมาย ต.: เก็บเลขคดีของศาลต้นทางไว้แสดงในแบบฟอร์มเท่านั้น (ไม่ใช้จับคู่/ตรวจซ้ำ)
        black_no: other ? other.text : (isT ? '' : (lines(thNorm(r[col.black]))[0] || '').replace(/\s+/g, '')),
        red_no: caseNos(r[col.red]).map((n) => n.text).join(' ') || lines(thNorm(r[col.red])).join(' ').replace(/^-$/, ''),
        plaintiff: get(r, 'plaintiff').replace(/\s+/g, ' '),
        defendant: get(r, 'defendant').replace(/\s+/g, ' '),
        summon_type: stype,
        recipient,
        address_raw: get(r, 'addr').replace(/\s+/g, ' '),
        house_no: addr.house_no, moo: addr.moo, soi: addr.soi, road: addr.road,
        subdistrict: cleanSubdistrict(get(r, 'sub')), district: cleanDistrict(get(r, 'dist')),
        price,
        money_type: price > 0 ? 'paid' : 'free',
        server_name: get(r, 'server').replace(/\s+/g, ' '),
        payer_court: get(r, 'payer').replace(/\s+/g, ' '),
        result_text: get(r, 'result').replace(/\s+/g, ' '),
      });
    }
    if (!items.length) throw new Error('ไม่พบรายการหมายในไฟล์');
    return { kind: 'issued', period: parsePeriod(rows), items };
  }

  // ---------------------------------------------------------------
  // นำเข้า Excel: บัญชีค่านำหมาย/ใบเสร็จ (litigant_rpt_accexpense)
  // ---------------------------------------------------------------
  /** "97335/110(900)" → "ใบเสร็จเล่มที่ 97335 เลขที่ 110" */
  function receiptText(v) {
    const s = toArabicDigits(String(v || '')).trim();
    const m = s.match(/^(\d+)\s*\/\s*(\d+)/);
    return m ? `ใบเสร็จเล่มที่ ${m[1]} เลขที่ ${m[2]}` : s.replace(/\(.*\)$/, '').trim();
  }
  function parseAccExpenseSheet(rows) {
    const h = findHeader(rows, ['เลขดำที่', 'ราคาหมาย']);
    if (!h || !h.cells.some((c) => c.includes('ใบเสร็จ'))) {
      throw new Error('ไม่ใช่ไฟล์บัญชีค่านำหมาย/ใบเสร็จ (ไม่พบหัวตาราง เลขดำที่/ราคาหมาย/ใบเสร็จ)');
    }
    const c = h.cells;
    const col = {
      seq: colOf(c, 'ที่'), date: colOf(c, 'วันที่ลงข้อมูล'), black: colOf(c, 'เลขดำที่'), red: colOf(c, 'เลขแดงที่'),
      stype: colOf(c, 'หมายอะไร'), recipient: colOf(c, 'ส่งหมายให้ใคร'), sub: colOf(c, 'ตำบล'), dist: colOf(c, 'อำเภอ'),
      price: colOf(c, 'ราคาหมาย'), server: colOf(c, 'ผู้ส่งหมาย'), out: colOf(c, 'ใบเสร็จจ่ายออก'), inn: colOf(c, 'ใบเสร็จรับมา'),
    };
    const get = (r, k) => (col[k] >= 0 ? thNorm(String(r[col[k]] == null ? '' : r[col[k]])).trim() : '');
    const items = [];
    for (let i = h.index + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const seq = parseInt(toArabicDigits(get(r, 'seq')), 10);
      const nos = caseNos(r[col.black]);
      if (!seq || !nos.length) continue;
      const tNo = nos.find((n) => n.isT); const other = nos.find((n) => !n.isT);
      const isT = !!tNo;
      const rin = get(r, 'inn') || get(r, 'out');
      items.push({
        seq,
        entry_date: toIso(parseThaiTextDate(get(r, 'date'))),
        t_no: isT ? tNo.text : '',
        black_no: other ? other.text : '',
        red_no: lines(thNorm(r[col.red])).join(' '),
        summon_type: get(r, 'stype').replace(/\s+/g, ' '),
        recipient: get(r, 'recipient').replace(/\s+/g, ' '),
        subdistrict: cleanSubdistrict(get(r, 'sub')), district: cleanDistrict(get(r, 'dist')),
        price: parseMoney(get(r, 'price')) || 0,
        server_name: get(r, 'server').replace(/\s+/g, ' '),
        receipt_raw: rin,
        receipt_ref: receiptText(rin),
      });
    }
    return { kind: 'accexpense', period: parsePeriod(rows), items };
  }

  /** ตรวจชนิดไฟล์อัตโนมัติ */
  function parseCourtExcel(rows) {
    const flat = rows.slice(0, 12).map((r) => (r || []).join('|')).join('\n');
    if (/ใบเสร็จ/.test(flat) && /ราคาหมาย/.test(flat)) return parseAccExpenseSheet(rows);
    return parseIssuedSheet(rows);
  }

  const normName = (s) => thNorm(s).replace(/\s+/g, '').replace(/(จำเลย|โจทก์|ผู้ร้อง|ผู้คัดค้าน|ผู้เสียหาย)(ที่\d+)?.*$/, '');
  const normCase = caseKey;

  /** จับคู่ใบเสร็จ (accexpense) เข้ากับหมายในบัญชีจ่ายหมาย → คืนรายการ {issuedIndex, receipt} */
  function matchReceipts(issued, acc) {
    const used = new Set();
    const out = [];
    issued.forEach((it, idx) => {
      const keyT = normCase(it.t_no); const keyB = normCase(it.black_no);
      let best = -1; let bestScore = 0;
      acc.forEach((a, j) => {
        if (used.has(j)) return;
        let score = 0;
        if (keyT) { if (normCase(a.t_no) === keyT) score += 5; } // หมาย ต. จับคู่ด้วยเลข ต. เท่านั้น
        else if (keyB && !a.t_no && normCase(a.black_no) === keyB) score += 4;
        if (!score) return;
        if (normName(a.recipient) && normName(a.recipient) === normName(it.recipient)) score += 3;
        if (subKey(a.subdistrict) === subKey(it.subdistrict)) score += 1;
        if (score > bestScore) { bestScore = score; best = j; }
      });
      if (best >= 0) { used.add(best); out.push({ index: idx, receipt: acc[best] }); }
    });
    return out;
  }

  // ---------------------------------------------------------------
  // อัตราค่านำหมาย
  // ---------------------------------------------------------------
  function exceptionMoos(note) {
    const s = toArabicDigits(String(note || ''));
    if (!/ยกเว้น/.test(s)) return [];
    return (s.match(/\d+/g) || []).map(Number);
  }
  /**
   * หาอัตราตามอำเภอ/ตำบล (และหมู่ กรณีมีข้อยกเว้น เช่น "ยกเว้นหมู่ 18")
   * @param rates [{rate_type, district, subdistrict, exception_note, rate_amount}]
   */
  function findRate(rates, type, district, subdistrict, moo) {
    const dk = districtKey(district); const sk = subKey(subdistrict);
    const list = (rates || []).filter((r) => r.rate_type === type && subKey(r.subdistrict) === sk &&
      (!dk || districtKey(r.district) === dk));
    if (!list.length) return null;
    const mooN = parseInt(toArabicDigits(moo), 10);
    if (mooN) {
      const exc = list.find((r) => exceptionMoos(r.exception_note).includes(mooN));
      if (exc) return exc;
    }
    return list.find((r) => !String(r.exception_note || '').trim()) || list[0];
  }

  /** การคิดเงินหมายฟรีหลายรายการ (พอร์ตจาก summon-report): ซ้ำบ้านเดียวกัน=ห้ามเบิก, หมู่เดียวกันคนละบ้าน=50% */
  function evaluateFreeSummonItems(items) {
    const norm = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
    const exact = new Map(); const mooMap = new Map();
    items.forEach((it, idx) => {
      const d = norm(cleanDistrict(it.district)); const s = norm(cleanSubdistrict(it.subdistrict));
      const moo = norm(it.moo); const house = norm(it.house_no);
      if (!d || !s) return;
      if (house) { const k = `${d}|${s}|${moo}|${house}`; exact.set(k, (exact.get(k) || []).concat(idx)); }
      if (moo && moo !== '-') { const k = `${d}|${s}|${moo}`; mooMap.set(k, (mooMap.get(k) || []).concat({ idx, house })); }
    });
    const dup = new Set(); exact.forEach((l) => { if (l.length > 1) l.forEach((i) => dup.add(i)); });
    const half = new Set();
    mooMap.forEach((l) => { if (l.length > 1 && new Set(l.map((x) => x.house)).size > 1) l.forEach((x) => half.add(x.idx)); });
    let total = 0;
    const out = items.map((it, idx) => {
      const base = Math.round((Number(it.base_rate) || 0) * 100) / 100;
      let rule = 'full'; let claim = base;
      if (dup.has(idx)) { rule = 'duplicate'; claim = 0; } else if (half.has(idx)) { rule = 'half'; claim = Math.round(base / 2 * 100) / 100; }
      total += claim;
      return Object.assign({}, it, { base_rate: base, claim_rate: claim, calc_rule: rule });
    });
    return { items: out, has_duplicates: dup.size > 0, duplicate_indices: Array.from(dup), total_amount: Math.round(total * 100) / 100 };
  }

  /** อ่านตารางอัตราจาก Excel (แบบ 4 บล็อก "อำเภอ.. | ตำบล | ค่าหมาย" หรือแบบตารางธรรมดา) */
  function parseRateRows(rows) {
    const str = rows.map((r) => (r || []).map((c) => thNorm(String(c == null ? '' : c))));
    const isFour = str.slice(0, 8).some((r) => [2, 5, 8, 11].filter((c) => (r[c] || '').includes('ค่าหมาย')).length >= 2);
    const num = (v) => parseMoney(v);
    const headers = []; const notes = [];
    if (isFour) {
      let inNotes = false; let seen = false;
      const cur = ['', '', '', '']; const last = ['', '', '', '']; const blocks = [[], [], [], []];
      for (const row of str) {
        const joined = row.map((c) => c.trim()).filter(Boolean).join(' ');
        if (!joined) continue;
        if (!seen && !joined.includes('ค่าหมาย') && !joined.includes('อำเภอ')) { headers.push((row[0] || joined).trim()); continue; }
        seen = true;
        if (joined.includes('หมายเหตุ') || inNotes) { inNotes = true; notes.push(joined.replace(/\s+/g, ' ')); continue; }
        for (let b = 0; b < 4; b++) {
          const c0 = (row[b * 3] || '').trim(); const c1 = (row[b * 3 + 1] || '').trim(); const c2 = (row[b * 3 + 2] || '').trim();
          if (!c0 && !c1 && !c2) continue;
          if (c0.startsWith('อำเภอ') || c2.includes('ค่าหมาย')) { const d = cleanDistrict(c0); if (d) { cur[b] = d; last[b] = ''; } continue; }
          const rate = num(c2);
          if (rate === null || !cur[b]) continue;
          if (!c0 && c1 && last[b]) blocks[b].push({ district: cur[b], subdistrict: last[b], exception_note: c1, rate_amount: rate });
          else if (c1) { const s = cleanSubdistrict(c1); last[b] = s; blocks[b].push({ district: cur[b], subdistrict: s, exception_note: '', rate_amount: rate }); }
        }
      }
      const seenKey = new Set(); const items = []; let sort = 1;
      blocks.forEach((l) => l.forEach((it) => {
        const k = `${it.district}|${it.subdistrict}|${it.exception_note}|${it.rate_amount}`;
        if (seenKey.has(k)) return; seenKey.add(k); items.push(Object.assign({ sort_order: sort++ }, it));
      }));
      return { items, headers, notes };
    }
    let cd = 0, cs = 1, cn = -1, cr = 2, found = false; const items = []; let sort = 1;
    for (const row of str) {
      const cells = row.map((c) => c.trim());
      if (!cells.some(Boolean)) continue;
      if (!found) {
        cells.forEach((c, i) => {
          if (c.includes('อำเภอ')) { cd = i; found = true; } else if (c.includes('ตำบล')) cs = i;
          else if (c.includes('หมายเหตุ') || c.includes('ยกเว้น')) cn = i;
          else if (c.includes('ค่าหมาย') || c.includes('อัตรา') || c.includes('ราคา')) cr = i;
        });
        if (found) continue;
      }
      const d = cleanDistrict(cells[cd]); const s = cleanSubdistrict(cells[cs]); const rate = num(cells[cr]);
      if (d && s && rate !== null) items.push({ district: d, subdistrict: s, exception_note: cn >= 0 ? cells[cn] || '' : '', rate_amount: rate, sort_order: sort++ });
    }
    return { items, headers, notes };
  }
  /** workbook sheets [{name, rows}] → {paid:[], free:[], meta:{}} */
  function parseRatesWorkbook(sheets, forceType) {
    const out = { paid: [], free: [], meta: {} };
    sheets.forEach((sh, idx) => {
      const title = String(sh.name || '').trim();
      const type = forceType || (/ฟรี|หมายศาล/.test(title) ? 'free' : /เงิน/.test(title) ? 'paid' : (idx === 0 ? 'paid' : 'free'));
      const p = parseRateRows(sh.rows || []);
      out[type].push(...p.items);
      if (p.headers.length) {
        if (type === 'paid') out.meta.paid_header = p.headers[0] || '';
        else { out.meta.free_header_1 = p.headers[0] || ''; out.meta.free_header_2 = p.headers[1] || ''; out.meta.free_header_3 = p.headers[2] || ''; }
      }
      if (p.notes.length) out.meta[type + '_notes'] = p.notes.join('\n');
    });
    return out;
  }


  /** อ่านอัตราจากข้อความ PDF (พอร์ตจาก summon-report parsePdfBuffer) */
  function parseRatePdfLines(lines) {
    const items = []; let cur = ''; let last = ''; let sort = 1;
    const n = (v) => Number(String(v).replace(/,/g, ''));
    for (const raw of lines) {
      const line = toArabicDigits(String(raw || '')).trim().replace(/\s+/g, ' ');
      if (!line) continue;
      const tab = line.match(/^(?:\d+\s+)?(?:อำเภอ|อ\.)\s*([^\s]+)\s+(?:ตำบล|ต\.)\s*([^\s]+)(?:\s+\(([^)]+)\))?\s+([\d,]+(?:\.\d+)?)\s*(?:บาท)?$/);
      if (tab) { items.push({ district: cleanDistrict(tab[1]), subdistrict: cleanSubdistrict(tab[2]), exception_note: (tab[3] || '').trim(), rate_amount: n(tab[4]), sort_order: sort++ }); continue; }
      const dm = line.match(/อำเภอ([^\s\d]+)/);
      if (dm && !line.includes('ตำบล')) { cur = cleanDistrict(dm[1]); last = ''; continue; }
      const subs = [...line.matchAll(/(?:(\d+)\s+)?ตำบล([^\s\d]+)\s+([\d,]+(?:\.\d+)?)/g)];
      if (subs.length && cur) { subs.forEach((m) => { last = cleanSubdistrict(m[2]); items.push({ district: cur, subdistrict: last, exception_note: '', rate_amount: n(m[3]), sort_order: sort++ }); }); continue; }
      const ex = line.match(/(ยกเว้น[^\d]*\d*)\s+([\d,]+(?:\.\d+)?)/);
      if (cur && last && ex) items.push({ district: cur, subdistrict: last, exception_note: ex[1].trim(), rate_amount: n(ex[2]), sort_order: sort++ });
    }
    return items;
  }

  // ---------------------------------------------------------------
  // แบบรายงาน Word
  // ---------------------------------------------------------------
  /** เลือกแม่แบบ: หมาย ต./หมายศาล × ปิดประกาศ/ปกติ */
  function templateFor(kind, resultCode) {
    const notice = isNoticeResult(resultCode);
    if (kind === 'T') return notice ? 't_notice' : 't_normal';
    return notice ? 'local_notice' : 'local_normal';
  }
  const TEMPLATE_LABELS = {
    local_normal: 'หมายศาล — แบบปกติ', local_notice: 'หมายศาล — แบบปิดประกาศ',
    t_normal: 'หมายต่างจังหวัด (ต.) — แบบปกติ', t_notice: 'หมายต่างจังหวัด (ต.) — แบบปิดประกาศ',
  };

  /**
   * คำนวณเงินของรายงาน 1 หมาย
   *  - หมายเงิน: ราคาตามบัญชีจ่ายหมาย, ตัดจ่ายจากใบเสร็จ (หมายศาล) / ศาลผู้วางเงิน (หมาย ต.)
   *  - หมายฟรี + เบิก: อัตราหมายฟรีตามตำบล, "เงินงบประมาณ"
   *  - หมายฟรี + ไม่เบิก: เว้นว่างทั้งจำนวนเงิน/ตัวหนังสือ/แหล่งเงิน
   */
  function computeMoney(r) {
    const paid = r.money_type === 'paid';
    if (paid) {
      const amt = Number(r.amount) || 0;
      return { amount: amt, show: amt > 0, source1: r.receipt_ref || '', source2: r.kind === 'T' ? (r.payer_court || r.origin_court || '') : (r.receipt_ref || ''), receipt_ref: r.receipt_ref || '' };
    }
    if (r.claim) {
      const amt = Number(r.claim_amount) || 0;
      return { amount: amt, show: true, source1: 'เงินงบประมาณ', source2: 'เงินงบประมาณ', receipt_ref: '' };
    }
    return { amount: 0, show: false, source1: '', source2: '', receipt_ref: '' };
  }

  /** จัดรูปจำนวนเงินในเอกสาร "๘๕๐.๐๐" */
  const docMoney = (n, arabic) => { const s = money2(n); return arabic ? s : toThaiDigits(s); };

  const CB = { w2: { on: '52', off: 'a3' }, w1: { on: 'f0fe', off: 'f06f' } };

  /**
   * เตรียมค่าทั้งหมดสำหรับ {{placeholder}} ในแม่แบบ
   * @param r  ข้อมูลรายงาน (รวมข้อมูลหมายจาก Excel + ค่าที่กรอกในฟอร์ม)
   * @param opt {arabic:boolean} ใช้เลขอารบิกแทนเลขไทย
   */
  function buildDocData(r, opt) {
    opt = opt || {};
    const A = !!opt.arabic;
    const T = (s) => (A ? toArabicDigits(String(s == null ? '' : s)) : toThaiDigits(String(s == null ? '' : s)));
    const doc = thaiDateParts(r.record_date || todayIso(), { arabic: A });
    const rc = thaiDateParts(r.receipt_date, { arabic: A });
    const money = computeMoney(r);
    const fileType = r.file_type || 'file';
    const posting = String(r.posting_choice || '2');
    const result = (r.result_text || resultText(r.result_code) || '') + (r.result_extra ? ' ' + r.result_extra : '');
    const acting = r.inspector_acting !== false && r.inspector_acting !== 'false' && r.inspector_acting !== 0;
    const blackNo = r.black_no || '';
    const data = {
      t_no: T(r.t_no || ''),
      origin_court: r.origin_court || r.payer_court || '',
      black_no: T(blackNo), red_no: T(r.red_no || ''),
      black_no2: T(blackNo), red_no2: T(r.red_no || ''),
      doc_d: doc.d, doc_m: doc.m, doc_y: doc.y,
      case_kind: r.case_kind || caseKindOf(blackNo),
      plaintiff: r.plaintiff || '', petitioner: r.petitioner || '', defendant: r.defendant || '',
      reporter_name: r.reporter_name || '', reporter_position: r.reporter_position || '',
      issue_date: thaiDateLong(r.issue_date, { arabic: A }),
      summon_type: r.summon_type || '',
      recipient: r.recipient || '',
      house_no: T(r.house_no || ''), moo: T(r.moo || ''), soi: T(r.soi || ''), road: T(r.road || ''),
      subdistrict: cleanSubdistrict(r.subdistrict), district: cleanDistrict(r.district), province: r.province || 'อุดรธานี',
      postcode: T(r.postcode || postcodeFor(r.district) || ''),
      send_method: r.send_method || 'ส่งโดยเจ้าพนักงาน',
      result,
      serve_date: thaiDateLong(r.serve_date, { arabic: A }),
      server_name: r.server_name || r.reporter_name || '',
      amount: money.show ? docMoney(money.amount, A) : '',
      amount_text: money.show ? bahtText(money.amount) : '',
      pay_source: money.show ? T(money.source1) : '',
      pay_source2: money.show ? T(money.source2) : '',
      receipt_ref: T(money.receipt_ref),
      rcpt_d: rc.d, rcpt_m: rc.m, rcpt_y: rc.y,
      payer_name: r.payer_name || '', payer_position: r.payer_position || '',
      resend_to: fileType === 'sendto' ? (r.resend_to || '') : '',
      court_note: fileType === 'court' ? (r.court_note || '') : '',
      inspector_name: r.inspector_name || '', inspector_position: r.inspector_position || '',
      inspector_acting: acting ? ' ปฏิบัติราชการแทน' : '',
      inspector_title: acting ? (r.inspector_title || 'ผู้อำนวยการสำนักอำนวยการประจำศาลจังหวัดอุดรธานี') : '',
      absent_name: posting === '3' ? (r.absent_name || r.recipient || '') : '................',
      other_text: posting === '5' ? (r.other_text || '') : '',
      notice_place: r.notice_place || r.recipient || '',
      notice_time: r.notice_time || 'เวลากลางวัน',
      letter_no: T(r.letter_no || ''), letter_date: r.letter_date ? T(thaiDateText(r.letter_date)) : '',
      ref_no: T(r.ref_no || ''),
    };
    FILE_TYPES.forEach(([k]) => { data['cb_' + k] = fileType === k ? CB.w2.on : CB.w2.off; });
    for (let i = 1; i <= 5; i++) data['cb2_' + i] = posting === String(i) ? CB.w1.on : CB.w1.off;
    return data;
  }

  /** ชื่อไฟล์ Word ที่ดาวน์โหลด */
  function docFileName(r) {
    const no = (r.kind === 'T' ? r.t_no : r.black_no) || 'หมาย';
    const who = String(r.recipient || '').replace(/\s+/g, ' ').split(' ').slice(0, 2).join('_');
    return `รายงานผลหมาย_${no}_${who}`.replace(/[\\/:*?"<>|]+/g, '-') + '.docx';
  }

  const api = {
    thNorm, THAI_MONTHS, THAI_MONTHS_SHORT, RESULT_CODES, FILE_TYPES, POSTING_CHOICES, SEND_METHODS, UDON_POSTCODES, TEMPLATE_LABELS,
    toThaiDigits, toArabicDigits, ymd, toIso, todayIso, parseThaiTextDate, thaiDateLong, thaiDateParts, thaiDateText, thaiDateShort,
    bahtText, money2, moneyShort, parseMoney, resultText, resultCodeOf, isNoticeResult, cleanDistrict, cleanSubdistrict,
    districtKey, subKey, postcodeFor, caseKindOf, parseAddress, isTNo, receiptText,
    parseIssuedSheet, parseAccExpenseSheet, parseCourtExcel, matchReceipts, normName, normCase, caseNos, caseKey,
    findRate, exceptionMoos, evaluateFreeSummonItems, parseRateRows, parseRatesWorkbook, parseRatePdfLines,
    templateFor, computeMoney, buildDocData, docFileName,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SltsReportLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
