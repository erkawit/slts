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
    boot: null, issued: [], batches: [], memos: [], loadedIssued: false, sub: 'issued', dash: null,
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
  function openPrint(html) {
    const w = window.open('', '_blank');
    if (!w) { fail(new Error('เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้')); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }
  const baseUrl = () => location.origin + location.pathname.replace(/[^/]*$/, '');

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

  // ------------------------------------------------------------------
  // ภาพส่งหมาย (จากข้อมูลที่มือถืออัปโหลดเข้าระบบ)
  // ------------------------------------------------------------------
  const sheetRows = () => { const s = appState(); return s && Array.isArray(s.allSheetRows) ? s.allSheetRows : []; };
  const caseMatch = (a, b) => {
    if (!a || !b) return false;
    if (typeof window.matchCaseNumbers === 'function') return window.matchCaseNumbers(a, b);
    return L.normCase(a) === L.normCase(b);
  };
  const timeOf = (v) => (typeof window.parseDateToTime === 'function' ? window.parseDateToTime(v) : (Date.parse(v) || 0));
  function photoFromRow(row) {
    let id = String(row['Drive File ID'] || '').trim();
    const link = String(row['ลิงก์รูปภาพใน Google Drive'] || '');
    if (!id) { const m = link.match(/id=([a-zA-Z0-9_-]+)/) || link.match(/\/d\/([a-zA-Z0-9_-]+)/) || link.match(/[?&]f=(db-[^&]+)/); if (m) id = decodeURIComponent(m[1]); }
    if (!id) return null;
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
      .filter((p) => caseMatch(p.caseNo, it.t_no) || caseMatch(p.caseNo, it.black_no));
    const exact = list.filter((p) => houseIn(p.loc, it));
    const out = (exact.length ? exact : list).sort((a, b) => b.time - a.time);
    const seen = new Set();
    return out.filter((p) => (seen.has(p.id) ? false : seen.add(p.id)));
  }
  function issuedForPhoto(p) {
    const list = R.issued.filter((it) => caseMatch(p.caseNo, it.t_no) || caseMatch(p.caseNo, it.black_no));
    const exact = list.filter((it) => houseIn(p.loc, it));
    return exact.length ? exact : list;
  }

  /** ดึงไฟล์ภาพเป็น bytes + ขนาด (ลองโหลดตรงก่อน ไม่ได้ค่อยผ่านเซิร์ฟเวอร์) */
  async function photoBytes(id) {
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
      const b = document.getElementById('tabBtnReport'); if (b) b.classList.add('active');
      const lbl = document.getElementById('compactNavActiveLabel'); if (lbl) lbl.textContent = 'รายงานผลหมาย';
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
          <button class="sr-tab" data-sub="issued"><i class="fa-solid fa-list-check"></i> บัญชีจ่ายหมาย / รายงานผลหมาย</button>
          <button class="sr-tab" data-sub="memos"><i class="fa-solid fa-file-invoice"></i> บันทึกข้อความ / ใบสำคัญรับเงิน</button>
          <button class="sr-tab" data-sub="rates"><i class="fa-solid fa-table"></i> อัตราค่านำหมาย</button>
          <button class="sr-tab" data-sub="settings"><i class="fa-solid fa-user-pen"></i> ผู้ลงนามและตั้งค่า</button>
        </div>
        <div id="srBody"><div class="sr-empty"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลดข้อมูล...</div></div>
      </div>`;
      pane.dataset.ready = '1';
      $('#srTabs', pane).addEventListener('click', (e) => { const t = e.target.closest('.sr-tab'); if (t) { R.sub = t.dataset.sub; renderSub(); } });
    }
    try {
      await ensureBoot(true);
      if (!R.loadedIssued || R.sub === 'issued') await loadIssued();
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
    if (window.SltsSidebar) window.SltsSidebar.sync();
    const body = $('#srBody'); if (!body) return;
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
        for (const sh of sheets) { try { got = L.parseCourtExcel(sh.rows); break; } catch (er) { lastErr = er; } }
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
    const firstTime = photos[0] && photos[0].time ? new Date(photos[0].time) : null;
    const code = L.resultCodeOf(it.result_text) || (/ประกาศ/.test(it.summon_type) ? '003' : '001');
    const fr = freeRateFor(it);
    const prof = profile();
    const d = {
      issue_date: it.entry_date || it.period_start || L.todayIso(),
      send_method: 'ส่งโดยเจ้าพนักงาน',
      server_name: it.server_name || myName(),
      serve_date: firstTime ? L.toIso(firstTime) : L.todayIso(),
      result_code: code, result_text: L.resultText(code), result_extra: '',
      file_type: 'file', resend_to: '', court_note: '', note: '',
      reporter_name: prof.name || myName(), reporter_position: prof.position || '',
      recipient: it.recipient,
      inspector_id: insp ? insp.id : '', inspector_name: insp ? insp.full_name : '', inspector_position: insp ? insp.position : '',
      inspector_acting: insp ? insp.acting : true, inspector_title: insp ? (insp.acting_title || settings().director_title) : settings().director_title,
      payer_id: payer ? payer.id : '', payer_name: payer ? payer.full_name : '', payer_position: payer ? payer.position : '',
      receipt_date: L.todayIso(), money_type: it.money_type,
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
    return d;
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
              <div class="sr-radio"><label><input type="radio" name="rf_claim" value="1" ${v.claim !== false ? 'checked' : ''}> เบิก (เงินงบประมาณ)</label><label><input type="radio" name="rf_claim" value="0" ${v.claim === false ? 'checked' : ''}> ไม่เบิก</label></div></div>
            ${inp('claim_amount', 'อัตราหมายฟรี (บาท)', { type: 'number', cls: 'rf-free' })}
            ${inp('amount', 'ค่าบริการส่งครั้งนี้ (บาท)', { type: 'number', cls: 'rf-paid' })}
            ${inp('receipt_ref', 'โดยตัดจ่ายจากเงินของ (ใบเสร็จ)', { cls: 'rf-paid sr-span2' })}
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

    const refresh = () => {
      const code = g('result_code').value; const notice = L.isNoticeResult(code);
      wrap.querySelector('#rf_tpl').textContent = 'แบบ: ' + L.TEMPLATE_LABELS[L.templateFor(it.kind, code)];
      $$('.rf-normal', wrap).forEach((el) => { el.style.display = notice ? 'none' : ''; });
      $$('.rf-notice', wrap).forEach((el) => { el.style.display = notice ? '' : 'none'; });
      const paid = g('money_type').value === 'paid';
      $$('.rf-paid', wrap).forEach((el) => { el.style.display = paid ? '' : 'none'; });
      $$('.rf-free', wrap).forEach((el) => { el.style.display = paid ? 'none' : ''; });
      g('claim_box').style.display = paid ? 'none' : '';
      const claim = (wrap.querySelector('input[name="rf_claim"]:checked') || {}).value !== '0';
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
      r.claim = (wrap.querySelector('input[name="rf_claim"]:checked') || {}).value !== '0';
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
    wrap.addEventListener('input', refresh);
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
        if (act.dataset.act === 'save' || act.dataset.act === 'saveprint') {
          const out = await api('sr_report_save', { id: it.id, report: stripReport(r), status: act.dataset.act === 'saveprint' ? 'printed' : 'saved' });
          it.report = stripReport(r); it.report_status = out.report_status; it.reported_at = new Date().toISOString();
          toast('success', 'บันทึกรายงานผลหมายแล้ว');
        }
        if (act.dataset.act === 'print' || act.dataset.act === 'saveprint') {
          const extra = $$('input[data-extra]', wrap).map((x) => x.files && x.files[0]).filter(Boolean);
          await generateWord(it, r, extra);
        }
        if (act.dataset.act !== 'print') { close(); if (R.sub === 'issued' && $('#srRows')) fillIssuedRows(); refreshStats(); refreshUploadsCard(); }
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
    if (r.money_type !== 'paid' && r.claim && !r.claim_amount) p.push('• หมายฟรีที่เบิกยังไม่มีอัตราเงิน');
    if (!(r.photo_ids || []).length) p.push('• ไม่มีภาพการส่งหมาย (เอกสารจะไม่มีภาพแนบท้าย)');
    return p;
  }

  /** สร้างไฟล์ Word จากแม่แบบ + ภาพแนบท้าย แล้วดาวน์โหลด */
  async function buildWord(it, r, extraFiles) {
    const name = L.templateFor(it.kind, r.result_code);
    const tpl = await template(name);
    const imgs = [];
    for (const pid of r.photo_ids || []) imgs.push(await photoBytes(pid));
    for (const f of extraFiles || []) imgs.push(await normalizeImage(f));
    const data = L.buildDocData(Object.assign({}, it, r, { kind: it.kind }), { arabic: arabicDocs() });
    return { blob: await DOCX.fillReportDocx(tpl, data, imgs), fileName: L.docFileName(Object.assign({}, it, r)) };
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
        let n = `${String(list[i].seq || i + 1).padStart(2, '0')}_${fileName}`; while (names.has(n)) n = n.replace('.docx', '_1.docx'); names.add(n);
        zip.file(n, blob);
      }
      const out = await zip.generateAsync({ type: 'blob' });
      done(); downloadBlob(out, `รายงานผลหมาย_${L.todayIso()}.zip`);
    } catch (e) { done(); fail(e); }
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
        ${m.report_type === 'free' ? `<button class="sr-btn sm" data-rxlsx="${m.id}" title="ใบสำคัญรับเงิน Excel"><i class="fa-solid fa-file-excel"></i> ใบสำคัญ</button><button class="sr-btn sm" data-rpdf="${m.id}" title="ใบสำคัญรับเงิน PDF"><i class="fa-solid fa-print"></i></button>` : ''}</td>
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
        } else if (b.dataset.mpdf) openPrint(E.memoPrintHtml(memo, baseUrl()));
        else if (b.dataset.rxlsx) { const { wb } = E.receiptWorkbook(memo, items); downloadBlob(await wb.toBlob(), `ใบสำคัญรับเงินฟรี-${(memo.round_label || id).toString().replace(/[\\/:*?"<>|]/g, '-')}.xlsx`); }
        else if (b.dataset.rpdf) openPrint(E.receiptPrintHtml(memo, items, baseUrl()));
      } catch (er) { fail(er); }
    };
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
          <div class="sr-toolbar"><button class="sr-btn primary" type="button" id="mf_pull_free"><i class="fa-solid fa-download"></i> ดึงหมายฟรีที่รายงาน "เบิก" แล้ว (ในช่วงวันที่)</button>
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
      t.innerHTML = `<thead><tr><th>#</th>${ITEM_COLS.map((c) => `<th>${c[1]}</th>`).join('')}<th class="num">ราคาเบิก</th><th></th></tr></thead><tbody>${items.map((it, i) => `<tr style="${ev.items[i].calc_rule === 'duplicate' ? 'background:#fef2f2' : ev.items[i].calc_rule === 'half' ? 'background:#fffbeb' : ''}">
        <td>${i + 1}</td>${ITEM_COLS.map((c) => `<td><input class="sr-input" style="width:${c[2]}px" data-i="${i}" data-k="${c[0]}" type="${c[3] || 'text'}" value="${esc(it[c[0]] == null ? '' : it[c[0]])}"></td>`).join('')}
        <td class="num">${L.money2(it.claim_rate)}${it.calc_rule === 'half' ? '<div class="sr-muted">50%</div>' : it.calc_rule === 'duplicate' ? '<div class="sr-chip red">ซ้ำ</div>' : ''}</td>
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
      if (e.target.closest('#mf_pull_free')) {
        const from = g('period_start').value; const to = g('period_end').value;
        const list = R.issued.filter((it) => it.money_type === 'free' && it.report && it.report.claim !== false && it.report_status !== 'none')
          .filter((it) => { const sd = it.report.serve_date || ''; return (!from || sd >= from) && (!to || sd <= to); });
        const have = new Set(items.map((x) => x.issued_id).filter(Boolean));
        list.filter((it) => !have.has(it.id)).forEach((it) => items.push({
          issued_id: it.id, case_prefix: 'คดีดำ', case_no: it.kind === 'T' ? it.t_no : it.black_no, issue_date: it.report.issue_date || '', serve_date: it.report.serve_date || '',
          summon_type: it.summon_type, recipient_role: (String(it.recipient).match(/(จำเลย|โจทก์|ผู้ร้อง|ผู้คัดค้าน|ผู้เสียหาย|ผู้ประกัน|นายประกัน)[^\s]*/) || [''])[0] || 'ผู้รับ',
          house_no: it.house_no, moo: it.moo, subdistrict: it.subdistrict, district: it.district, province: 'จ.อุดรธานี', base_rate: Number(it.report.claim_amount) || freeRateFor(it),
        }));
        renderItems();
        toast(list.length ? 'success' : 'info', list.length ? `ดึงมา ${list.length} รายการ` : 'ไม่พบหมายฟรีที่รายงาน "เบิก" ในช่วงวันที่นี้');
        return;
      }
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
    $('#srRatePdf').onclick = () => openPrint(E.ratesPrintHtml(R.boot.rates, settings(), R.rateType, baseUrl()));
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
      <div class="sr-card"><h3>ข้อมูลของฉัน (ใช้ในแบบรายงาน)</h3><div class="sr-grid sr-g3">
        <div class="sr-field"><label>ชื่อ-สกุล ผู้รายงาน</label><input class="sr-input" id="pf_name" value="${esc(prof.name || myName())}"></div>
        <div class="sr-field"><label>ตำแหน่ง</label><input class="sr-input" id="pf_position" value="${esc(prof.position || '')}" placeholder="เช่น นักวิชาการคอมพิวเตอร์ปฏิบัติการ"></div>
        <div class="sr-field"><label>&nbsp;</label><button class="sr-btn primary" id="pf_save"><i class="fa-solid fa-floppy-disk"></i> บันทึก (เครื่องนี้)</button></div></div></div>
      ${['inspector', 'payer', 'director', 'officer'].map(block).join('')}
      <div class="sr-card"><div class="sr-toolbar"><h3 style="margin:0">คำสั่งศาลแต่งตั้งเจ้าพนักงาน (ใช้ในบันทึกข้อความ)</h3><span class="grow"></span>${admin ? '<button class="sr-btn sm primary" id="srOrderAdd"><i class="fa-solid fa-plus"></i> เพิ่มคำสั่งฉบับใหม่</button>' : ''}</div>
        <table class="sr-table" style="margin-top:8px"><thead><tr><th>คำสั่ง</th><th>หมายเหตุ</th><th></th></tr></thead><tbody>${(R.boot.orders || []).map((o, i) => `<tr><td>${esc(o.order_text)} ${i === 0 ? '<span class="sr-chip ok">ฉบับล่าสุด</span>' : ''}</td><td class="sr-muted">${esc(o.note)}</td><td class="ctr">${admin ? `<button class="sr-btn sm danger" data-odel="${o.id}"><i class="fa-solid fa-trash"></i></button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="sr-card"><h3>การตั้งค่าเอกสาร</h3><div class="sr-grid sr-g3">
        <div class="sr-field"><label>ตัวเลขในไฟล์ Word</label><select class="sr-select" id="st_doc_digits" ${admin ? '' : 'disabled'}><option value="thai" ${s.doc_digits !== 'arabic' ? 'selected' : ''}>เลขไทย (๑๒๓) ตามแบบฟอร์มศาล</option><option value="arabic" ${s.doc_digits === 'arabic' ? 'selected' : ''}>เลขอารบิก (123)</option></select></div>
        <div class="sr-field"><label>ที่อยู่ผู้รับเงิน (ใบสำคัญรับเงิน)</label><input class="sr-input" id="st_reporter_address" value="${esc(s.reporter_address || '')}" ${admin ? '' : 'readonly'}></div>
        <div class="sr-field"><label>ตำแหน่ง ผอ. (ข้อความใต้ผู้ตรวจ)</label><input class="sr-input" id="st_director_title" value="${esc(s.director_title || '')}" ${admin ? '' : 'readonly'}></div>
        ${admin ? '<div class="sr-field"><button class="sr-btn primary" id="st_save"><i class="fa-solid fa-floppy-disk"></i> บันทึกการตั้งค่า</button></div>' : ''}</div></div>`;
    const reload = async () => { await ensureBoot(true); renderSettings(body); };
    $('#pf_save').onclick = () => { LS.set(profileKey(), Object.assign(profile(), { name: $('#pf_name').value.trim(), position: $('#pf_position').value.trim() })); toast('success', 'บันทึกแล้ว'); };
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
    try {
      busy('กำลังดาวน์โหลดภาพ...');
      const img = await photoBytes(p.id);
      done(); downloadBlob(new Blob([img.bytes], { type: img.ext === 'png' ? 'image/png' : 'image/jpeg' }), photoFileName(p));
    } catch (e) {
      done();
      if (typeof window.downloadSingleImageFile === 'function') window.downloadSingleImageFile(p.url, photoFileName(p)); else fail(e);
    }
  }
  async function zipUploads() {
    const list = roundUploads(); if (!list.length) return;
    busy(`กำลังรวมภาพ ${list.length} ภาพ...`);
    try {
      const zip = new window.JSZip(); let n = 0;
      for (let i = 0; i < list.length; i++) {
        try { const img = await photoBytes(list[i].id); zip.file(photoFileName(list[i], i), img.bytes); n++; } catch (er) { console.warn('[report] photo skip', er); }
        Swal.update({ title: `กำลังรวมภาพ (${i + 1}/${list.length})...` }); Swal.showLoading();
      }
      const out = await zip.generateAsync({ type: 'blob' });
      done(); downloadBlob(out, `ภาพส่งหมาย_${L.todayIso()}.zip`);
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
  window.SltsReportUI = { open: () => window.switchTab('report'), openSub: (sub) => { R.sub = sub; window.switchTab('report'); }, openReportForm, refreshUploadsCard, R };
})();
