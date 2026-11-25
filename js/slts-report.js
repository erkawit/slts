/**
 * js/slts-report.js — หน้าจอ "รายงานผลหมาย" (ผนวกรวมระบบ summon-report เข้ากับ SLTS) สำหรับโหมด PC / แท็บเล็ตโหมด PC
 *
 *  แท็บ "รายงานผลหมาย"
 *    1) บัญชีจ่ายหมาย — นำเข้า Excel (บัญชีจ่ายหมาย + บัญชีใบเสร็จ) → รายการหมาย → ปุ่ม "รายงานหมาย" → แบบฟอร์ม → Word
 *    2) บันทึกข้อความ / ใบสำคัญรับเงิน — ขออนุมัติเบิก (หมายฟรี/หมายเงิน) Word/PDF + ใบสำคัญรับเงินหมายฟรี Excel/PDF
 *    3) อัตราค่านำหมาย — หมายเงิน/หมายฟรี แก้ไข นำเข้า Excel/PDF ส่งออก Excel/PDF
 *    4) ผู้ลงนามและตั้งค่า — ผู้ตรวจ, ผู้จ่ายเงิน, ผู้อำนวยการ, เจ้าหน้าที่เสนอ, คำสั่งศาล
 *  แท็บ "รายการส่งหมายรอบนี้" (เดิม) — เพิ่มรายการภาพที่อัปโหลดจากมือถือในรอบนี้ + ดาวน์โหลด + ปุ่ม "รายงานหมาย"
 */
