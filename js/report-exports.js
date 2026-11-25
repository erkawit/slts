/**
 * report-exports.js — ส่งออกเอกสารของระบบรายงานผลหมาย (พอร์ตจาก summon-report)
 *   - ใบสำคัญรับเงินหมายฟรี / บัญชีขอเบิกจ่ายค่านำส่งคำคู่ความ (.xlsx + หน้าพิมพ์ PDF)
 *   - อัตราค่านำหมาย หมายเงิน/หมายฟรี (.xlsx + หน้าพิมพ์ PDF)
 *   - บันทึกข้อความขออนุมัติเบิก (Word จากแม่แบบเดิม + หน้าพิมพ์ PDF)
 *   - บัญชีรายการหมาย (.xlsx)
 * หน้าพิมพ์ PDF ใช้ฟอนต์ TH SarabunPSK / TH SarabunIT๙ จากโฟลเดอร์ fonts/ แล้วสั่ง "บันทึกเป็น PDF" จากหน้าต่างพิมพ์
 */
(function (root) {
  'use strict';
  const L = root.SltsReportLogic || (typeof require === 'function' ? require('./report-logic.js') : null);
  const X = root.SltsXlsx || (typeof require === 'function' ? require('./report-xlsx.js') : null);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // -------------------------------------------------------------
  // ใบสำคัญรับเงินหมายฟรี (บัญชีขอเบิกจ่ายค่านำส่งคำคู่ความ)
  // -------------------------------------------------------------
  function receiptWorkbook(memo, items) {
    const wb = X.workbook();
    const ws = wb.sheet('ใบรับเงินหมายฟรี', {
      landscape: true,
      widths: [4.5, 4.2, 5.5, 11.5, 9.5, 9.5, 15, 9.5, 4.8, 5, 3.8, 4, 3.5, 11, 3.5, 13, 9.5, 9.8, 9.8],
    });
    const base = { size: 15 }; const bold = { size: 15, bold: true };
    ws.cell('B1', 'ศาลจังหวัดอุดรธานี', Object.assign({ align: 'center' }, bold)).merge('B1:S1');
    ws.cell('B2', 'บัญชีขอเบิกจ่ายค่านำส่งคำคู่ความ', Object.assign({ align: 'center' }, bold)).merge('B2:S2');
    const rec = L.thaiDateText(memo.receipt_date);
    ws.cell('J4', rec ? `                    วันที่  ${rec}` : '                    วันที่.........เดือน...........................พ.ศ..................', base).merge('J4:S4');
    const repName = (memo.reporter_name || '').trim();
    const repAddr = (memo.reporter_address || '2 ถ.อธิบดี ตำบลหมากแข้ง อำเภอเมือง จังหวัดอุดรธานี').trim();
    const payer = (memo.payer_name || '').trim(); const payerPos = (memo.payer_position || '').trim();
    ws.cell('B6', `นามผู้รับเงิน............................${repName}.................................................................................`, base).merge('B6:S6');
    ws.cell('B7', `ที่อยู่ ..${repAddr}............................................`, base).merge('B7:S7');
    ws.cell('B8', 'ได้รับเงินจาก  สำนักอำนวยการประจำศาลจังหวัดอุดรธานี  ดังรายการต่อไปนี้', base).merge('B8:S8');
    const hd = { size: 14, bold: true, align: 'center', border: true, wrap: true };
    ws.styleRange('B10:S11', hd);
    ws.cell('B10', 'รายละเอียดการเบิกจ่ายเงิน ค่าตอบแทนในการส่งคำคู่ความหรือเอกสาร', hd).merge('B10:Q10');
    ws.cell('R10', 'จำนวนเงิน', hd).merge('R10:S10');
    [['B11', 'ลำดับ'], ['C11', 'หมายเลขคดี'], ['E11', 'วันที่จ่ายหมาย'], ['F11', 'วันที่ส่งหมาย'], ['G11', 'หมายอะไร'], ['H11', 'ส่งหมายให้ใคร'],
      ['I11', 'ที่อยู่'], ['R11', 'ราคาหมาย'], ['S11', 'ราคาเบิก']].forEach(([r, v]) => ws.cell(r, v, hd));
    ws.merge('C11:D11').merge('I11:Q11'); ws.height(10, 22).height(11, 24);
    let row = 12; let sumBase = 0; let sumClaim = 0;
    const cellS = (al, fmt) => ({ size: 15, border: true, shrink: true, align: al, fmt });
    (items || []).forEach((it, i) => {
      const b = Number(it.base_rate) || 0; const c = Number(it.claim_rate) || 0; sumBase += b; sumClaim += c;
      ws.height(row, 21);
      ws.at(row, 1, i + 1, cellS('center'));
      ws.at(row, 2, (it.case_prefix || 'คดีดำ').trim(), cellS('left'));
      ws.at(row, 3, (it.case_no || '').trim(), cellS('left'));
      ws.at(row, 4, L.thaiDateShort(it.issue_date), cellS('center'));
      ws.at(row, 5, L.thaiDateShort(it.serve_date), cellS('center'));
      ws.at(row, 6, (it.summon_type || '').trim(), cellS('left'));
      ws.at(row, 7, (it.recipient_role || '').trim(), cellS('left'));
      ws.at(row, 8, 'เลขที่', cellS('left')); ws.at(row, 9, (it.house_no || '').trim(), cellS('left'));
      ws.at(row, 10, 'หมู่', cellS('left')); ws.at(row, 11, (it.moo || '').trim(), cellS('center'));
      ws.at(row, 12, 'ต.', cellS('left')); ws.at(row, 13, L.cleanSubdistrict(it.subdistrict), cellS('left'));
      ws.at(row, 14, 'อ.', cellS('left')); ws.at(row, 15, L.cleanDistrict(it.district), cellS('left'));
      ws.at(row, 16, (it.province || 'จ.อุดรธานี').trim(), cellS('left'));
      ws.at(row, 17, b, cellS('right', '#,##0.00')); ws.at(row, 18, c, cellS('right', '#,##0.00'));
      row++;
    });
    if (!items || !items.length) { ws.styleRange(`B${row}:S${row}`, { border: true }); row++; }
    const last = row - 1;
    ws.styleRange(`B${row}:S${row}`, { size: 15, bold: true, border: true });
    ws.cell(`B${row}`, `จำนวนเงิน (ตัวอักษร) ……${L.bahtText(sumClaim)}.....`, { size: 15, bold: true, border: true }).merge(`B${row}:Q${row}`);
    ws.cell(`R${row}`, items && items.length ? { formula: `SUM(R12:R${last})` } : 0, { size: 15, bold: true, border: true, align: 'right', fmt: '#,##0.00' });
    ws.cell(`S${row}`, items && items.length ? { formula: `SUM(S12:S${last})` } : 0, { size: 15, bold: true, border: true, align: 'right', fmt: '#,##0.00' });
    ws.height(row, 23);
    const sig = row + 2;
    ws.cell(`B${sig}`, '(ลงชื่อ)....................................................... ผู้จ่ายเงิน                                                                                           (ลงชื่อ)....................................................... ผู้รับเงิน', Object.assign({ align: 'center' }, base)).merge(`B${sig}:S${sig}`);
    ws.cell(`B${sig + 1}`, `                ( ${payer} )                                                                                                                                    ( ${repName} )`, Object.assign({ align: 'center' }, base)).merge(`B${sig + 1}:S${sig + 1}`);
    ws.cell(`B${sig + 2}`, payerPos, Object.assign({ align: 'center' }, base)).merge(`B${sig + 2}:I${sig + 2}`);
    ws.cell(`N${sig + 2}`, (memo.reporter_position || '').trim(), Object.assign({ align: 'center' }, base)).merge(`N${sig + 2}:S${sig + 2}`);
    return { wb, sumBase, sumClaim };
  }

  // -------------------------------------------------------------
  // อัตราค่านำหมาย (Excel)
  // -------------------------------------------------------------
  function ratesWorkbook(rates, settings, scope) {
    const wb = X.workbook();
    const types = scope === 'paid' ? ['paid'] : scope === 'free' ? ['free'] : ['paid', 'free'];
    types.forEach((type) => {
      const ws = wb.sheet(type === 'paid' ? 'อัตราหมายเงิน' : 'อัตราหมายฟรี', { widths: [8, 26, 30, 26, 14] });
      const heads = type === 'paid' ? [settings.paid_header] : [settings.free_header_1, settings.free_header_2, settings.free_header_3];
      let r = 1;
      heads.filter(Boolean).forEach((h) => { ws.cell(`A${r}`, h, { size: 16, bold: true, align: 'center', wrap: true }).merge(`A${r}:E${r}`).height(r, 26); r++; });
      r++;
      const hd = { size: 15, bold: true, border: true, align: 'center', fill: 'E8EDF5' };
      ['ลำดับ', 'อำเภอ', 'ตำบล', 'หมายเหตุ/ข้อยกเว้น', 'ค่าหมาย (บาท)'].forEach((h, i) => ws.at(r, i, h, hd));
      r++;
      const list = rates.filter((x) => x.rate_type === type);
      let lastD = ''; let n = 0;
      list.forEach((x) => {
        const d = L.cleanDistrict(x.district);
        if (d !== lastD) { ws.cell(`A${r}`, 'อำเภอ' + d, { size: 15, bold: true, border: true, fill: 'F6F7F9' }).merge(`A${r}:E${r}`).styleRange(`B${r}:E${r}`, { border: true, fill: 'F6F7F9' }); r++; lastD = d; n = 0; }
        n++;
        ws.at(r, 0, n, { size: 15, border: true, align: 'center' });
        ws.at(r, 1, d, { size: 15, border: true });
        ws.at(r, 2, 'ตำบล' + L.cleanSubdistrict(x.subdistrict), { size: 15, border: true });
        ws.at(r, 3, x.exception_note || '', { size: 15, border: true });
        ws.at(r, 4, Number(x.rate_amount) || 0, { size: 15, border: true, align: 'right', fmt: '#,##0.00' });
        r++;
      });
      const notes = type === 'paid' ? settings.paid_notes : settings.free_notes;
      if (notes) { r++; String(notes).split('\n').forEach((line) => { ws.cell(`A${r}`, line, { size: 14, wrap: true }).merge(`A${r}:E${r}`); r++; }); }
    });
    return wb;
  }

  /** บัญชีรายการหมายที่นำเข้า (สำหรับตรวจทาน) */
  function issuedWorkbook(items) {
    const wb = X.workbook();
    const ws = wb.sheet('รายการจ่ายหมาย', { landscape: true, widths: [6, 14, 16, 22, 30, 34, 12, 12, 10, 12, 14] });
    const hd = { size: 14, bold: true, border: true, align: 'center', fill: 'E8EDF5', wrap: true };
    ['ที่', 'เลขหมาย ต.', 'คดีหมายเลขดำ', 'หมายอะไร', 'หมายถึงใคร', 'ที่อยู่', 'ประเภท', 'หมายเงิน/ฟรี', 'ราคา', 'สถานะรายงาน', 'ใบเสร็จ'].forEach((h, i) => ws.at(1, i, h, hd));
    items.forEach((it, i) => {
      const r = i + 2; const c = { size: 14, border: true };
      ws.at(r, 0, it.seq || i + 1, Object.assign({ align: 'center' }, c));
      ws.at(r, 1, it.t_no, c); ws.at(r, 2, it.black_no, c); ws.at(r, 3, it.summon_type, c); ws.at(r, 4, it.recipient, c);
      ws.at(r, 5, `${it.address_raw || ''} ต.${it.subdistrict} อ.${it.district}`, c);
      ws.at(r, 6, it.kind === 'T' ? 'หมาย ต.' : 'หมายศาล', c); ws.at(r, 7, it.money_type === 'paid' ? 'หมายเงิน' : 'หมายฟรี', c);
      ws.at(r, 8, Number(it.price) || 0, Object.assign({ align: 'right', fmt: '#,##0.00' }, c));
      ws.at(r, 9, it.report_status === 'printed' ? 'พิมพ์แล้ว' : it.report_status === 'saved' ? 'บันทึกแล้ว' : 'ยังไม่รายงาน', c);
      ws.at(r, 10, it.receipt_ref || '', c);
    });
    return wb;
  }

  // -------------------------------------------------------------
  // บันทึกข้อความ (Word) — เติมแม่แบบเดิมของ summon-report
  // -------------------------------------------------------------
  function memoVars(m) {
    const acting = String(m.director_acting || '').trim();
    const amount = Number(m.total_amount) || 0;
    return {
      doc_no: (m.doc_no || '').trim(),
      doc_date: L.thaiDateText(m.doc_date),
      order_text: (m.order_text || '').trim(),
      period_start: L.thaiDateText(m.period_start),
      period_end: L.thaiDateText(m.period_end),
      item_count: String(Number(m.item_count) || 0),
      amount: L.moneyShort(amount),
      amount_text: (m.amount_text || '').trim() || L.bahtText(amount),
      reporter_name: (m.reporter_name || '').trim(), reporter_position: (m.reporter_position || '').trim(),
      officer_name: (m.officer_name || '').trim(), officer_position: (m.officer_position || '').trim(),
      director_name: (m.director_name || '').trim(), director_acting: acting ? 'รักษาราชการแทน ' : '',
    };
  }

  // -------------------------------------------------------------
  // หน้าพิมพ์ (PDF) — เปิดหน้าต่างใหม่แล้วสั่งพิมพ์/บันทึกเป็น PDF
  // -------------------------------------------------------------
  function fontCss(base) {
    const f = (fam, file, w) => `@font-face{font-family:'${fam}';src:url('${base}fonts/${file}') format('truetype');font-weight:${w};}`;
    return f('TH SarabunPSK', 'THSarabun.ttf', 400) + f('TH SarabunPSK', 'THSarabun-Bold.ttf', 700) +
      f('TH SarabunIT9', 'THSarabunIT9.ttf', 400) + f('TH SarabunIT9', 'THSarabunIT9-Bold.ttf', 700);
  }
  function printHtml(title, body, opt) {
    opt = opt || {};
    const base = opt.base || '';
    return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
${fontCss(base)}
@page{size:A4 ${opt.landscape ? 'landscape' : 'portrait'};margin:${opt.margin || '14mm 14mm 14mm 18mm'}}
*{box-sizing:border-box}body{margin:0;font-family:'TH SarabunPSK','Sarabun',sans-serif;font-size:16pt;color:#000;line-height:1.25}
.it9{font-family:'TH SarabunIT9','TH SarabunPSK',sans-serif}
h1,h2,h3{margin:0;font-weight:700}.c{text-align:center}.r{text-align:right}.b{font-weight:700}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #000;padding:1px 4px;vertical-align:middle}
th{background:#f4f6fa;font-weight:700}.nob td{border:none}
.dot{border-bottom:1px dotted #000;display:inline-block;min-width:60px;padding:0 4px}
.grp td{background:#f6f7f9;font-weight:700}.small{font-size:14pt}
.toolbar{position:fixed;top:8px;right:8px;font-family:sans-serif;font-size:13px}
.toolbar button{padding:6px 14px;border:1px solid #1e3a5f;background:#1e3a5f;color:#fff;border-radius:6px;cursor:pointer}
@media print{.toolbar{display:none}}
</style></head><body><div class="toolbar"><button onclick="window.print()">พิมพ์ / บันทึกเป็น PDF</button></div>${body}
<script>document.fonts&&document.fonts.ready.then(function(){setTimeout(function(){window.print()},300)})</script></body></html>`;
  }

  function receiptPrintHtml(memo, items, base) {
    let sumB = 0; let sumC = 0;
    const rows = (items || []).map((it, i) => {
      const b = Number(it.base_rate) || 0; const c = Number(it.claim_rate) || 0; sumB += b; sumC += c;
      return `<tr><td class="c">${i + 1}</td><td>${esc((it.case_prefix || 'คดีดำ') + ' ' + (it.case_no || ''))}</td><td class="c">${esc(L.thaiDateShort(it.issue_date))}</td><td class="c">${esc(L.thaiDateShort(it.serve_date))}</td><td>${esc(it.summon_type)}</td><td>${esc(it.recipient_role)}</td><td>เลขที่ ${esc(it.house_no || '-')} หมู่ ${esc(it.moo || '-')} ต.${esc(L.cleanSubdistrict(it.subdistrict))} อ.${esc(L.cleanDistrict(it.district))} ${esc(it.province || 'จ.อุดรธานี')}</td><td class="r">${L.money2(b)}</td><td class="r">${L.money2(c)}</td></tr>`;
    }).join('');
    const rec = L.thaiDateText(memo.receipt_date);
    const body = `<h2 class="c">ศาลจังหวัดอุดรธานี</h2><h2 class="c">บัญชีขอเบิกจ่ายค่านำส่งคำคู่ความ</h2>
<p class="r" style="margin:4px 30px 6px 0">${rec ? 'วันที่ ' + esc(rec) : 'วันที่.........เดือน...........................พ.ศ..................'}</p>
<p style="margin:0">นามผู้รับเงิน&nbsp;&nbsp; ${esc(memo.reporter_name)}</p><p style="margin:0">ที่อยู่&nbsp;&nbsp; ${esc(memo.reporter_address || '2 ถ.อธิบดี ตำบลหมากแข้ง อำเภอเมือง จังหวัดอุดรธานี')}</p>
<p style="margin:0 0 6px">ได้รับเงินจาก&nbsp;&nbsp; สำนักอำนวยการประจำศาลจังหวัดอุดรธานี&nbsp;&nbsp; ดังรายการต่อไปนี้</p>
<table class="small"><thead><tr><th colspan="7">รายละเอียดการเบิกจ่ายเงิน ค่าตอบแทนในการส่งคำคู่ความหรือเอกสาร</th><th colspan="2">จำนวนเงิน</th></tr>
<tr><th>ลำดับ</th><th>หมายเลขคดี</th><th>วันที่จ่ายหมาย</th><th>วันที่ส่งหมาย</th><th>หมายอะไร</th><th>ส่งหมายให้ใคร</th><th>ที่อยู่</th><th>ราคาหมาย</th><th>ราคาเบิก</th></tr></thead>
<tbody>${rows}<tr class="b"><td colspan="7">จำนวนเงิน (ตัวอักษร) ……${esc(L.bahtText(sumC))}.....</td><td class="r">${L.money2(sumB)}</td><td class="r">${L.money2(sumC)}</td></tr></tbody></table>
<table class="nob" style="margin-top:28px"><tr><td class="c">(ลงชื่อ).......................................................ผู้จ่ายเงิน<br>( ${esc(memo.payer_name)} )<br>${esc(memo.payer_position)}</td>
<td class="c">(ลงชื่อ).......................................................ผู้รับเงิน<br>( ${esc(memo.reporter_name)} )<br>${esc(memo.reporter_position)}</td></tr></table>`;
    return printHtml('ใบสำคัญรับเงินหมายฟรี', body, { landscape: true, base, margin: '10mm' });
  }

  function ratesPrintHtml(rates, settings, scope, base) {
    const types = scope === 'paid' ? ['paid'] : scope === 'free' ? ['free'] : ['paid', 'free'];
    const body = types.map((type, ti) => {
      const heads = type === 'paid' ? [settings.paid_header] : [settings.free_header_1, settings.free_header_2, settings.free_header_3];
      const list = rates.filter((x) => x.rate_type === type);
      let lastD = ''; let n = 0;
      const rows = list.map((x) => {
        const d = L.cleanDistrict(x.district); let pre = '';
        if (d !== lastD) { pre = `<tr class="grp"><td colspan="4">อำเภอ${esc(d)}</td></tr>`; lastD = d; n = 0; }
        n++;
        return `${pre}<tr><td class="c">${n}</td><td>ตำบล${esc(L.cleanSubdistrict(x.subdistrict))}</td><td>${esc(x.exception_note || '')}</td><td class="r">${L.money2(x.rate_amount)}</td></tr>`;
      }).join('');
      const notes = (type === 'paid' ? settings.paid_notes : settings.free_notes) || '';
      return `<section style="${ti ? 'page-break-before:always' : ''}">${heads.filter(Boolean).map((h) => `<h3 class="c">${esc(h)}</h3>`).join('')}
<table style="margin-top:8px"><thead><tr><th style="width:12%">ลำดับ</th><th>ตำบล</th><th>หมายเหตุ</th><th style="width:20%">ค่าหมาย (บาท)</th></tr></thead><tbody>${rows}</tbody></table>
<p class="small" style="white-space:pre-line">${esc(notes)}</p></section>`;
    }).join('');
    return printHtml('อัตราค่านำหมาย', body, { base });
  }

  function memoPrintHtml(m, base) {
    const v = memoVars(m); const isPaid = m.report_type === 'paid';
    const subject = isPaid ? 'รายงานผลการส่งคำคู่ความและขออนุมัติเบิกจ่ายค่าส่งคำคู่ความ' : 'รายงานผลการส่งคำคู่ความและขออนุมัติเบิกจ่ายค่าส่งคำคู่ความตามระเบียบ';
    const p2 = isPaid
      ? `บัดนี้ ข้าพเจ้าได้ส่งคำคู่ความสำหรับรอบระหว่างวันที่ ${esc(v.period_start)} ถึงวันที่ ${esc(v.period_end)} จำนวน ${esc(v.item_count)} เรื่อง ทั้งนี้ จะดำเนินการสแกนรายงานผลการส่งคำคู่ความเข้าสู่ระบบเทคโนโลยีสารสนเทศตามระเบียบของสำนักงานศาลยุติธรรม ได้แก่ ระบบรายงานผลการส่งหมาย (Summons) การส่งหมายในระบบคดีที่มีการยื่นฟ้องอิเล็กทรอนิกส์ (e-filling) ระบบการจัดทำสารบบและสำนวนความอิเล็กทรอนิกส์ (E-CMS) ภายใน 3 วันทำการ นับถัดจากวันเบิกจ่ายค่าส่งคำคู่ความแล้วเสร็จ`
      : `บัดนี้ ข้าพเจ้า ได้ส่งคำคู่ความตามคำสั่งศาล จำนวน ${esc(v.item_count)} เรื่อง ทั้งนี้จะดำเนินการสแกนรายงานผลการส่งคำคู่ความเข้าสู่ระบบเทคโนโลยีสารสนเทศตามระเบียบของสำนักงานศาลยุติธรรม ได้แก่ ระบบรายงานผลการส่งหมาย (Summons) การส่งหมายในระบบคดีที่มีการยื่นฟ้องอิเล็กทรอนิกส์ (e-filling), ระบบการจัดทำสารบบและสำนวนความอิเล็กทรอนิกส์ (E-CMS) ภายใน 3 วันทำการ นับถัดจากวันเบิกจ่ายค่าส่งคำคู่ความแล้วเสร็จ`;
    const p3 = isPaid
      ? `ข้าพเจ้าจึงขออนุมัติเบิกจ่ายค่าส่งคำคู่ความที่คู่ความได้วางเงิน จำนวน ${esc(v.amount)} บาท (${esc(v.amount_text)}) รายละเอียดปรากฏตามเอกสารที่แนบมาพร้อมนี้ ข้าพเจ้า ขอรับรองว่าได้เบิกจ่ายค่าคำคู่ความถูกต้องตามระเบียบและประกาศของศาลจังหวัดอุดรธานีแล้ว`
      : `ข้าพเจ้าจึงขออนุมัติเบิกจ่ายค่าส่งคำคู่ความตามระเบียบคณะกรรมการบริหารศาลยุติธรรมว่าด้วยค่าตอบแทนในการส่งคำคู่ความหรือเอกสารโดยเจ้าพนักงานศาล พ.ศ.2562 จำนวน ${esc(v.amount)} บาท (${esc(v.amount_text)}) ข้าพเจ้าขอรับรองว่าได้เบิกจ่ายค่าคำคู่ความถูกต้องตามระเบียบและประกาศของศาลจังหวัดอุดรธานีแล้ว และผลหมายดังกล่าวยังไม่เคยมีการเบิก ค่าส่งคำคู่ความ รายละเอียดปรากฏตามเอกสารที่แนบมาพร้อมนี้`;
    const dirTitle = String(m.director_acting || '').trim() ? 'รักษาราชการแทน ผู้อำนวยการสำนักอำนวยการประจำศาลจังหวัดอุดรธานี' : 'ผู้อำนวยการสำนักอำนวยการประจำศาลจังหวัดอุดรธานี';
    const body = `<div class="it9" style="font-size:16.5pt">
<div style="display:flex;align-items:center;gap:0;margin-bottom:8px"><img src="${base}img/garuda.png" style="width:52px;height:54px" alt=""><h1 style="flex:1;text-align:center;font-size:29pt;font-family:'TH SarabunPSK'">บันทึกข้อความ</h1><span style="width:52px"></span></div>
<p style="margin:0"><b style="font-family:'TH SarabunPSK';font-size:17pt">ส่วนราชการ</b>&nbsp;&nbsp;&nbsp;&nbsp; ศาลจังหวัดอุดรธานี</p>
<p style="margin:0;display:flex"><span style="flex:1"><b>ที่</b>&nbsp; ${esc(v.doc_no)}</span><span style="flex:1"><b>วันที่</b>&nbsp; ${esc(v.doc_date)}</span></p>
<p style="margin:0"><b>เรื่อง</b>&nbsp;&nbsp;&nbsp; ${esc(subject)}</p>
<p style="margin:10px 0 6px">เรียน&nbsp;&nbsp;&nbsp;&nbsp; ผู้อำนวยการสำนักอำนวยการประจำศาลจังหวัดอุดรธานี</p>
<p style="text-indent:2.5cm;margin:0 0 4px;text-align:justify">ตาม${esc(v.order_text)} ได้แต่งตั้งข้าพเจ้าเป็นเจ้าพนักงานศาลในการส่งคำคู่ความหรือเอกสารประจำศาลจังหวัดอุดรธานี นั้น</p>
<p style="text-indent:2.5cm;margin:0 0 4px;text-align:justify">${p2}</p>
<p style="text-indent:2.5cm;margin:0 0 4px;text-align:justify">${p3}</p>
<p style="text-indent:2.5cm;margin:0">จึงเรียนมาเพื่อโปรดพิจารณา</p>
<div style="margin:46px 0 0 45%;text-align:center">(${esc(v.reporter_name)})<br>${esc(v.reporter_position)}</div>
<table class="nob" style="margin-top:28px"><tr><td style="width:50%;vertical-align:top"><b>เรียน&nbsp; ผู้อำนวยการฯ</b><br>- เพื่อโปรดทราบและพิจารณา<br>- เห็นควรให้ส่วนคลังตรวจสอบและเบิกจ่ายต่อไป<br><br><br><div class="c">(${esc(v.officer_name)})<br>${esc(v.officer_position)}</div></td>
<td style="vertical-align:top"><b>- ทราบ&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; - เบิกจ่ายตามระเบียบ</b><br><br><br><br><br><div class="c">(${esc(v.director_name)})<br>${esc(dirTitle)}</div></td></tr></table></div>`;
    return printHtml('บันทึกข้อความ', body, { base, margin: '15mm 20mm 12mm 30mm' });
  }

  const api = { receiptWorkbook, ratesWorkbook, issuedWorkbook, memoVars, receiptPrintHtml, ratesPrintHtml, memoPrintHtml, printHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SltsReportExports = api;
})(typeof window !== 'undefined' ? window : globalThis);