(function () {
  'use strict';
  const L = window.SltsReportLogic; const DOCX = window.SltsReportDocx; const X = window.SltsXlsx; const E = window.SltsReportExports;
  if (!L || !DOCX || !X || !E || !window.SLTS) { console.warn('[report] missing modules'); return; }

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };

  const R = {
    boot: null, issued: [], batches: [], memos: [], loadedIssued: false, sub: 'flow', dash: null,
    f: { q: '', status: '', kind: '', money: '', batch: '' }, sel: new Set(), rateQ: '', rateType: 'free',
  };

  // ------------------------------------------------------------------
  // พื้นฐาน
  // ------------------------------------------------------------------
  const appState = () => { try { return typeof state !== 'undefined' ? state : null; } catch (_) { return null; } };
  const currentUser = () => { const s = appState(); return s && s.currentUser ? s.currentUser : null; };
  const myName = () => (R.boot && R.boot.me && R.boot.me.name) || (currentUser() && (currentUser().name || currentUser().username)) || '';
  const myUser = () => String((R.boot && R.boot.me && R.boot.me.username) || (currentUser() && currentUser().username) || '').toLowerCase();
  const isAdmin = () => (R.boot && R.boot.me && R.boot.me.role === 'admin') || (currentUser() && currentUser().role === 'admin');
  const isPc = () => (typeof window.isMobileView === 'function' ? !window.isMobileView() : window.innerWidth > 768);
  const settings = () => (R.boot && R.boot.settings) || {};
  const arabicDocs = () => settings().doc_digits === 'arabic';
  /** ข้อมูลผู้ที่ล็อกอินอยู่ (ชื่อ-นามสกุล ตำแหน่ง จากบัญชีผู้ใช้) = ผู้ส่งหมาย/ผู้รายงาน */
  const meInfo = () => {
    const m = (R.boot && R.boot.me) || {}; const c = currentUser() || {};
    const first = m.first_name || c.firstName || '';
    return {
      title: m.title || c.title || '', first, last: m.last_name || c.lastName || '',
      full: first ? (m.full_name || `${c.title || ''}${first} ${c.lastName || ''}`.trim()) : '',
      position: m.position || c.position || '',
    };
  };
  const profileKey = () => 'sr_profile_' + myUser();
  const profile = () => LS.get(profileKey(), {});

  function toast(icon, title) {
    if (window.Swal) Swal.fire({ toast: true, position: 'top-end', icon, title, timer: 2800, showConfirmButton: false });
  }
  function fail(e) {
    console.error('[report]', e);
    if (window.Swal) Swal.fire({ icon: 'error', title: 'ดำเนินการไม่สำเร็จ', text: (e && e.message) || String(e), confirmButtonText: 'ตกลง' });
  }
  function busy(title) {
    if (window.Swal) Swal.fire({ title: title || 'กำลังดำเนินการ...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
  }
  const done = () => { if (window.Swal && Swal.isVisible()) Swal.close(); };

  async function api(action, data) {
    const res = await (SLTS.nativeFetch || fetch)(SLTS.apiBase() + '/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SLTS.auth.getToken(), 'X-App-Version': SLTS.version },
      body: JSON.stringify(Object.assign({ action }, data || {})),
      cache: 'no-store',
    });
    const json = await res.json().catch(() => ({ status: 'error', message: 'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (HTTP ' + res.status + ')' }));
    if (res.status === 401 && SLTS.auth.onExpired) SLTS.auth.onExpired();
    if (json.status !== 'success') { const e = new Error(json.message || 'เกิดข้อผิดพลาด'); e.data = json; throw e; }
    return json;
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
  }
  const baseUrl = () => location.origin + location.pathname.replace(/[^/]*$/, '');

  // ------------------------------------------------------------------
  // สร้างไฟล์ PDF จริงจากหน้าเอกสาร (ไม่ใช้หน้าต่างพิมพ์ของเบราว์เซอร์) แล้วแสดงผลในระบบ
  // html2canvas (ภาษาไทยถูกต้องตามฟอนต์ TH Sarabun) → jsPDF ขนาด A4 ตามที่หน้าเอกสารกำหนด
  // ------------------------------------------------------------------
  async function htmlToPdfBlob(html) {
    if (!window.html2canvas) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    if (!(window.jspdf && window.jspdf.jsPDF)) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    const land = /size:A4 landscape/.test(html);
    const mStr = ((html.match(/@page\{size:A4 \w+;margin:([^}]+)\}/) || [])[1] || '14mm').trim();
    let m = mStr.split(/\s+/).map((x) => parseFloat(x) || 0);
    m = m.length === 1 ? [m[0], m[0], m[0], m[0]] : m.length === 2 ? [m[0], m[1], m[0], m[1]] : m.length === 3 ? [m[0], m[1], m[2], m[1]] : m;
    const [mt, mr, mb, ml] = m;
    const pw = land ? 297 : 210; const ph = land ? 210 : 297;
    const cw = pw - ml - mr; const ch = ph - mt - mb;
    const PX = 96 / 25.4; const wpx = Math.round(cw * PX); const hpx = Math.floor(ch * PX);
    const ifr = document.createElement('iframe');
    ifr.setAttribute('aria-hidden', 'true');
    ifr.style.cssText = `position:fixed;left:-20000px;top:0;width:${wpx}px;height:${hpx}px;border:0;visibility:hidden;`;
    document.body.appendChild(ifr);
    try {
      const clean = html.replace(/<div class="toolbar">[\s\S]*?<\/div>/, '').replace(/<script>[\s\S]*?<\/script>/g, '')
        .replace('</head>', `<style>html,body{margin:0!important;padding:0!important;width:${wpx}px;background:#fff}</style></head>`);
      const doc = ifr.contentDocument;
      await new Promise((res) => { ifr.onload = res; doc.open(); doc.write(clean); doc.close(); setTimeout(res, 1500); });
      try { await doc.fonts.ready; } catch (_) {}
      await new Promise((r) => setTimeout(r, 250));
      const body = doc.body;
      const H = Math.ceil(body.scrollHeight);
      // จุดตัดหน้าที่ปลอดภัย (ไม่ตัดกลางบรรทัด/แถวตาราง) + ขึ้นหน้าใหม่ที่กำหนดไว้
      const cands = new Set([H]); const forced = [];
      doc.querySelectorAll('tr, p, h1, h2, h3, table, section, li, br, div').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.height > 0) cands.add(Math.round(r.bottom));
        const st = el.getAttribute('style') || '';
        if (/page-break-before:\s*always/.test(st) && r.top > 1) forced.push(Math.round(r.top));
      });
      const sorted = [...cands].sort((a, b) => a - b);
      const breaks = []; let start = 0;
      while (start < H - 2) {
        const f = forced.find((y) => y > start + 2 && y <= start + hpx);
        let end;
        if (f) end = f;
        else if (start + hpx >= H) end = H;
        else { const ok = sorted.filter((y) => y > start + hpx * 0.4 && y <= start + hpx); end = ok.length ? ok[ok.length - 1] : start + hpx; }
        breaks.push([start, end]); start = end;
      }
      const scale = 2;
      const canvas = await window.html2canvas(body, { scale, width: wpx, height: H, windowWidth: wpx, windowHeight: H, backgroundColor: '#ffffff', useCORS: true, logging: false });
      const pdf = new window.jspdf.jsPDF({ orientation: land ? 'l' : 'p', unit: 'mm', format: 'a4', compress: true });
      breaks.forEach(([a, b], i) => {
        const sh = Math.max(1, Math.round((b - a) * scale));
        const c = document.createElement('canvas'); c.width = canvas.width; c.height = sh;
        const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, sh);
        cx.drawImage(canvas, 0, Math.round(a * scale), canvas.width, sh, 0, 0, canvas.width, sh);
        if (i) pdf.addPage('a4', land ? 'l' : 'p');
        pdf.addImage(c.toDataURL('image/jpeg', 0.93), 'JPEG', ml, mt, cw, (b - a) / PX);
      });
      return pdf.output('blob');
    } finally { ifr.remove(); }
  }

  /** แสดงไฟล์ PDF ที่สร้างแล้วในระบบ (PDF.js) + ปุ่มดาวน์โหลด */
  async function showPdf(blob, fileName) {
    const wrap = document.createElement('div');
    wrap.className = 'sr-modal sr-wrap';
    wrap.innerHTML = `<div class="sr-dialog" role="dialog" style="max-width:1100px;width:100%">
      <div class="sr-dialog-head"><i class="fa-solid fa-file-pdf"></i><h2>${esc(fileName)}</h2>
        <button class="sr-btn sm" data-pdf-dl style="margin-left:auto;background:#fff"><i class="fa-solid fa-download"></i> ดาวน์โหลด PDF</button>
        <button class="x" data-close title="ปิด">&times;</button></div>
      <div class="sr-dialog-body" style="background:#525659;padding:16px;display:flex;flex-direction:column;align-items:center;gap:14px" data-pages>
        <div style="color:#fff">กำลังแสดงผล…</div></div></div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('[data-close]')) close();
      if (e.target.closest('[data-pdf-dl]')) downloadBlob(blob, fileName);
    });
    const box = wrap.querySelector('[data-pages]');
    try {
      if (!window.pdfjsLib) throw new Error('ไม่พบไลบรารี PDF.js');
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      box.innerHTML = '';
      const maxW = Math.min(1040, box.clientWidth - 32 || 1040);
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const v1 = page.getViewport({ scale: 1 });
        const cssScale = maxW / v1.width; const dpr = Math.min(2, window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale: cssScale * dpr });
        const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
        c.style.cssText = `width:${Math.round(v1.width * cssScale)}px;max-width:100%;height:auto;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.35)`;
        box.appendChild(c);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      }
      const n = document.createElement('div'); n.style.cssText = 'color:#e5e7eb;font-size:13px'; n.textContent = `${pdf.numPages} หน้า`; box.appendChild(n);
    } catch (e) {
      box.innerHTML = `<div style="color:#fff">แสดงตัวอย่างไม่ได้ (${esc(e.message || e)}) — กด "ดาวน์โหลด PDF" เพื่อเปิดไฟล์</div>`;
    }
  }

  /** เอกสาร HTML → ไฟล์ PDF จริง แล้วแสดงผลในระบบ */
  async function openPdf(html, fileName) {
    busy('กำลังสร้างไฟล์ PDF...');
    try {
      const blob = await htmlToPdfBlob(html);
      done();
      await showPdf(blob, String(fileName || 'เอกสาร').replace(/[\\/:*?"<>|]+/g, '-') + '.pdf');
    } catch (e) { done(); fail(e); }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if ($$('script').some((s) => s.src === src)) return resolve();
      const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('โหลดไลบรารีไม่สำเร็จ: ' + src));
      document.head.appendChild(s);
    });
  }
  async function readWorkbook(file) {
    if (!window.XLSX) await loadScript('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return wb.SheetNames.map((n) => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: false, blankrows: false }) }));
  }
  function pickFiles(accept, multiple) {
    return new Promise((resolve) => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept; inp.multiple = !!multiple;
      inp.onchange = () => resolve(Array.from(inp.files || [])); inp.click();
    });
  }

  const tplCache = {};
  function template(name) {
    if (!tplCache[name]) {
      tplCache[name] = fetch(`templates/report/${name}.docx?v=${encodeURIComponent(SLTS.version)}`).then((r) => {
        if (!r.ok) throw new Error('ไม่พบแม่แบบ Word: ' + name);
        return r.arrayBuffer();
      }).catch((e) => { delete tplCache[name]; throw e; });
    }
    return tplCache[name];
  }

  async function ensureBoot(force) {
    if (R.boot && !force) return R.boot;
    R.boot = await api('sr_bootstrap');
    return R.boot;
  }
  /** โหลดข้อมูลการส่งหมาย (ภาพจากมือถือ) ของระบบเดิม ถ้ายังไม่เคยโหลด */
  let sheetLoading = null;
  async function ensureSheetRows(force) {
    if (!force && sheetRows().length) return;
    if (typeof window.loadGoogleSheetData !== 'function') return;
    if (!sheetLoading) {
      sheetLoading = Promise.race([Promise.resolve(window.loadGoogleSheetData(Boolean(force), true)).catch(() => {}), new Promise((r) => setTimeout(r, 15000))])
        .finally(() => { sheetLoading = null; });
    }
    await sheetLoading;
  }
  async function loadIssued() {
    const r = await api('sr_issued_list', {});
    R.issued = r.items; R.batches = r.batches; R.loadedIssued = true;
    return R.issued;
  }
  const signers = (kind) => ((R.boot && R.boot.signers) || []).filter((s) => s.kind === kind);
  const defaultSigner = (kind) => { const l = signers(kind); return l.find((s) => s.is_default) || l[0] || null; };
  const freeRateFor = (it) => { const r = L.findRate((R.boot && R.boot.rates) || [], 'free', it.district, it.subdistrict, it.moo); return r ? Number(r.rate_amount) : 0; };
  const paidRateFor = (it) => { const r = L.findRate((R.boot && R.boot.rates) || [], 'paid', it.district, it.subdistrict, it.moo); return r ? Number(r.rate_amount) : 0; };

  // ---------------- การเบิกหมายฟรี (ไม่เบิก / เบิกเต็ม / เบิกครึ่ง) ----------------
  /** การเลือกที่บันทึกไว้ (รายงานเดิมที่ "เบิก" แต่ยังไม่มีข้อมูลการเลือก → ถือเป็นเบิกเต็ม) */
  const claimChoice = (it) => {
    const fc = it.free_claim || {};
    if (fc.mode) return fc;
    if (it.report && it.report_status && it.report_status !== 'none' && it.report.claim !== false) return { mode: 'full', at: it.reported_at || '' };
    return {};
  };
  /** หมายฟรีในรอบเดียวกัน (ผู้ส่งคนเดียวกัน + ช่วงวันที่บัญชีจ่ายหมายเดียวกัน) */
  const claimScope = (it) => R.issued.filter((x) => x.money_type !== 'paid' && x.owner === it.owner && (x.period_start || '') === (it.period_start || '') && (x.period_end || '') === (it.period_end || ''));
  const claimPlan = (scope, override) => L.freeClaimPlan(scope.map((x) => ({ ...x, province: 'อุดรธานี', free_claim: override && override.id === x.id ? override.fc : claimChoice(x) })), freeRateFor);
  const claimLabel = (x) => `ที่ ${x.seq || '-'} ${x.kind === 'T' ? x.t_no : x.black_no} (${x.recipient || ''})`;
  /**
   * เลือกการเบิกหมายฟรี แล้วปรับหมายอื่นในหมู่บ้านเดียวกันตามกฎ และบันทึก
   * คืนผลของหมายนี้ { mode, eff, amount, base } หรือ null ถ้าเลือกไม่ได้ (บ้านเดียวกันเบิกไปแล้ว)
   */
  async function setFreeClaim(it, mode, opt) {
    const scope = claimScope(it);
    const before = claimPlan(scope);
    const b = before.get(it.id);
    if (mode !== 'none' && b && b.blockedBy) {
      const h = R.issued.find((x) => x.id === b.blockedBy);
      await Swal.fire({ icon: 'warning', title: 'เบิกได้หมายเดียวต่อบ้าน', html: `หมายนี้อยู่บ้านเลขที่ หมู่ ตำบล อำเภอ จังหวัดเดียวกับ<br><b>${esc(h ? claimLabel(h) : '#' + b.blockedBy)}</b><br>ซึ่งเลือกเบิกไปแล้ว — ถ้าต้องการเบิกหมายนี้แทน ให้เปลี่ยนหมายนั้นเป็น "ไม่เบิก" ก่อน` });
      return null;
    }
    const prev = claimChoice(it);
    const fc = { mode, at: mode === 'none' ? '' : (prev.mode && prev.mode !== 'none' ? prev.at || new Date().toISOString() : new Date().toISOString()) };
    const after = claimPlan(scope, { id: it.id, fc });
    const changed = scope.filter((x) => {
      const p = after.get(x.id); const f = x.free_claim || {};
      return x.id === it.id || (f.mode || 'none') !== p.mode || (f.eff || 'none') !== p.eff || Number(f.amount || 0) !== p.amount;
    });
    const payload = changed.map((x) => { const p = after.get(x.id); return { id: x.id, mode: p.mode, eff: p.eff, amount: p.amount, base: p.base, at: p.at }; });
    await api('sr_claims_save', { items: payload });
    payload.forEach((p) => { const x = R.issued.find((y) => y.id === p.id); if (x) x.free_claim = { mode: p.mode, eff: p.eff, amount: p.amount, base: p.base, at: p.at }; });
    const mine = after.get(it.id);
    const others = changed.filter((x) => x.id !== it.id && x.free_claim && x.free_claim.mode !== 'none');
    if (!(opt && opt.silent) && others.length) {
      toast('info', mine.eff === 'half' ? `หมู่บ้านเดียวกัน ${mine.villageCount} หมาย — ปรับเป็นเบิกครึ่งหนึ่งทุกหมาย (${others.map((x) => 'ที่ ' + (x.seq || '-')).join(', ')})` : `ปรับการเบิกหมายในหมู่บ้านเดียวกันแล้ว (${others.map((x) => 'ที่ ' + (x.seq || '-')).join(', ')})`);
    }
    return mine;
  }

  // ------------------------------------------------------------------
  // ภาพส่งหมาย (จากข้อมูลที่มือถืออัปโหลดเข้าระบบ)
  // ------------------------------------------------------------------
  const sheetRows = () => { const s = appState(); return s && Array.isArray(s.allSheetRows) ? s.allSheetRows : []; };
  const caseMatch = (a, b) => {
    if (!a || !b) return false;
    // เทียบถึงปี พ.ศ. หลัง "/" เท่านั้น (ข้อความหลังปีไม่นำมาพิจารณา)
    const ka = L.caseKey(a); const kb = L.caseKey(b);
    if (ka && kb && ka === kb) return true;
    if (typeof window.matchCaseNumbers === 'function') return window.matchCaseNumbers(ka, kb);
    return false;
  };
  const timeOf = (v) => (typeof window.parseDateToTime === 'function' ? window.parseDateToTime(v) : (Date.parse(v) || 0));
  // ภาพแทนสำหรับหมายที่ไม่มีภาพถ่าย (เช่น ผู้รับเซ็นรับหมายเอง)
  const NOPHOTO_THUMB = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" rx="10" fill="#fef3c7"/><text x="80" y="52" font-size="30" text-anchor="middle">✍️</text><text x="80" y="84" font-size="13" font-family="sans-serif" text-anchor="middle" fill="#92400e">ไม่มีภาพ</text><text x="80" y="102" font-size="11" font-family="sans-serif" text-anchor="middle" fill="#92400e">เซ็นรับหมาย</text></svg>');
  const isNoPhotoId = (id) => /^nophoto-/.test(String(id || ''));
  function photoFromRow(row) {
    let id = String(row['Drive File ID'] || '').trim();
    const link = String(row['ลิงก์รูปภาพใน Google Drive'] || '');
    if (!id) { const m = link.match(/id=([a-zA-Z0-9_-]+)/) || link.match(/\/d\/([a-zA-Z0-9_-]+)/) || link.match(/[?&]f=(db-[^&]+)/); if (m) id = decodeURIComponent(m[1]); }
    const noPhoto = !id && String(row['ไม่มีภาพ (เหตุผล)'] || '').trim();
    if (!id && noPhoto && row._id) id = 'nophoto-' + row._id;
    if (!id) return null;
    if (noPhoto) {
      return {
        id, rowId: row._id || '', noPhoto: true, reason: noPhoto, caseNo: String(row['เลขคดี'] || '').trim(), loc: String(row['ที่ตั้งส่งหมาย (เต็ม)'] || ''),
        at: String(row['วัน-เวลาบันทึก'] || ''), time: timeOf(row['วัน-เวลาบันทึก']), uploader: String(row['ผู้บันทึก'] || '').toLowerCase(),
        lat: row['ละติจูด (Lat)'] || '', lng: row['ลองจิจูด (Lng)'] || '', district: row['อำเภอ'] || '', subdistrict: row['ตำบล'] || '',
        fileName: '', url: '', thumb: NOPHOTO_THUMB,
      };
    }
    return {
      id, rowId: row._id || '', caseNo: String(row['เลขคดี'] || '').trim(), loc: String(row['ที่ตั้งส่งหมาย (เต็ม)'] || ''),
      at: String(row['วัน-เวลาบันทึก'] || ''), time: timeOf(row['วัน-เวลาบันทึก']), uploader: String(row['ผู้บันทึก'] || '').toLowerCase(),
      lat: row['ละติจูด (Lat)'] || '', lng: row['ลองจิจูด (Lng)'] || '', district: row['อำเภอ'] || '', subdistrict: row['ตำบล'] || '',
      fileName: row['ชื่อไฟล์รูปภาพ'] || '',
      url: window.sltsImgUrl ? window.sltsImgUrl(id, 1600) : '', thumb: window.sltsThumbUrl ? window.sltsThumbUrl(id, 320) : '',
    };
  }
  const houseIn = (loc, it) => {
    const h = String(it.house_no || '').trim().split(' ')[0];
    if (!h) return false;
    const t = ' ' + L.toArabicDigits(loc).replace(/\s+/g, ' ') + ' ';
    return t.includes(' ' + L.toArabicDigits(h) + ' ') || t.includes(' ' + L.toArabicDigits(h) + 'ม') || t.startsWith(' ' + L.toArabicDigits(h));
  };
  function photosForIssued(it) {
    const list = sheetRows().map(photoFromRow).filter(Boolean)
      .filter((p) => (it.kind === 'T' && it.t_no ? caseMatch(p.caseNo, it.t_no) : caseMatch(p.caseNo, it.black_no)));
    const exact = list.filter((p) => houseIn(p.loc, it));
    const out = (exact.length ? exact : list).sort((a, b) => b.time - a.time);
    const seen = new Set();
    return out.filter((p) => (seen.has(p.id) ? false : seen.add(p.id)));
  }
  function issuedForPhoto(p) {
    const list = R.issued.filter((it) => (it.kind === 'T' && it.t_no ? caseMatch(p.caseNo, it.t_no) : caseMatch(p.caseNo, it.black_no)));
    const exact = list.filter((it) => houseIn(p.loc, it));
    return exact.length ? exact : list;
  }

  /** ดึงไฟล์ภาพเป็น bytes + ขนาด (ลองโหลดตรงก่อน ไม่ได้ค่อยผ่านเซิร์ฟเวอร์) */
  async function photoBytes(id) {
    if (isNoPhotoId(id)) return null; // หมายที่ไม่มีภาพถ่าย — ไม่มีไฟล์แนบ
    let blob = null;
    try {
      const r = await (SLTS.nativeFetch || fetch)(window.sltsImgUrl(id, 1600), { mode: 'cors', cache: 'force-cache' });
      if (r.ok) { const b = await r.blob(); if (/^image\//.test(b.type) && b.size > 1000) blob = b; }
    } catch (_) { /* CORS — ใช้ทางสำรอง */ }
    if (!blob) {
      const j = await api('sr_photo', { file_id: id, size: 1600 });
      const bin = atob(j.base64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      blob = new Blob([arr], { type: j.mime || 'image/jpeg' });
    }
    return normalizeImage(blob);
  }
  /** แปลงภาพเป็น JPEG/PNG ที่ Word รองรับ + หาขนาดภาพ */
  async function normalizeImage(blob) {
    const bmp = await createImageBitmap(blob).catch(() => null);
    if (!bmp) throw new Error('ไฟล์ภาพไม่รองรับ (ใช้ได้เฉพาะ JPG/PNG)');
    const okType = /image\/(jpeg|png)/.test(blob.type);
    let out = blob;
    if (!okType || bmp.width > 2600 || bmp.height > 2600) {
      const scale = Math.min(1, 2600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      return { bytes: new Uint8Array(await out.arrayBuffer()), width: c.width, height: c.height, ext: 'jpeg' };
    }
    return { bytes: new Uint8Array(await out.arrayBuffer()), width: bmp.width, height: bmp.height, ext: /png/.test(blob.type) ? 'png' : 'jpeg' };
  }

  // ------------------------------------------------------------------
  // ผนวกเข้ากับเมนูหลักของ SLTS
  // ------------------------------------------------------------------
  function syncTabVisibility() {
    const show = Boolean(currentUser()) && isPc();
    const btn = document.getElementById('tabBtnReport');
    const cbtn = document.getElementById('compactTabBtnReport');
    if (btn) btn.classList.toggle('hidden', !show);
    if (cbtn) { cbtn.classList.toggle('hidden', !show); cbtn.classList.toggle('flex', show); }
  }
  function hookNavigation() {
    const orig = window.switchTab;
    if (typeof orig !== 'function' || orig.__srHooked) return;
    const wrapped = function (tabName) {
      const pane = document.getElementById('tabContentReport');
      // โหมด PC: เมนู "รายงานหมาย" (เดิม "รายการส่งหมายรอบนี้") → หน้ารายงานหมายแบบทีละขั้นตอน
      let viaRouteBtn = false;
      if (tabName === 'route_batch' && !FL.legacy && isPc() && currentUser()) { tabName = 'report'; R.sub = 'flow'; viaRouteBtn = true; }
      else if (tabName === 'report' && R.sub === 'flow') viaRouteBtn = true;
      if (tabName !== 'report') {
        if (pane) { pane.classList.add('hidden'); pane.classList.remove('active'); }
        const b = document.getElementById('tabBtnReport'); if (b) b.classList.remove('active');
        return orig.apply(this, arguments);
      }
      if (!currentUser()) {
        Swal.fire({ icon: 'warning', title: 'จำเป็นต้องเข้าสู่ระบบ', text: 'ระบบรายงานผลหมายสำหรับเจ้าหน้าที่ที่เข้าสู่ระบบแล้วเท่านั้น', confirmButtonText: 'เข้าสู่ระบบ', showCancelButton: true, cancelButtonText: 'ยกเลิก' })
          .then((r) => { if (r.isConfirmed && typeof window.openLoginModal === 'function') window.openLoginModal(); });
        return;
      }
      $$('.tab-nav-btn').forEach((b) => b.classList.remove('active'));
      $$('.tab-pane').forEach((p) => { p.classList.add('hidden'); p.classList.remove('active'); });
      if (typeof window.closeCameraModal === 'function') { try { window.closeCameraModal(); } catch (_) {} }
      if (typeof window.stopRouteBatchRealtimePoller === 'function') { try { window.stopRouteBatchRealtimePoller(); } catch (_) {} }
      const b = document.getElementById(viaRouteBtn ? 'tabBtnRouteBatch' : 'tabBtnReport'); if (b) b.classList.add('active');
      const lbl = document.getElementById('compactNavActiveLabel'); if (lbl) lbl.textContent = viaRouteBtn ? 'รายงานหมาย' : 'ข้อมูลรายงานผลหมาย';
      const ic = document.getElementById('compactNavActiveIcon'); if (ic) ic.innerHTML = '<i class="fa-solid fa-file-signature"></i>';
      if (pane) { pane.classList.remove('hidden'); pane.classList.add('active'); }
      openReportTab();
    };
    wrapped.__srHooked = true;
    window.switchTab = wrapped;
  }

  // ------------------------------------------------------------------
  // แท็บ "รายงานผลหมาย"
  // ------------------------------------------------------------------
  async function openReportTab() {
    const pane = document.getElementById('tabContentReport');
    if (!pane) return;
    if (!pane.dataset.ready) {
      pane.innerHTML = `<div class="sr-wrap">
        <div class="sr-hero">
          <div><div class="sr-kicker">ศาลจังหวัดอุดรธานี · งานเจ้าพนักงานศาล</div>
            <h2 class="sr-title">ระบบรายงานผลการส่งหมาย</h2>
            <div class="sr-sub">บัญชีจ่ายหมาย · แบบรายงานเจ้าหน้าที่/ใบสำคัญรับเงิน (Word) · บันทึกข้อความขออนุมัติเบิก · อัตราค่านำหมาย</div></div>
          <div class="sr-stats" id="srStats"></div>
        </div>
        <div class="sr-tabs" id="srTabs">
          <button class="sr-tab" data-sub="flow"><i class="fa-solid fa-list-ol"></i> รายงานหมาย (ทีละขั้นตอน)</button>
          <button class="sr-tab" data-sub="issued"><i class="fa-solid fa-list-check"></i> บัญชีจ่ายหมาย / รายงานผลหมาย</button>
          <button class="sr-tab" data-sub="memos"><i class="fa-solid fa-file-invoice"></i> บันทึกข้อความ / ใบสำคัญรับเงิน</button>
          <button class="sr-tab" data-sub="rates"><i class="fa-solid fa-table"></i> อัตราค่านำหมาย</button>
          <button class="sr-tab" data-sub="zones"><i class="fa-solid fa-map-location-dot"></i> โซนจ่ายหมาย</button>
          <button class="sr-tab" data-sub="settings"><i class="fa-solid fa-user-pen"></i> ผู้ลงนามและตั้งค่า</button>
        </div>
        <div id="srBody"><div class="sr-empty"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลดข้อมูล...</div></div>
      </div>`;
      pane.dataset.ready = '1';
      $('#srTabs', pane).addEventListener('click', (e) => { const t = e.target.closest('.sr-tab'); if (t) { R.sub = t.dataset.sub; renderSub(); } });
    }
    try {
      await ensureBoot(true);
      if (!R.loadedIssued || R.sub === 'issued' || R.sub === 'flow') await loadIssued();
      renderSub();
      refreshStats();
      if (!sheetRows().length) ensureSheetRows().then(() => { if (R.sub === 'issued' && $('#srRows')) fillIssuedRows(); });
    } catch (e) {
      $('#srBody').innerHTML = `<div class="sr-card"><div class="sr-empty"><i class="fa-solid fa-triangle-exclamation"></i> โหลดข้อมูลไม่สำเร็จ: ${esc(e.message)}<br><button class="sr-btn primary" style="margin-top:10px" id="srRetry">ลองใหม่</button></div></div>`;
      const b = $('#srRetry'); if (b) b.onclick = openReportTab;
    }
  }
  async function refreshStats() {
    try {
      const { summary: s } = await api('sr_dashboard', {});
      const el = $('#srStats'); if (!el) return;
      el.innerHTML = [
        ['หมายทั้งหมด', s.total], ['รายงานแล้ว', `${s.reported}/${s.total}`], ['หมายเงิน', s.paid], ['หมายฟรี', s.free], ['หมาย ต.', s.t_count],
      ].map(([k, v]) => `<div class="sr-stat"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
    } catch (_) { /* ไม่สำคัญ */ }
  }
  function renderSub() {
    $$('#srTabs .sr-tab').forEach((t) => t.classList.toggle('active', t.dataset.sub === R.sub));
    const pane = document.getElementById('tabContentReport');
    if (pane) pane.classList.toggle('sr-flow-mode', R.sub === 'flow');
    if (pane && !pane.classList.contains('hidden')) {
      const rb = document.getElementById('tabBtnRouteBatch'); const rp = document.getElementById('tabBtnReport');
      if (rb) rb.classList.toggle('active', R.sub === 'flow'); if (rp) rp.classList.toggle('active', R.sub !== 'flow');
    }
    if (window.SltsSidebar) window.SltsSidebar.sync();
    const body = $('#srBody'); if (!body) return;
    if (R.sub === 'flow') return renderFlow(body);
    if (R.sub === 'zones') return renderZones(body);
    if (R.sub === 'issued') return renderIssued(body);
    if (R.sub === 'memos') return renderMemos(body);
    if (R.sub === 'rates') return renderRates(body);
    return renderSettings(body);
  }

  // ---------------- 1) บัญชีจ่ายหมาย ----------------
  function filteredIssued() {
    const q = R.f.q.trim().toLowerCase();
    return R.issued.filter((it) => {
      if (R.f.batch && String(it.batch_id) !== R.f.batch) return false;
      if (R.f.status && (R.f.status === 'none' ? it.report_status !== 'none' : it.report_status === 'none')) return false;
      if (R.f.kind && it.kind !== R.f.kind) return false;
      if (R.f.money && it.money_type !== R.f.money) return false;
      if (q) {
        const hay = [it.t_no, it.black_no, it.red_no, it.recipient, it.summon_type, it.subdistrict, it.district, it.address_raw, it.plaintiff, it.defendant].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }
  function renderIssued(body) {
    const batches = R.batches.map((b) => `<option value="${b.id}" ${R.f.batch === String(b.id) ? 'selected' : ''}>${esc(L.thaiDateShort(b.period_start))} – ${esc(L.thaiDateShort(b.period_end))} (${b.item_count} รายการ)</option>`).join('');
    body.innerHTML = `
      <div class="sr-card">
        <div class="sr-toolbar">
          <button class="sr-btn primary" id="srImport"><i class="fa-solid fa-file-excel"></i> นำเข้าไฟล์ Excel บัญชีจ่ายหมาย / ใบเสร็จ</button>
          <button class="sr-btn" id="srAddManual"><i class="fa-solid fa-plus"></i> เพิ่มหมายเอง</button>
          <span class="grow"></span>
          <button class="sr-btn" id="srZip" disabled><i class="fa-solid fa-file-zipper"></i> ดาวน์โหลด Word ที่เลือก (.zip)</button>
          <button class="sr-btn" id="srExport"><i class="fa-solid fa-file-arrow-down"></i> ส่งออก Excel</button>
          <button class="sr-btn danger" id="srDelSel" disabled><i class="fa-solid fa-trash"></i> ลบที่เลือก</button>
        </div>
        <div class="sr-info" style="margin-top:10px"><i class="fa-solid fa-circle-info"></i>
          การรายงานหมายทุกครั้งต้องอ้างอิง<b>บัญชีจ่ายหมาย (ไฟล์ Excel "บัญชีจ่ายหมาย พนักงานศาลนี้ส่ง")</b> — นำเข้าไฟล์ใหม่ทุกรอบ ระบบจะอัปเดตรายการเดิมโดยไม่ลบรายงานที่กรอกไว้ · ไฟล์บัญชีใบเสร็จ (accexpense) ใช้เติมเลขใบเสร็จของหมายเงินอัตโนมัติ</div>
        <div class="sr-toolbar" style="margin-top:12px">
          <input class="sr-input" id="srQ" placeholder="ค้นหา เลข ต./เลขคดี/ผู้รับ/ตำบล" value="${esc(R.f.q)}" style="width:260px">
          <select class="sr-select" id="srBatch"><option value="">ทุกรอบที่นำเข้า</option>${batches}</select>
          <select class="sr-select" id="srKind"><option value="">หมาย ต. และหมายศาล</option><option value="T" ${R.f.kind === 'T' ? 'selected' : ''}>หมายต่างจังหวัด (ต.)</option><option value="LOCAL" ${R.f.kind === 'LOCAL' ? 'selected' : ''}>หมายศาล</option></select>
          <select class="sr-select" id="srMoney"><option value="">หมายเงินและหมายฟรี</option><option value="paid" ${R.f.money === 'paid' ? 'selected' : ''}>หมายเงิน</option><option value="free" ${R.f.money === 'free' ? 'selected' : ''}>หมายฟรี</option></select>
          <select class="sr-select" id="srStatus"><option value="">ทุกสถานะ</option><option value="none" ${R.f.status === 'none' ? 'selected' : ''}>ยังไม่รายงาน</option><option value="done" ${R.f.status === 'done' ? 'selected' : ''}>รายงานแล้ว</option></select>
          <span class="sr-muted" id="srCount"></span>
        </div>
        <div class="sr-scroll" style="margin-top:10px"><table class="sr-table">
          <thead><tr><th class="ctr"><input type="checkbox" id="srAll"></th><th>ที่</th><th>เลขหมาย / คดี</th><th>หมายอะไร / ส่งถึง</th><th>ที่อยู่</th><th>ประเภท</th><th class="num">ราคา / เบิก</th><th>ภาพ</th><th>สถานะ</th><th class="ctr">จัดการ</th></tr></thead>
          <tbody id="srRows"></tbody></table></div>
      </div>`;
    const rerender = () => fillIssuedRows();
    $('#srQ').oninput = (e) => { R.f.q = e.target.value; rerender(); };
    $('#srBatch').onchange = (e) => { R.f.batch = e.target.value; rerender(); };
    $('#srKind').onchange = (e) => { R.f.kind = e.target.value; rerender(); };
    $('#srMoney').onchange = (e) => { R.f.money = e.target.value; rerender(); };
    $('#srStatus').onchange = (e) => { R.f.status = e.target.value; rerender(); };
    $('#srImport').onclick = importExcelFlow;
    $('#srAddManual').onclick = () => openIssuedEditor(null);
    $('#srExport').onclick = async () => { const wb = E.issuedWorkbook(filteredIssued()); downloadBlob(await wb.toBlob(), `บัญชีจ่ายหมาย_${L.todayIso()}.xlsx`); };
    $('#srZip').onclick = () => bulkWord(Array.from(R.sel));
    $('#srDelSel').onclick = deleteSelected;
    $('#srAll').onchange = (e) => { filteredIssued().forEach((it) => (e.target.checked ? R.sel.add(it.id) : R.sel.delete(it.id))); fillIssuedRows(); };
    $('#srRows').addEventListener('click', onIssuedRowClick);
    $('#srRows').addEventListener('change', (e) => {
      if (e.target.matches('input[data-sel]')) { const id = Number(e.target.dataset.sel); e.target.checked ? R.sel.add(id) : R.sel.delete(id); syncSelButtons(); }
    });
    fillIssuedRows();
  }
  function syncSelButtons() {
    const n = R.sel.size;
    const z = $('#srZip'); if (z) { z.disabled = !n; z.innerHTML = `<i class="fa-solid fa-file-zipper"></i> ดาวน์โหลด Word ที่เลือก${n ? ` (${n})` : ''} (.zip)`; }
    const d = $('#srDelSel'); if (d) d.disabled = !n;
  }
  function fillIssuedRows() {
    const tb = $('#srRows'); if (!tb) return;
    const list = filteredIssued();
    $('#srCount').textContent = `แสดง ${list.length} จาก ${R.issued.length} รายการ`;
    if (!R.issued.length) {
      tb.innerHTML = `<tr><td colspan="10"><div class="sr-empty"><i class="fa-solid fa-file-excel" style="font-size:28px;color:#94a3b8"></i><br>ยังไม่มีบัญชีจ่ายหมาย — กด <b>"นำเข้าไฟล์ Excel"</b> แล้วเลือกไฟล์ litigant_rpt_issued_sendbyofficer.xls จากระบบงานศาล</div></td></tr>`;
      syncSelButtons(); return;
    }
    tb.innerHTML = list.map((it) => {
      const photos = photosForIssued(it);
      const rate = it.money_type === 'paid' ? `${L.money2(it.price)}` : (() => { const fr = freeRateFor(it); const rep = it.report || {}; return rep.claim === false ? '<span class="sr-muted">ไม่เบิก</span>' : (fr ? `<span class="sr-muted">เบิก</span> ${L.money2(rep.claim_amount || fr)}` : '<span class="sr-chip red">ไม่พบอัตรา</span>'); })();
      const st = it.report_status === 'printed' ? '<span class="sr-chip ok">พิมพ์แล้ว</span>' : it.report_status === 'saved' ? '<span class="sr-chip warn">บันทึกแล้ว</span>' : '<span class="sr-chip">ยังไม่รายงาน</span>';
      const no = it.kind === 'T' ? `<b>${esc(it.t_no)}</b><div class="sr-muted">${esc(it.black_no)}</div>` : `<b>${esc(it.black_no)}</b>${it.red_no ? `<div class="sr-muted">แดง ${esc(it.red_no)}</div>` : ''}`;
      const thumb = photos[0] ? `<img class="sr-thumb" src="${esc(photos[0].thumb)}" data-view="${esc(photos[0].id)}" referrerpolicy="no-referrer" loading="lazy" alt="">${photos.length > 1 ? `<div class="sr-muted">+${photos.length - 1}</div>` : ''}` : '<span class="sr-muted">-</span>';
      return `<tr>
        <td class="ctr"><input type="checkbox" data-sel="${it.id}" ${R.sel.has(it.id) ? 'checked' : ''}></td>
        <td>${it.seq || ''}</td><td>${no}</td>
        <td>${esc(it.summon_type)}<div class="sr-muted">${esc(it.recipient)}</div></td>
        <td>${esc(it.address_raw || [it.house_no, it.moo && 'ม.' + it.moo].filter(Boolean).join(' '))}<div class="sr-muted">ต.${esc(it.subdistrict)} อ.${esc(it.district)}</div></td>
        <td><span class="sr-chip ${it.kind === 'T' ? 't' : ''}">${it.kind === 'T' ? 'หมาย ต.' : 'หมายศาล'}</span><br><span class="sr-chip ${it.money_type === 'paid' ? 'paid' : ''}" style="margin-top:3px">${it.money_type === 'paid' ? 'หมายเงิน' : 'หมายฟรี'}</span></td>
        <td class="num">${rate}${it.receipt_ref ? `<div class="sr-muted">${esc(it.receipt_ref)}</div>` : ''}</td>
        <td>${thumb}</td><td>${st}</td>
        <td class="ctr" style="white-space:nowrap"><button class="sr-btn primary sm" data-report="${it.id}"><i class="fa-solid fa-file-pen"></i> รายงานหมาย</button>
          ${it.report_status !== 'none' ? `<button class="sr-btn sm" data-word="${it.id}" title="ดาวน์โหลด Word"><i class="fa-solid fa-file-word"></i></button>` : ''}
          <button class="sr-btn sm" data-edit="${it.id}" title="แก้ไขข้อมูลหมาย"><i class="fa-solid fa-pen"></i></button></td></tr>`;
    }).join('') || '<tr><td colspan="10"><div class="sr-empty">ไม่พบรายการตามเงื่อนไข</div></td></tr>';
    syncSelButtons();
  }
  function onIssuedRowClick(e) {
    const t = e.target.closest('[data-report],[data-word],[data-edit],[data-view]');
    if (!t) return;
    if (t.dataset.report) openReportForm(Number(t.dataset.report));
    else if (t.dataset.word) quickWord(Number(t.dataset.word));
    else if (t.dataset.edit) openIssuedEditor(R.issued.find((x) => x.id === Number(t.dataset.edit)));
    else if (t.dataset.view) viewPhoto(t.dataset.view);
  }
  function viewPhoto(id) {
    const p = sheetRows().map(photoFromRow).find((x) => x && x.id === id);
    if (p && p.noPhoto) return Swal.fire({ icon: 'info', title: 'ไม่มีภาพถ่าย', html: `<b>${esc(p.caseNo)}</b><br>${esc(p.reason)}<br><span class="sr-muted">${esc(p.loc)} · ${esc(p.at)}</span>` });
    if (p && typeof window.viewPhotoModal === 'function') window.viewPhotoModal(p.url, p.caseNo, p.loc, p.at, p.lat, p.lng);
    else window.open(window.sltsImgUrl(id, 1600), '_blank');
  }

  async function importExcelFlow() {
    const files = await pickFiles('.xls,.xlsx', true);
    if (!files.length) return;
    busy('กำลังอ่านไฟล์ Excel...');
    try {
      const parsed = [];
      for (const f of files) {
        const sheets = await readWorkbook(f);
        let got = null; let lastErr = null;
        // ไฟล์อาจมีหลายชีต (หลายหน้า) → รวมทุกชีตที่อ่านได้
        for (const sh of sheets) {
          try {
            const g = L.parseCourtExcel(sh.rows);
            if (!got) got = g;
            else if (g.kind === got.kind) { const base = got.items.length; got.items = got.items.concat(g.items.map((x, k) => ({ ...x, seq: x.seq || base + k + 1 }))); }
          } catch (er) { lastErr = er; }
        }
        if (!got) throw new Error(`${f.name}: ${lastErr ? lastErr.message : 'อ่านไม่ได้'}`);
        got.file = f.name; parsed.push(got);
      }
      const issued = parsed.filter((p) => p.kind === 'issued');
      const acc = parsed.filter((p) => p.kind === 'accexpense');
      if (!issued.length && !R.issued.length) {
        done();
        return Swal.fire({ icon: 'warning', title: 'ต้องนำเข้าบัญชีจ่ายหมายก่อน', html: 'ไฟล์ที่เลือกเป็นบัญชีใบเสร็จ — กรุณานำเข้าไฟล์ <b>"บัญชีจ่ายหมาย พนักงานศาลนี้ส่ง"</b> ก่อน (เลือกพร้อมกันทั้ง 2 ไฟล์ได้)' });
      }
      const msgs = [];
      for (const p of issued) {
        // เติมใบเสร็จจากไฟล์ accexpense ที่เลือกมาพร้อมกัน
        acc.forEach((a) => L.matchReceipts(p.items, a.items).forEach((m) => { p.items[m.index].receipt_ref = m.receipt.receipt_ref; p.items[m.index].entry_date = m.receipt.entry_date; }));
        const r = await api('sr_issued_import', { items: p.items, period: p.period, source_file: p.file });
        msgs.push(`${esc(p.file)}: ${esc(r.message)}`);
      }
      for (const a of acc) {
        const r = await api('sr_receipts_import', { receipts: a.items });
        msgs.push(`${esc(a.file)}: ${esc(r.message)}${r.unmatched && r.unmatched.length ? `<div class="sr-muted" style="text-align:left">ไม่พบในบัญชีจ่ายหมาย: ${r.unmatched.map(esc).join(', ')}</div>` : ''}`);
      }
      await loadIssued();
      R.f.batch = '';
      done();
      renderSub(); refreshStats();
      Swal.fire({ icon: 'success', title: 'นำเข้าเรียบร้อย', html: msgs.join('<br>') });
    } catch (e) { done(); fail(e); }
  }

  async function deleteSelected() {
    const ids = Array.from(R.sel);
    const ok = await Swal.fire({ icon: 'warning', title: `ลบ ${ids.length} รายการ?`, text: 'ข้อมูลรายงานผลหมายที่กรอกไว้ของรายการเหล่านี้จะถูกลบด้วย', showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#b91c1c' });
    if (!ok.isConfirmed) return;
    try { const r = await api('sr_issued_delete', { ids }); R.sel.clear(); await loadIssued(); renderSub(); refreshStats(); toast('success', r.message); } catch (e) { fail(e); }
  }

  /** เพิ่ม/แก้ไขข้อมูลหมาย (กรณีไม่มีในไฟล์ หรือข้อมูลในไฟล์ไม่ครบ) */
  async function openIssuedEditor(it) {
    it = it || { kind: 'LOCAL', money_type: 'free' };
    const f = (k, label, w) => `<div class="sr-field ${w || ''}"><label>${label}</label><input class="sr-input" id="ie_${k}" value="${esc(it[k] == null ? '' : it[k])}"></div>`;
    const r = await Swal.fire({
      title: it.id ? 'แก้ไขข้อมูลหมาย' : 'เพิ่มหมาย (ไม่มีในบัญชีจ่ายหมาย)', width: 900, showCancelButton: true, confirmButtonText: 'บันทึก', cancelButtonText: 'ยกเลิก',
      html: `<div class="sr-grid sr-g3" style="text-align:left">
        <div class="sr-field"><label>ประเภทหมาย</label><select class="sr-select" id="ie_kind"><option value="LOCAL" ${it.kind !== 'T' ? 'selected' : ''}>หมายศาล</option><option value="T" ${it.kind === 'T' ? 'selected' : ''}>หมายต่างจังหวัด (ต.)</option></select></div>
        <div class="sr-field"><label>หมายนำ/หมายศาล</label><select class="sr-select" id="ie_money_type"><option value="paid" ${it.money_type === 'paid' ? 'selected' : ''}>หมายนำ (หมายเงิน)</option><option value="free" ${it.money_type !== 'paid' ? 'selected' : ''}>หมายศาล (หมายฟรี)</option></select></div>
        ${f('price', 'ราคา (บาท)')}${f('t_no', 'เลขหมาย ต. (เช่น ต3086/2569)')}${f('black_no', 'คดีหมายเลขดำ')}${f('red_no', 'คดีหมายเลขแดง')}
        ${f('plaintiff', 'โจทก์', 'sr-span2')}${f('payer_court', 'ผู้วางเงิน / ศาลต้นทาง')}${f('defendant', 'จำเลย', 'sr-span2')}${f('summon_type', 'หมายอะไร')}
        ${f('recipient', 'หมายถึงใคร', 'sr-span2')}${f('receipt_ref', 'ใบเสร็จ (หมายเงิน)')}
        ${f('house_no', 'บ้านเลขที่')}${f('moo', 'หมู่')}${f('soi', 'ซอย')}${f('road', 'ถนน')}${f('subdistrict', 'ตำบล')}${f('district', 'อำเภอ')}
      </div>`,
      preConfirm: () => {
        const o = {};
        ['kind', 'money_type', 'price', 't_no', 'black_no', 'red_no', 'plaintiff', 'payer_court', 'defendant', 'summon_type', 'recipient', 'receipt_ref', 'house_no', 'moo', 'soi', 'road', 'subdistrict', 'district']
          .forEach((k) => { o[k] = $('#ie_' + k).value.trim(); });
        if (!o.t_no && !o.black_no) { Swal.showValidationMessage('กรุณาระบุเลขหมาย ต. หรือคดีหมายเลขดำ'); return false; }
        o.address_raw = [o.house_no, o.moo && 'ม. ' + o.moo, o.soi && 'ซ. ' + o.soi, o.road && 'ถ. ' + o.road].filter(Boolean).join(' ');
        o.seq = it.seq || 0; o.server_name = it.server_name || myName(); o.result_text = it.result_text || ''; o.entry_date = it.entry_date || '';
        return o;
      },
    });
    if (!r.isConfirmed) return;
    try { const out = await api('sr_issued_upsert', { id: it.id || 0, item: r.value }); await loadIssued(); renderSub(); toast('success', out.message); } catch (e) { fail(e); }
  }

  // ---------------- แบบฟอร์มรายงานผลหมาย (ภาพที่ 1–2) ----------------
  function defaultsFor(it, opt) {
    const rep = it.report || {};
    const insp = defaultSigner('inspector'); const payer = defaultSigner('payer');
    const photos = photosForIssued(it);
    // วันที่ส่งหมาย = วันที่ของภาพส่งหมายที่เลือก (วันเวลาบนภาพ/ข้อมูลภาพ) → ภาพล่าสุดของหมายนี้
    const selId = opt && opt.photoIds && opt.photoIds[0];
    const selPhoto = (selId && (photos.find((p) => p.id === selId) || sheetRows().map(photoFromRow).find((x) => x && x.id === selId))) || photos[0];
    const firstTime = selPhoto && selPhoto.time ? new Date(selPhoto.time) : null;
    const code = L.resultCodeOf(it.result_text) || (/ประกาศ/.test(it.summon_type) ? '003' : '001');
    const fr = freeRateFor(it);
    const prof = profile();
    const d = {
      issue_date: it.entry_date || it.period_start || L.todayIso(),
      send_method: 'ส่งโดยเจ้าพนักงาน',
      server_name: meInfo().full || it.server_name || myName(),
      serve_date: firstTime ? L.toIso(firstTime) : L.todayIso(),
      result_code: code, result_text: L.resultText(code), result_extra: '',
      file_type: 'file', resend_to: '', court_note: '', note: '',
      reporter_name: meInfo().full || prof.name || myName(), reporter_position: meInfo().position || prof.position || '',
      recipient: it.recipient,
      inspector_id: insp ? insp.id : '', inspector_name: insp ? insp.full_name : '', inspector_position: insp ? insp.position : '',
      inspector_acting: insp ? insp.acting : true, inspector_title: insp ? (insp.acting_title || settings().director_title) : settings().director_title,
      payer_id: payer ? payer.id : '', payer_name: payer ? payer.full_name : '', payer_position: payer ? payer.position : '',
      receipt_date: it.money_type === 'paid' ? L.todayIso() : '', money_type: it.money_type, // หมายฟรี: ไม่ใช้วันที่รับเงิน
      claim: true, claim_amount: fr, amount: Number(it.price) || 0, receipt_ref: it.receipt_ref || '',
      court_order: '', judge: '', record_date: L.todayIso(),
      house_no: it.house_no, moo: it.moo, soi: it.soi, road: it.road, province: 'อุดรธานี', district: it.district, subdistrict: it.subdistrict,
      postcode: L.postcodeFor(it.district), phone: '', appt_time: '', detail: '', house_desc: '',
      posting_choice: '2', absent_name: '', other_text: '', notice_place: it.recipient, notice_time: 'เวลากลางวัน',
      kind: it.kind, t_no: it.t_no, origin_court: it.payer_court || '', payer_court: it.payer_court || '',
      letter_no: '', letter_date: L.todayIso(), ref_no: '',
      black_no: it.black_no, red_no: it.red_no, case_kind: L.caseKindOf(it.black_no),
      plaintiff: it.plaintiff, petitioner: '', defendant: it.defendant, summon_type: it.summon_type,
      photo_ids: (opt && opt.photoIds) || photos.slice(0, 1).map((p) => p.id),
    };
    // ค่าที่เคยบันทึกไว้ทับค่าเริ่มต้น (ยกเว้นกด "ล้าง")
    if (!(opt && opt.reset)) Object.keys(rep).forEach((k) => { if (rep[k] !== undefined && rep[k] !== null) d[k] = rep[k]; });
    if (opt && opt.photoIds && opt.photoIds.length) d.photo_ids = Array.from(new Set([...(opt.photoIds), ...((!opt.reset && rep.photo_ids) || [])]));
    // ใบเสร็จ (หมายเงิน): ที่บันทึกไว้ → จากบัญชีใบเสร็จ Excel → เลขล่าสุดของผู้ใช้ +1
    if (!d.rcpt_book && !d.rcpt_no) Object.assign(d, receiptDefaults(it, d.receipt_ref || it.receipt_ref));
    if (!d.rcpt_type) d.rcpt_type = L.isEfilingCase(it) ? 'efiling' : 'pink';
    // หมายฟรี: การเบิกตามที่เลือกไว้ (กฎบ้าน/หมู่บ้านเดียวกัน) เป็นหลัก
    if (it.money_type !== 'paid') {
      const p = claimPlan(claimScope(it)).get(it.id);
      if (p) {
        const decided = Boolean(claimChoice(it).mode);
        d.claim_mode = decided ? p.mode : (p.blockedBy ? 'none' : (d.claim === false ? 'none' : 'full'));
        d.claim = d.claim_mode !== 'none';
        d.claim_blocked = p.blockedBy || 0;
        if (decided && d.claim) d.claim_amount = p.amount || d.claim_amount;
        if (!decided && d.claim) d.claim_amount = claimPlan(claimScope(it), { id: it.id, fc: { mode: d.claim_mode, at: new Date().toISOString() } }).get(it.id).amount || d.claim_amount;
      }
    }
    return d;
  }

  /** ค่าเริ่มต้นของใบเสร็จ: ชมพู/e-Filing ตามเลขคดี (มี E และไม่ใช่หมาย ต. = e-Filing) */
  function receiptDefaults(it, ref) {
    const type = L.isEfilingCase(it) ? 'efiling' : 'pink';
    const p = L.parseReceiptRef(ref);
    if (p && p.book && p.no) return { rcpt_type: p.type, rcpt_book: p.book, rcpt_no: p.no, rcpt_hint: 'จากบัญชีใบเสร็จ (Excel)' };
    const last = ((R.boot && R.boot.rcptLast) || {})[type];
    if (type === 'efiling') {
      const fy = 'D' + L.fiscalYearBE(new Date());
      if (last && last.book === fy) return { rcpt_type: type, rcpt_book: fy, rcpt_no: L.nextReceiptNo(type, last.no), rcpt_hint: `ต่อจากเลขล่าสุด ${last.book} / ${last.no}` };
      return { rcpt_type: type, rcpt_book: fy, rcpt_no: '', rcpt_hint: last ? `เลขล่าสุด ${last.book} / ${last.no} (ปีงบประมาณก่อน)` : '' };
    }
    if (last && last.book) return { rcpt_type: type, rcpt_book: last.book, rcpt_no: L.nextReceiptNo(type, last.no), rcpt_hint: `ต่อจากเลขล่าสุด เล่มที่ ${last.book} เลขที่ ${last.no}` };
    return { rcpt_type: type, rcpt_book: '', rcpt_no: '', rcpt_hint: '' };
  }

  function signerOptions(kind, selId) {
    return signers(kind).map((s) => `<option value="${s.id}" ${String(s.id) === String(selId) ? 'selected' : ''}>${esc(s.full_name)}${s.is_default ? ' (ค่าเริ่มต้น)' : ''}</option>`).join('');
  }

  async function openReportForm(id, opt) {
    try {
      await ensureBoot();
      if (!R.loadedIssued) await loadIssued();
      await ensureSheetRows();
    } catch (e) { return fail(e); }
    let it = R.issued.find((x) => x.id === id);
    if (!it) { try { it = (await api('sr_issued_get', { id })).item; } catch (e) { return fail(e); } }
    const v = defaultsFor(it, opt);
    const photos = photosForIssued(it);
    const extraIds = (v.photo_ids || []).filter((pid) => !photos.some((p) => p.id === pid));
    extraIds.forEach((pid) => { const p = sheetRows().map(photoFromRow).find((x) => x && x.id === pid); if (p) photos.push(p); });
    const isT = it.kind === 'T';
    const inp = (k, label, o) => {
      o = o || {};
      const type = o.type || 'text';
      const val = v[k] == null ? '' : v[k];
      const ctl = o.textarea ? `<textarea class="sr-textarea" id="rf_${k}" rows="${o.rows || 2}">${esc(val)}</textarea>`
        : o.select ? `<select class="sr-select" id="rf_${k}">${o.select}</select>`
          : `<input class="sr-input" id="rf_${k}" type="${type}" value="${esc(val)}" ${o.list ? `list="${o.list}"` : ''} ${o.ro ? 'readonly' : ''}>`;
      return `<div class="sr-field ${o.cls || ''}"><label>${label}${o.req ? ' <span class="req">*</span>' : ''}</label>${o.pre ? `<div class="sr-inline">${ctl}${o.pre}</div>` : ctl}</div>`;
    };
    const resultOpts = L.RESULT_CODES.map(([c, t]) => `<option value="${c}" ${v.result_code === c ? 'selected' : ''}>${c} — ${esc(t)}</option>`).join('');
    const fileOpts = L.FILE_TYPES.map(([k, t]) => `<option value="${k}" ${v.file_type === k ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const sendOpts = L.SEND_METHODS.map((t) => `<option ${v.send_method === t ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const postOpts = L.POSTING_CHOICES.map(([k, t]) => `<label style="display:flex;gap:6px;align-items:flex-start;margin:3px 0"><input type="radio" name="rf_posting" value="${k}" ${String(v.posting_choice) === k ? 'checked' : ''}> <span>${esc(t)}</span></label>`).join('');
    const photoHtml = photos.length ? photos.map((p) => `<label class="sr-photo"><input type="checkbox" data-photo="${esc(p.id)}" ${(v.photo_ids || []).includes(p.id) ? 'checked' : ''}>
        <img src="${esc(p.thumb)}" referrerpolicy="no-referrer" alt="" data-zoom="${esc(p.id)}"><div class="cap">${esc(p.caseNo)}<br>${esc(p.at)}<br>${esc(p.loc).slice(0, 60)}</div></label>`).join('')
      : '<div class="sr-muted">ไม่พบภาพที่อัปโหลดจากมือถือสำหรับหมายนี้ (เลือกไฟล์ภาพเพิ่มได้ด้านล่าง หรือรายงานโดยไม่มีภาพ)</div>';
    const courts = LS.get('sr_origin_courts', []);

    const wrap = document.createElement('div');
    wrap.className = 'sr-modal sr-wrap';
    wrap.innerHTML = `<div class="sr-dialog" role="dialog">
      <div class="sr-dialog-head"><i class="fa-solid fa-file-pen"></i><h2>บันทึกผลการส่งหมาย : ${esc(isT ? it.t_no : it.black_no)} — ${esc(it.recipient)}</h2>
        <span class="sr-chip" style="background:#fff" id="rf_tpl"></span><button class="x" data-close title="ปิด">&times;</button></div>
      <div class="sr-dialog-body">
        <div class="sr-section" style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:10px 14px">
          <div style="font-size:15px"><b><i class="fa-solid fa-location-dot" style="color:#e11d48"></i> ที่ตั้งส่งหมาย:</b> ${esc(issuedAddr(it))}${it.recipient ? ` <span class="sr-muted">· ${esc(it.recipient)}</span>` : ''}</div>
          ${photos.length ? `<div class="sr-muted" style="margin-top:4px"><i class="fa-solid fa-camera"></i> ที่ตั้งจากภาพส่งหมาย: ${photos.slice(0, 3).map((p) => `${p.noPhoto ? esc(p.reason) : esc(p.loc || '-')}${p.lat && p.lng ? ` <a href="https://www.google.com/maps?q=${encodeURIComponent(p.lat + ',' + p.lng)}" target="_blank" rel="noopener">แผนที่</a>` : ''} <span style="opacity:.7">(${esc(p.at)})</span>`).join(' · ')}</div>` : '<div class="sr-muted" style="margin-top:4px">ยังไม่มีภาพส่งหมายของหมายนี้</div>'}
        </div>
        <div class="sr-section"><h4>บันทึกผลการส่งหมาย</h4>
          <div class="sr-grid sr-g4">
            ${inp('issue_date', 'วันที่จ่ายหมาย', { type: 'date', req: true })}
            ${inp('send_method', 'ส่งโดย', { select: sendOpts })}
            ${inp('server_name', 'ผู้นำส่งหมาย', { req: true })}
            ${inp('serve_date', 'วันที่ส่งหมาย', { type: 'date', req: true })}
            ${inp('result_code', 'ผลการส่งหมาย', { select: resultOpts, cls: 'sr-span2', req: true })}
            ${inp('result_extra', 'ผลการส่งหมายเพิ่มเติม', { cls: 'sr-span2' })}
            ${inp('file_type', 'ประเภทการส่งหมาย', { select: fileOpts, cls: 'sr-span2' })}
            ${inp('resend_to', 'ส่งหมายไปที่ / ข้อเสนอต่อศาล (ถ้ามี)', { cls: 'sr-span2' })}
            ${inp('note', 'หมายเหตุ (ไม่พิมพ์ในแบบ)', { textarea: true, cls: 'sr-span4' })}
          </div></div>
        <div class="sr-section"><h4>ข้อมูลคดี</h4>
          <div class="sr-grid sr-g4">
            ${isT ? inp('t_no', 'เลขหมาย ต.', { req: true }) : ''}
            ${isT ? inp('origin_court', 'ศาลต้นทาง (ศาลที่ส่งหมายมา)', { list: 'rf_courts', req: true }) : ''}
            ${inp('black_no', 'คดีหมายเลขดำ', { req: true })}
            ${inp('red_no', 'คดีหมายเลขแดง')}
            ${inp('case_kind', 'ความ', { select: ['แพ่ง', 'อาญา'].map((x) => `<option ${v.case_kind === x ? 'selected' : ''}>${x}</option>`).join('') })}
            ${inp('summon_type', 'หมายอะไร', { cls: isT ? '' : 'sr-span2' })}
            ${inp('plaintiff', 'โจทก์', { cls: 'sr-span2' })}
            ${inp('defendant', 'จำเลย', { cls: 'sr-span2' })}
            ${inp('petitioner', 'ผู้ร้อง (แบบปิดประกาศ)', { cls: 'sr-span2' })}
            ${inp('recipient', 'ส่งหมายถึง', { cls: 'sr-span2', req: true })}
          </div><datalist id="rf_courts">${courts.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
        <div class="sr-section"><h4>การเงิน</h4>
          <div class="sr-grid sr-g4">
            ${inp('reporter_name', 'ผู้บันทึกผลหมาย (ผู้รายงาน/ผู้รับเงิน)', { req: true })}
            ${inp('reporter_position', 'ตำแหน่งผู้บันทึก', { req: true })}
            <div class="sr-field"><label>ผู้ตรวจ <span class="req">*</span></label><div class="sr-inline"><select class="sr-select" id="rf_inspector_id"><option value="">— เลือก —</option>${signerOptions('inspector', v.inspector_id)}</select><button class="sr-btn sm" type="button" data-add-signer="inspector" title="เพิ่มผู้ตรวจ"><i class="fa-solid fa-user-plus"></i></button></div></div>
            ${inp('inspector_position', 'ตำแหน่งผู้ตรวจ')}
            <div class="sr-field sr-span2"><label>ข้อความใต้ตำแหน่งผู้ตรวจ</label><div class="sr-inline"><label class="sr-radio"><label><input type="checkbox" id="rf_inspector_acting" ${v.inspector_acting ? 'checked' : ''}> ปฏิบัติราชการแทน</label></label><input class="sr-input" id="rf_inspector_title" value="${esc(v.inspector_title || '')}"></div></div>
            <div class="sr-field"><label>ผู้จ่ายเงิน <span class="req">*</span></label><div class="sr-inline"><select class="sr-select" id="rf_payer_id"><option value="">— เลือก —</option>${signerOptions('payer', v.payer_id)}</select><button class="sr-btn sm" type="button" data-add-signer="payer" title="เพิ่มผู้จ่ายเงิน"><i class="fa-solid fa-user-plus"></i></button></div></div>
            ${inp('payer_position', 'ตำแหน่งผู้จ่ายเงิน')}
            ${inp('receipt_date', 'วันที่รับเงิน (ใบสำคัญรับเงิน)', { type: 'date' })}
            ${inp('money_type', 'หมายนำ / หมายศาล', { select: `<option value="paid" ${v.money_type === 'paid' ? 'selected' : ''}>หมายนำ (หมายเงิน)</option><option value="free" ${v.money_type !== 'paid' ? 'selected' : ''}>หมายศาล (หมายฟรี)</option>` })}
            <div class="sr-field sr-span2" id="rf_claim_box"><label>หมายฟรี: การเบิกค่าส่งหมาย</label>
              <div class="sr-radio"><label><input type="radio" name="rf_claim" value="none" ${v.claim_mode === 'none' ? 'checked' : ''}> ไม่เบิก</label><label><input type="radio" name="rf_claim" value="full" ${v.claim_mode === 'full' ? 'checked' : ''} ${v.claim_blocked ? 'disabled' : ''}> เบิกเต็มจำนวน</label><label><input type="radio" name="rf_claim" value="half" ${v.claim_mode === 'half' ? 'checked' : ''} ${v.claim_blocked ? 'disabled' : ''}> เบิกครึ่งหนึ่ง</label></div>
              <div class="sr-muted" id="rf_claim_rule"></div></div>
            ${inp('claim_amount', 'อัตราหมายฟรี (บาท)', { type: 'number', cls: 'rf-free' })}
            ${inp('amount', 'ค่าบริการส่งครั้งนี้ (บาท)', { type: 'number', cls: 'rf-paid' })}
            <div class="sr-field sr-span4 rf-paid sr-rcpt"><label>ใบเสร็จ (โดยตัดจ่ายจากเงินของ) <span class="req">*</span></label>
              <div class="sr-inline" style="flex-wrap:wrap;gap:10px;align-items:center">
                <div class="sr-radio"><label><input type="radio" name="rf_rcpt_type" value="pink" ${v.rcpt_type !== 'efiling' ? 'checked' : ''}> ใบเสร็จชมพู</label><label><input type="radio" name="rf_rcpt_type" value="efiling" ${v.rcpt_type === 'efiling' ? 'checked' : ''}> ใบเสร็จ e-Filing</label></div>
                <label class="sr-muted">เล่มที่</label><span class="sr-prefix" id="rcBookPre">D</span><input class="sr-input" id="rf_rcpt_book_in" inputmode="numeric" style="width:110px" value="${esc(String(v.rcpt_book || '').replace(/\D+/g, ''))}">
                <label class="sr-muted">เลขที่</label><span class="sr-prefix" id="rcNoPre">ค</span><input class="sr-input" id="rf_rcpt_no_in" inputmode="numeric" style="width:120px" value="${esc(v.rcpt_type === 'efiling' ? String(v.rcpt_no || '').replace(/\D+/g, '') : String(v.rcpt_no || '').replace(/\D+/g, ''))}">
                <button class="sr-btn sm" type="button" id="rcNext" title="ใช้เลขถัดจากเลขล่าสุดที่บันทึก">เลขถัดไป</button>
              </div>
              <div class="sr-muted" id="rcHint" style="margin-top:4px"></div></div>
            ${isT ? inp('payer_court', 'ศาลผู้วางเงิน (ใบสำคัญรับเงิน)', { cls: 'rf-paid', list: 'rf_courts' }) : ''}
            <div class="sr-field sr-span4"><div class="sr-note" id="rf_money_preview"></div></div>
          </div></div>
        <div class="sr-section"><h4>ศาล</h4>
          <div class="sr-grid sr-g4">
            ${inp('court_order', 'คำสั่งศาล', { textarea: true, cls: 'sr-span2' })}
            ${inp('judge', 'ผู้พิพากษาผู้สั่งผลการส่งหมาย')}
            ${inp('record_date', 'วันที่บันทึกผลหมาย (วันที่ของรายงาน)', { type: 'date', req: true })}
          </div></div>
        <div class="sr-section"><h4>บันทึกการปิดหมาย</h4>
          <div class="sr-grid sr-g4">
            ${inp('house_no', 'บ้านเลขที่')}${inp('moo', 'หมู่')}${inp('soi', 'ตรอก/ซอย')}${inp('road', 'ถนน')}
            ${inp('province', 'ชื่อจังหวัด')}${inp('district', 'อำเภอ/เขต')}${inp('subdistrict', 'ตำบล/แขวง')}${inp('postcode', 'รหัสไปรษณีย์')}
            ${inp('phone', 'โทรศัพท์')}${inp('appt_time', 'เวลานัด')}${inp('detail', 'รายละเอียด', { textarea: true })}${inp('house_desc', 'ลักษณะบ้าน', { textarea: true })}
            <div class="sr-field sr-span4 rf-normal"><label>ผลการปิดหมาย (หน้า 2 ของแบบรายงาน)</label>${postOpts}
              <div class="sr-grid sr-g2" style="margin-top:6px">${inp('absent_name', 'ชื่อผู้ที่ไม่พบ (ข้อ 3)')}${inp('other_text', 'อื่นๆ (ข้อ 5)')}</div></div>
            <div class="sr-field sr-span3 rf-notice">${inp('notice_place', 'สถานที่ปิดประกาศ (ผลการส่งหมาย คือ)')}</div>
            <div class="sr-field rf-notice">${inp('notice_time', 'ช่วงเวลา')}</div>
          </div></div>
        ${isT ? `<div class="sr-section"><h4>หนังสือนำส่งคืนศาลต้นทาง (หมาย ต.)</h4>
          <div class="sr-grid sr-g4">
            ${inp('letter_no', 'เลขที่หนังสือ ศย304.019/', { pre: '' })}
            ${inp('letter_date', 'ลงวันที่', { type: 'date' })}
            ${inp('ref_no', 'อ้างถึง (เลขที่หนังสือของศาลต้นทาง)', { cls: 'sr-span2' })}
          </div></div>` : ''}
        <div class="sr-section"><h4>เอกสาร / ภาพการส่งหมาย (แนบท้ายไฟล์ Word)</h4>
          <div class="sr-photos" id="rf_photos">${photoHtml}</div>
          <div class="sr-grid sr-g3" style="margin-top:10px">
            ${[1, 2, 3].map((n) => `<div class="sr-field"><label>ชื่อเอกสาร / ภาพเพิ่มเติม ${n}</label><input class="sr-input" type="file" accept="image/jpeg,image/png,image/webp" data-extra="${n}"></div>`).join('')}
          </div></div>
      </div>
      <div class="sr-dialog-foot">
        <span class="sr-muted" id="rf_status">${it.report_status === 'none' ? 'ยังไม่เคยบันทึก' : 'บันทึกล่าสุด ' + esc(it.reported_at ? new Date(it.reported_at).toLocaleString('th-TH') : '')}</span>
        <span class="grow"></span>
        <button class="sr-btn" data-act="clear"><i class="fa-solid fa-eraser"></i> ล้าง</button>
        <button class="sr-btn" data-act="save"><i class="fa-solid fa-floppy-disk"></i> บันทึก</button>
        <button class="sr-btn accent" data-act="print"><i class="fa-solid fa-print"></i> พิมพ์ปิดหมาย</button>
        <button class="sr-btn primary" data-act="saveprint"><i class="fa-solid fa-file-word"></i> บันทึกและพิมพ์</button>
      </div></div>`;
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    const close = () => { wrap.remove(); document.body.style.overflow = ''; };
    const g = (k) => wrap.querySelector('#rf_' + k);

    let touchedRc = false;
    // วันที่ส่งหมาย: ตามภาพที่ติ๊กเลือก / ไฟล์ภาพที่แนบเพิ่ม (จนกว่าจะแก้เอง)
    let touchedServe = Boolean(it.report && it.report.serve_date);
    const sd = g('serve_date');
    if (sd) sd.addEventListener('input', () => { touchedServe = true; });
    const setServe = (d, why) => {
      if (!sd || touchedServe || !d || isNaN(d)) return;
      sd.value = L.toIso(d);
      sd.title = why || '';
      sd.style.background = '#ecfeff'; setTimeout(() => { sd.style.background = ''; }, 1500);
    };
    wrap.addEventListener('change', async (e) => {
      const el = e.target;
      if (el.matches && el.matches('input[data-photo]') && el.checked) {
        const p = sheetRows().map(photoFromRow).find((x) => x && x.id === el.dataset.photo);
        if (p && p.time) setServe(new Date(p.time), 'จากภาพส่งหมายที่เลือก');
      }
      if (el.matches && el.matches('input[data-extra]') && el.files && el.files[0] && window.SLTS && SLTS.geo && SLTS.geo.readPhotoDate) {
        try { const r = await SLTS.geo.readPhotoDate(el.files[0]); if (r && r.source !== 'file') setServe(r.date, 'จากวันที่ในภาพที่แนบ'); } catch (_) {}
      }
    });
    const refresh = () => {
      const code = g('result_code').value; const notice = L.isNoticeResult(code);
      wrap.querySelector('#rf_tpl').textContent = 'แบบ: ' + L.TEMPLATE_LABELS[L.templateFor(it.kind, code)];
      $$('.rf-normal', wrap).forEach((el) => { el.style.display = notice ? 'none' : ''; });
      $$('.rf-notice', wrap).forEach((el) => { el.style.display = notice ? '' : 'none'; });
      const paid = g('money_type').value === 'paid';
      $$('.rf-paid', wrap).forEach((el) => { el.style.display = paid ? '' : 'none'; });
      { // วันที่รับเงิน (ใบสำคัญรับเงิน): ใช้เฉพาะหมายเงิน — หมายฟรีปิดไว้และไม่กรอกวันที่
        const rd = g('receipt_date');
        if (rd) {
          rd.disabled = !paid;
          rd.title = paid ? '' : 'หมายฟรีไม่ต้องระบุวันที่รับเงิน';
          if (!paid) rd.value = ''; else if (!rd.value) rd.value = L.todayIso();
        }
      }
      $$('.rf-free', wrap).forEach((el) => { el.style.display = paid ? 'none' : ''; });
      g('claim_box').style.display = paid ? 'none' : '';
      {
        const ef = ((wrap.querySelector('input[name="rf_rcpt_type"]:checked') || {}).value) === 'efiling';
        wrap.querySelector('#rcBookPre').style.display = ef ? '' : 'none';
        wrap.querySelector('#rcNoPre').style.display = ef ? '' : 'none';
        const bi = g('rcpt_book_in'); const ni = g('rcpt_no_in');
        bi.maxLength = ef ? 4 : 7; ni.maxLength = ef ? 6 : 7;
        bi.placeholder = ef ? String(L.fiscalYearBE(new Date())) : 'เช่น 97335'; ni.placeholder = ef ? '000912' : 'เช่น 310';
        const n = L.normReceipt(ef ? 'efiling' : 'pink', bi.value, ni.value);
        const doc = L.receiptDocText(n.type, n.book, n.no);
        const last = ((R.boot && R.boot.rcptLast) || {})[n.type];
        wrap.querySelector('#rcHint').innerHTML = `${n.book || n.no ? `บนใบเสร็จ: <b>${ef ? 'เล่มที่ ' + esc(n.book) + ' เลขที่ ' + esc(n.no) : 'เล่มที่ ' + esc(n.book) + ' เลขที่ ' + esc(n.no)}</b> · ในแบบรายงาน: <b>${esc(doc)}</b>` : 'กรอกเล่มที่และเลขที่ใบเสร็จ'}`
          + `${v.rcpt_hint && !touchedRc ? ` · <span style="color:#b45309">${esc(v.rcpt_hint)} — ตรวจกับใบเสร็จจริง</span>` : ''}${last ? ` · ล่าสุดของคุณ (${ef ? 'e-Filing' : 'ชมพู'}): ${esc(last.book)} / ${esc(last.no)}` : ''}`
          + `${L.isEfilingCase(it) !== ef ? ` <span class="sr-chip warn">เลขคดีนี้ปกติใช้ใบเสร็จ${L.isEfilingCase(it) ? ' e-Filing' : 'ชมพู'}</span>` : ''}`;
      }
      if (!paid && it.money_type !== 'paid') {
        const mode = (wrap.querySelector('input[name="rf_claim"]:checked') || {}).value || 'none';
        const p = claimPlan(claimScope(it), { id: it.id, fc: { mode, at: claimChoice(it).at || new Date().toISOString() } }).get(it.id);
        const h = p && p.blockedBy ? R.issued.find((x) => x.id === p.blockedBy) : null;
        g('claim_rule').innerHTML = h ? `<span style="color:#b45309">บ้านเลขที่ หมู่ ตำบล อำเภอ จังหวัดเดียวกับ ${esc(claimLabel(h))} ซึ่งเบิกแล้ว — เบิกได้หมายเดียว</span>`
          : p && p.eff === 'half' ? (p.villageCount >= 2 ? `หมู่บ้านเดียวกันเบิก ${p.villageCount} หมาย → เบิกครึ่งหนึ่งทุกหมาย (อัตราเต็ม ${L.money2(p.base)})` : `เลือกเบิกครึ่งหนึ่ง (อัตราเต็ม ${L.money2(p.base)})`)
          : p && p.eff === 'full' ? `เบิกเต็มอัตรา ${L.money2(p.base)} บาท — ถ้าเลือกเบิกหมายอื่นในหมู่บ้านเดียวกันเพิ่ม จะปรับเป็นครึ่งหนึ่งทั้งหมด` : '';
      }
      const claim = ((wrap.querySelector('input[name="rf_claim"]:checked') || {}).value || 'none') !== 'none';
      const r = collect();
      const m = L.computeMoney(r);
      g('money_preview').innerHTML = paid
        ? `<b>หมายเงิน</b> ค่าบริการส่งครั้งนี้ <b>${L.money2(m.amount)}</b> บาท (${esc(L.bahtText(m.amount))}) · โดยตัดจ่ายจากเงินของ: <b>${esc(m.source1 || '— ระบุใบเสร็จ —')}</b>${it.kind === 'T' ? ` · ใบสำคัญรับเงิน: ตัดจ่ายจากเงินของ <b>${esc(m.source2 || '—')}</b>` : ''}`
        : (claim ? `<b>หมายฟรี — เบิก</b> ค่าบริการส่งครั้งนี้ <b>${L.money2(m.amount)}</b> บาท (${esc(L.bahtText(m.amount))}) · โดยตัดจ่ายจากเงินของ <b>เงินงบประมาณ</b>${m.amount ? '' : ' <span class="sr-chip red">ไม่พบอัตราหมายฟรีของตำบลนี้ — กรุณากรอกจำนวนเงิน</span>'}`
          : '<b>หมายฟรี — ไม่เบิก</b> ช่องจำนวนเงิน, "โดยตัดจ่ายจากเงินของ" และจำนวนเงินตัวหนังสือ จะเว้นว่างไว้');
    };
    function collect() {
      const r = Object.assign({}, v);
      $$('[id^="rf_"]', wrap).forEach((el) => {
        const k = el.id.slice(3);
        if (el.tagName === 'DATALIST' || !(k in v || ['inspector_id', 'payer_id', 'inspector_acting'].includes(k))) return;
        r[k] = el.type === 'checkbox' ? el.checked : el.value;
      });
      r.result_text = L.resultText(r.result_code);
      if (r.file_type === 'court') { r.court_note = r.resend_to; }
      {
        const t = ((wrap.querySelector('input[name="rf_rcpt_type"]:checked') || {}).value) === 'efiling' ? 'efiling' : 'pink';
        const n = L.normReceipt(t, g('rcpt_book_in').value, g('rcpt_no_in').value);
        r.rcpt_type = t; r.rcpt_book = n.book; r.rcpt_no = n.no;
        r.receipt_ref = L.receiptDocText(t, n.book, n.no);
        delete r.rcpt_hint;
      }
      r.claim_mode = (wrap.querySelector('input[name="rf_claim"]:checked') || {}).value || 'none';
      r.claim = r.claim_mode !== 'none';
      r.posting_choice = (wrap.querySelector('input[name="rf_posting"]:checked') || {}).value || '2';
      r.claim_amount = Number(r.claim_amount) || 0; r.amount = Number(r.amount) || 0;
      const insp = signers('inspector').find((s) => String(s.id) === String(r.inspector_id));
      r.inspector_name = insp ? insp.full_name : '';
      const pay = signers('payer').find((s) => String(s.id) === String(r.payer_id));
      r.payer_name = pay ? pay.full_name : '';
      r.photo_ids = $$('input[data-photo]', wrap).filter((x) => x.checked).map((x) => x.dataset.photo);
      r.kind = it.kind;
      return r;
    }
    wrap.addEventListener('input', (e) => {
      if (e.target.id === 'rf_rcpt_book_in' || e.target.id === 'rf_rcpt_no_in') {
        touchedRc = true;
        const c = e.target.value.replace(/[๐-๙]/g, (x) => '๐๑๒๓๔๕๖๗๘๙'.indexOf(x)).replace(/\D+/g, '');
        if (c !== e.target.value) e.target.value = c;
      }
      refresh();
    });
    wrap.addEventListener('focusout', (e) => {
      const ef = ((wrap.querySelector('input[name="rf_rcpt_type"]:checked') || {}).value) === 'efiling';
      if (ef && e.target.id === 'rf_rcpt_no_in' && e.target.value) { e.target.value = e.target.value.padStart(6, '0'); refresh(); }
    });
    wrap.addEventListener('click', (e) => {
      if (!e.target.closest('#rcNext')) return;
      const ef = ((wrap.querySelector('input[name="rf_rcpt_type"]:checked') || {}).value) === 'efiling';
      const d0 = receiptDefaults(Object.assign({}, it, ef ? { kind: 'LOCAL', t_no: '', black_no: 'E' } : { kind: 'T' }), '');
      if (d0.rcpt_book) g('rcpt_book_in').value = d0.rcpt_book.replace(/\D+/g, '');
      g('rcpt_no_in').value = String(d0.rcpt_no || '').replace(/\D+/g, '');
      if (!d0.rcpt_no) toast('info', 'ยังไม่มีเลขล่าสุดของใบเสร็จแบบนี้ — กรอกเลขที่เอง');
      touchedRc = true; refresh();
    });
    wrap.addEventListener('change', (e) => {
      if (e.target.id === 'rf_inspector_id') {
        const s = signers('inspector').find((x) => String(x.id) === e.target.value);
        if (s) { g('inspector_position').value = s.position; g('inspector_acting').checked = !!s.acting; g('inspector_title').value = s.acting_title || settings().director_title || ''; }
      }
      if (e.target.id === 'rf_payer_id') {
        const s = signers('payer').find((x) => String(x.id) === e.target.value);
        if (s) g('payer_position').value = s.position;
      }
      if (e.target.id === 'rf_district' && !g('postcode').value) g('postcode').value = L.postcodeFor(e.target.value);
      if (e.target.name === 'rf_rcpt_type') {
        touchedRc = true;
        const t = e.target.value;
        const last = ((R.boot && R.boot.rcptLast) || {})[t];
        if (t === 'efiling') {
          const fy = String(L.fiscalYearBE(new Date()));
          g('rcpt_book_in').value = fy;
          g('rcpt_no_in').value = last && last.book === 'D' + fy ? L.nextReceiptNo(t, last.no).replace(/\D+/g, '') : '';
        } else {
          g('rcpt_book_in').value = last ? String(last.book).replace(/\D+/g, '') : '';
          g('rcpt_no_in').value = last ? L.nextReceiptNo(t, last.no) : '';
        }
      }
      if (e.target.name === 'rf_claim' && it.money_type !== 'paid') {
        const p = claimPlan(claimScope(it), { id: it.id, fc: { mode: e.target.value, at: claimChoice(it).at || new Date().toISOString() } }).get(it.id);
        if (p && p.base) g('claim_amount').value = p.amount;
      }
      refresh();
    });
    wrap.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) return close();
      const z = e.target.closest('[data-zoom]'); if (z) { e.preventDefault(); return viewPhoto(z.dataset.zoom); }
      const add = e.target.closest('[data-add-signer]');
      if (add) {
        const kind = add.dataset.addSigner;
        const created = await signerDialog({ kind });
        if (created) {
          await ensureBoot(true);
          const sel = g(kind + '_id'); sel.innerHTML = `<option value="">— เลือก —</option>${signerOptions(kind, created)}`;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return;
      }
      const act = e.target.closest('[data-act]'); if (!act) return;
      const r = collect();
      if (act.dataset.act === 'clear') {
        const ok = await Swal.fire({ icon: 'question', title: 'ล้างข้อมูลที่กรอก?', text: 'กลับไปใช้ค่าเริ่มต้นจากบัญชีจ่ายหมาย', showCancelButton: true, confirmButtonText: 'ล้าง', cancelButtonText: 'ยกเลิก' });
        if (ok.isConfirmed) { close(); openReportForm(id, { reset: true }); }
        return;
      }
      const problems = validate(r);
      if (problems.length && act.dataset.act !== 'save') {
        const ok = await Swal.fire({ icon: 'warning', title: 'ข้อมูลยังไม่ครบ', html: problems.map(esc).join('<br>') + '<br><br>ต้องการพิมพ์ต่อหรือไม่?', showCancelButton: true, confirmButtonText: 'พิมพ์ต่อ', cancelButtonText: 'กลับไปแก้ไข' });
        if (!ok.isConfirmed) return;
      }
      // จำค่าที่ใช้บ่อย
      LS.set(profileKey(), Object.assign(profile(), { name: r.reporter_name, position: r.reporter_position }));
      if (r.origin_court) LS.set('sr_origin_courts', Array.from(new Set([r.origin_court, ...LS.get('sr_origin_courts', [])])).slice(0, 40));
      try {
        if ((act.dataset.act === 'save' || act.dataset.act === 'saveprint') && r.money_type !== 'paid') {
          const res = await setFreeClaim(it, r.claim_mode || 'none');
          if (!res) return;
          if (res.base) r.claim_amount = res.amount; // ไม่พบอัตรา → ใช้จำนวนที่กรอกเอง
          r.claim = res.mode !== 'none'; r.claim_mode = res.mode;
        }
        if (act.dataset.act === 'save' || act.dataset.act === 'saveprint') {
          const out = await api('sr_report_save', { id: it.id, report: stripReport(r), status: act.dataset.act === 'saveprint' ? 'printed' : 'saved' });
          it.report = stripReport(r); it.report_status = out.report_status; it.reported_at = new Date().toISOString();
          if (out.rcptLast && R.boot) R.boot.rcptLast = out.rcptLast;
          toast('success', 'บันทึกรายงานผลหมายแล้ว');
        }
        if (act.dataset.act === 'print' || act.dataset.act === 'saveprint') {
          const extra = $$('input[data-extra]', wrap).map((x) => x.files && x.files[0]).filter(Boolean);
          await generateWord(it, r, extra);
        }
        if (act.dataset.act !== 'print') { close(); if (R.sub === 'issued' && $('#srRows')) fillIssuedRows(); if (R.sub === 'flow') renderFlow(); refreshStats(); refreshUploadsCard(); }
      } catch (er) { done(); fail(er); }
    });
    refresh();
  }
  /** เก็บเฉพาะค่าที่กรอก (ไม่เก็บซ้ำข้อมูลพื้นฐานที่อยู่ในบัญชีจ่ายหมายแล้ว) */
  function stripReport(r) {
    const o = Object.assign({}, r);
    delete o.kind;
    return o;
  }
  function validate(r) {
    const p = [];
    if (!r.serve_date) p.push('• ยังไม่ได้ระบุวันที่ส่งหมาย');
    if (!r.result_code) p.push('• ยังไม่ได้เลือกผลการส่งหมาย');
    if (!r.reporter_position) p.push('• ยังไม่ได้ระบุตำแหน่งผู้บันทึกผลหมาย');
    if (!r.inspector_name) p.push('• ยังไม่ได้เลือกผู้ตรวจ');
    if (!r.payer_name) p.push('• ยังไม่ได้เลือกผู้จ่ายเงิน');
    if (r.kind === 'T' && !r.origin_court) p.push('• ยังไม่ได้ระบุศาลต้นทาง (หมาย ต.)');
    if (r.money_type === 'paid' && !r.amount) p.push('• หมายเงินยังไม่มีค่าบริการ');
    if (r.money_type === 'paid' && (!r.rcpt_book || !r.rcpt_no)) p.push('• หมายเงินยังไม่ได้กรอกเล่มที่/เลขที่ใบเสร็จ');
    if (r.money_type !== 'paid' && r.claim && !r.claim_amount) p.push('• หมายฟรีที่เบิกยังไม่มีอัตราเงิน');
    if (!(r.photo_ids || []).length) p.push('• ไม่มีภาพการส่งหมาย (เอกสารจะไม่มีภาพแนบท้าย)');
    return p;
  }

  /** สร้างไฟล์ Word จากแม่แบบ + ภาพแนบท้าย แล้วดาวน์โหลด */
  async function buildWord(it, r, extraFiles) {
    const name = L.templateFor(it.kind, r.result_code);
    const tpl = await template(name);
    const imgs = [];
    for (const pid of r.photo_ids || []) { const im = await photoBytes(pid); if (im) imgs.push(im); }
    for (const f of extraFiles || []) imgs.push(await normalizeImage(f));
    const data = L.buildDocData(Object.assign({}, it, r, { kind: it.kind }), { arabic: arabicDocs() });
    const selPh = (r.photo_ids || []).map((pid) => sheetRows().map(photoFromRow).find((x) => x && x.id === pid)).find(Boolean) || photosForIssued(it)[0];
    return { blob: await DOCX.fillReportDocx(tpl, data, imgs), fileName: L.docFileName(Object.assign({}, it, r), selPh && selPh.caseNo) };
  }
  async function generateWord(it, r, extraFiles) {
    busy('กำลังสร้างไฟล์ Word...');
    try {
      const { blob, fileName } = await buildWord(it, r, extraFiles);
      done(); downloadBlob(blob, fileName);
      toast('success', 'ดาวน์โหลดไฟล์ Word แล้ว');
    } catch (e) { done(); throw e; }
  }
  async function quickWord(id) {
    const it = R.issued.find((x) => x.id === id);
    if (!it || !it.report) return openReportForm(id);
    try { await generateWord(it, defaultsFor(it)); } catch (e) { fail(e); }
  }
  async function bulkWord(ids) {
    const list = ids.map((id) => R.issued.find((x) => x.id === id)).filter(Boolean);
    const notReady = list.filter((x) => !x.report);
    if (notReady.length) {
      const ok = await Swal.fire({ icon: 'info', title: `มี ${notReady.length} รายการยังไม่ได้กรอกรายงาน`, text: 'รายการเหล่านี้จะใช้ค่าเริ่มต้นจากบัญชีจ่ายหมาย (ตรวจทานก่อนส่งศาล)', showCancelButton: true, confirmButtonText: 'สร้างทั้งหมด', cancelButtonText: 'ยกเลิก' });
      if (!ok.isConfirmed) return;
    }
    busy(`กำลังสร้างไฟล์ Word ${list.length} รายการ...`);
    try {
      const zip = new window.JSZip(); const names = new Set();
      for (let i = 0; i < list.length; i++) {
        Swal.update({ title: `กำลังสร้างไฟล์ Word (${i + 1}/${list.length})...` }); Swal.showLoading();
        const { blob, fileName } = await buildWord(list[i], defaultsFor(list[i]));
        let n = fileName; let k = 2; while (names.has(n)) n = fileName.replace(/\.docx$/, `(${k++}).docx`); names.add(n);
        zip.file(n, blob);
      }
      const out = await zip.generateAsync({ type: 'blob' });
      done(); downloadBlob(out, `รายงานผลหมาย_${L.todayIso()}.zip`);
    } catch (e) { done(); fail(e); }
  }

  // ==================================================================
  // 0) รายงานหมาย — ทำทีละขั้นตอน
  //    ① โซนจ่ายหมาย + ช่วงเวลา (จันทร์สัปดาห์ก่อน → ศุกร์สัปดาห์นี้)
  //    ② ภาพส่งหมายในโซน (ถ่ายจากแอป/อัปโหลดจากมือถือ แท็บเล็ต PC) — ไม่มี → ไปหน้าอัปโหลด
  //    ③ นำเข้าบัญชีจ่ายหมาย (Excel) → ตรวจความครบถ้วน
  //    ④ สร้างแบบรายงานหมาย (Word) ทีละรายการ/ทั้งหมด
  // ==================================================================
  const FL = { weekOffset: 0, viewZone: '', all: false, checkedAt: 0 };
  const ADDR = () => (typeof THAILAND_ADDRESS_DATA !== 'undefined' ? THAILAND_ADDRESS_DATA : (window.THAILAND_ADDRESS_DATA || {}));
  const PROVINCES = () => (typeof THAILAND_PROVINCES !== 'undefined' ? THAILAND_PROVINCES.map((p) => p.name) : Object.keys(ADDR()));
  /** จังหวัดที่ตั้งค่าไว้ (จังหวัดของผู้ใช้ → จังหวัดที่เลือกในระบบ → อุดรธานี) */
  const defaultProvince = () => {
    const u = currentUser(); const st = appState();
    return String((u && (u.province || u.assignedProvince || u.assigned_province)) || (st && st.selectedProvince) || localStorage.getItem('slts_selected_province') || 'อุดรธานี').replace(/^จ(\.|ังหวัด)\s*/, '');
  };
  const zonePresets = () => (R.boot && R.boot.zonePresets) || [];
  const zoneState = () => (R.boot && R.boot.zone) || null;
  /** Pre-set ที่ศาลใช้งานอยู่ (ใช้ร่วมกันทุกคน) */
  const activePreset = () => { const id = R.boot && R.boot.activePresetId; return (id && zonePresets().find((p) => p.id === Number(id))) || null; };
  const staffList = () => (R.boot && R.boot.staff) || [];
  const rosterOf = (p) => (p && p.roster && p.roster.assign ? p.roster : null);
  /** โซนของฉันตามตารางผู้ส่ง (ตามที่บันทึกไว้ — ไม่เลื่อนเองจนกว่าจะยืนยัน) → { zone, role: 'sender'|'backup' } */
  function myRosterZone(groups, preset) {
    const r = rosterOf(preset); const me = myUser(); if (!r || !me) return null;
    // ยังไม่ได้จับคู่ username → เทียบชื่อในตารางกับชื่อของฉัน (จากบัญชีผู้ใช้)
    const mi = meInfo(); const meStaff = [{ username: me, name: mi.full || myName(), first_name: mi.first }];
    const isMe = (u, txt) => u === me || (!u && txt && (L.matchStaff(txt, meStaff) || {}).username === me);
    let z = groups.find((g) => r.assign[g.key] && isMe(r.assign[g.key].sender_username, r.assign[g.key].sender));
    if (z) return { zone: z, role: 'sender' };
    z = groups.find((g) => r.assign[g.key] && isMe(r.assign[g.key].backup_username, r.assign[g.key].backup));
    return z ? { zone: z, role: 'backup' } : null;
  }
  const zoneInfoOf = (it) => ({ district: it.district, subdistrict: it.subdistrict, moo: it.moo, text: [it.address_raw, it.recipient, it.summon_type].filter(Boolean).join(' ') });
  const photoInfoOf = (p) => ({ district: p.district, subdistrict: p.subdistrict, moo: '', text: p.loc });
  const zoneGroups = (preset) => L.presetZones(preset || activePreset(), ADDR());
  const thDay = (d) => L.thaiDateShort ? L.thaiDateShort(L.dIso(d)) : L.dIso(d);
  const WD = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const thDayLong = (d) => `${WD[d.getDay()]}ที่ ${d.getDate()} ${L.THAI_MONTHS[d.getMonth() + 1]} ${d.getFullYear() + 543}`;

  /** รอบจ่ายหมายตามบัญชีจ่ายหมาย (Excel) = ช่วงวันที่ในหัวรายงาน → [{ key, start, end, items }] ล่าสุดก่อน */
  function issuedPeriods() {
    const m = new Map();
    const me = myUser();
    R.issued.forEach((it) => {
      if (!it.period_start && !it.period_end) return;
      if (!(FL.all && isAdmin()) && me && it.owner && it.owner !== me) return; // บัญชีจ่ายหมายของฉัน
      const k = `${it.period_start || it.period_end}|${it.period_end || it.period_start}`;
      if (!m.has(k)) m.set(k, { key: k, start: it.period_start || it.period_end, end: it.period_end || it.period_start, items: [] });
      m.get(k).items.push(it);
    });
    return [...m.values()].sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0));
  }
  function flowData() {
    const preset = activePreset();
    const groups = zoneGroups();
    const roster = rosterOf(preset);
    const mine = myRosterZone(groups, preset);
    // โซนปัจจุบัน: ตามตารางผู้ส่ง (ยืนยันการเลื่อนแล้ว) → ถ้าไม่อยู่ในตาราง ใช้โซนส่วนตัวแบบหมุนเวียนเดิม
    const st = zoneState();
    const personal = !mine && st && (!st.preset_id || Number(st.preset_id) === (preset && preset.id)) ? L.currentZone(st, groups, new Date()) : null;
    const cur = mine ? { zone: mine.zone, role: mine.role, roster: true } : personal;
    const rs = roster ? L.rosterStatus(roster, new Date()) : null;
    const cal = L.reportWindow(new Date(), FL.weekOffset);
    // ช่วงเวลา 2 สัปดาห์: ยึดช่วงวันที่จ่ายหมายในบัญชีจ่ายหมาย (Excel) เป็นหลัก — ยังไม่นำเข้า → ใช้ช่วงปฏิทินชั่วคราว
    const periods = issuedPeriods();
    const recentIso = L.dIso(new Date(Date.now() - 21 * 864e5));
    let per = null;
    if (FL.periodKey === 'cal') per = null;
    else if (FL.periodKey) per = periods.find((p) => p.key === FL.periodKey) || null;
    else per = periods.find((p) => p.end >= cal.startIso && p.start <= cal.endIso) || (FL.weekOffset === 0 ? periods.find((p) => p.end >= recentIso) : null) || null;
    let win = cal;
    if (per) {
      const st = L.parseIso(per.start); const en = L.parseIso(per.end);
      // ภาพส่งหมาย: ตั้งแต่วันแรกที่จ่ายหมาย ถึง 14 วันหลังวันสุดท้าย (เวลาออกส่งหมาย) แต่ไม่เกินวันนี้
      const photoTo = Math.min(en.getTime() + 15 * 864e5 - 1, Date.now() + 864e5);
      win = { start: st, end: en, startIso: per.start, endIso: per.end, from: st.getTime(), to: photoTo, fromExcel: true };
    }
    // โซนตามบัญชีจ่ายหมาย: นับว่ารายการในรอบนี้อยู่ในโซนใดมากที่สุด
    let detected = null; let detectedCount = 0; let outside = []; let breakdown = [];
    if (per && groups.length) {
      const cnt = new Map();
      per.items.forEach((it) => {
        const z = L.zoneFor(groups, zoneInfoOf(it));
        if (z) cnt.set(z.key, (cnt.get(z.key) || 0) + 1); else outside.push(it);
      });
      cnt.forEach((n, k) => { if (n > detectedCount) { detectedCount = n; detected = groups.find((g) => g.key === k); } });
      breakdown = [...cnt.entries()].sort((x, y) => y[1] - x[1]).map(([k, n]) => ({ zone: groups.find((g) => g.key === k), n }));
    }
    const zone = (FL.viewZone && groups.find((z) => z.key === FL.viewZone)) || detected || (cur && cur.zone) || null;
    // บัญชีจ่ายหมายของฉันอาจมีหมายหลายโซน (เช่น ช่วงเปลี่ยนโซน) → แสดงทุกรายการในบัญชี เว้นแต่เลือกดูโซนเดียว
    const scope = new Set(FL.viewZone || !per ? (zone ? [zone.key] : []) : breakdown.map((b) => b.zone.key));
    const inScope = (z) => Boolean(z) && scope.has(z.key);
    const me = myUser();
    const seen = new Set();
    const uploads = !zone ? [] : sheetRows().map(photoFromRow).filter(Boolean)
      .filter((p) => (FL.all && isAdmin()) || !me || p.uploader === me)
      .filter((p) => p.time >= win.from && p.time <= win.to)
      .filter((p) => { const z = L.zoneFor(groups, photoInfoOf(p)); return z ? inScope(z) : L.inZone(zone, p.district, p.subdistrict, p.loc); })
      .filter((p) => (seen.has(p.id) ? false : seen.add(p.id)))
      .sort((a, b) => a.time - b.time);
    const overlap = (it) => (!it.period_end || it.period_end >= win.startIso) && (!it.period_start || it.period_start <= win.endIso);
    const issued = !zone ? [] : (per && !FL.viewZone ? per.items : (per ? per.items : R.issued.filter(overlap)).filter((it) => inScope(L.zoneFor(groups, zoneInfoOf(it)))))
      .sort((a, b) => (a.seq || 0) - (b.seq || 0));
    const recentBatch = per ? (R.batches || []).find((b) => b.period_start === per.start && b.period_end === per.end) || (R.batches || [])[0] : (R.batches || []).find((b) => new Date(b.created_at).getTime() >= cal.from);
    // จับคู่ภาพ ↔ บัญชีจ่ายหมาย
    const photoMap = new Map();
    issued.forEach((it) => photoMap.set(it.id, photosForIssued(it).filter((p) => p.time >= win.from - 14 * 864e5)));
    const orphan = uploads.filter((p) => !issued.some((it) => (photoMap.get(it.id) || []).some((x) => x.id === p.id)));
    const withPhoto = issued.filter((it) => (photoMap.get(it.id) || []).length);
    const noPhoto = issued.filter((it) => !(photoMap.get(it.id) || []).length);
    const reported = issued.filter((it) => it.report_status && it.report_status !== 'none');
    // โซนที่ควรเป็นของฉันในรอบจ่ายหมายนี้ (ตามตารางผู้ส่ง + การเลื่อนทุก 2 สัปดาห์)
    const expected = per && roster && mine && mine.role === 'sender' ? L.userZoneAt(groups, roster, myUser(), per.end) : null; // บัญชีจ่ายหมายออกล่วงหน้า → เทียบกับวันสุดท้ายของรอบ
    return { preset, roster, rs, mine, groups, cur, expected, breakdown, zone, win, cal, per, periods, detected, detectedCount, outside, uploads, issued, recentBatch, photoMap, orphan, withPhoto, noPhoto, reported };
  }

  function stepHead(n, title, state, sub) {
    const ic = state === 'done' ? '<i class="fa-solid fa-check"></i>' : state === 'lock' ? '<i class="fa-solid fa-lock"></i>' : n;
    return `<div class="sr-step-head"><span class="sr-step-no ${state}">${ic}</span><div><div class="sr-step-title">${title}</div>${sub ? `<div class="sr-muted">${sub}</div>` : ''}</div></div>`;
  }

  async function renderFlow(body) {
    body = body || $('#srBody'); if (!body) return;
    if (!sheetRows().length) { body.innerHTML = '<div class="sr-card"><div class="sr-empty"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลดภาพส่งหมาย...</div></div>'; await ensureSheetRows(); }
    if (!R.loadedIssued) await loadIssued().catch(() => {});
    if (R.sub !== 'flow') return;
    // ถึงรอบเลื่อนผู้ส่ง (สัปดาห์ที่ 3) → ถามก่อนเลื่อน วันละครั้ง
    if (!FL.prompting && !FL.promptedOnce) { FL.promptedOnce = true; FL.prompting = true; try { await maybePromptShift(); } catch (_) {} finally { FL.prompting = false; } if (R.sub !== 'flow') return; }
    const D = flowData();
    const { zone, cur, win } = D;
    const blockNote = !cur ? '' : cur.roster
      ? `${cur.role === 'backup' ? 'คุณเป็นผู้ส่งสำรอง/แทนในโซนนี้' : 'คุณเป็นผู้ส่งประจำโซนนี้'} · รอบผู้ส่ง ${thDay(L.parseIso(D.roster.period_start))} – ${thDay(L.parseIso(D.roster.period_end))}`
      : `ใช้โซนนี้ตั้งแต่วันจันทร์ที่ ${thDay(cur.blockStart)} · เปลี่ยนเป็น <b>${esc(cur.nextZone.label)}</b> อัตโนมัติวันจันทร์ที่ ${thDay(cur.nextChange)}`;
    const s1done = Boolean(zone);
    const s2state = !s1done ? 'lock' : D.uploads.length ? 'done' : 'todo';
    const s3state = s2state !== 'done' ? 'lock' : (D.per && D.issued.length) ? 'done' : 'todo';
    const s4state = s3state === 'lock' || !D.issued.length ? 'lock' : D.reported.length >= D.issued.length ? 'done' : 'todo';
    const stepper = [['โซนและช่วงเวลา', s1done ? 'done' : 'todo'], ['ภาพส่งหมายในโซน', s2state], ['ตรวจกับบัญชีจ่ายหมาย', s3state], ['สร้างแบบรายงานหมาย', s4state]]
      .map(([t, st], i) => `<div class="sr-stepper-item ${st}"><span>${st === 'done' ? '<i class="fa-solid fa-check"></i>' : i + 1}</span>${t}</div>`).join('<i class="fa-solid fa-chevron-right sr-stepper-sep"></i>');

    // ① โซน + ช่วงเวลา (Pre-set ของศาล + ตารางผู้ส่งประจำโซน)
    const preset = D.preset;
    const presets = zonePresets();
    const senderOf = (z) => { const a = D.roster && D.roster.assign[z.key]; return a ? (a.sender || '') : ''; };
    const zoneOpts = D.groups.map((z) => `<option value="${esc(z.key)}" ${zone && z.key === zone.key ? 'selected' : ''}>โซน ${z.no}: ${esc(z.label)}${senderOf(z) ? ` — ${esc(senderOf(z))}` : ''}${cur && z.key === cur.zone.key ? ' (โซนของฉัน)' : ''}</option>`).join('');
    const prevHint = !D.per && cur && !cur.roster && !FL.viewZone && cur.blockStart.getTime() > win.from && D.groups.length > 1
      ? `<div class="sr-note" style="margin-top:10px"><i class="fa-solid fa-circle-info"></i> ช่วงรายงานนี้คาบเกี่ยวโซนก่อนหน้า — <a href="#" data-fl="viewprev">ดูรายการของ${esc(cur.prevZone.label)}</a></div>` : '';
    const areaText = (z) => (z.keywords || []).concat(z.areas.map((a) => (a.subdistrict ? `ต.${a.subdistrict}${a.moo === 'with' ? ' (มีหมู่)' : a.moo === 'without' ? ' (ไม่มีหมู่)' : ''}` : `อ.${a.district}`))).join(', ');
    // แจ้งถึงรอบเลื่อนผู้ส่ง (เข้าสัปดาห์ที่ 3) — ชะลอได้ระหว่างรายงานผล (ไม่เกินวันพุธ)
    const shiftNote = D.rs && D.rs.due ? `<div class="sr-note ${D.rs.afterReport ? 'warn' : ''}" style="margin-top:10px"><i class="fa-solid fa-arrows-rotate"></i>
        ถึงรอบเลื่อนผู้ส่งลง 1 โซนแล้ว (รอบใหม่เริ่มวันจันทร์ที่ ${thDay(D.rs.nextStart)}${D.rs.steps > 1 ? ` · ค้าง ${D.rs.steps} รอบ` : ''}) —
        ${D.rs.afterReport ? 'เลยช่วงรายงานผลของรอบเดิมแล้ว ควรเลื่อนโซน' : `ยังอยู่ในช่วงรายงานผลของรอบเดิม (ไม่เกินวันพุธที่ ${thDay(D.rs.reportUntil)}) จึงยังไม่เลื่อนจนกว่าจะยืนยัน`}
        · <a href="#" data-fl="shift">เลื่อนผู้ส่งตอนนี้</a> · บัญชีจ่ายหมายของโซนใหม่นำเข้าและตรวจได้ตามปกติ</div>` : '';
    let s1body;
    if (!presets.length) {
      s1body = `<div class="sr-note warn"><i class="fa-solid fa-map-location-dot"></i> ยังไม่ได้ตั้งค่าโซนจ่ายหมาย — นำเข้าไฟล์ Excel ตารางโซน (โซน / เขตตำบล/อำเภอ / ผู้ส่ง) หรือกำหนดเองว่าแต่ละโซนมีตำบล/อำเภอใดบ้าง</div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="sr-btn primary lg" data-fl="zimport"><i class="fa-solid fa-file-excel"></i> นำเข้าตารางโซนจาก Excel</button><button class="sr-btn lg" data-fl="zsettings"><i class="fa-solid fa-sliders"></i> ตั้งค่าโซนเอง</button></div>`;
    } else if (!preset) {
      s1body = `<div class="sr-note warn"><i class="fa-solid fa-map-location-dot"></i> ยังไม่ได้เลือก Pre-set โซนจ่ายหมายที่ศาลใช้งาน</div>
        <div style="margin-top:10px"><button class="sr-btn primary" data-fl="zsettings"><i class="fa-solid fa-sliders"></i> เลือก/ตั้งค่า Pre-set</button></div>`;
    } else if (!zone) {
      const pz = D.groups;
      s1body = `<div class="sr-note warn"><i class="fa-solid fa-user-clock"></i> ไม่พบชื่อของคุณในช่อง "ผู้ส่ง" ของตารางโซน "${esc(preset.name)}" — ให้ผู้ดูแลกำหนดชื่อผู้ส่งในตารางโซน หรือเลือกโซนที่รับผิดชอบเอง</div>
        <div class="sr-toolbar" style="margin-top:10px">
          <label class="sr-muted">โซนที่รับผิดชอบ</label><select class="sr-select" id="flZoneInit" style="max-width:360px">${pz.map((z) => `<option value="${esc(z.key)}">โซน ${z.no}: ${esc(z.label)}</option>`).join('')}</select>
          <label class="sr-muted">เริ่มวันจันทร์ที่</label><input type="date" class="sr-input" id="flAnchor" value="${L.dIso(L.mondayOf(new Date()))}">
          <button class="sr-btn primary" data-fl="zinit"><i class="fa-solid fa-check"></i> ใช้โซนนี้</button>
          <button class="sr-btn" data-fl="zsettings"><i class="fa-solid fa-sliders"></i> ตารางโซน/ผู้ส่ง</button></div>`;
    } else {
      const sender = senderOf(zone);
      s1body = `<div class="sr-flow-zone">
          <div class="sr-flow-box"><div class="sr-kicker">${FL.viewZone ? 'กำลังดูโซน' : D.detected ? 'โซนตามบัญชีจ่ายหมาย' : 'โซนจ่ายหมายของฉัน'} · โซน ${zone.no}/${D.groups.length}${sender ? ` · ผู้ส่ง: ${esc(sender)}` : ''}</div><div class="sr-flow-big">${esc(zone.label)}</div>
            ${areaText(zone) !== zone.label ? `<div class="sr-muted">${esc(areaText(zone))}</div>` : ''}
            <div class="sr-muted" style="margin-top:4px">${FL.viewZone ? '<a href="#" data-fl="backcur">กลับไปโซนตามบัญชีจ่ายหมาย/โซนของฉัน</a>' : D.detected ? `ตรวจจากบัญชีจ่ายหมาย (${D.per.items.length} รายการ): ${D.breakdown.map((b) => `โซน ${b.zone.no} ${esc(b.zone.label)} ${b.n}`).join(' · ')}${D.outside.length ? ` · นอกโซน ${D.outside.length}` : ''}${D.breakdown.length > 1 ? ' — แสดงทุกรายการในบัญชี (เลือก "ดูโซน" เพื่อกรอง)' : ''}` : blockNote}</div></div>
          <div class="sr-flow-box"><div class="sr-kicker">${win.fromExcel ? 'ช่วงวันที่จ่ายหมาย (ตามบัญชีจ่ายหมาย Excel)' : 'ช่วงเวลาเบื้องต้น (ยังไม่มีบัญชีจ่ายหมายของช่วงนี้)'}</div><div class="sr-flow-big">${thDay(win.start)} – ${thDay(win.end)}</div><div class="sr-muted">วัน${thDayLong(win.start)} ถึงวัน${thDayLong(win.end)}</div>
            ${win.fromExcel ? '<div class="sr-muted">ภาพส่งหมาย: ตั้งแต่วันแรกที่จ่ายหมาย ถึง 14 วันหลังวันสุดท้าย</div>' : '<div class="sr-muted">จันทร์สัปดาห์ก่อน – ศุกร์สัปดาห์นี้ · เมื่อนำเข้าบัญชีจ่ายหมายแล้วจะใช้ช่วงวันที่ใน Excel แทน</div>'}
            <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
              ${D.periods.length ? `<select class="sr-select" id="flPeriod" style="max-width:300px">${D.periods.map((p) => `<option value="${esc(p.key)}" ${D.per && D.per.key === p.key ? 'selected' : ''}>รอบจ่ายหมาย ${thDay(L.parseIso(p.start))} – ${thDay(L.parseIso(p.end))} (${p.items.length})</option>`).join('')}<option value="cal" ${!D.per ? 'selected' : ''}>ช่วงปฏิทิน (จันทร์สัปดาห์ก่อน – ศุกร์)</option></select>` : ''}
              ${!D.per ? `<button class="sr-btn sm" data-fl="wkprev"><i class="fa-solid fa-chevron-left"></i> สัปดาห์ก่อน</button>${FL.weekOffset ? '<button class="sr-btn sm" data-fl="wknow">สัปดาห์นี้</button>' : ''}<button class="sr-btn sm" data-fl="wknext" ${FL.weekOffset >= 0 ? 'disabled' : ''}>สัปดาห์ถัดไป <i class="fa-solid fa-chevron-right"></i></button>` : ''}</div></div>
        </div>
        ${D.detected && D.expected && !FL.viewZone && D.detected.key !== D.expected.key ? `<div class="sr-note warn" style="margin-top:10px"><i class="fa-solid fa-triangle-exclamation"></i> บัญชีจ่ายหมายรอบนี้เป็นของ <b>${esc(D.detected.label)}</b> แต่ตามตารางผู้ส่ง รอบวันที่นี้คุณอยู่ <b>${esc(D.expected.label)}</b> — ตรวจว่านำเข้าไฟล์ถูกคน/ถูกรอบ หรือ <a href="#" data-fl="zsettings">แก้ไขตารางผู้ส่ง</a></div>` : ''}
        ${D.per && D.outside.length ? `<div class="sr-note" style="margin-top:10px"><i class="fa-solid fa-circle-info"></i> มี ${D.outside.length} รายการในบัญชีจ่ายหมายรอบนี้ที่ไม่อยู่ในโซนใดของ Pre-set (${esc([...new Set(D.outside.map((it) => 'อ.' + (it.district || '?')))].slice(0, 6).join(', '))}) — ตรวจการตั้งค่าโซน หรือเลือก "ดูโซน" อื่น</div>` : ''}
        ${shiftNote}
        <div class="sr-toolbar" style="margin-top:12px">
          <span class="sr-muted">Pre-set: <b>${esc(preset.name)}</b></span>
          <label class="sr-muted">ดูโซน</label><select class="sr-select" id="flZone" style="max-width:380px">${zoneOpts}</select>
          ${FL.viewZone && !(cur && cur.roster) ? `<button class="sr-btn primary" data-fl="zsetview"><i class="fa-solid fa-thumbtack"></i> ใช้เป็นโซนของฉัน</button>` : ''}
          <button class="sr-btn" data-fl="zsettings"><i class="fa-solid fa-sliders"></i> ตารางโซน/ผู้ส่ง</button>
          ${isAdmin() ? `<label class="sr-muted" style="margin-left:auto"><input type="checkbox" id="flAll" ${FL.all ? 'checked' : ''}> แสดงภาพของผู้ใช้ทุกคน</label>` : ''}
        </div>${prevHint}`;
    }
    const s1 = `<div class="sr-card sr-step">${stepHead(1, 'โซนจ่ายหมายและช่วงเวลารายงาน', s1done ? 'done' : 'todo', 'โซนตามตารางโซน/ผู้ส่งของศาล (ผู้ส่งเลื่อนลง 1 โซนทุก 2 สัปดาห์ เมื่อยืนยัน) · ช่วงวันที่และโซนยืนยันจากบัญชีจ่ายหมาย (Excel) เป็นหลัก')}${s1body}</div>`;

    // ② ภาพส่งหมาย
    const upRows = D.uploads.map((p, i) => {
      const m = D.issued.filter((it) => (D.photoMap.get(it.id) || []).some((x) => x.id === p.id));
      return `<tr><td>${i + 1}</td><td><img class="sr-thumb" src="${esc(p.thumb)}" data-view="${esc(p.id)}" referrerpolicy="no-referrer" loading="lazy" alt=""></td>
        <td><b>${esc(p.caseNo || '-')}</b></td><td>${esc(p.loc)}</td><td style="white-space:nowrap">${esc(p.at)}</td>
        <td>${!D.issued.length ? '<span class="sr-muted">รอตรวจกับบัญชี</span>' : m.length ? m.map((it) => `<span class="sr-chip ok">${esc(it.kind === 'T' ? it.t_no : it.black_no)}</span>`).join(' ') : '<span class="sr-chip warn">ไม่พบในบัญชีจ่ายหมาย</span>'}</td>
        <td class="ctr"><button class="sr-btn sm" data-fl-dl="${esc(p.id)}" title="ดาวน์โหลดภาพ"><i class="fa-solid fa-download"></i></button></td></tr>`;
    }).join('');
    const s2 = `<div class="sr-card sr-step ${s2state === 'lock' ? 'locked' : ''}">${stepHead(2, 'ภาพส่งหมายในโซนนี้', s2state, 'ภาพที่ถ่ายจากแอปบนมือถือ และภาพที่อัปโหลดเองจากมือถือ แท็บเล็ต หรือ PC ภายในช่วงเวลารายงาน')}
      ${s2state === 'lock' ? '' : D.uploads.length ? `<div class="sr-toolbar"><span class="sr-chip ok">${D.uploads.length} ภาพ</span><span class="grow"></span>
          <button class="sr-btn" data-fl="refresh"><i class="fa-solid fa-rotate-right"></i> รีเฟรช</button>
          <button class="sr-btn" data-fl="upload"><i class="fa-solid fa-cloud-arrow-up"></i> อัปโหลดภาพเพิ่ม</button>
          <button class="sr-btn" data-fl="zip"><i class="fa-solid fa-file-zipper"></i> ดาวน์โหลดภาพทั้งหมด (.zip)</button></div>
        <div class="sr-scroll" style="margin-top:10px;max-height:380px"><table class="sr-table"><thead><tr><th>#</th><th>ภาพ</th><th>เลขคดี</th><th>สถานที่ส่งหมาย</th><th>วันที่/เวลา</th><th>บัญชีจ่ายหมาย</th><th class="ctr"></th></tr></thead><tbody>${upRows}</tbody></table></div>`
      : `<div class="sr-empty" style="padding:26px 10px"><i class="fa-regular fa-images" style="font-size:30px;color:#94a3b8"></i>
          <div style="font-size:16px;font-weight:700;color:var(--c-primary);margin-top:8px">ยังไม่มีภาพส่งหมายใน${esc(zone.label)} ช่วง ${thDay(win.start)} – ${thDay(win.end)}</div>
          <div class="sr-muted" style="margin:4px 0 14px">ภาพที่ถ่ายด้วยแอปบนมือถือจะขึ้นที่นี่อัตโนมัติ หรืออัปโหลดภาพเองได้จากหน้าบันทึกส่งหมาย</div>
          <button class="sr-btn primary lg" data-fl="upload"><i class="fa-solid fa-cloud-arrow-up"></i> ไปหน้าอัปโหลดภาพส่งหมาย</button>
          <button class="sr-btn lg" data-fl="refresh"><i class="fa-solid fa-rotate-right"></i> ตรวจสอบอีกครั้ง</button></div>`}
    </div>`;

    // ③ นำเข้าบัญชีจ่ายหมาย + ตรวจความครบถ้วน
    const chk = (label, n, cls, key) => `<div class="sr-flow-stat ${cls}" ${key ? `data-fl-show="${key}"` : ''}><b>${n}</b><span>${label}</span></div>`;
    const gapRows = (list, kind) => list.map((x) => kind === 'nophoto'
      ? `<tr><td><b>${esc(x.kind === 'T' ? x.t_no : x.black_no)}</b>${x.kind === 'T' ? ' <span class="sr-chip">หมาย ต.</span>' : ''}</td><td>${esc(x.summon_type)}</td><td>${esc(x.recipient)}</td><td>${esc(x.address_raw)} ต.${esc(x.subdistrict)} อ.${esc(x.district)}</td>
        <td class="ctr"><button class="sr-btn sm" data-fl-nophoto="${x.id}" title="บันทึกรายการส่งหมายโดยไม่มีภาพถ่าย เพื่อให้รายงานหมายได้"><i class="fa-solid fa-signature"></i> บันทึกโดยไม่มีภาพ</button></td></tr>`
      : `<tr><td><b>${esc(x.caseNo || '-')}</b></td><td colspan="2">${esc(x.loc)}</td><td>${esc(x.at)}</td></tr>`).join('');
    const s3 = `<div class="sr-card sr-step ${s3state === 'lock' ? 'locked' : ''}">${stepHead(3, 'นำเข้าบัญชีจ่ายหมาย (Excel) เพื่อตรวจความถูกต้องครบถ้วน', s3state, 'ไฟล์ "บัญชีจ่ายหมาย พนักงานศาลนี้ส่ง" จากระบบงานศาล (เลือกบัญชีใบเสร็จมาพร้อมกันได้) — นำเข้าทุกครั้งก่อนรายงาน')}
      ${s3state === 'lock' ? '<div class="sr-muted">ต้องมีภาพส่งหมายในโซนนี้ก่อน</div>' : `<div class="sr-toolbar">
          <button class="sr-btn primary" data-fl="import"><i class="fa-solid fa-file-excel"></i> ${D.recentBatch ? 'นำเข้าบัญชีจ่ายหมายอีกครั้ง' : 'นำเข้าบัญชีจ่ายหมาย (Excel)'}</button>
          <span class="sr-muted">${D.recentBatch ? `นำเข้าล่าสุด: ${esc(D.recentBatch.source_file || '-')} (${esc(new Date(D.recentBatch.created_at).toLocaleString('th-TH'))})` : 'ยังไม่ได้นำเข้าบัญชีจ่ายหมายในช่วงนี้'}</span></div>
        ${D.issued.length ? `<div class="sr-flow-stats">${chk('หมายในบัญชี (โซนนี้)', D.issued.length, '')}${chk('มีภาพส่งหมายแล้ว', D.withPhoto.length, 'ok')}${chk('ยังไม่มีภาพ', D.noPhoto.length, D.noPhoto.length ? 'warn' : 'ok', 'nophoto')}${chk('ภาพที่ไม่พบในบัญชี', D.orphan.length, D.orphan.length ? 'bad' : 'ok', 'orphan')}</div>
          ${D.noPhoto.length ? `<details class="sr-gap" ${FL.open === 'nophoto' ? 'open' : ''}><summary>หมายในบัญชีที่ยังไม่มีภาพส่งหมาย (${D.noPhoto.length})</summary><div class="sr-scroll" style="max-height:260px"><table class="sr-table"><thead><tr><th>เลขคดี</th><th>หมาย</th><th>ผู้รับ</th><th>ที่อยู่</th><th class="ctr"></th></tr></thead><tbody>${gapRows(D.noPhoto, 'nophoto')}</tbody></table></div>
            <div class="sr-muted" style="margin-top:6px">ถ้าส่งแล้วแต่ยังไม่อัปโหลดภาพ <a href="#" data-fl="upload">ไปหน้าอัปโหลดภาพ</a> — ถ้าไม่มีภาพถ่าย (เช่น ผู้รับเซ็นรับหมายเอง) กด <b>บันทึกโดยไม่มีภาพ</b></div></details>` : ''}
          ${D.orphan.length ? `<details class="sr-gap bad" ${FL.open === 'orphan' ? 'open' : ''}><summary>ภาพที่ไม่พบในบัญชีจ่ายหมาย (${D.orphan.length}) — ตรวจเลขคดีที่บันทึกตอนถ่ายภาพ</summary><div class="sr-scroll" style="max-height:220px"><table class="sr-table"><thead><tr><th>เลขคดี (จากภาพ)</th><th colspan="2">สถานที่</th><th>วันที่</th></tr></thead><tbody>${gapRows(D.orphan, 'orphan')}</tbody></table></div></details>` : ''}`
        : (D.recentBatch ? `<div class="sr-note warn" style="margin-top:10px"><i class="fa-solid fa-triangle-exclamation"></i> บัญชีจ่ายหมายที่นำเข้าไม่มีหมายของ${esc(zone.label)} ในช่วงนี้ — ตรวจว่าเลือกไฟล์ถูกช่วงวันที่/ถูกโซน</div>` : '')}`}
    </div>`;

    // ④ สร้างแบบรายงานหมาย
    // แผนการเบิกหมายฟรี (คำนวณต่อรอบบัญชีจ่ายหมาย)
    const planCache = new Map();
    const planOf = (it) => { const k = `${it.owner}|${it.period_start}|${it.period_end}`; if (!planCache.has(k)) planCache.set(k, claimPlan(claimScope(it))); return planCache.get(k).get(it.id); };
    let claimTotal = 0; let claimN = 0;
    const claimCell = (it) => {
      if (it.money_type === 'paid') {
        const rp = it.report || {};
        const ref = rp.rcpt_book ? L.receiptDocText(rp.rcpt_type, rp.rcpt_book, rp.rcpt_no) : L.receiptText(it.receipt_ref || '');
        return `หมายเงิน ${L.money2(it.price)}<div class="sr-muted">${ref ? esc(ref) + (rp.rcpt_type === 'efiling' ? ' <span class="sr-chip">e-Filing</span>' : '') : `<span class="sr-chip warn">ยังไม่มีใบเสร็จ${L.isEfilingCase(it) ? ' (e-Filing)' : ''}</span>`}</div>`;
      }
      const p = planOf(it); if (!p) return 'หมายฟรี';
      const decided = Boolean(claimChoice(it).mode);
      if (p.mode !== 'none') { claimTotal += p.amount; claimN += 1; }
      const h = p.blockedBy ? R.issued.find((x) => x.id === p.blockedBy) : null;
      const stale = it.report_status === 'printed' && it.report && it.report.claim !== false && p.mode !== 'none' && Number(it.report.claim_amount || 0) !== p.amount;
      return `<div style="white-space:nowrap">หมายฟรี</div>
        <select class="sr-select sr-claim-sel" data-fl-claim="${it.id}" ${h && p.mode === 'none' ? 'title="บ้านเดียวกันเบิกได้หมายเดียว"' : ''}>
          <option value="" ${!decided ? 'selected' : ''} disabled>— เลือกการเบิก —</option>
          <option value="none" ${decided && p.mode === 'none' ? 'selected' : ''}>ไม่เบิก</option>
          <option value="full" ${p.mode === 'full' ? 'selected' : ''} ${h ? 'disabled' : ''}>${p.mode === 'full' && p.eff === 'half' ? 'เบิก (ปรับเป็นครึ่งตามกฎหมู่บ้าน)' : 'เบิกเต็ม'}</option>
          <option value="half" ${p.mode === 'half' ? 'selected' : ''} ${h ? 'disabled' : ''}>เบิกครึ่งหนึ่ง</option></select>
        ${p.mode !== 'none' ? `<div class="sr-muted"><b style="color:#166534">${L.money2(p.amount)}</b>${p.eff === 'half' ? ` <span class="sr-chip warn" title="อัตราเต็ม ${L.money2(p.base)}">ครึ่ง${p.villageCount >= 2 ? ` · หมู่บ้านเดียวกัน ${p.villageCount}` : ''}</span>` : ''}${!p.base ? ' <span class="sr-chip red">ไม่พบอัตรา</span>' : ''}</div>` : ''}
        ${h ? `<div class="sr-muted" style="color:#b45309">บ้านเดียวกับที่ ${esc(h.seq || '-')} (เบิกแล้ว)</div>` : ''}
        ${stale ? '<div class="sr-chip red">ยอดเบิกเปลี่ยน — พิมพ์ใหม่</div>' : ''}`;
    };
    const repRows = D.issued.map((it) => {
      const ph = D.photoMap.get(it.id) || [];
      const st = it.report_status === 'printed' ? '<span class="sr-chip ok">พิมพ์แล้ว</span>' : it.report_status === 'saved' ? '<span class="sr-chip ok">บันทึกแล้ว</span>' : '<span class="sr-chip">ยังไม่รายงาน</span>';
      return `<tr><td>${esc(it.seq || '')}</td><td><b>${esc(it.kind === 'T' ? it.t_no : it.black_no)}</b>${it.kind === 'T' ? '<div class="sr-muted">หมาย ต.</div>' : ''}</td><td>${esc(it.summon_type)}</td><td>${esc(it.recipient)}</td>
        <td style="min-width:220px;max-width:340px">${locCell(it, ph)}</td>
        <td>${claimCell(it)}</td>
        <td>${ph.length ? `<img class="sr-thumb" src="${esc(ph[0].thumb)}" data-view="${esc(ph[0].id)}" referrerpolicy="no-referrer" loading="lazy" alt="">${ph.length > 1 ? ` <span class="sr-muted">+${ph.length - 1}</span>` : ''}` : '<span class="sr-muted">ไม่มีภาพ</span>'}</td>
        <td>${st}</td>
        <td class="ctr" style="white-space:nowrap"><button class="sr-btn sm primary" data-fl-rep="${it.id}"><i class="fa-solid fa-file-pen"></i> รายงานหมาย</button>
          ${it.report ? `<button class="sr-btn sm" data-fl-word="${it.id}" title="ดาวน์โหลด Word"><i class="fa-solid fa-file-word"></i></button>` : ''}</td></tr>`;
    }).join('');
    const pct = D.issued.length ? Math.round((D.reported.length / D.issued.length) * 100) : 0;
    const s4 = `<div class="sr-card sr-step ${s4state === 'lock' ? 'locked' : ''}">${stepHead(4, 'สร้างแบบรายงานหมาย (Word)', s4state, 'กด "รายงานหมาย" เพื่อกรอกผลการส่ง ภาพส่งหมายจะแนบท้ายเอกสารให้อัตโนมัติ')}
      ${s4state === 'lock' ? '<div class="sr-muted">นำเข้าบัญชีจ่ายหมายที่มีหมายของโซนนี้ก่อน</div>' : `<div class="sr-toolbar"><div class="sr-progress"><div style="width:${pct}%"></div></div><span><b>${D.reported.length}</b> / ${D.issued.length} รายการรายงานแล้ว</span><span class="sr-muted">· เบิกหมายฟรี <b>${claimN}</b> หมาย รวม <b>${L.money2(claimTotal)}</b> บาท</span><span class="grow"></span>
          <button class="sr-btn" data-fl="wordall" ${D.reported.length ? '' : 'disabled'}><i class="fa-solid fa-file-zipper"></i> ดาวน์โหลด Word ที่รายงานแล้ว (.zip)</button>
          <button class="sr-btn" data-fl="memo"><i class="fa-solid fa-file-invoice"></i> ทำบันทึกข้อความขออนุมัติเบิก</button></div>
        <div class="sr-scroll" style="margin-top:10px;max-height:560px"><table class="sr-table"><thead><tr><th>ที่</th><th>เลขคดี</th><th>หมาย</th><th>ผู้รับหมาย</th><th>ที่ตั้ง (บัญชี / <i class="fa-solid fa-camera"></i> ภาพ)</th><th style="min-width:150px">ประเภท / การเบิก</th><th>ภาพ</th><th>สถานะ</th><th class="ctr">จัดการ</th></tr></thead><tbody>${repRows}</tbody></table></div>`}
    </div>`;

    body.innerHTML = `<div class="sr-stepper">${stepper}</div>${s1}${s2}${s3}${s4}
      <div class="sr-muted" style="text-align:right;margin-top:4px"><a href="#" data-fl="legacy"><i class="fa-solid fa-route"></i> ดูรายการเส้นทางส่งหมายจากมือถือ (หน้าเดิม)</a></div>`;
    bindFlow(body, D);
  }

  async function setZone(zoneKey, anchorIso, presetId) {
    const r = await api('sr_zone_set', { preset_id: presetId || (activePreset() && activePreset().id), zone_key: zoneKey, anchor: anchorIso });
    if (R.boot) R.boot.zone = r.zone;
    FL.viewZone = '';
  }
  /**
   * บันทึกรายการส่งหมายโดยไม่มีภาพถ่าย (เช่น ผู้รับเซ็นรับหมายเอง) จากรายการในบัญชีจ่ายหมาย
   * → เข้าตารางประวัติส่งหมายเหมือนรายการที่มีภาพ เพื่อให้รายงานหมายได้ครบ
   */
  async function recordNoPhoto(it) {
    if (!it) return false;
    const caseNo = it.kind === 'T' && it.t_no ? it.t_no : it.black_no;
    const prov = String(it.province || defaultProvince()).replace(/^จ(\.|ังหวัด)\s*/, '');
    const loc = [it.address_raw, it.subdistrict && !String(it.address_raw || '').includes('ต.' + it.subdistrict) ? 'ต.' + it.subdistrict : '', it.district && !String(it.address_raw || '').includes('อ.' + it.district) ? 'อ.' + it.district : '', 'จ.' + prov].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const today = L.dIso(new Date());
    const res = await Swal.fire({
      title: 'บันทึกส่งหมายโดยไม่มีภาพถ่าย',
      html: `<div style="text-align:left;font-size:14px;line-height:1.7">
          <div><b>${esc(caseNo)}</b> · ${esc(it.summon_type || '')} · ${esc(it.recipient || '')}</div>
          <div class="sr-muted">${esc(loc)}</div>
          <label style="display:block;margin-top:10px;font-weight:700">เหตุที่ไม่มีภาพ</label>
          <select id="npReason" class="swal2-select" style="width:100%;margin:4px 0;display:block">
            <option>ผู้รับเซ็นรับหมายเอง (ไม่มีภาพถ่าย)</option>
            <option>มารับหมายที่ศาล (ไม่มีภาพถ่าย)</option>
            <option value="__other">อื่น ๆ (ระบุ)</option>
          </select>
          <input id="npOther" class="swal2-input" placeholder="ระบุเหตุผล" style="display:none;width:100%;margin:4px 0">
          <label style="display:block;margin-top:8px;font-weight:700">วันที่ส่งหมาย</label>
          <input id="npDate" type="date" class="swal2-input" value="${today}" max="${today}" style="width:100%;margin:4px 0">
        </div>`,
      showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-floppy-disk"></i> บันทึก', cancelButtonText: 'ยกเลิก',
      didOpen: () => { const r = document.getElementById('npReason'); const o = document.getElementById('npOther'); r.onchange = () => { o.style.display = r.value === '__other' ? 'block' : 'none'; }; },
      preConfirm: () => {
        const r = document.getElementById('npReason').value; const o = document.getElementById('npOther').value.trim();
        if (r === '__other' && !o) { Swal.showValidationMessage('กรุณาระบุเหตุผล'); return false; }
        return { reason: r === '__other' ? o : r, date: document.getElementById('npDate').value || today };
      },
    });
    if (!res.isConfirmed) return false;
    const d = L.parseIso(res.value.date); const now = new Date();
    if (res.value.date !== today) d.setHours(12, 0, 0, 0); else d.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 0);
    const dateTime = (window.WatermarkEngine && window.WatermarkEngine.formatThaiDateTime) ? window.WatermarkEngine.formatThaiDateTime(d) : d.toLocaleString('th-TH');
    const u = currentUser() || {};
    busy('กำลังบันทึกรายการ...');
    try {
      await SLTS.api('upload_image', {
        caseNumber: caseNo, courtType: u.assignedCourt || u['ศาลที่สังกัด'] || '', province: prov, district: it.district || '', subdistrict: it.subdistrict || '',
        locationType: 'หมายบ้าน', locationText: loc, dateTime, noPhoto: true, noPhotoReason: res.value.reason,
        clientUploadId: 'nophoto-' + it.id + '-' + Date.now(),
      });
      try { if (typeof window.loadGoogleSheetData === 'function') await window.loadGoogleSheetData(true, true); } catch (_) {}
      done(); toast('success', `บันทึก ${caseNo} (ไม่มีภาพถ่าย) แล้ว`);
      return true;
    } catch (e) { done(); fail(e); return false; }
  }

  function bindFlow(body, D) {
    const z = $('#flZone', body);
    if (z) z.onchange = () => { const base = D.detected || (D.cur && D.cur.zone); FL.viewZone = (base && z.value === base.key) ? '' : z.value; renderFlow(body); };
    const pr = $('#flPeriod', body); if (pr) pr.onchange = () => { FL.periodKey = pr.value; FL.weekOffset = 0; FL.viewZone = ''; renderFlow(body); };
    const all = $('#flAll', body); if (all) all.onchange = () => { FL.all = all.checked; renderFlow(body); };
    $$('select[data-fl-claim]', body).forEach((sel) => {
      sel.onchange = async () => {
        const it = R.issued.find((x) => x.id === Number(sel.dataset.flClaim)); if (!it) return;
        try { await setFreeClaim(it, sel.value); } catch (er) { fail(er); }
        renderFlow(body);
      };
    });
    body.onclick = async (e) => {
      const a = e.target.closest('[data-fl],[data-fl-dl],[data-fl-rep],[data-fl-word],[data-view],[data-fl-show],[data-fl-nophoto]');
      if (!a) return;
      if (a.tagName === 'A') e.preventDefault();
      try {
        if (a.dataset.view) return viewPhoto(a.dataset.view);
        if (a.dataset.flShow) { FL.open = a.dataset.flShow; const d = body.querySelector(`details.sr-gap${a.dataset.flShow === 'orphan' ? '.bad' : ':not(.bad)'}`); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'center' }); } return; }
        if (a.dataset.flDl) { const p = D.uploads.find((x) => x.id === a.dataset.flDl); if (p) downloadPhoto(p); return; }
        if (a.dataset.flRep) { const id = Number(a.dataset.flRep); const ph = D.photoMap.get(id) || []; return openReportForm(id, { photoIds: ph.map((p) => p.id) }); }
        if (a.dataset.flWord) return quickWord(Number(a.dataset.flWord));
        if (a.dataset.flNophoto) { if (await recordNoPhoto(R.issued.find((x) => x.id === Number(a.dataset.flNophoto)))) renderFlow(body); return; }
        const act = a.dataset.fl;
        if (act === 'wkprev') { FL.weekOffset -= 1; FL.periodKey = FL.periodKey || ''; return renderFlow(body); }
        if (act === 'wknext') { FL.weekOffset = Math.min(0, FL.weekOffset + 1); return renderFlow(body); }
        if (act === 'wknow') { FL.weekOffset = 0; return renderFlow(body); }
        if (act === 'backcur') { FL.viewZone = ''; return renderFlow(body); }
        if (act === 'viewprev') { FL.viewZone = D.cur.prevZone.key; return renderFlow(body); }
        if (act === 'zinit') { await setZone($('#flZoneInit').value, $('#flAnchor').value || L.dIso(L.mondayOf(new Date())), D.preset && D.preset.id); toast('success', 'ตั้งโซนของคุณแล้ว'); return renderFlow(body); }
        if (act === 'zsettings') { R.sub = 'zones'; return renderSub(); }
        if (act === 'zimport') { if (await importZoneExcel()) { R.sub = 'flow'; renderSub(); } return; }
        if (act === 'shift') { if (await shiftRosterFlow(D.preset)) renderFlow(body); return; }
        if (act === 'zsetview') {
          const g = D.zone;
          const ok = await Swal.fire({ icon: 'question', title: 'ใช้เป็นโซนของฉัน?', html: `<b>${esc(g.label)}</b><br><span class="sr-muted">เริ่มนับ 2 สัปดาห์ตั้งแต่วันจันทร์ที่ ${thDay(L.mondayOf(new Date()))} (ใช้เมื่อไม่มีชื่อคุณในตารางผู้ส่ง)</span>`, showCancelButton: true, confirmButtonText: 'ตั้งค่า', cancelButtonText: 'ยกเลิก' });
          if (!ok.isConfirmed) return;
          await setZone(g.key, L.dIso(L.mondayOf(new Date())), D.preset && D.preset.id); return renderFlow(body);
        }
        if (act === 'upload') { window.switchTab('form'); return; }
        if (act === 'refresh') {
          busy('กำลังตรวจสอบภาพส่งหมาย...');
          try { if (typeof window.loadGoogleSheetData === 'function') await window.loadGoogleSheetData(true, true); } catch (_) {}
          await loadIssued().catch(() => {}); done(); return renderFlow(body);
        }
        if (act === 'zip') return zipPhotos(D.uploads, `ภาพส่งหมาย_${D.zone.label}_${D.win.startIso}`);
        if (act === 'import') { FL.periodKey = ''; FL.viewZone = ''; await importExcelFlow(); return; }
        if (act === 'wordall') return bulkWord(D.reported.map((it) => it.id));
        if (act === 'memo') { R.sub = 'memos'; return renderSub(); }
        if (act === 'legacy') { openLegacyRouteBatch(); }
      } catch (er) { done(); fail(er); }
    };
  }
  /** เลือก Pre-set ที่ศาลใช้งาน (ใช้ร่วมกันทุกคน) */
  async function usePreset(id) {
    const p = zonePresets().find((x) => x.id === Number(id)); if (!p) return false;
    const ok = await Swal.fire({ icon: 'question', title: `ใช้ Pre-set "${esc(p.name)}"?`, html: 'Pre-set นี้จะเป็นตารางโซนจ่ายหมายที่ใช้งานของทุกคนในระบบ', showCancelButton: true, confirmButtonText: 'ใช้ Pre-set นี้', cancelButtonText: 'ยกเลิก' });
    if (!ok.isConfirmed) return false;
    const r = await api('sr_zone_activate', { id: p.id });
    R.boot.activePresetId = r.activePresetId;
    toast('success', `ใช้ Pre-set "${p.name}" แล้ว`);
    return true;
  }
  const presetFresh = async (id) => { await ensureBoot(true); return zonePresets().find((x) => x.id === Number(id)) || null; };
  const zoneIdsOf = (p) => (p.zones || []).map((z) => String(z.id));
  /**
   * เลื่อนผู้ส่งลง 1 โซน (ทุก 2 สัปดาห์) — ถามก่อนเสมอ
   * เข้าสัปดาห์ที่ 3 ยังเป็นช่วงรายงานผลของรอบเดิม (ไม่เกินวันพุธ) จึงให้ชะลอได้
   */
  async function shiftRosterFlow(preset, auto) {
    preset = preset && await presetFresh(preset.id); if (!preset) return false;
    const r = rosterOf(preset); if (!r || !r.period_start) { if (!auto) Swal.fire({ icon: 'info', title: 'ยังไม่มีตารางผู้ส่งของ Pre-set นี้' }); return false; }
    const st = L.rosterStatus(r, new Date());
    const steps = Math.max(1, st.steps || 1);
    const ids = zoneIdsOf(preset);
    const next = L.shiftRoster(ids, r, steps);
    const groups = zoneGroups(preset);
    const me = myUser();
    const myNow = groups.find((g) => r.assign[g.key] && r.assign[g.key].sender_username === me);
    const myNext = groups.find((g) => next.assign[g.key] && next.assign[g.key].sender_username === me);
    const backups = ids.filter((id) => r.assign[id] && r.assign[id].backup).length;
    const res = await Swal.fire({
      icon: 'question',
      title: auto ? 'ถึงรอบเปลี่ยนโซนจ่ายหมายแล้ว' : 'เลื่อนผู้ส่งลง 1 โซน?',
      html: `<div style="text-align:left;font-size:14px;line-height:1.7">
        รอบปัจจุบัน: <b>${thDay(L.parseIso(r.period_start))} – ${thDay(L.parseIso(r.period_end))}</b><br>
        รอบใหม่: <b>${thDay(L.parseIso(next.period_start))} – ${thDay(L.parseIso(next.period_end))}</b>${steps > 1 ? ` <span style="color:#b45309">(เลื่อน ${steps} รอบให้ตรงกับวันนี้)</span>` : ''}<br>
        ${myNow || myNext ? `โซนของคุณ: ${myNow ? esc(myNow.label) : '-'} → <b>${myNext ? esc(myNext.label) : '-'}</b><br>` : ''}
        ${st.due && !st.afterReport ? `<div style="margin-top:8px;padding:8px 10px;background:#fffbeb;border:1px solid #fde2b4;border-radius:6px;color:#92400e">ตอนนี้ยังอยู่ในช่วงรายงานผลการส่งหมายของรอบเดิม (ไม่เกินวันพุธที่ ${thDay(st.reportUntil)}) — ถ้ายังรายงานไม่เสร็จ เลือก "ยังก่อน" ได้ ระหว่างนี้นำเข้าบัญชีจ่ายหมายของโซนใหม่ได้ตามปกติ</div>` : ''}
        ${!st.due ? '<div style="margin-top:8px;color:#b45309">ยังไม่ครบ 2 สัปดาห์ของรอบปัจจุบัน</div>' : ''}
        ${backups ? `<div style="margin-top:6px;color:#64748b;font-size:13px">ผู้ส่งสำรอง/แทน ${backups} โซนจะถูกล้าง (ใช้เฉพาะรอบเดิม)</div>` : ''}
        <div style="margin-top:6px;color:#64748b;font-size:13px">มีผลกับทุกคนในตารางผู้ส่ง · ย้อนกลับได้ที่หน้าตารางโซน</div></div>`,
      showCancelButton: true, confirmButtonText: steps > 1 ? `เลื่อน ${steps} รอบ` : 'เลื่อนผู้ส่งตอนนี้', cancelButtonText: auto ? 'ยังก่อน (ถามใหม่พรุ่งนี้)' : 'ยกเลิก', reverseButtons: true,
    });
    if (!res.isConfirmed) { if (auto) { try { localStorage.setItem(snoozeKey(preset), L.todayIso()); } catch (_) {} } return false; }
    busy('กำลังเลื่อนผู้ส่ง...');
    try {
      await api('sr_zone_roster_save', { preset_id: preset.id, mode: 'shift', roster: next, expect_period_start: r.period_start });
      await ensureBoot(true); done(); toast('success', 'เลื่อนผู้ส่งลง 1 โซนแล้ว'); return true;
    } catch (er) { done(); await ensureBoot(true).catch(() => {}); fail(er); return true; }
  }
  const snoozeKey = (p) => `slts_zone_shift_snooze_${p.id}_${(p.roster && p.roster.period_start) || ''}`;
  /** เข้าหน้ารายงานหมาย: ถึงรอบเลื่อนแล้ว และวันนี้ยังไม่ได้ถาม → ถาม (เฉพาะคนที่อยู่ในตารางผู้ส่ง หรือผู้ดูแล) */
  async function maybePromptShift() {
    const p = activePreset(); const r = rosterOf(p); if (!r) return false;
    const st = L.rosterStatus(r, new Date()); if (!st.due) return false;
    const inRoster = Object.values(r.assign || {}).some((a) => a.sender_username === myUser() || a.backup_username === myUser());
    if (!inRoster && !isAdmin()) return false;
    let snoozed = ''; try { snoozed = localStorage.getItem(snoozeKey(p)) || ''; } catch (_) {}
    if (snoozed === L.todayIso()) return false;
    return shiftRosterFlow(p, true);
  }

  // ---------------- นำเข้าตารางโซนจาก Excel ----------------
  async function importZoneExcel() {
    const files = await pickFiles('.xls,.xlsx', false); if (!files.length) return false;
    let sheets = [];
    busy('กำลังอ่านไฟล์ตารางโซน...');
    try { sheets = await readWorkbook(files[0]); } finally { done(); }
    const prov = defaultProvince();
    const parsed = [];
    let lastErr = null;
    sheets.forEach((sh) => { try { parsed.push({ name: sh.name, ...L.parseZoneSheet(sh.rows, prov, ADDR()) }); } catch (er) { lastErr = er; } });
    if (!parsed.length) { fail(lastErr || new Error('ไม่พบตารางโซนในไฟล์')); return false; }
    return zoneImportPreview(parsed, prov, files[0].name);
  }
  async function zoneImportPreview(parsed, prov, fileName) {
    let pick = 0;
    const staff = staffList();
    const muang = L.muangOf(prov, ADDR()) || ('เมือง' + prov);
    const userOpts = (sel) => `<option value="">— ไม่ระบุ —</option>${staff.map((u) => `<option value="${esc(u.username)}" ${u.username === sel ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}`;
    const build = () => {
      const P = parsed[pick];
      P.zones.forEach((z) => {
        if (z._m === undefined) { const m = L.matchStaff(z.sender, staff); z._m = m && m.username ? m.username : ''; z._amb = m && m.ambiguous ? m.ambiguous.length : 0; }
        if (z._b === undefined) { const m = z.backup ? L.matchStaff(z.backup, staff) : null; z._b = m && m.username ? m.username : ''; }
      });
      const chips = (z) => [].concat(
        (z.keywords || []).map((k) => `<span class="sr-chip">${esc(k)}</span>`),
        (z.subdistricts || []).map((t) => `<span class="sr-chip ok">ต.${esc(t)}${z.moo[t] === 'with' ? ' มีหมู่' : z.moo[t] === 'without' ? ' ไม่มีหมู่' : ''}</span>`),
        (z.others || []).map((o) => `<span class="sr-chip ok">ต.${esc(o.subdistrict)} อ.${esc(o.district)}</span>`),
        (z.districts || []).map((d) => `<span class="sr-chip ok">อ.${esc(d)}</span>`),
        (z.unresolved || []).map((u) => `<span class="sr-chip bad" title="ไม่พบในข้อมูลจังหวัด">? ${esc(u)}</span>`)).join(' ');
      const errs = L.validatePreset({ zones: P.zones });
      const unmatched = P.zones.filter((z) => z.sender && !z._m).length;
      return `<div style="text-align:left;font-size:14px">
        ${parsed.length > 1 ? `<div class="sr-toolbar"><label class="sr-muted">แผ่นงาน</label><select class="sr-select" id="ziSheet">${parsed.map((x, i) => `<option value="${i}" ${i === pick ? 'selected' : ''}>${esc(x.name)} (${x.zones.length} โซน)</option>`).join('')}</select></div>` : ''}
        <div class="sr-toolbar" style="margin-top:6px"><label class="sr-muted">ชื่อ Pre-set</label><input class="sr-input" id="ziName" style="width:280px" value="${esc(FL.ziName || `ตารางโซน ${P.period_start ? thDay(L.parseIso(P.period_start)) + ' – ' + thDay(L.parseIso(P.period_end)) : ''}`)}">
          <label class="sr-muted">รอบผู้ส่ง</label><input type="date" class="sr-input" id="ziStart" value="${esc(P.period_start)}"> – <input type="date" class="sr-input" id="ziEnd" value="${esc(P.period_end)}"></div>
        <div class="sr-muted" style="margin:6px 0">จังหวัด${esc(prov)} · อำเภอเมือง = ${esc(muang)} · ผู้ส่งเทียบกับช่อง "ชื่อ" ในบัญชีผู้ใช้ (ชื่อสะกดต่าง 1 ตัวอักษรก็จับคู่ได้)${unmatched ? ` · <b style="color:#b45309">ยังไม่พบผู้ใช้ ${unmatched} ชื่อ</b> — บัญชีผู้ใช้ยังไม่มีชื่อ-นามสกุลตรงกัน: เลือกเอง หรือบันทึกไว้ก่อนแล้วกด "จับคู่ผู้ส่งอีกครั้ง" หลังกรอกชื่อผู้ใช้` : ''}</div>
        ${errs.length ? `<div class="sr-note warn">${errs.map(esc).join('<br>')}</div>` : ''}
        <div class="sr-scroll" style="max-height:52vh;margin-top:6px"><table class="sr-table"><thead><tr><th>โซน</th><th>เขตตำบล/อำเภอ (ในไฟล์ → ในระบบ)</th><th>ผู้ส่ง</th><th>ผู้ส่งสำรอง/แทน</th></tr></thead><tbody>
        ${P.zones.map((z, i) => `<tr><td><b>${z.no}</b></td><td>${esc(z.raw)}<div style="margin-top:3px">${chips(z)}</div></td>
          <td>${esc(z.sender || '-')}<select class="sr-select" data-zim="${i}" style="width:100%;margin-top:3px;${z.sender && !z._m ? 'border-color:#f59e0b' : ''}">${userOpts(z._m)}</select>${z._amb ? `<div class="sr-muted">ชื่อซ้ำ ${z._amb} คน — เลือกเอง</div>` : ''}</td>
          <td>${esc(z.backup || '')}${z.backup ? `<select class="sr-select" data-zib="${i}" style="width:100%;margin-top:3px">${userOpts(z._b)}</select>` : ''}</td></tr>`).join('')}
        </tbody></table></div></div>`;
    };
    const res = await Swal.fire({
      title: 'นำเข้าตารางโซนจ่ายหมาย', width: 1100, html: build(), showCancelButton: true, confirmButtonText: 'บันทึกและใช้ตารางโซนนี้', cancelButtonText: 'ยกเลิก',
      didOpen: (el) => {
        el.addEventListener('change', (e) => {
          const t = e.target;
          if (t.id === 'ziSheet') { FL.ziName = $('#ziName').value; pick = Number(t.value); Swal.update({ html: build() }); }
          if (t.dataset.zim) parsed[pick].zones[+t.dataset.zim]._m = t.value;
          if (t.dataset.zib) parsed[pick].zones[+t.dataset.zib]._b = t.value;
        });
      },
      preConfirm: () => {
        const P = parsed[pick];
        const errs = L.validatePreset({ zones: P.zones });
        if (errs.length) { Swal.showValidationMessage(errs[0]); return false; }
        const name = ($('#ziName').value || '').trim(); if (!name) { Swal.showValidationMessage('กรุณาตั้งชื่อ Pre-set'); return false; }
        return { name, start: $('#ziStart').value, end: $('#ziEnd').value };
      },
    });
    FL.ziName = '';
    if (!res.isConfirmed) return false;
    const P = parsed[pick];
    const stamp = Date.now().toString(36);
    const nameOf = (u) => { const x = staff.find((s0) => s0.username === u); return x ? x.name : ''; };
    const zones = P.zones.map((z, i) => ({ id: `z${stamp}${i}`, name: z.raw.replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim(), subdistricts: z.subdistricts, moo: z.moo, others: z.others, districts: z.districts, keywords: z.keywords }));
    const assign = {};
    P.zones.forEach((z, i) => { assign[zones[i].id] = { sender: z.sender || nameOf(z._m), sender_username: z._m || '', backup: z.backup ? z.backup.replace(/\(.*?\)/g, '').trim() : '', backup_username: z._b || '' }; });
    busy('กำลังบันทึกตารางโซน...');
    try {
      await api('sr_zone_preset_save', { name: res.value.name, province: prov, muang, zones, roster: { period_start: res.value.start, period_end: res.value.end, assign }, source_file: fileName, activate: true });
      await ensureBoot(true); done(); toast('success', 'นำเข้าตารางโซนแล้ว และตั้งเป็น Pre-set ที่ใช้งาน'); return true;
    } catch (er) { done(); fail(er); return false; }
  }

  // ---------------- โซนจ่ายหมาย: ตั้งค่า Pre-set เอง ----------------
  const ZE = { draft: null, open: -1 };
  const newZoneId = () => 'z' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function blankPreset() {
    const prov = defaultProvince();
    return { id: null, name: zonePresets().length ? `Pre-set ${zonePresets().length + 1}` : 'โซนจ่ายหมาย', province: prov, muang: L.muangOf(prov, ADDR()), zones: [{ id: newZoneId(), name: '', subdistricts: [], districts: [] }] };
  }
  const canEditPreset = (p) => Boolean(p) && (isAdmin() || p.owner === myUser());
  function rosterCard(p) {
    if (!p) return '';
    const groups = zoneGroups(p); const r = rosterOf(p) || { period_start: '', period_end: '', assign: {} };
    const st = r.period_start ? L.rosterStatus(r, new Date()) : null;
    const edit = canEditPreset(p); const staff = staffList(); const me = myUser();
    const opts = (sel, raw) => `<option value="">${raw ? esc(raw) + ' (ยังไม่จับคู่)' : '— ไม่ระบุ —'}</option>${staff.map((u) => `<option value="${esc(u.username)}" ${u.username === sel ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}`;
    const rows = groups.map((z) => {
      const a = r.assign[z.key] || {};
      const mine = a.sender_username === me || a.backup_username === me;
      return `<tr class="${mine ? 'sr-row-me' : ''}"><td><b>${z.no}</b></td><td>${esc(z.label)}</td>
        <td>${edit ? `<select class="sr-select" data-rs="${esc(z.key)}" style="width:100%">${opts(a.sender_username, a.sender_username ? '' : a.sender)}</select>` : esc(a.sender || '-')}${a.sender && !a.sender_username ? '<div class="sr-muted" style="color:#b45309">ไม่พบผู้ใช้ชื่อนี้ในระบบ</div>' : ''}</td>
        <td>${edit ? `<select class="sr-select" data-rb="${esc(z.key)}" style="width:100%">${opts(a.backup_username, a.backup_username ? '' : a.backup)}</select>` : esc(a.backup || '')}</td></tr>`;
    }).join('');
    return `<div class="sr-card"><div class="sr-toolbar"><h3 style="margin:0">ตารางโซนและผู้ส่ง — ${esc(p.name)}</h3><span class="sr-chip ok">ใช้งานอยู่</span><span class="grow"></span>
        ${r.period_start ? `<button class="sr-btn primary" data-zr="shift"><i class="fa-solid fa-arrow-down-short-wide"></i> เลื่อนผู้ส่งลง 1 โซน</button>` : ''}
        ${edit ? '<button class="sr-btn" data-zr="rematch" title="จับคู่ชื่อผู้ส่ง/ผู้ส่งสำรองกับชื่อ-นามสกุลของผู้ใช้ในระบบอีกครั้ง"><i class="fa-solid fa-user-check"></i> จับคู่ผู้ส่งอีกครั้ง</button>' : ''}
        ${edit ? '<button class="sr-btn" data-zr="undo" title="ย้อนการเลื่อน/แก้ไขผู้ส่งครั้งล่าสุด"><i class="fa-solid fa-rotate-left"></i> ย้อนกลับ</button>' : ''}
        <button class="sr-btn" data-zr="log"><i class="fa-solid fa-clock-rotate-left"></i> ประวัติ</button></div>
      <div class="sr-toolbar" style="margin-top:8px"><label class="sr-muted">รอบผู้ส่ง</label>
        ${edit ? `<input type="date" class="sr-input" id="rsStart" value="${esc(r.period_start)}"> – <input type="date" class="sr-input" id="rsEnd" value="${esc(r.period_end)}">` : `<b>${r.period_start ? thDay(L.parseIso(r.period_start)) + ' – ' + thDay(L.parseIso(r.period_end)) : '-'}</b>`}
        ${st ? `<span class="sr-muted">${st.due ? `<b style="color:#b45309">ถึงรอบเลื่อนแล้ว</b> (รอบใหม่เริ่ม ${thDay(st.nextStart)}; รายงานผลรอบเดิมไม่เกินวันพุธที่ ${thDay(st.reportUntil)})` : `เลื่อนรอบถัดไปได้ตั้งแต่วันจันทร์ที่ ${thDay(st.nextStart)} (ระบบจะถามก่อนเลื่อน)`}</span>` : ''}</div>
      ${(() => { const un = Object.values(r.assign || {}).filter((a) => a.sender && !a.sender_username).length; return un ? `<div class="sr-note warn" style="margin-top:8px"><i class="fa-solid fa-user-xmark"></i> ผู้ส่ง ${un} ชื่อยังจับคู่กับบัญชีผู้ใช้ไม่ได้ — ระบบเทียบ "ชื่อ" ในตารางกับช่อง <b>ชื่อ</b> ในบัญชีผู้ใช้ ให้ผู้ดูแลเพิ่มผู้ใช้/กรอกชื่อ-นามสกุลที่ จัดการผู้ใช้งาน (หรือผู้ใช้กรอกเองที่ ข้อมูลของฉัน) แล้วกด "จับคู่ผู้ส่งอีกครั้ง" · ผู้ใช้ที่ชื่อตรงจะเห็นโซนของตนได้ทันทีแม้ยังไม่ได้กดจับคู่</div>` : ''; })()}
      <div class="sr-muted" style="margin:6px 0">ผู้ส่งเลื่อนลงทีละ 1 โซนทุก 2 สัปดาห์ (โซนสุดท้าย → โซน 1) · เมื่อเข้าสัปดาห์ที่ 3 ระบบจะถามก่อนเลื่อน เพราะยังอยู่ในช่วงรายงานผลของรอบเดิม (ไม่เกินวันพุธ) · ผู้ส่งสำรอง/แทนใช้เฉพาะรอบนั้น</div>
      <div class="sr-scroll" style="max-height:520px"><table class="sr-table"><thead><tr><th style="width:56px">โซน</th><th>เขตตำบล/อำเภอ</th><th style="width:24%">ผู้ส่ง</th><th style="width:22%">ผู้ส่งสำรอง/แทน</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${edit ? '<div class="sr-toolbar" style="margin-top:10px"><span class="grow"></span><button class="sr-btn primary" data-zr="save"><i class="fa-solid fa-floppy-disk"></i> บันทึกตารางผู้ส่ง</button></div>' : '<div class="sr-muted" style="margin-top:8px">แก้ไขชื่อผู้ส่งได้เฉพาะผู้สร้าง Pre-set หรือผู้ดูแลระบบ</div>'}</div>`;
  }
  function renderZones(body) {
    body = body || $('#srBody'); if (!body) return;
    const presets = zonePresets(); const act = activePreset();
    const list = presets.map((p) => {
      const zs = zoneGroups(p); const r = rosterOf(p);
      return `<tr><td><b>${esc(p.name)}</b> ${act && act.id === p.id ? '<span class="sr-chip ok">ใช้งานอยู่</span>' : ''}<div class="sr-muted">จ.${esc(p.province)} · ${zs.length} โซน${r && r.period_start ? ` · รอบผู้ส่ง ${thDay(L.parseIso(r.period_start))} – ${thDay(L.parseIso(r.period_end))}` : ''}</div>${p.source_file ? `<div class="sr-muted">นำเข้าจาก ${esc(p.source_file)}</div>` : ''}</td>
        <td><details><summary class="sr-muted" style="cursor:pointer">ดูโซนทั้งหมด</summary>${zs.map((z) => `<div><b>โซน ${z.no}</b> ${esc(z.label)}${r && r.assign[z.key] && r.assign[z.key].sender ? ` — <span class="sr-muted">${esc(r.assign[z.key].sender)}</span>` : ''}</div>`).join('')}</details></td>
        <td class="ctr" style="white-space:nowrap">${act && act.id === p.id ? '' : `<button class="sr-btn sm primary" data-zp-use="${p.id}"><i class="fa-solid fa-circle-check"></i> ใช้ Pre-set นี้</button>`}
          ${canEditPreset(p) ? `<button class="sr-btn sm" data-zp-edit="${p.id}"><i class="fa-solid fa-pen"></i> แก้ไขโซน</button>` : ''}
          <button class="sr-btn sm" data-zp-copy="${p.id}" title="คัดลอกเป็น Pre-set ใหม่"><i class="fa-regular fa-copy"></i></button>
          ${canEditPreset(p) ? `<button class="sr-btn sm danger" data-zp-del="${p.id}" title="ลบ"><i class="fa-solid fa-trash"></i></button>` : ''}</td></tr>`;
    }).join('');
    body.innerHTML = `${rosterCard(act)}
      <div class="sr-card"><div class="sr-toolbar"><h3 style="margin:0">Pre-set โซนจ่ายหมายของศาล</h3><span class="grow"></span>
        <button class="sr-btn primary" data-zp-import="1"><i class="fa-solid fa-file-excel"></i> นำเข้าตารางโซนจาก Excel</button>
        <button class="sr-btn" data-zp-new="1"><i class="fa-solid fa-plus"></i> สร้าง Pre-set เอง</button></div>
        <div class="sr-muted" style="margin:4px 0 10px">นำเข้าไฟล์ตารางโซน (หัว "วันที่ ... ถึง วันที่ ..." และคอลัมน์ โซน / เขตตำบล/อำเภอ / ผู้ส่ง / ผู้ส่งสำรอง) แล้วจัดโซนให้อัตโนมัติ — หรือกำหนดเองว่าแต่ละโซนมี <b>ตำบลในอำเภอเมือง</b> (แบ่ง มีหมู่/ไม่มีหมู่ ได้) <b>อำเภอ</b> หรือ <b>หน่วยงาน</b> (เช่น อัยการ เรือนจำ) ใดบ้าง · ใช้ได้ทีละ Pre-set ทั้งศาล — ถ้าการแบ่งโซนเปลี่ยน ให้สร้าง/นำเข้า Pre-set ใหม่แล้วเลือกใช้</div>
        ${presets.length ? `<table class="sr-table"><thead><tr><th style="width:30%">Pre-set</th><th>โซน (ตามลำดับ)</th><th class="ctr">จัดการ</th></tr></thead><tbody>${list}</tbody></table>` : '<div class="sr-empty">ยังไม่มี Pre-set — นำเข้าตารางโซนจาก Excel หรือสร้างเอง</div>'}
      </div><div id="zpEditor"></div>`;
    if (ZE.draft) drawEditor();
    body.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.zr) {
          const p = activePreset(); if (!p) return;
          if (b.dataset.zr === 'shift') { if (await shiftRosterFlow(p)) renderZones(body); return; }
          if (b.dataset.zr === 'rematch') {
            const r0 = rosterOf(p) || { assign: {} }; const staff = staffList();
            let n = 0; const assign = {};
            Object.keys(r0.assign || {}).forEach((k) => {
              const a = { ...r0.assign[k] };
              if (a.sender && !a.sender_username) { const m = L.matchStaff(a.sender, staff); if (m && m.username) { a.sender_username = m.username; n += 1; } }
              if (a.backup && !a.backup_username) { const m = L.matchStaff(a.backup, staff); if (m && m.username) { a.backup_username = m.username; n += 1; } }
              assign[k] = a;
            });
            if (!n) { toast('info', 'ไม่พบชื่อที่จับคู่เพิ่มได้ — ตรวจว่าผู้ใช้กรอกชื่อ-นามสกุลในบัญชีแล้ว'); return; }
            busy('กำลังบันทึก...');
            await api('sr_zone_roster_save', { preset_id: p.id, mode: 'edit', roster: { ...r0, assign } }); await ensureBoot(true); done();
            toast('success', `จับคู่เพิ่ม ${n} ชื่อ`); return renderZones(body);
          }
          if (b.dataset.zr === 'undo') {
            const ok = await Swal.fire({ icon: 'question', title: 'ย้อนการเปลี่ยนผู้ส่งครั้งล่าสุด?', showCancelButton: true, confirmButtonText: 'ย้อนกลับ', cancelButtonText: 'ยกเลิก' });
            if (!ok.isConfirmed) return;
            await api('sr_zone_roster_undo', { preset_id: p.id }); await ensureBoot(true); toast('success', 'ย้อนกลับแล้ว'); return renderZones(body);
          }
          if (b.dataset.zr === 'log') {
            const r = await api('sr_zone_log', { preset_id: p.id });
            const name = { import: 'นำเข้า', create: 'สร้าง', shift: 'เลื่อนผู้ส่ง', edit: 'แก้ไขผู้ส่ง', undo: 'ย้อนกลับ', activate: 'เลือกใช้' };
            return Swal.fire({ title: 'ประวัติตารางผู้ส่ง', width: 720, html: `<table class="sr-table" style="font-size:13.5px"><thead><tr><th>เมื่อ</th><th>รายการ</th><th>รอบ</th><th>โดย</th></tr></thead><tbody>${r.items.map((x) => `<tr><td>${esc(new Date(x.created_at).toLocaleString('th-TH'))}</td><td>${esc(name[x.action] || x.action)}${x.undone ? ' <span class="sr-muted">(ย้อนแล้ว)</span>' : ''}</td><td>${x.roster_after && x.roster_after.period_start ? esc(thDay(L.parseIso(x.roster_after.period_start)) + ' – ' + thDay(L.parseIso(x.roster_after.period_end))) : '-'}</td><td>${esc(x.created_by)}</td></tr>`).join('') || '<tr><td colspan="4">ยังไม่มีประวัติ</td></tr>'}</tbody></table>` });
          }
          if (b.dataset.zr === 'save') {
            const r0 = rosterOf(p) || { assign: {} };
            const staff = staffList(); const nameOf = (u) => { const x = staff.find((y) => y.username === u); return x ? x.name : ''; };
            const assign = {};
            zoneGroups(p).forEach((z) => {
              const a = r0.assign[z.key] || {};
              const su = ($(`select[data-rs="${CSS.escape(z.key)}"]`, body) || {}).value || '';
              const bu = ($(`select[data-rb="${CSS.escape(z.key)}"]`, body) || {}).value || '';
              assign[z.key] = { sender: su ? nameOf(su) : (a.sender_username ? '' : a.sender || ''), sender_username: su, backup: bu ? nameOf(bu) : (a.backup_username ? '' : a.backup || ''), backup_username: bu };
            });
            const roster = { period_start: $('#rsStart', body).value, period_end: $('#rsEnd', body).value, assign };
            busy('กำลังบันทึก...');
            await api('sr_zone_roster_save', { preset_id: p.id, mode: 'edit', roster }); await ensureBoot(true); done(); toast('success', 'บันทึกตารางผู้ส่งแล้ว'); return renderZones(body);
          }
        }
        if (b.dataset.zpImport) { if (await importZoneExcel()) renderZones(body); return; }
        if (b.dataset.zpNew) { ZE.draft = blankPreset(); ZE.open = 0; return drawEditor(true); }
        if (b.dataset.zpEdit || b.dataset.zpCopy) {
          const p = presets.find((x) => x.id === Number(b.dataset.zpEdit || b.dataset.zpCopy));
          ZE.draft = JSON.parse(JSON.stringify(p)); ZE.open = -1;
          if (b.dataset.zpCopy) {
            const map = {};
            ZE.draft.id = null; ZE.draft.name = `${p.name} (สำเนา)`;
            ZE.draft.zones.forEach((z) => { const nid = newZoneId(); map[z.id] = nid; z.id = nid; });
            const r = ZE.draft.roster || {}; const assign = {};
            Object.keys(r.assign || {}).forEach((k) => { if (map[k]) assign[map[k]] = r.assign[k]; });
            ZE.draft.roster = { ...r, assign };
          }
          ZE.draft.muang = ZE.draft.muang || L.muangOf(ZE.draft.province, ADDR());
          return drawEditor(true);
        }
        if (b.dataset.zpUse) { if (await usePreset(Number(b.dataset.zpUse))) renderZones(body); return; }
        if (b.dataset.zpDel) {
          const p = presets.find((x) => x.id === Number(b.dataset.zpDel));
          const ok = await Swal.fire({ icon: 'warning', title: `ลบ Pre-set "${esc(p.name)}"?`, text: activePreset() && activePreset().id === p.id ? 'Pre-set นี้กำลังใช้งานอยู่ ทุกคนจะไม่มีตารางโซนจนกว่าจะเลือกชุดใหม่' : '', showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#b91c1c' });
          if (!ok.isConfirmed) return;
          await api('sr_zone_preset_delete', { id: p.id }); await ensureBoot(true); if (ZE.draft && ZE.draft.id === p.id) ZE.draft = null; return renderZones(body);
        }
      } catch (er) { done(); fail(er); }
    };
  }
  function drawEditor(scroll) {
    const host = $('#zpEditor'); if (!host) return;
    const d = ZE.draft; if (!d) { host.innerHTML = ''; return; }
    const A = L.provinceAreas(d.province, ADDR());
    d.muang = A.muang;
    const owner = new Map(); // พื้นที่ → [{ zone, cond }]
    const own = (k, i, cond) => { if (!owner.has(k)) owner.set(k, []); owner.get(k).push({ i, cond }); };
    d.zones.forEach((z, i) => { (z.subdistricts || []).forEach((t) => own('t:' + t, i, (z.moo && z.moo[t]) || '')); (z.districts || []).forEach((x) => own('d:' + x, i, '')); });
    const box = (zi, kind, name) => {
      const k = (kind === 't' ? 't:' : 'd:') + name; const list = owner.get(k) || [];
      const mine = list.some((x) => x.i === zi);
      const others = list.filter((x) => x.i !== zi);
      // ตำบลที่โซนอื่นใช้แบบ "มีหมู่/ไม่มีหมู่" ยังเลือกส่วนที่เหลือได้
      const other = others.length > 0 && !(kind === 't' && others.length === 1 && others[0].cond);
      const o = others.length ? others[0].i : undefined;
      const condTxt = (c) => (c === 'with' ? 'มีหมู่' : c === 'without' ? 'ไม่มีหมู่' : '');
      return `<label class="sr-zcheck ${mine ? 'on' : ''} ${other ? 'used' : ''}" title="${o !== undefined ? `โซน ${o + 1}${others[0].cond ? ' (' + condTxt(others[0].cond) + ')' : ''}` : ''}"><input type="checkbox" data-za="${zi}|${kind}|${esc(name)}" ${mine ? 'checked' : ''} ${other ? 'disabled' : ''}> ${kind === 't' ? 'ต.' : 'อ.'}${esc(name)}${o !== undefined && !mine ? ` <small>(โซน ${o + 1}${others[0].cond ? ' ' + condTxt(others[0].cond) : ''})</small>` : ''}</label>`;
    };
    const zonesHtml = d.zones.map((z, i) => {
      const auto = L.autoZoneName(z, A.muang); const cnt = (z.subdistricts || []).length + (z.districts || []).length + (z.others || []).length + (z.keywords || []).length;
      const mooRows = (z.subdistricts || []).map((t) => `<label class="sr-zmoo">ต.${esc(t)} <select class="sr-select" data-zmoo="${i}|${esc(t)}"><option value="">ทั้งตำบล</option><option value="without" ${z.moo && z.moo[t] === 'without' ? 'selected' : ''}>เฉพาะที่อยู่ไม่มีหมู่</option><option value="with" ${z.moo && z.moo[t] === 'with' ? 'selected' : ''}>เฉพาะที่อยู่มีหมู่</option></select></label>`).join('');
      return `<details class="sr-zone" ${ZE.open === i ? 'open' : ''} data-zi="${i}"><summary><b>โซน ${i + 1}</b> <span>${esc(z.name || auto)}</span> <span class="sr-muted">${cnt} พื้นที่</span>
          <span class="grow"></span><button class="sr-btn sm" data-zu="${i}" ${i ? '' : 'disabled'} title="เลื่อนขึ้น"><i class="fa-solid fa-arrow-up"></i></button><button class="sr-btn sm" data-zd="${i}" ${i < d.zones.length - 1 ? '' : 'disabled'} title="เลื่อนลง"><i class="fa-solid fa-arrow-down"></i></button><button class="sr-btn sm danger" data-zx="${i}" title="ลบโซน"><i class="fa-solid fa-xmark"></i></button></summary>
        <div class="sr-zone-body"><label class="sr-muted">ชื่อโซน (เว้นว่าง = ตั้งชื่อจากพื้นที่)</label><input class="sr-input" data-zn="${i}" value="${esc(z.name || '')}" placeholder="${esc(auto)}" style="width:100%;max-width:520px">
          ${A.muang ? `<div class="sr-zgroup"><div class="sr-zgroup-h">ตำบลในอำเภอ${esc(A.muang)} <a href="#" data-zall="${i}|t">เลือกที่เหลือทั้งหมด</a> · <a href="#" data-znone="${i}|t">ล้าง</a></div><div class="sr-zgrid">${A.muangSubdistricts.map((t) => box(i, 't', t)).join('')}</div></div>` : ''}
          ${mooRows ? `<div class="sr-zgroup"><div class="sr-zgroup-h">แบ่งตำบลตามที่อยู่ (ใช้เมื่อตำบลเดียวแยก 2 โซน เช่น ต.หมากแข้ง ไม่มีหมู่/มีหมู่)</div><div class="sr-zgrid">${mooRows}</div></div>` : ''}
          <div class="sr-zgroup"><div class="sr-zgroup-h">อำเภอ${A.muang ? ' (นอกจากอำเภอ' + esc(A.muang) + ')' : ''} <a href="#" data-znone="${i}|d">ล้าง</a></div><div class="sr-zgrid">${A.districts.map((x) => box(i, 'd', x)).join('')}</div></div>
          ${(z.others || []).length ? `<div class="sr-zgroup"><div class="sr-zgroup-h">ตำบลในอำเภออื่น</div>${z.others.map((o, k) => `<span class="sr-chip ok">ต.${esc(o.subdistrict)} อ.${esc(o.district)} <a href="#" data-zorm="${i}|${k}" title="เอาออก">✕</a></span>`).join(' ')}</div>` : ''}
          <div class="sr-zgroup"><div class="sr-zgroup-h">หน่วยงาน/คำค้นในที่อยู่หรือชื่อผู้รับ (คั่นด้วย ,) — เช่น อัยการ, เรือนจำ, คุมประพฤติ <span class="sr-muted" style="font-weight:400">ตรวจก่อนพื้นที่</span></div>
            <input class="sr-input" data-zkw="${i}" value="${esc((z.keywords || []).join(', '))}" style="width:100%;max-width:620px" placeholder="เว้นว่างได้"></div>
        </div></details>`;
    }).join('');
    const usedT = new Set(d.zones.flatMap((z) => z.subdistricts || [])).size; const usedD = new Set(d.zones.flatMap((z) => z.districts || [])).size;
    host.innerHTML = `<div class="sr-card" id="zpEditCard"><h3 style="margin-top:0">${d.id ? 'แก้ไข Pre-set' : 'สร้าง Pre-set ใหม่'}</h3>
      <div class="sr-toolbar"><label class="sr-muted">ชื่อ Pre-set</label><input class="sr-input" id="zpName" value="${esc(d.name)}" style="width:260px">
        <label class="sr-muted">จังหวัด</label><select class="sr-select" id="zpProv" style="width:200px">${PROVINCES().map((p) => `<option ${p === d.province ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
        <span class="sr-muted">อำเภอเมือง: <b>${esc(A.muang || '— (ไม่มี)')}</b> · เลือกแล้ว ต. ${usedT}/${A.muangSubdistricts.length} · อ. ${usedD}/${A.districts.length}</span></div>
      <div style="margin-top:10px">${zonesHtml}</div>
      <div class="sr-toolbar" style="margin-top:12px"><button class="sr-btn" data-zadd="1"><i class="fa-solid fa-plus"></i> เพิ่มโซน</button><span class="grow"></span>
        <button class="sr-btn" data-zcancel="1">ยกเลิก</button><button class="sr-btn primary" data-zsave="1"><i class="fa-solid fa-floppy-disk"></i> บันทึก Pre-set</button></div></div>`;
    if (scroll) host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    host.oninput = (e) => {
      const t = e.target;
      if (t.id === 'zpName') d.name = t.value;
      if (t.dataset.zkw !== undefined) d.zones[+t.dataset.zkw].keywords = t.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
      if (t.dataset.zn !== undefined) { d.zones[+t.dataset.zn].name = t.value; const sm = t.closest('details').querySelector('summary > span'); if (sm) sm.textContent = t.value || L.autoZoneName(d.zones[+t.dataset.zn], A.muang); }
    };
    host.onchange = async (e) => {
      const t = e.target;
      if (t.id === 'zpProv') {
        const has = d.zones.some((z) => (z.subdistricts || []).length || (z.districts || []).length);
        if (has) { const ok = await Swal.fire({ icon: 'question', title: 'เปลี่ยนจังหวัด?', text: 'พื้นที่ที่เลือกไว้ในทุกโซนจะถูกล้าง', showCancelButton: true, confirmButtonText: 'เปลี่ยน', cancelButtonText: 'ยกเลิก' }); if (!ok.isConfirmed) { t.value = d.province; return; } }
        d.province = t.value; d.zones.forEach((z) => { z.subdistricts = []; z.districts = []; }); return drawEditor();
      }
      if (t.dataset.zmoo) {
        const [zi, name] = t.dataset.zmoo.split('|'); const z = d.zones[+zi]; z.moo = z.moo || {};
        if (t.value) z.moo[name] = t.value; else delete z.moo[name];
        ZE.open = +zi; return drawEditor();
      }
      if (t.dataset.za) {
        const [zi, kind, name] = t.dataset.za.split('|'); const z = d.zones[+zi]; const key = kind === 't' ? 'subdistricts' : 'districts';
        z[key] = z[key] || [];
        if (t.checked) {
          if (!z[key].includes(name)) z[key].push(name);
          // ตำบลที่โซนอื่นใช้แบบ มีหมู่/ไม่มีหมู่ → โซนนี้ได้ส่วนที่เหลือ
          if (kind === 't') { const o = d.zones.find((x, j) => j !== +zi && (x.subdistricts || []).includes(name) && x.moo && x.moo[name]); if (o) { z.moo = z.moo || {}; z.moo[name] = o.moo[name] === 'with' ? 'without' : 'with'; } }
        } else { z[key] = z[key].filter((x) => x !== name); if (z.moo) delete z.moo[name]; }
        ZE.open = +zi; drawEditor();
      }
    };
    host.onclick = async (e) => {
      const rm = e.target.closest('a[data-zorm]');
      if (rm) { e.preventDefault(); const [zi, k] = rm.dataset.zorm.split('|'); d.zones[+zi].others.splice(+k, 1); ZE.open = +zi; return drawEditor(); }
      const a = e.target.closest('a[data-zall],a[data-znone]');
      if (a) {
        e.preventDefault();
        const [zi, kind] = (a.dataset.zall || a.dataset.znone).split('|'); const z = d.zones[+zi]; const key = kind === 't' ? 'subdistricts' : 'districts';
        if (a.dataset.znone) z[key] = [];
        else { const taken = new Set(d.zones.filter((_, j) => j !== +zi).flatMap((x) => x[key] || [])); z[key] = (kind === 't' ? A.muangSubdistricts : A.districts).filter((x) => !taken.has(x)); }
        ZE.open = +zi; return drawEditor();
      }
      const b = e.target.closest('button'); if (!b) return;
      if (b.closest('summary')) e.preventDefault();
      if (b.dataset.zu || b.dataset.zd) { const i = +(b.dataset.zu || b.dataset.zd); const j = b.dataset.zu ? i - 1 : i + 1; [d.zones[i], d.zones[j]] = [d.zones[j], d.zones[i]]; ZE.open = j; return drawEditor(); }
      if (b.dataset.zx) { d.zones.splice(+b.dataset.zx, 1); ZE.open = -1; return drawEditor(); }
      if (b.dataset.zadd) { d.zones.push({ id: newZoneId(), name: '', subdistricts: [], districts: [] }); ZE.open = d.zones.length - 1; return drawEditor(); }
      if (b.dataset.zcancel) { ZE.draft = null; host.innerHTML = ''; return; }
      if (b.dataset.zsave) {
        d.name = ($('#zpName').value || '').trim();
        const errs = (d.name ? [] : ['กรุณาตั้งชื่อ Pre-set']).concat(L.validatePreset(d));
        if (errs.length) return Swal.fire({ icon: 'warning', title: 'ตรวจสอบการตั้งค่าโซน', html: errs.map(esc).join('<br>') });
        const left = A.muangSubdistricts.length + A.districts.length - (usedT + usedD);
        if (left > 0) { const ok = await Swal.fire({ icon: 'question', title: 'ยังมีพื้นที่ที่ไม่อยู่ในโซนใด', text: `${left} พื้นที่ยังไม่ถูกเลือก (เช่น อยู่นอกเขตจ่ายหมาย) — บันทึกต่อไหม?`, showCancelButton: true, confirmButtonText: 'บันทึก', cancelButtonText: 'กลับไปแก้ไข' }); if (!ok.isConfirmed) return; }
        try {
          busy('กำลังบันทึก...');
          await api('sr_zone_preset_save', { id: d.id, name: d.name, province: d.province, muang: A.muang, zones: d.zones, roster: d.id ? undefined : d.roster });
          await ensureBoot(true); done(); ZE.draft = null; toast('success', 'บันทึก Pre-set แล้ว'); renderZones();
        } catch (er) { done(); fail(er); }
      }
    };
  }

  /** เปิดหน้า "รายการส่งหมายรอบนี้" แบบเดิม (เส้นทางจากมือถือ) */
  function openLegacyRouteBatch() {
    FL.legacy = true;
    try { window.switchTab('route_batch'); } finally { FL.legacy = false; }
  }

  // ---------------- 2) บันทึกข้อความ / ใบสำคัญรับเงิน ----------------
  async function renderMemos(body) {
    body.innerHTML = `<div class="sr-card"><div class="sr-toolbar">
        <button class="sr-btn primary" data-new="free"><i class="fa-solid fa-plus"></i> สร้างรายงานหมายฟรี (ขออนุมัติเบิก + ใบสำคัญรับเงิน)</button>
        <button class="sr-btn primary" data-new="paid"><i class="fa-solid fa-plus"></i> สร้างรายงานหมายเงิน</button>
        <span class="grow"></span><span class="sr-muted">คำสั่งศาลฉบับล่าสุด: ${esc(((R.boot.orders || [])[0] || {}).order_text || '-')}</span></div>
      <div class="sr-scroll" style="margin-top:12px"><table class="sr-table"><thead><tr><th>ประเภท</th><th>รอบ</th><th>เลขที่ / วันที่</th><th class="num">จำนวนเรื่อง</th><th class="num">จำนวนเงิน</th><th>ผู้รายงาน</th><th class="ctr">เอกสาร</th><th class="ctr">จัดการ</th></tr></thead><tbody id="srMemoRows"><tr><td colspan="8"><div class="sr-empty"><i class="fa-solid fa-spinner fa-spin"></i></div></td></tr></tbody></table></div></div>`;
    body.querySelectorAll('[data-new]').forEach((b) => { b.onclick = () => openMemoForm(b.dataset.new, null); });
    try { R.memos = (await api('sr_memo_list', {})).memos; } catch (e) { return fail(e); }
    const tb = $('#srMemoRows');
    tb.innerHTML = R.memos.map((m) => `<tr>
      <td><span class="sr-chip ${m.report_type === 'paid' ? 'paid' : ''}">${m.report_type === 'paid' ? 'หมายเงิน' : 'หมายฟรี'}</span></td>
      <td>${esc(m.round_label || '-')}${m.period_start ? `<div class="sr-muted">${esc(L.thaiDateShort(m.period_start))} – ${esc(L.thaiDateShort(m.period_end))}</div>` : ''}</td>
      <td>${esc(m.doc_no || '-')}<div class="sr-muted">${esc(L.thaiDateText(m.doc_date))}</div></td>
      <td class="num">${m.item_count}</td><td class="num">${L.money2(m.total_amount)}</td><td>${esc(m.reporter_name)}</td>
      <td class="ctr" style="white-space:nowrap"><button class="sr-btn sm" data-mword="${m.id}" title="บันทึกข้อความ Word"><i class="fa-solid fa-file-word"></i> Word</button>
        <button class="sr-btn sm" data-mpdf="${m.id}" title="บันทึกข้อความ PDF"><i class="fa-solid fa-file-pdf"></i> PDF</button>
        ${m.report_type === 'free' ? `<button class="sr-btn sm" data-rxlsx="${m.id}" title="ใบสำคัญรับเงิน Excel"><i class="fa-solid fa-file-excel"></i> ใบสำคัญ</button><button class="sr-btn sm" data-rpdf="${m.id}" title="ใบสำคัญรับเงิน PDF"><i class="fa-solid fa-file-pdf"></i> ใบสำคัญ PDF</button>` : ''}</td>
      <td class="ctr" style="white-space:nowrap"><button class="sr-btn sm" data-medit="${m.id}"><i class="fa-solid fa-pen"></i></button><button class="sr-btn sm danger" data-mdel="${m.id}"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('')
      || '<tr><td colspan="8"><div class="sr-empty">ยังไม่มีรายงาน — สร้างรายงานหมายฟรี/หมายเงินจากปุ่มด้านบน</div></td></tr>';
    tb.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const id = Number(b.dataset.mword || b.dataset.mpdf || b.dataset.rxlsx || b.dataset.rpdf || b.dataset.medit || b.dataset.mdel);
      try {
        if (b.dataset.mdel) {
          const ok = await Swal.fire({ icon: 'warning', title: 'ลบรายงานนี้?', showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#b91c1c' });
          if (ok.isConfirmed) { await api('sr_memo_delete', { id }); renderSub(); }
          return;
        }
        const { memo, items } = await api('sr_memo_get', { id });
        if (b.dataset.medit) return openMemoForm(memo.report_type, { memo, items });
        if (b.dataset.mword) {
          const tpl = await template(memo.report_type === 'paid' ? 'memo_paid' : 'memo_free');
          downloadBlob(await DOCX.fillReportDocx(tpl, E.memoVars(memo), []), `บันทึกข้อความ-${memo.report_type === 'paid' ? 'หมายมีเงิน' : 'หมายฟรี'}-${(memo.round_label || id).toString().replace(/[\\/:*?"<>|]/g, '-')}.docx`);
        } else if (b.dataset.mpdf) await openPdf(E.memoPrintHtml(memo, baseUrl()), `บันทึกข้อความ-${memo.report_type === 'paid' ? 'หมายมีเงิน' : 'หมายฟรี'}-${memo.round_label || id}`);
        else if (b.dataset.rxlsx) { const { wb } = E.receiptWorkbook(memo, items); downloadBlob(await wb.toBlob(), `ใบสำคัญรับเงินฟรี-${(memo.round_label || id).toString().replace(/[\\/:*?"<>|]/g, '-')}.xlsx`); }
        else if (b.dataset.rpdf) await openPdf(E.receiptPrintHtml(memo, items, baseUrl()), `ใบสำคัญรับเงิน-หมายฟรี-${memo.round_label || id}`);
      } catch (er) { fail(er); }
    };
  }

  const roleOf = (rec) => ((String(rec || '').match(/(จำเลย|โจทก์|ผู้ร้องสอด|ผู้ร้อง|ผู้คัดค้าน|ผู้เสียหาย|ผู้ประกัน|นายประกัน|บุคคลภายนอก)(ร่วม)?(ที่\s*\d+)?/) || [''])[0] || 'ผู้รับ').replace(/ที่\s+(\d)/, 'ที่ $1');
  /** แถวใบสำคัญรับเงินหมายฟรีจากหมายในบัญชีจ่ายหมาย (กรอกข้อมูลให้ครบ) */
  function freeMemoItemOf(it) {
    const rep = it.report || {};
    const ph = photosForIssued(it);
    const photoDate = ph[0] && ph[0].time ? L.toIso(new Date(ph[0].time)) : '';
    const plan = claimPlan(claimScope(it)).get(it.id) || {};
    const ch = claimChoice(it);
    return {
      issued_id: it.id, case_prefix: 'คดีดำ', case_no: it.kind === 'T' ? it.t_no : it.black_no,
      issue_date: rep.issue_date || it.entry_date || it.period_start || '', serve_date: rep.serve_date || photoDate || '',
      summon_type: it.summon_type || '', recipient: it.recipient || '', recipient_role: roleOf(it.recipient),
      house_no: it.house_no || '', moo: it.moo || '', subdistrict: it.subdistrict || '', district: it.district || '', province: 'จ.อุดรธานี',
      base_rate: freeRateFor(it) || Number(rep.claim_amount) || 0,
      claim_mode: ch.mode || 'full', claim_eff: plan.eff || ch.mode || 'full',
      reported: Boolean(it.report && it.report_status && it.report_status !== 'none'),
    };
  }
  /** หมายฟรีที่เลือก "เบิก" (เต็ม/ครึ่ง) ในช่วงวันที่ — ช่วงจ่ายหมายทับซ้อน หรือวันที่ส่งอยู่ในช่วง */
  function claimableFree(from, to) {
    const me = myUser();
    return R.issued.filter((it) => it.money_type !== 'paid' && (!me || !it.owner || it.owner === me || isAdmin()))
      .filter((it) => { const m = claimChoice(it).mode; if (m !== 'full' && m !== 'half') return false; const p = claimPlan(claimScope(it)).get(it.id); return !(p && (p.blockedBy || p.eff === 'none')); })
      .filter((it) => {
        if (!from && !to) return true;
        const ps = it.period_start || it.period_end || ''; const pe = it.period_end || it.period_start || '';
        const overlap = ps && pe && (!to || ps <= to) && (!from || pe >= from);
        const sd = (it.report && it.report.serve_date) || '';
        return overlap || (sd && (!from || sd >= from) && (!to || sd <= to));
      })
      .sort((a, b) => (a.period_start || '').localeCompare(b.period_start || '') || (a.seq || 0) - (b.seq || 0));
  }

  /** ที่อยู่ส่งหมายเต็มตามบัญชีจ่ายหมาย */
  function issuedAddr(it) {
    const raw = String(it.address_raw || '').replace(/\s*(ซ\.|ถ\.)\s*-(?=\s|$)/g, '').replace(/\s+/g, ' ').trim();
    const parts = [raw || [it.house_no, it.moo ? 'ม.' + it.moo : '', it.soi && it.soi !== '-' ? 'ซ.' + it.soi : '', it.road && it.road !== '-' ? 'ถ.' + it.road : ''].filter(Boolean).join(' ')];
    if (it.subdistrict && !raw.includes('ต.' + it.subdistrict) && !raw.includes('ตำบล' + it.subdistrict)) parts.push('ต.' + it.subdistrict);
    if (it.district && !raw.includes('อ.' + it.district) && !raw.includes('อำเภอ' + it.district)) parts.push('อ.' + it.district);
    return parts.filter(Boolean).join(' ');
  }
  /** ช่องที่ตั้ง: ตามบัญชี + ตามภาพส่งหมาย (ปุ่มเปิดแผนที่) */
  function locCell(it, ph) {
    const p = (ph || [])[0];
    const map = p && p.lat && p.lng ? ` <a href="https://www.google.com/maps?q=${encodeURIComponent(p.lat + ',' + p.lng)}" target="_blank" rel="noopener" title="เปิดตำแหน่งที่ถ่ายภาพใน Google Maps"><i class="fa-solid fa-map-location-dot"></i></a>` : '';
    return `<div><i class="fa-solid fa-house" style="color:#64748b"></i> ${esc(issuedAddr(it))}</div>`
      + (p ? `<div class="sr-muted" style="margin-top:2px"><i class="fa-solid fa-camera"></i> ${p.noPhoto ? esc(p.reason) : esc(p.loc || '-')}${map}</div>` : '');
  }

  /** ฟอร์มรายงานรอบ (บันทึกข้อความ) */
  function openMemoForm(type, existing) {
    const m = (existing && existing.memo) || {};
    let items = ((existing && existing.items) || []).map((x) => Object.assign({}, x));
    const officer = defaultSigner('officer'); const director = defaultSigner('director'); const payer = defaultSigner('payer');
    const prof = profile();
    const val = (k, d) => (m[k] != null && m[k] !== '' ? m[k] : d);
    const wrap = document.createElement('div'); wrap.className = 'sr-modal sr-wrap';
    const opts = (kind, name) => signers(kind).map((s) => `<option value="${s.id}" ${s.full_name === name ? 'selected' : ''}>${esc(s.full_name)}</option>`).join('');
    wrap.innerHTML = `<div class="sr-dialog"><div class="sr-dialog-head"><i class="fa-solid fa-file-invoice"></i><h2>${m.id ? 'แก้ไข' : 'สร้าง'}รายงาน${type === 'paid' ? 'หมายเงิน' : 'หมายฟรี'} (บันทึกข้อความขออนุมัติเบิก${type === 'free' ? ' + ใบสำคัญรับเงิน' : ''})</h2><button class="x" data-close>&times;</button></div>
      <div class="sr-dialog-body">
        <div class="sr-section"><h4>ข้อมูลบันทึกข้อความ</h4><div class="sr-grid sr-g4">
          <div class="sr-field"><label>ชื่อรอบ</label><input class="sr-input" id="mf_round_label" value="${esc(val('round_label', ''))}" placeholder="เช่น รอบ 19 พ.ศ. 2569"></div>
          <div class="sr-field"><label>เลขที่ (ที่ ...)</label><input class="sr-input" id="mf_doc_no" value="${esc(val('doc_no', ''))}"></div>
          <div class="sr-field"><label>วันที่</label><input class="sr-input" type="date" id="mf_doc_date" value="${esc(val('doc_date', L.todayIso()))}"></div>
          <div class="sr-field"><label>วันที่รับเงิน (ใบสำคัญ)</label><input class="sr-input" type="date" id="mf_receipt_date" value="${esc(val('receipt_date', ''))}"></div>
          <div class="sr-field"><label>ตั้งแต่วันที่</label><input class="sr-input" type="date" id="mf_period_start" value="${esc(val('period_start', (R.batches[0] || {}).period_start || ''))}"></div>
          <div class="sr-field"><label>ถึงวันที่</label><input class="sr-input" type="date" id="mf_period_end" value="${esc(val('period_end', (R.batches[0] || {}).period_end || ''))}"></div>
          ${type === 'paid' ? `<div class="sr-field"><label>จำนวนเรื่อง</label><input class="sr-input" type="number" id="mf_item_count" value="${esc(val('item_count', ''))}"></div>
          <div class="sr-field"><label>จำนวนเงิน (บาท)</label><input class="sr-input" type="number" id="mf_total_amount" value="${esc(val('total_amount', ''))}"></div>
          <div class="sr-field sr-span4"><button class="sr-btn" type="button" id="mf_pull_paid"><i class="fa-solid fa-calculator"></i> คำนวณจากบัญชีจ่ายหมาย (หมายเงินในช่วงวันที่)</button> <span class="sr-muted" id="mf_paid_info"></span></div>` : ''}
          <div class="sr-field"><label>ผู้รายงาน / ผู้รับเงิน</label><input class="sr-input" id="mf_reporter_name" value="${esc(val('reporter_name', prof.name || myName()))}"></div>
          <div class="sr-field"><label>ตำแหน่ง</label><input class="sr-input" id="mf_reporter_position" value="${esc(val('reporter_position', prof.position || ''))}"></div>
          <div class="sr-field sr-span2"><label>ที่อยู่ผู้รับเงิน</label><input class="sr-input" id="mf_reporter_address" value="${esc(val('reporter_address', settings().reporter_address || ''))}"></div>
          <div class="sr-field"><label>เจ้าหน้าที่เสนอ (เรียน ผอ.)</label><select class="sr-select" id="mf_officer">${opts('officer', val('officer_name', officer && officer.full_name))}</select></div>
          <div class="sr-field"><label>ผู้อำนวยการ (ผู้อนุมัติ)</label><select class="sr-select" id="mf_director">${opts('director', val('director_name', director && director.full_name))}</select></div>
          <div class="sr-field"><label>ผู้จ่ายเงิน (ใบสำคัญ)</label><select class="sr-select" id="mf_payer">${opts('payer', val('payer_name', payer && payer.full_name))}</select></div>
          <div class="sr-field"><label>หมายเหตุ</label><input class="sr-input" id="mf_note" value="${esc(val('note', ''))}"></div>
        </div></div>
        ${type === 'free' ? `<div class="sr-section"><h4>รายการส่งหมาย (ใบสำคัญรับเงินหมายฟรี)</h4>
          <div class="sr-toolbar"><button class="sr-btn primary" type="button" id="mf_pull_free"><i class="fa-solid fa-rotate"></i> ดึงหมายฟรีที่เลือก "เบิก" (ในช่วงวันที่)</button>
            <button class="sr-btn" type="button" id="mf_add_row"><i class="fa-solid fa-plus"></i> เพิ่มแถว</button><span class="grow"></span><span class="sr-muted" id="mf_total"></span></div>
          <div class="sr-note" style="margin-top:8px">กติกา (ตาม summon-report): บ้านเลขที่ หมู่ ตำบล อำเภอ เดียวกัน = เบิกได้หมายเดียว (แถวสีแดง ห้ามบันทึก) · หมู่เดียวกันแต่คนละบ้าน = เบิก 50%</div>
          <div class="sr-scroll" style="margin-top:8px;max-height:360px"><table class="sr-table" id="mf_items"></table></div></div>` : ''}
      </div>
      <div class="sr-dialog-foot"><span class="grow"></span><button class="sr-btn" data-close>ยกเลิก</button><button class="sr-btn primary" id="mf_save"><i class="fa-solid fa-floppy-disk"></i> บันทึกรายงาน</button></div></div>`;
    document.body.appendChild(wrap); document.body.style.overflow = 'hidden';
    const close = () => { wrap.remove(); document.body.style.overflow = ''; };
    const g = (k) => wrap.querySelector('#mf_' + k);
    let dup = [];
    const ITEM_COLS = [['case_no', 'หมายเลขคดี', 110], ['issue_date', 'วันที่จ่าย', 125, 'date'], ['serve_date', 'วันที่ส่ง', 125, 'date'], ['summon_type', 'หมายอะไร', 140], ['recipient_role', 'ส่งให้ใคร', 90],
      ['house_no', 'บ้านเลขที่', 70], ['moo', 'หมู่', 45], ['subdistrict', 'ตำบล', 100], ['district', 'อำเภอ', 110], ['base_rate', 'ราคาหมาย', 80, 'number']];
    function renderItems() {
      const t = g('items'); if (!t) return;
      const ev = L.evaluateFreeSummonItems(items);
      items = ev.items; dup = ev.duplicate_indices;
      const missing = (x) => ['case_no', 'serve_date', 'summon_type', 'house_no', 'subdistrict', 'district'].filter((k) => !String(x[k] == null ? '' : x[k]).trim()).length + (Number(x.base_rate) > 0 ? 0 : 1);
      t.innerHTML = `<thead><tr><th>#</th>${ITEM_COLS.map((c) => `<th>${c[1]}</th>`).join('')}<th class="num">ราคาเบิก</th><th class="ctr">แก้ไข</th><th></th></tr></thead><tbody>${items.map((it, i) => `<tr style="${ev.items[i].calc_rule === 'duplicate' ? 'background:#fef2f2' : ev.items[i].calc_rule === 'half' ? 'background:#fffbeb' : ''}">
        <td>${i + 1}${missing(it) ? ' <span class="sr-chip warn" title="ข้อมูลยังไม่ครบ">!</span>' : ''}</td>${ITEM_COLS.map((c) => `<td><input class="sr-input" style="width:${c[2]}px" data-i="${i}" data-k="${c[0]}" type="${c[3] || 'text'}" value="${esc(it[c[0]] == null ? '' : it[c[0]])}"></td>`).join('')}
        <td class="num">${L.money2(it.claim_rate)}${it.calc_rule === 'half' ? '<div class="sr-muted">50%</div>' : it.calc_rule === 'duplicate' ? '<div class="sr-chip red">ซ้ำ</div>' : ''}</td>
        <td class="ctr" style="white-space:nowrap"><button class="sr-btn sm" data-iedit="${i}" type="button" title="แก้ไขรายการนี้"><i class="fa-solid fa-pen"></i></button>${it.issued_id ? `<button class="sr-btn sm" data-irep="${it.issued_id}" type="button" title="เปิดแบบรายงานหมายของรายการนี้"><i class="fa-solid fa-file-pen"></i></button>` : ''}</td>
        <td><button class="sr-btn sm danger" data-del="${i}" type="button"><i class="fa-solid fa-xmark"></i></button></td></tr>`).join('')}</tbody>`;
      g('total').textContent = `${items.length} รายการ · รวมเบิก ${L.money2(ev.total_amount)} บาท (${L.bahtText(ev.total_amount)})`;
    }
    wrap.addEventListener('change', (e) => {
      const el = e.target; if (el.dataset.i == null) return;
      const i = Number(el.dataset.i); items[i][el.dataset.k] = el.type === 'number' ? Number(el.value) || 0 : el.value;
      if (['subdistrict', 'district', 'moo'].includes(el.dataset.k) && !items[i].base_rate_manual) items[i].base_rate = freeRateFor(items[i]) || items[i].base_rate;
      if (el.dataset.k === 'base_rate') items[i].base_rate_manual = true;
      renderItems();
    });
    wrap.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) return close();
      const del = e.target.closest('[data-del]'); if (del) { items.splice(Number(del.dataset.del), 1); return renderItems(); }
      if (e.target.closest('#mf_add_row')) { items.push({ case_prefix: 'คดีดำ', province: 'จ.อุดรธานี', base_rate: 0 }); return renderItems(); }
      const rep = e.target.closest('[data-irep]');
      if (rep) { openReportForm(Number(rep.dataset.irep)); return; }
      const ied = e.target.closest('[data-iedit]');
      if (ied) { if (await editMemoItem(Number(ied.dataset.iedit))) renderItems(); return; }
      if (e.target.closest('#mf_pull_free')) { pullFree(true); return; }
      if (e.target.closest('#mf_pull_paid')) {
        const from = g('period_start').value; const to = g('period_end').value;
        const list = R.issued.filter((it) => it.money_type === 'paid' && (!R.f.batch || true))
          .filter((it) => { const d = (it.report && it.report.serve_date) || it.period_end || ''; return (!from || d >= from) && (!to || d <= to); });
        g('item_count').value = list.length; g('total_amount').value = list.reduce((a, it) => a + (Number((it.report && it.report.amount) || it.price) || 0), 0);
        g('paid_info').textContent = `พบหมายเงิน ${list.length} รายการ`;
        return;
      }
      if (e.target.closest('#mf_save')) {
        if (type === 'free' && dup.length) return Swal.fire({ icon: 'error', title: 'พบรายการที่อยู่ซ้ำ', text: 'บ้านเลขที่ หมู่ ตำบล อำเภอ เดียวกัน เบิกได้เพียงหมายเดียว — ลบแถวสีแดงก่อนบันทึก' });
        const pick = (kind, id) => signers(kind).find((s) => String(s.id) === String(id)) || {};
        const off = pick('officer', g('officer').value); const dir = pick('director', g('director').value); const pay = pick('payer', g('payer').value);
        const data = {
          id: m.id || 0, report_type: type,
          round_label: g('round_label').value, doc_no: g('doc_no').value, doc_date: g('doc_date').value, receipt_date: g('receipt_date').value,
          period_start: g('period_start').value, period_end: g('period_end').value,
          reporter_name: g('reporter_name').value, reporter_position: g('reporter_position').value, reporter_address: g('reporter_address').value,
          officer_name: off.full_name || '', officer_position: off.position || '', director_name: dir.full_name || '', director_acting: dir.acting ? (dir.acting_title || 'รักษาราชการแทน') : '',
          payer_name: pay.full_name || '', payer_position: pay.position || '', note: g('note').value,
        };
        if (type === 'paid') { data.item_count = g('item_count').value; data.total_amount = g('total_amount').value; data.amount_text = L.bahtText(Number(data.total_amount) || 0); }
        else { data.items = items; data.amount_text = L.bahtText(L.evaluateFreeSummonItems(items).total_amount); }
        try { const r = await api('sr_memo_save', data); close(); toast('success', r.message); R.sub = 'memos'; renderSub(); } catch (er) {
          if (er.data && er.data.duplicate_indices) { dup = er.data.duplicate_indices; renderItems(); }
          fail(er);
        }
      }
    });
    /** ดึงหมายฟรีที่เลือกเบิกในช่วงวันที่ (เพิ่มเฉพาะที่ยังไม่มีในตาราง) */
    function pullFree(notify) {
      const list = claimableFree(g('period_start').value, g('period_end').value);
      const have = new Set(items.map((x) => x.issued_id).filter(Boolean));
      const add = list.filter((it) => !have.has(it.id));
      add.forEach((it) => items.push(freeMemoItemOf(it)));
      renderItems();
      if (notify) toast(add.length ? 'success' : 'info', add.length ? `เพิ่ม ${add.length} รายการ` : (list.length ? 'มีครบทุกรายการแล้ว' : 'ไม่พบหมายฟรีที่เลือก "เบิก" ในช่วงวันที่นี้'));
      return add.length;
    }
    /** แก้ไขรายการในใบสำคัญ (ข้อมูลครบทุกช่อง + การเบิก) */
    async function editMemoItem(i) {
      const x = items[i]; if (!x) return false;
      const src = x.issued_id ? R.issued.find((y) => y.id === x.issued_id) : null;
      const F = [['case_no', 'หมายเลขคดี'], ['issue_date', 'วันที่จ่ายหมาย', 'date'], ['serve_date', 'วันที่ส่งหมาย', 'date'], ['summon_type', 'หมายอะไร'], ['recipient', 'ชื่อผู้รับ'], ['recipient_role', 'ส่งให้ใคร (ฐานะ)'],
        ['house_no', 'บ้านเลขที่'], ['moo', 'หมู่ที่'], ['subdistrict', 'ตำบล'], ['district', 'อำเภอ'], ['base_rate', 'ราคาหมาย (บาท)', 'number']];
      const mode = x.claim_mode || 'full';
      const out = await Swal.fire({
        title: `แก้ไขรายการที่ ${i + 1}`, width: 760, showCancelButton: true, confirmButtonText: 'บันทึก', cancelButtonText: 'ยกเลิก',
        html: `<div class="sr-grid sr-g2" style="text-align:left">${F.map(([k, l, t]) => `<div class="sr-field"><label>${l}</label><input class="sr-input" id="mi_${k}" type="${t || 'text'}" value="${esc(x[k] == null ? '' : x[k])}"></div>`).join('')}
          <div class="sr-field sr-span2"><label>การเบิก</label><div class="sr-radio">${[['full', 'เบิกเต็ม'], ['half', 'เบิกครึ่ง'], ['none', 'ไม่เบิก (เอาออกจากใบสำคัญ)']].map(([v, l]) => `<label><input type="radio" name="mi_claim" value="${v}" ${mode === v ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>
          ${src ? '<div class="sr-muted sr-span2">การเบิกจะปรับที่หน้ารายงานหมายด้วย (ตามกฎบ้าน/หมู่บ้านเดียวกัน)</div>' : ''}</div>`,
        preConfirm: () => {
          const v = Object.fromEntries(F.map(([k, , t]) => { const el = document.getElementById('mi_' + k); return [k, t === 'number' ? Number(el.value) || 0 : el.value.trim()]; }));
          v.claim_mode = (document.querySelector('input[name="mi_claim"]:checked') || {}).value || 'full';
          return v;
        },
      });
      if (!out.isConfirmed) return false;
      const v = out.value;
      if (Number(v.base_rate) !== Number(x.base_rate)) x.base_rate_manual = true;
      Object.assign(x, v);
      if (src && v.claim_mode !== (claimChoice(src).mode || 'full')) {
        try { await setFreeClaim(src, v.claim_mode); } catch (er) { fail(er); }
      }
      if (v.claim_mode === 'none') { items.splice(i, 1); }
      // ปรับผลการเบิก (เต็ม/ครึ่ง) ของทุกแถวตามกฎล่าสุด
      items.forEach((y) => { const s0 = y.issued_id && R.issued.find((z) => z.id === y.issued_id); if (s0) { const p = claimPlan(claimScope(s0)).get(s0.id) || {}; y.claim_mode = claimChoice(s0).mode || y.claim_mode; y.claim_eff = p.eff || y.claim_eff; } });
      return true;
    }
    ['period_start', 'period_end'].forEach((k) => { const el = g(k); if (el) el.addEventListener('change', () => { if (type === 'free') pullFree(false); }); });
    // สร้างใบสำคัญหมายฟรีใหม่ → แสดงรายการหมายฟรีที่เลือก "เบิก" ให้ทันที
    if (type === 'free' && !m.id && !items.length) {
      const n = pullFree(false);
      const info = g('total');
      if (info && n) info.insertAdjacentHTML('beforebegin', `<span class="sr-chip ok" style="margin-right:8px">ดึงหมายฟรีที่เลือกเบิกมาให้ ${n} รายการ</span>`);
    }
    renderItems();
  }

  // ---------------- 3) อัตราค่านำหมาย ----------------
  function renderRates(body) {
    const s = settings(); const admin = isAdmin();
    const heads = R.rateType === 'paid' ? [s.paid_header] : [s.free_header_1, s.free_header_2, s.free_header_3];
    body.innerHTML = `<div class="sr-card"><div class="sr-toolbar">
        <div class="sr-radio"><label><input type="radio" name="sr_rt" value="free" ${R.rateType === 'free' ? 'checked' : ''}> อัตราหมายฟรี (หมายศาล)</label><label><input type="radio" name="sr_rt" value="paid" ${R.rateType === 'paid' ? 'checked' : ''}> อัตราหมายเงิน</label></div>
        <input class="sr-input" id="srRateQ" placeholder="ค้นหาอำเภอ/ตำบล" value="${esc(R.rateQ)}" style="width:220px">
        <span class="grow"></span>
        ${admin ? '<button class="sr-btn" id="srRateAdd"><i class="fa-solid fa-plus"></i> เพิ่มอัตรา</button><button class="sr-btn" id="srRateImport"><i class="fa-solid fa-file-import"></i> นำเข้า Excel/PDF</button><button class="sr-btn" id="srRateMeta"><i class="fa-solid fa-heading"></i> หัวประกาศ/หมายเหตุ</button>' : ''}
        <button class="sr-btn" id="srRateXlsx"><i class="fa-solid fa-file-excel"></i> ส่งออก Excel</button>
        <button class="sr-btn" id="srRatePdf"><i class="fa-solid fa-file-pdf"></i> PDF</button></div>
      <div style="margin-top:12px">${heads.filter(Boolean).map((h) => `<div style="text-align:center;font-weight:600;color:var(--c-primary)">${esc(h)}</div>`).join('')}</div>
      <div class="sr-scroll" style="margin-top:10px"><table class="sr-table"><thead><tr><th>อำเภอ</th><th>ตำบล</th><th>หมายเหตุ/ข้อยกเว้น</th><th class="num">ค่าหมาย (บาท)</th>${admin ? '<th class="ctr">จัดการ</th>' : ''}</tr></thead><tbody id="srRateRows"></tbody></table></div>
      <p class="sr-muted" style="white-space:pre-line;margin-top:10px">${esc(R.rateType === 'paid' ? s.paid_notes : s.free_notes)}</p></div>`;
    const fill = () => {
      const q = R.rateQ.trim();
      const list = (R.boot.rates || []).filter((r) => r.rate_type === R.rateType && (!q || (r.district + r.subdistrict + r.exception_note).includes(q)));
      let last = '';
      $('#srRateRows').innerHTML = list.map((r) => {
        const d = L.cleanDistrict(r.district); const grp = d !== last ? (last = d, true) : false;
        return `<tr><td>${grp ? `<b>อำเภอ${esc(d)}</b>` : ''}</td><td>ตำบล${esc(r.subdistrict)}</td><td>${esc(r.exception_note)}</td><td class="num">${L.money2(r.rate_amount)}</td>
          ${admin ? `<td class="ctr"><button class="sr-btn sm" data-redit="${r.id}"><i class="fa-solid fa-pen"></i></button><button class="sr-btn sm danger" data-rdel="${r.id}"><i class="fa-solid fa-trash"></i></button></td>` : ''}</tr>`;
      }).join('') || '<tr><td colspan="5"><div class="sr-empty">ไม่พบรายการ</div></td></tr>';
    };
    fill();
    body.querySelectorAll('input[name="sr_rt"]').forEach((r) => { r.onchange = () => { R.rateType = r.value; renderRates(body); }; });
    $('#srRateQ').oninput = (e) => { R.rateQ = e.target.value; fill(); };
    $('#srRateXlsx').onclick = async () => downloadBlob(await E.ratesWorkbook(R.boot.rates, settings(), 'all').toBlob(), 'อัตราค่านำหมาย_ศาลจังหวัดอุดรธานี.xlsx');
    $('#srRatePdf').onclick = () => openPdf(E.ratesPrintHtml(R.boot.rates, settings(), R.rateType, baseUrl()), 'อัตราค่านำหมาย');
    if (!admin) return;
    const reload = async () => { await ensureBoot(true); renderRates(body); };
    const editRate = async (r) => {
      r = r || { rate_type: R.rateType };
      const out = await Swal.fire({
        title: r.id ? 'แก้ไขอัตรา' : 'เพิ่มอัตรา', showCancelButton: true, confirmButtonText: 'บันทึก', cancelButtonText: 'ยกเลิก',
        html: `<div class="sr-grid sr-g2" style="text-align:left">
          <div class="sr-field"><label>ประเภท</label><select class="sr-select" id="re_t"><option value="free" ${r.rate_type === 'free' ? 'selected' : ''}>หมายฟรี</option><option value="paid" ${r.rate_type === 'paid' ? 'selected' : ''}>หมายเงิน</option></select></div>
          <div class="sr-field"><label>ค่าหมาย (บาท)</label><input class="sr-input" id="re_a" type="number" value="${esc(r.rate_amount || '')}"></div>
          <div class="sr-field"><label>อำเภอ</label><input class="sr-input" id="re_d" value="${esc(r.district || '')}"></div>
          <div class="sr-field"><label>ตำบล</label><input class="sr-input" id="re_s" value="${esc(r.subdistrict || '')}"></div>
          <div class="sr-field sr-span2"><label>หมายเหตุ/ข้อยกเว้น (เช่น ยกเว้นหมู่ 18)</label><input class="sr-input" id="re_n" value="${esc(r.exception_note || '')}"></div></div>`,
        preConfirm: () => ({ id: r.id || 0, rate_type: $('#re_t').value, rate_amount: $('#re_a').value, district: $('#re_d').value, subdistrict: $('#re_s').value, exception_note: $('#re_n').value }),
      });
      if (out.isConfirmed) { try { await api('sr_rate_save', out.value); await reload(); toast('success', 'บันทึกแล้ว'); } catch (e) { fail(e); } }
    };
    $('#srRateAdd').onclick = () => editRate(null);
    $('#srRateRows').onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.redit) editRate(R.boot.rates.find((x) => String(x.id) === b.dataset.redit));
      if (b.dataset.rdel) {
        const ok = await Swal.fire({ icon: 'warning', title: 'ลบอัตรานี้?', showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#b91c1c' });
        if (ok.isConfirmed) { try { await api('sr_rate_delete', { id: b.dataset.rdel }); await reload(); } catch (er) { fail(er); } }
      }
    };
    $('#srRateMeta').onclick = async () => {
      const keys = [['paid_header', 'หัวประกาศ หมายเงิน'], ['paid_notes', 'หมายเหตุ หมายเงิน'], ['free_header_1', 'หัวประกาศ หมายฟรี บรรทัด 1'], ['free_header_2', 'บรรทัด 2'], ['free_header_3', 'บรรทัด 3'], ['free_notes', 'หมายเหตุ หมายฟรี']];
      const out = await Swal.fire({
        title: 'หัวประกาศและหมายเหตุ', width: 800, showCancelButton: true, confirmButtonText: 'บันทึก', cancelButtonText: 'ยกเลิก',
        html: `<div style="text-align:left">${keys.map(([k, l]) => `<div class="sr-field" style="margin-bottom:8px"><label>${l}</label><textarea class="sr-textarea" style="width:100%" rows="${/notes/.test(k) ? 4 : 2}" id="mt_${k}">${esc(settings()[k] || '')}</textarea></div>`).join('')}</div>`,
        preConfirm: () => Object.fromEntries(keys.map(([k]) => [k, $('#mt_' + k).value])),
      });
      if (out.isConfirmed) { try { await api('sr_settings_save', { values: out.value }); await reload(); } catch (e) { fail(e); } }
    };
    $('#srRateImport').onclick = async () => {
      const [file] = await pickFiles('.xlsx,.xls,.pdf', false);
      if (!file) return;
      busy('กำลังอ่านไฟล์อัตรา...');
      try {
        let parsed;
        if (/\.pdf$/i.test(file.name)) {
          if (!window.pdfjsLib) throw new Error('ไม่พบไลบรารี PDF.js');
          const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
          const lines = [];
          for (let p = 1; p <= pdf.numPages; p++) {
            const tc = await (await pdf.getPage(p)).getTextContent();
            const byY = new Map();
            tc.items.forEach((t) => { const y = Math.round(t.transform[5]); byY.set(y, (byY.get(y) || []).concat({ x: t.transform[4], s: t.str })); });
            Array.from(byY.keys()).sort((a, b) => b - a).forEach((y) => lines.push(byY.get(y).sort((a, b) => a.x - b.x).map((t) => t.s).join(' ')));
          }
          const list = L.parseRatePdfLines(lines);
          parsed = { paid: [], free: [], meta: {} };
          done();
          const t = await Swal.fire({ title: `พบ ${list.length} รายการ — เป็นอัตราประเภทใด?`, input: 'radio', inputOptions: { free: 'หมายฟรี', paid: 'หมายเงิน' }, inputValue: R.rateType, showCancelButton: true, confirmButtonText: 'ต่อไป', cancelButtonText: 'ยกเลิก' });
          if (!t.isConfirmed) return;
          parsed[t.value] = list;
        } else {
          parsed = L.parseRatesWorkbook(await readWorkbook(file));
          done();
        }
        const ok = await Swal.fire({ icon: 'question', title: 'ยืนยันการนำเข้าอัตรา', html: `หมายเงิน ${parsed.paid.length} รายการ · หมายฟรี ${parsed.free.length} รายการ<br><span class="sr-muted">ประเภทที่มีข้อมูลในไฟล์จะถูกแทนที่ทั้งชุด</span>`, showCancelButton: true, confirmButtonText: 'นำเข้า', cancelButtonText: 'ยกเลิก' });
        if (!ok.isConfirmed) return;
        const r = await api('sr_rates_import', Object.assign({ mode: 'replace' }, parsed));
        await reload(); toast('success', r.message);
      } catch (e) { done(); fail(e); }
    };
  }

  // ---------------- 4) ผู้ลงนามและตั้งค่า ----------------
  const KIND_LABEL = { inspector: 'ผู้ตรวจ (แบบรายงานผลหมาย)', payer: 'ผู้จ่ายเงิน', director: 'ผู้อำนวยการ (ผู้อนุมัติ — บันทึกข้อความ)', officer: 'เจ้าหน้าที่เสนอ (เรียน ผอ. — บันทึกข้อความ)' };
  async function signerDialog(sg) {
    const kind = sg.kind; const admin = isAdmin();
    const out = await Swal.fire({
      title: (sg.id ? 'แก้ไข' : 'เพิ่ม') + KIND_LABEL[kind], width: 640, showCancelButton: true, confirmButtonText: 'บันทึก', cancelButtonText: 'ยกเลิก',
      html: `<div class="sr-grid sr-g2" style="text-align:left">
        <div class="sr-field sr-span2"><label>ชื่อ-สกุล (รวมคำนำหน้า)</label><input class="sr-input" id="sg_n" value="${esc(sg.full_name || '')}" placeholder="เช่น นายณัฐพงศ์  กุบแก้ว"></div>
        <div class="sr-field sr-span2"><label>ตำแหน่ง</label><input class="sr-input" id="sg_p" value="${esc(sg.position || '')}"></div>
        <div class="sr-field"><label><input type="checkbox" id="sg_a" ${sg.acting ? 'checked' : ''}> ${kind === 'director' ? 'รักษาราชการแทน' : 'ปฏิบัติราชการแทน'}</label></div>
        <div class="sr-field"><label>ข้อความต่อท้าย (เช่น ผู้อำนวยการสำนักอำนวยการประจำศาล...)</label><input class="sr-input" id="sg_t" value="${esc(sg.acting_title || (kind === 'inspector' ? settings().director_title || '' : ''))}"></div>
        ${admin ? `<div class="sr-field sr-span2"><label><input type="checkbox" id="sg_d" ${sg.is_default ? 'checked' : ''}> ตั้งเป็นค่าเริ่มต้นของทุกคน</label></div>` : ''}</div>`,
      preConfirm: () => {
        const v = { id: sg.id || 0, kind, full_name: $('#sg_n').value.trim(), position: $('#sg_p').value.trim(), acting: $('#sg_a').checked, acting_title: $('#sg_t').value.trim(), is_default: admin ? $('#sg_d').checked : !!sg.is_default };
        if (!v.full_name) { Swal.showValidationMessage('กรุณากรอกชื่อ-สกุล'); return false; }
        return v;
      },
    });
    if (!out.isConfirmed) return null;
    try { const r = await api('sr_signer_save', out.value); toast('success', r.message); return r.id; } catch (e) { fail(e); return null; }
  }
  function renderSettings(body) {
    const admin = isAdmin(); const s = settings(); const prof = profile();
    const block = (kind) => `<div class="sr-card"><div class="sr-toolbar"><h3 style="margin:0">${KIND_LABEL[kind]}</h3><span class="grow"></span>
        ${(kind === 'inspector' || kind === 'payer' || admin) ? `<button class="sr-btn sm primary" data-sadd="${kind}"><i class="fa-solid fa-plus"></i> เพิ่ม</button>` : ''}</div>
      <table class="sr-table" style="margin-top:8px"><thead><tr><th>ชื่อ-สกุล</th><th>ตำแหน่ง</th><th>ข้อความต่อท้าย</th><th></th><th class="ctr">จัดการ</th></tr></thead><tbody>
      ${signers(kind).map((sg) => `<tr><td>${esc(sg.full_name)}</td><td>${esc(sg.position)}</td><td>${sg.acting ? esc(kind === 'director' ? (sg.acting_title || 'รักษาราชการแทน') : 'ปฏิบัติราชการแทน ' + (sg.acting_title || '')) : '-'}</td><td>${sg.is_default ? '<span class="sr-chip ok">ค่าเริ่มต้น</span>' : ''}</td>
        <td class="ctr">${(admin || sg.created_by === myUser()) ? `<button class="sr-btn sm" data-sedit="${sg.id}"><i class="fa-solid fa-pen"></i></button><button class="sr-btn sm danger" data-sdel="${sg.id}"><i class="fa-solid fa-trash"></i></button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="sr-muted">ยังไม่มีรายชื่อ</td></tr>'}
      </tbody></table></div>`;
    body.innerHTML = `
      <div class="sr-card"><h3>ข้อมูลของฉัน (ผู้ส่งหมาย / ผู้รายงานในแบบรายงาน)</h3>
        <div class="sr-muted" style="margin-bottom:8px">บันทึกลงบัญชีผู้ใช้ @${esc(myUser())} — ใช้ทุกเครื่อง และใช้จับคู่ชื่อผู้ส่งในตารางโซนจ่ายหมาย</div>
        <div class="sr-grid sr-g4">
        <div class="sr-field"><label>คำนำหน้า</label><input class="sr-input" id="pf_title" list="pf_titles" value="${esc(meInfo().title)}"><datalist id="pf_titles"><option value="นาย"><option value="นาง"><option value="นางสาว"><option value="ว่าที่ร้อยตรี"></datalist></div>
        <div class="sr-field"><label>ชื่อ <span class="req">*</span></label><input class="sr-input" id="pf_first" value="${esc(meInfo().first || '')}"></div>
        <div class="sr-field"><label>นามสกุล <span class="req">*</span></label><input class="sr-input" id="pf_last" value="${esc(meInfo().last || '')}"></div>
        <div class="sr-field"><label>ตำแหน่ง</label><input class="sr-input" id="pf_position" value="${esc(meInfo().position || prof.position || '')}" placeholder="เช่น เจ้าพนักงานศาลยุติธรรมปฏิบัติงาน"></div>
        <div class="sr-field"><button class="sr-btn primary" id="pf_save"><i class="fa-solid fa-floppy-disk"></i> บันทึกข้อมูลของฉัน</button></div></div></div>
      ${['inspector', 'payer', 'director', 'officer'].map(block).join('')}
      <div class="sr-card"><div class="sr-toolbar"><h3 style="margin:0">คำสั่งศาลแต่งตั้งเจ้าพนักงาน (ใช้ในบันทึกข้อความ)</h3><span class="grow"></span>${admin ? '<button class="sr-btn sm primary" id="srOrderAdd"><i class="fa-solid fa-plus"></i> เพิ่มคำสั่งฉบับใหม่</button>' : ''}</div>
        <table class="sr-table" style="margin-top:8px"><thead><tr><th>คำสั่ง</th><th>หมายเหตุ</th><th></th></tr></thead><tbody>${(R.boot.orders || []).map((o, i) => `<tr><td>${esc(o.order_text)} ${i === 0 ? '<span class="sr-chip ok">ฉบับล่าสุด</span>' : ''}</td><td class="sr-muted">${esc(o.note)}</td><td class="ctr">${admin ? `<button class="sr-btn sm danger" data-odel="${o.id}"><i class="fa-solid fa-trash"></i></button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="sr-card"><h3>การตั้งค่าเอกสาร</h3><div class="sr-grid sr-g3">
        <div class="sr-field"><label>ตัวเลขในไฟล์ Word</label><select class="sr-select" id="st_doc_digits" ${admin ? '' : 'disabled'}><option value="thai" ${s.doc_digits !== 'arabic' ? 'selected' : ''}>เลขไทย (๑๒๓) ตามแบบฟอร์มศาล</option><option value="arabic" ${s.doc_digits === 'arabic' ? 'selected' : ''}>เลขอารบิก (123)</option></select></div>
        <div class="sr-field"><label>ที่อยู่ผู้รับเงิน (ใบสำคัญรับเงิน)</label><input class="sr-input" id="st_reporter_address" value="${esc(s.reporter_address || '')}" ${admin ? '' : 'readonly'}></div>
        <div class="sr-field"><label>ตำแหน่ง ผอ. (ข้อความใต้ผู้ตรวจ)</label><input class="sr-input" id="st_director_title" value="${esc(s.director_title || '')}" ${admin ? '' : 'readonly'}></div>
        ${admin ? '<div class="sr-field"><button class="sr-btn primary" id="st_save"><i class="fa-solid fa-floppy-disk"></i> บันทึกการตั้งค่า</button></div>' : ''}</div></div>`;
    const reload = async () => { await ensureBoot(true); renderSettings(body); };

    $('#pf_save').onclick = async () => {
      const v = { title: $('#pf_title').value.trim(), firstName: $('#pf_first').value.trim(), lastName: $('#pf_last').value.trim(), position: $('#pf_position').value.trim() };
      if (!v.firstName || !v.lastName) return fail(new Error('กรุณากรอกชื่อและนามสกุล'));
      try {
        busy('กำลังบันทึก...');
        const out = await SLTS.api('save_user', { username: myUser(), ...v });
        const st = appState();
        if (st && st.currentUser && out.user) { Object.assign(st.currentUser, out.user); try { localStorage.setItem('slts_current_user', JSON.stringify(st.currentUser)); } catch (_) {} }
        LS.set(profileKey(), Object.assign(profile(), { position: v.position }));
        await reload(); done(); toast('success', 'บันทึกข้อมูลของฉันแล้ว');
      } catch (er) { done(); fail(er); }
    };
    body.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.sadd) { if (await signerDialog({ kind: b.dataset.sadd })) await reload(); }
        else if (b.dataset.sedit) { const sg = R.boot.signers.find((x) => String(x.id) === b.dataset.sedit); if (await signerDialog(sg)) await reload(); }
        else if (b.dataset.sdel) {
          const ok = await Swal.fire({ icon: 'warning', title: 'ลบรายชื่อนี้?', showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#b91c1c' });
          if (ok.isConfirmed) { await api('sr_signer_delete', { id: b.dataset.sdel }); await reload(); }
        } else if (b.dataset.odel) {
          const ok = await Swal.fire({ icon: 'warning', title: 'ลบคำสั่งนี้?', showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก' });
          if (ok.isConfirmed) { await api('sr_order_delete', { id: b.dataset.odel }); await reload(); }
        } else if (b.id === 'srOrderAdd') {
          const out = await Swal.fire({
            title: 'เพิ่มคำสั่งศาลฉบับใหม่', width: 700, showCancelButton: true, confirmButtonText: 'บันทึก', cancelButtonText: 'ยกเลิก',
            html: `<div style="text-align:left"><div class="sr-field"><label>ข้อความคำสั่ง (ใช้ในย่อหน้า "ตาม...")</label><textarea class="sr-textarea" style="width:100%" rows="2" id="od_t" placeholder="คำสั่งศาลจังหวัดอุดรธานี ที่ .../2569 ลงวันที่ ..."></textarea></div>
              <div class="sr-grid sr-g2" style="margin-top:8px"><div class="sr-field"><label>เลขที่คำสั่ง</label><input class="sr-input" id="od_n"></div><div class="sr-field"><label>ลงวันที่</label><input class="sr-input" id="od_d"></div></div>
              <div class="sr-field" style="margin-top:8px"><label>หมายเหตุ</label><input class="sr-input" style="width:100%" id="od_note"></div></div>`,
            preConfirm: () => ({ order_text: $('#od_t').value, order_no: $('#od_n').value, order_date: $('#od_d').value, note: $('#od_note').value }),
          });
          if (out.isConfirmed) { await api('sr_order_save', out.value); await reload(); }
        } else if (b.id === 'st_save') {
          await api('sr_settings_save', { values: { doc_digits: $('#st_doc_digits').value, reporter_address: $('#st_reporter_address').value, director_title: $('#st_director_title').value } });
          await reload(); toast('success', 'บันทึกการตั้งค่าแล้ว');
        }
      } catch (er) { fail(er); }
    };
  }

  // ------------------------------------------------------------------
  // แท็บ "รายการส่งหมายรอบนี้": ภาพที่อัปโหลดจากมือถือในรอบนี้ + ปุ่มรายงานหมาย
  // ------------------------------------------------------------------
  const UP = { range: LS.get('sr_upload_range', 'round'), from: '', to: '' };
  function roundStart() {
    if (UP.range === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
    if (UP.range === '3d' || UP.range === '7d') { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() - (UP.range === '3d' ? 2 : 6) * 864e5; }
    if (UP.range === 'custom') return UP.from ? new Date(UP.from + 'T00:00:00').getTime() : 0;
    // รอบนี้: เริ่มรอบเส้นทางปัจจุบัน (ถ้ามี) ไม่เช่นนั้นตั้งแต่เริ่มวันนี้
    let t = 0;
    try { if (typeof window.getRouteStartTime === 'function') t = window.getRouteStartTime(); else if (typeof getRouteStartTime === 'function') t = getRouteStartTime(); } catch (_) {}
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return t > 0 ? Math.min(t - 15 * 60000, today.getTime()) : today.getTime();
  }
  function roundUploads() {
    const me = myUser(); const from = roundStart();
    const to = UP.range === 'custom' && UP.to ? new Date(UP.to + 'T23:59:59').getTime() : Infinity;
    const seen = new Set();
    return sheetRows().map(photoFromRow).filter(Boolean)
      .filter((p) => (!me || p.uploader === me) && p.time >= from && p.time <= to)
      .filter((p) => (seen.has(p.id) ? false : seen.add(p.id)))
      .sort((a, b) => b.time - a.time);
  }
  function ensureUploadsCard() {
    const pane = document.getElementById('tabContentRouteBatch');
    if (!pane || document.getElementById('srUploadsCard')) return;
    const card = document.createElement('div');
    card.id = 'srUploadsCard';
    card.className = 'bg-white rounded-2xl shadow-sm border border-gray-200 p-5 sm:p-6 sr-wrap';
    card.innerHTML = `<div class="sr-toolbar" style="border-bottom:1px solid var(--c-line);padding-bottom:12px">
        <div><div class="sr-kicker">ภาพจากมือถือ (ถ่ายภาพ / อัปโหลด)</div><h3 style="margin:2px 0 0;color:var(--c-primary);font-size:17px;font-weight:700">ภาพส่งหมายที่อัปโหลดเข้าระบบในรอบนี้ <span class="sr-chip" id="srUpCount">0</span></h3>
          <div class="sr-muted">ดาวน์โหลดภาพได้ทันที และกด "รายงานหมาย" เพื่อกรอกแบบรายงานผลหมาย (อ้างอิงบัญชีจ่ายหมายที่นำเข้า)</div></div>
        <span class="grow"></span>
        <select class="sr-select" id="srUpRange"><option value="round">รอบนี้ (ตั้งแต่เริ่มรอบเส้นทาง/วันนี้)</option><option value="today">วันนี้</option><option value="3d">3 วันล่าสุด</option><option value="7d">7 วันล่าสุด</option><option value="custom">กำหนดช่วงวันที่</option></select>
        <input type="date" class="sr-input" id="srUpFrom" style="display:none"><input type="date" class="sr-input" id="srUpTo" style="display:none">
        <button class="sr-btn" id="srUpRefresh"><i class="fa-solid fa-rotate-right"></i> รีเฟรช</button>
        <button class="sr-btn primary" id="srUpZip"><i class="fa-solid fa-file-zipper"></i> ดาวน์โหลดภาพทั้งหมด (.zip)</button>
        <button class="sr-btn" id="srUpImport"><i class="fa-solid fa-file-excel"></i> นำเข้าบัญชีจ่ายหมาย</button></div>
      <div class="sr-scroll" style="margin-top:12px;max-height:520px"><table class="sr-table"><thead><tr><th>#</th><th>เลขคดี</th><th>สถานที่ส่งหมาย</th><th>วันที่/เวลา</th><th>ภาพ</th><th>บัญชีจ่ายหมาย</th><th class="ctr">ดาวน์โหลด</th><th class="ctr">รายงาน</th></tr></thead><tbody id="srUpRows"></tbody></table></div>`;
    const batchCard = pane.querySelector('#routeBatchTableBody') ? pane.querySelector('#routeBatchTableBody').closest('.bg-white') : null;
    if (batchCard && batchCard.parentNode === pane) batchCard.after(card); else pane.appendChild(card);
    const sel = card.querySelector('#srUpRange'); sel.value = UP.range;
    const syncDates = () => { const c = UP.range === 'custom'; card.querySelector('#srUpFrom').style.display = c ? '' : 'none'; card.querySelector('#srUpTo').style.display = c ? '' : 'none'; };
    syncDates();
    sel.onchange = () => { UP.range = sel.value; LS.set('sr_upload_range', UP.range); syncDates(); refreshUploadsCard(); };
    card.querySelector('#srUpFrom').onchange = (e) => { UP.from = e.target.value; refreshUploadsCard(); };
    card.querySelector('#srUpTo').onchange = (e) => { UP.to = e.target.value; refreshUploadsCard(); };
    card.querySelector('#srUpRefresh').onclick = async () => { try { if (typeof window.loadGoogleSheetData === 'function') await window.loadGoogleSheetData(true); } catch (_) {} if (R.boot) await loadIssued().catch(() => {}); refreshUploadsCard(); };
    card.querySelector('#srUpZip').onclick = zipUploads;
    card.querySelector('#srUpImport').onclick = async () => { await ensureBoot().catch(fail); await importExcelFlow(); refreshUploadsCard(); };
    card.querySelector('#srUpRows').onclick = (e) => {
      const b = e.target.closest('[data-up-dl],[data-up-rep],[data-view]'); if (!b) return;
      if (b.dataset.view) return viewPhoto(b.dataset.view);
      const p = roundUploads().find((x) => x.id === (b.dataset.upDl || b.dataset.upRep));
      if (!p) return;
      if (b.dataset.upDl) return downloadPhoto(p);
      reportFromPhoto(p);
    };
  }
  function refreshUploadsCard() {
    if (!isPc() || !currentUser()) { const c = document.getElementById('srUploadsCard'); if (c) c.style.display = 'none'; return; }
    ensureUploadsCard();
    const card = document.getElementById('srUploadsCard'); if (!card) return;
    card.style.display = '';
    const list = roundUploads();
    card.querySelector('#srUpCount').textContent = `${list.length} ภาพ`;
    card.querySelector('#srUpZip').disabled = !list.length;
    const rowsHtml = list.map((p, i) => {
      const m = R.loadedIssued ? issuedForPhoto(p) : [];
      const st = !R.loadedIssued ? '<span class="sr-muted">—</span>' : m.length
        ? m.map((it) => `<div><span class="sr-chip ${it.report_status !== 'none' ? 'ok' : ''}">${esc(it.kind === 'T' ? it.t_no : it.black_no)}</span> <span class="sr-muted">${esc(String(it.recipient).slice(0, 28))}</span>${it.report_status !== 'none' ? ' <span class="sr-muted">(รายงานแล้ว)</span>' : ''}</div>`).join('')
        : '<span class="sr-chip warn">ไม่พบในบัญชีจ่ายหมาย</span>';
      return `<tr><td>${i + 1}</td><td><b>${esc(p.caseNo)}</b></td><td>${esc(p.loc)}</td><td style="white-space:nowrap">${esc(p.at)}</td>
        <td><img class="sr-thumb" src="${esc(p.thumb)}" data-view="${esc(p.id)}" referrerpolicy="no-referrer" loading="lazy" alt=""></td><td>${st}</td>
        <td class="ctr"><button class="sr-btn sm" data-up-dl="${esc(p.id)}"><i class="fa-solid fa-download"></i> ดาวน์โหลด</button></td>
        <td class="ctr"><button class="sr-btn sm primary" data-up-rep="${esc(p.id)}"><i class="fa-solid fa-file-pen"></i> รายงานหมาย</button></td></tr>`;
    }).join('') || `<tr><td colspan="8"><div class="sr-empty">ยังไม่มีภาพที่อัปโหลดจากมือถือในช่วงเวลานี้</div></td></tr>`;
    // เขียน DOM ใหม่เฉพาะเมื่อข้อมูลเปลี่ยน (รีเฟรชทุก 15 วินาที ไม่ให้ภาพโหลดซ้ำ/กระพริบ)
    const rowsEl = card.querySelector('#srUpRows');
    if (rowsEl.__html !== rowsHtml) { rowsEl.innerHTML = rowsHtml; rowsEl.__html = rowsHtml; }
  }
  const photoFileName = (p, i) => `${i != null ? String(i + 1).padStart(2, '0') + '_' : ''}${(p.caseNo || 'summons').replace(/[\\/:*?"<>|]/g, '-')}_${(p.at || '').replace(/[^0-9]/g, '').slice(0, 14)}.jpg`;
  async function downloadPhoto(p) {
    if (p && p.noPhoto) return toast('info', 'รายการนี้ไม่มีภาพถ่าย (เซ็นรับหมาย)');
    try {
      busy('กำลังดาวน์โหลดภาพ...');
      const img = await photoBytes(p.id);
      done(); downloadBlob(new Blob([img.bytes], { type: img.ext === 'png' ? 'image/png' : 'image/jpeg' }), photoFileName(p));
    } catch (e) {
      done();
      if (typeof window.downloadSingleImageFile === 'function') window.downloadSingleImageFile(p.url, photoFileName(p)); else fail(e);
    }
  }
  async function zipUploads() { return zipPhotos(roundUploads(), `ภาพส่งหมาย_${L.todayIso()}`); }
  async function zipPhotos(list, baseName) {
    if (!list.length) return;
    busy(`กำลังรวมภาพ ${list.length} ภาพ...`);
    try {
      const zip = new window.JSZip(); let n = 0;
      for (let i = 0; i < list.length; i++) {
        if (list[i].noPhoto) continue;
        try { const img = await photoBytes(list[i].id); zip.file(photoFileName(list[i], i), img.bytes); n++; } catch (er) { console.warn('[report] photo skip', er); }
        Swal.update({ title: `กำลังรวมภาพ (${i + 1}/${list.length})...` }); Swal.showLoading();
      }
      const out = await zip.generateAsync({ type: 'blob' });
      done(); downloadBlob(out, `${String(baseName).replace(/[\\/:*?"<>|]+/g, '-')}.zip`);
      if (n < list.length) toast('warning', `ดาวน์โหลดได้ ${n}/${list.length} ภาพ`);
    } catch (e) { done(); fail(e); }
  }
  /** ปุ่ม "รายงานหมาย" จากภาพ: หาหมายในบัญชีจ่ายหมาย (ต้องนำเข้า Excel ก่อน) แล้วเปิดแบบฟอร์ม */
  async function reportFromPhoto(p) {
    try { await ensureBoot(); if (!R.loadedIssued) await loadIssued(); } catch (e) { return fail(e); }
    if (!R.issued.length) {
      const ok = await Swal.fire({ icon: 'info', title: 'ต้องนำเข้าบัญชีจ่ายหมายก่อน', html: 'การรายงานหมายต้องใช้ข้อมูลจากไฟล์ Excel <b>"บัญชีจ่ายหมาย พนักงานศาลนี้ส่ง"</b> เป็นแบบ (เลขคดี โจทก์ จำเลย ราคาหมาย ฯลฯ)', showCancelButton: true, confirmButtonText: 'นำเข้าไฟล์ Excel', cancelButtonText: 'ยกเลิก' });
      if (ok.isConfirmed) { await importExcelFlow(); refreshUploadsCard(); }
      return;
    }
    const pids = p.id ? [p.id] : [];
    const list = issuedForPhoto(p);
    if (list.length === 1) return openReportForm(list[0].id, { photoIds: pids });
    if (!list.length) {
      const ok = await Swal.fire({ icon: 'warning', title: 'ไม่พบหมายนี้ในบัญชีจ่ายหมาย', html: `เลขคดี <b>${esc(p.caseNo)}</b> ไม่อยู่ในบัญชีจ่ายหมายที่นำเข้า<br>นำเข้าไฟล์ Excel รอบล่าสุด หรือเลือกหมายเอง`, showDenyButton: true, showCancelButton: true, confirmButtonText: 'นำเข้าไฟล์ Excel', denyButtonText: 'เลือกจากรายการ', cancelButtonText: 'ยกเลิก' });
      if (ok.isConfirmed) { await importExcelFlow(); refreshUploadsCard(); return; }
      if (!ok.isDenied) return;
    }
    const pool = list.length ? list : R.issued;
    const r = await Swal.fire({
      title: list.length ? 'เลือกผู้รับหมาย (คดีนี้มีหลายรายการ)' : 'เลือกหมายจากบัญชีจ่ายหมาย', width: 760, showConfirmButton: false, showCancelButton: true, cancelButtonText: 'ยกเลิก',
      html: `${list.length ? '' : '<input class="sr-input" id="pk_q" placeholder="ค้นหา" style="width:100%;margin-bottom:8px">'}<div class="sr-picker" id="pk_list"></div>`,
      didOpen: () => {
        const render = (q) => { $('#pk_list').innerHTML = pool.filter((it) => !q || [it.t_no, it.black_no, it.recipient, it.subdistrict].join(' ').includes(q)).slice(0, 200).map((it) => `<div class="row" data-pk="${it.id}"><b>${esc(it.kind === 'T' ? it.t_no : it.black_no)}</b> ${esc(it.summon_type)} — ${esc(it.recipient)}<div class="sr-muted">${esc(it.address_raw)} ต.${esc(it.subdistrict)} อ.${esc(it.district)}</div></div>`).join('') || '<div class="row">ไม่พบ</div>'; };
        render('');
        const q = $('#pk_q'); if (q) q.oninput = () => render(q.value.trim());
        $('#pk_list').onclick = (e) => { const row = e.target.closest('[data-pk]'); if (row) { Swal.close(); openReportForm(Number(row.dataset.pk), { photoIds: pids }); } };
      },
    });
    return r;
  }
  /** เพิ่มปุ่ม "รายงานหมาย" ในตารางลำดับเส้นทางเดิม */
  function hookRouteBatch() {
    const orig = window.renderRouteBatchTab;
    if (typeof orig !== 'function' || orig.__srHooked) return;
    const wrapped = function () {
      const out = orig.apply(this, arguments);
      try {
        const s = appState(); const stops = (s && s.routeBatchStops) || [];
        $$('#routeBatchTableBody > tr').forEach((tr, i) => {
          const stop = stops[i]; if (!stop || tr.querySelector('[data-sr-stop]')) return;
          const cell = tr.lastElementChild && tr.lastElementChild.querySelector('div') ? tr.lastElementChild.querySelector('div') : tr.lastElementChild;
          if (!cell) return;
          const b = document.createElement('button');
          b.type = 'button'; b.dataset.srStop = String(i);
          b.className = 'px-2 py-1 bg-white hover:bg-slate-50 font-bold rounded-lg text-[11px] transition inline-flex items-center gap-1 border cursor-pointer';
          b.style.cssText = 'color:var(--c-primary);border-color:#c7d2e2';
          b.innerHTML = '<i class="fa-solid fa-file-pen text-[10px]"></i> รายงานหมาย';
          b.onclick = () => {
            const photo = typeof window.getNewlyUploadedPhotoForStop === 'function' ? window.getNewlyUploadedPhotoForStop(stop) : null;
            let id = ''; const url = (photo && photo.url) || '';
            const m = url.match(/id=([a-zA-Z0-9_-]+)/) || url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]f=(db-[^&]+)/); if (m) id = decodeURIComponent(m[1]);
            const p = id ? (sheetRows().map(photoFromRow).find((x) => x && x.id === id) || { id, caseNo: stop.caseNumber, loc: stop.locationText || '' })
              : { id: '', caseNo: stop.caseNumber, loc: stop.locationText || '' };
            reportFromPhoto(p);
          };
          cell.appendChild(b);
        });
      } catch (e) { console.warn('[report] route batch hook', e); }
      refreshUploadsCard();
      return out;
    };
    wrapped.__srHooked = true;
    window.renderRouteBatchTab = wrapped;
  }

  // ------------------------------------------------------------------
  // เริ่มทำงาน
  // ------------------------------------------------------------------
  function init() {
    hookNavigation();
    hookRouteBatch();
    syncTabVisibility();
    const ref = document.getElementById('tabBtnRouteBatch');
    if (ref && window.MutationObserver) new MutationObserver(syncTabVisibility).observe(ref, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', syncTabVisibility);
    setInterval(syncTabVisibility, 4000);
    // เมื่อข้อมูลประวัติอัปเดต ให้รีเฟรชรายการภาพรอบนี้ (ถ้าแท็บเปิดอยู่)
    setInterval(() => {
      const pane = document.getElementById('tabContentRouteBatch');
      if (pane && !pane.classList.contains('hidden')) refreshUploadsCard();
    }, 15000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  // ให้ทดสอบ/เรียกจากที่อื่นได้
  window.SltsReportUI = { open: () => window.switchTab('report'), openSub: (sub) => { R.sub = sub; window.switchTab('report'); }, openFlow: () => { R.sub = 'flow'; window.switchTab('report'); }, openData: () => { if (R.sub === 'flow') R.sub = 'issued'; window.switchTab('report'); }, FL, openReportForm, refreshUploadsCard, openPdf, htmlToPdfBlob, R };
})();
