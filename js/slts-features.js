/**
 * js/slts-features.js — ฟีเจอร์ระบบ v2 (โหลดหลัง app.js)
 *
 *  1) ล็อกอิน/เปลี่ยนรหัสผ่าน/จัดการผู้ใช้ ผ่านเซิร์ฟเวอร์ (Neon)
 *  2) แชร์เส้นทางด้วย QR Code + สแกน QR รับเส้นทาง + ลิงก์ ?share=CODE
 *  3) คลังภาพในเครื่อง + สถานะออฟไลน์ + ส่งต่ออัตโนมัติเมื่อมีสัญญาณ
 *  4) เมนูแบบง่าย (Simple View) และศูนย์ผู้ดูแลระบบ (เวอร์ชัน • บันทึกจุดบกพร่อง • ประวัติการใช้งาน)
 */
(function () {
  'use strict';
  const SLTS = window.SLTS;
  const UI = (window.SLTSUI = window.SLTSUI || {});
  const esc = (v) => String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const isMobile = () => (typeof window.isMobileView === 'function' ? window.isMobileView() : window.innerWidth < 768);
  const me = () => (typeof state !== 'undefined' && state.currentUser) || null;
  const isAdmin = () => (me() || {}).role === 'admin';

  // v2.3 (แก้บั๊ก): Swal แสดงได้ทีละหน้าต่าง — toast ที่เด้งเข้ามา (เช่น "เส้นทางถูกล้างจากอีกเครื่องแล้ว")
  // เคยไปปิดหน้าต่างที่ผู้ใช้กำลังกรอกอยู่ (อัปโหลดภาพ/ฟอร์มบันทึก) ทำให้ข้อมูลที่กรอกหาย
  // → ถ้ามีหน้าต่างอื่นเปิดอยู่ ให้แสดง toast แบบแยก (DOM ของเราเอง) แทน
  function domToast(o) {
    let host = document.getElementById('slts-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'slts-toast-host';
      host.style.cssText = 'position:fixed;top:max(10px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:20000;display:flex;flex-direction:column;gap:6px;pointer-events:none;max-width:92vw';
      document.body.appendChild(host);
    }
    const colors = { success: '#059669', error: '#dc2626', warning: '#d97706', info: '#2563eb', question: '#2563eb' };
    const el = document.createElement('div');
    el.style.cssText = `background:#fff;border-left:4px solid ${colors[o.icon] || '#2563eb'};box-shadow:0 6px 20px rgba(0,0,0,.18);border-radius:10px;padding:8px 12px;font-size:13px;color:#111827;font-family:inherit`;
    const tmp = document.createElement('div'); tmp.innerHTML = String(o.title || o.text || o.html || '');
    el.textContent = tmp.textContent || '';
    host.appendChild(el);
    setTimeout(() => el.remove(), Math.max(1500, Number(o.timer) || 2500));
    return Promise.resolve({ isConfirmed: false, isDismissed: true, dismiss: 'timer' });
  }
  function guardSwalToasts() {
    if (typeof Swal === 'undefined' || Swal.__sltsToastGuard) return;
    const origFire = Swal.fire;
    const origMixin = Swal.mixin;
    const busyWithDialog = () => {
      const popup = typeof Swal.getPopup === 'function' ? Swal.getPopup() : null;
      return !!(Swal.isVisible() && popup && !popup.classList.contains('swal2-toast'));
    };
    Swal.fire = function (...args) {
      const o = args[0];
      const isToast = (o && typeof o === 'object' && o.toast) || (this && this.__sltsMixinToast);
      if (isToast && busyWithDialog()) {
        const base = (this && this.__sltsMixinParams) || {};
        return domToast(Object.assign({}, base, (o && typeof o === 'object') ? o : { title: args[0], text: args[1], icon: args[2] }));
      }
      return origFire.apply(this, args);
    };
    Swal.mixin = function (params) {
      const M = origMixin.call(this, params);
      try {
        if (params && params.toast) { M.__sltsMixinToast = true; M.__sltsMixinParams = params; }
      } catch (_) {}
      return M;
    };
    Swal.__sltsToastGuard = true;
  }
  guardSwalToasts();
  document.addEventListener('DOMContentLoaded', guardSwalToasts);

  UI.toast = function (title, icon = 'success', ms = 2200) {
    if (typeof Swal === 'undefined') return;
    Swal.fire({ toast: true, position: 'top', icon, title, timer: ms, showConfirmButton: false, timerProgressBar: true });
  };
  window.showSystemToast = window.showSystemToast || function (msg, type) { UI.toast(msg, type === 'error' ? 'error' : (type || 'success')); };

  function fmtDate(v) {
    if (!v) return '-';
    const d = new Date(v);
    if (isNaN(d)) return esc(v);
    return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  }
  function semverGt(a, b) {
    const pa = String(a).split('.').map(Number); const pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
    return false;
  }

  // =====================================================================
  // 1) AUTH ผ่านเซิร์ฟเวอร์
  // =====================================================================
  function applyLoggedInUser(u) {
    state.currentUser = {
      username: u.username, name: u.name || u.username, role: u.role,
      assignedProvince: u.assignedProvince || 'อุดรธานี', courtCategory: u.courtCategory || 'ศาลจังหวัด',
      assignedCourt: u.assignedCourt || '',
    };
    localStorage.setItem('slts_current_user', JSON.stringify(state.currentUser));
  }

  window.handleLogin = async function (e) {
    if (e) e.preventDefault();
    const uEl = document.getElementById('loginUsername');
    const pEl = document.getElementById('loginPassword');
    const u = (uEl && uEl.value || '').trim();
    const p = (pEl && pEl.value || '');
    if (!u || !p) return Swal.fire({ icon: 'warning', title: 'กรอกข้อมูลไม่ครบ', text: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน', confirmButtonColor: '#2563eb' });

    const form = document.getElementById('loginForm');
    const btn = form && form.querySelector('button[type="submit"]');
    const oldHtml = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> กำลังตรวจสอบ...'; }

    const deviceMode = window.innerWidth < 768 ? 'mobile' : 'desktop';
    let res;
    try {
      res = await SLTS.api('login', { username: u, password: p, deviceMode }, { timeoutMs: 20000 });
    } catch (err) {
      res = { status: 'error', message: navigator.onLine ? 'ติดต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง' : 'ไม่มีอินเทอร์เน็ต — การเข้าสู่ระบบครั้งแรกต้องเชื่อมต่ออินเทอร์เน็ต' };
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = oldHtml; }
    }
    if (!res || res.status !== 'success') {
      return Swal.fire({ icon: 'error', title: 'เข้าสู่ระบบไม่สำเร็จ', text: (res && res.message) || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', confirmButtonColor: '#2563eb' });
    }

    SLTS.auth.setToken(res.token);
    applyLoggedInUser(res.user);
    localStorage.setItem('slts_last_auth_action', 'login');
    localStorage.setItem('slts_last_auth_device_mode', deviceMode);
    localStorage.removeItem('slts_v2_relogin_notice');
    if (pEl) pEl.value = '';

    closeLoginModal();
    updateAuthUI();
    if (typeof initMobileHandoffReceiver === 'function') initMobileHandoffReceiver();
    if (deviceMode === 'mobile') {
      if (elements.cameraModal && elements.cameraModal.classList.contains('hidden')) openCameraModal().catch(() => {});
      if (typeof enforceProvinceBoundaryOnStartup === 'function') enforceProvinceBoundaryOnStartup();
    }
    if (typeof loadGoogleSheetData === 'function') loadGoogleSheetData(true, true);
    if (typeof fetchUsersFromGasApi === 'function') fetchUsersFromGasApi(false);
    if (typeof window.resumeBackgroundQueueNow === 'function') window.resumeBackgroundQueueNow();
    setTimeout(() => { SLTS.route.restore('login'); SLTS.route.flushPendingClears(); }, 800);
    SLTS.flushErrors();
    UI.toast(`ยินดีต้อนรับ ${res.user.name || res.user.username}`);

    if (res.user.mustChangePassword) {
      setTimeout(() => UI.forcePasswordChange(), 400);
    } else {
      UI.consumePendingShareCode();
    }
  };

  UI.forcePasswordChange = async function () {
    const r = await Swal.fire({
      icon: 'info',
      title: 'ตั้งรหัสผ่านใหม่ก่อนใช้งาน',
      html: `<p class="text-sm text-gray-600 mb-3">บัญชีนี้ใช้รหัสผ่านชั่วคราว (หรือรหัสเดิมที่ไม่ปลอดภัย) กรุณาตั้งรหัสผ่านใหม่</p>
        <input id="sltsNewPw1" type="password" class="swal2-input" placeholder="รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)" autocomplete="new-password">
        <input id="sltsNewPw2" type="password" class="swal2-input" placeholder="ยืนยันรหัสผ่านใหม่" autocomplete="new-password">`,
      confirmButtonText: 'บันทึกรหัสผ่าน', confirmButtonColor: '#2563eb',
      allowOutsideClick: false, allowEscapeKey: false, showLoaderOnConfirm: true,
      preConfirm: async () => {
        const a = document.getElementById('sltsNewPw1').value; const b = document.getElementById('sltsNewPw2').value;
        if (a.length < 6) return Swal.showValidationMessage('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
        if (a !== b) return Swal.showValidationMessage('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
        if (['123456', '12345678', 'password', 'caogikojt02'].includes(a)) return Swal.showValidationMessage('รหัสผ่านนี้คาดเดาง่ายเกินไป');
        const res = await SLTS.api('update_user_password', { username: me().username, password: a });
        if (res.status !== 'success') return Swal.showValidationMessage(res.message || 'บันทึกไม่สำเร็จ');
        return res;
      },
    });
    if (r.isConfirmed && r.value) {
      if (r.value.token) SLTS.auth.setToken(r.value.token);
      UI.toast('ตั้งรหัสผ่านใหม่เรียบร้อย');
      UI.consumePendingShareCode();
    }
  };

  window.handleSaveNewPassword = async function (e) {
    if (e) e.preventDefault();
    if (!me()) return;
    const cur = document.getElementById('currentPass').value;
    const np = document.getElementById('newPass').value;
    const cp = document.getElementById('confirmNewPass').value;
    if (np.length < 6) return Swal.fire('รหัสผ่านสั้นเกินไป', 'โปรดกำหนดรหัสผ่านใหม่อย่างน้อย 6 ตัวอักษร', 'warning');
    if (np !== cp) return Swal.fire('รหัสผ่านไม่ตรงกัน', 'รหัสผ่านใหม่และยืนยันรหัสผ่านใหม่ไม่ตรงกัน', 'warning');
    let res;
    try { res = await SLTS.api('update_user_password', { username: me().username, password: np, currentPassword: cur }); } catch (_) {
      return Swal.fire('ไม่มีการเชื่อมต่อ', 'การเปลี่ยนรหัสผ่านต้องเชื่อมต่ออินเทอร์เน็ต', 'error');
    }
    if (res.status !== 'success') return Swal.fire('เปลี่ยนรหัสผ่านไม่สำเร็จ', res.message || '', 'error');
    if (res.token) SLTS.auth.setToken(res.token);
    closeChangePasswordModal();
    Swal.fire({ icon: 'success', title: 'เปลี่ยนรหัสผ่านสำเร็จ', text: 'ออกจากระบบในอุปกรณ์อื่นทั้งหมดแล้วเพื่อความปลอดภัย', timer: 2200, showConfirmButton: false });
  };

  // หน้าจัดการผู้ใช้เดิมเรียกฟังก์ชันนี้หลังแก้ไขในเครื่อง → ส่งไปเซิร์ฟเวอร์และแจ้งผลจริง
  window.syncUserToGoogleSheet = async function (action, payload) {
    const body = { ...(payload || {}) };
    if (body.courtCategory) body['ประเภทศาล'] = body.courtCategory;
    if (body.assignedCourt) body['ศาลที่สังกัด'] = body.assignedCourt;
    if (body.assignedProvince) body['จังหวัดที่ส่งหมาย'] = body.assignedProvince;
    let res;
    try { res = await SLTS.api(action, body); } catch (_) {
      res = { status: 'error', message: 'ไม่มีการเชื่อมต่ออินเทอร์เน็ต — การจัดการผู้ใช้ต้องออนไลน์' };
    }
    if (res.status !== 'success') {
      Swal.fire({ icon: 'error', title: 'บันทึกที่เซิร์ฟเวอร์ไม่สำเร็จ', text: res.message || 'กรุณาลองใหม่', confirmButtonColor: '#2563eb' });
    } else if (res.token && me() && String(body.username || '').toLowerCase() === me().username) {
      SLTS.auth.setToken(res.token);
    }
    if (typeof fetchUsersFromGasApi === 'function') fetchUsersFromGasApi(false); // ดึงรายชื่อจริงจากเซิร์ฟเวอร์ (ย้อนค่าที่บันทึกไม่สำเร็จ)
    return res;
  };

  window.syncAllUsersStructureToGoogleSheet = async function () {
    showCustomLoading('กำลังโหลดรายชื่อผู้ใช้...', 'จากฐานข้อมูลกลาง');
    const ok = await fetchUsersFromGasApi(false);
    hideCustomLoading();
    UI.toast(ok ? 'อัปเดตรายชื่อผู้ใช้จากเซิร์ฟเวอร์แล้ว' : 'โหลดรายชื่อไม่สำเร็จ', ok ? 'success' : 'error');
  };

  const origLogout = window.performDirectLogout;
  window.performDirectLogout = function (mode) {
    if (SLTS.auth.getToken()) SLTS.api('logout').catch(() => {});
    SLTS.auth.clear();
    return origLogout.apply(this, arguments);
  };

  window.resetDefaultGasUrlAndRetry = function () {
    SLTS.net.markUnknown();
    if (typeof window.resumeBackgroundQueueNow === 'function') window.resumeBackgroundQueueNow();
    UI.toast('กำลังลองส่งข้อมูลใหม่...', 'info');
  };

  // ปุ่มตั้งค่า (เดิมใช้ตั้ง URL Apps Script) → ศูนย์ผู้ดูแลระบบ
  window.initSettings = function () {
    if (elements.btnSettings) elements.btnSettings.addEventListener('click', () => UI.openAdminCenter());
  };

  // =====================================================================
  // 2) แชร์เส้นทางด้วย QR Code
  // =====================================================================
  function currentRoutePayload() {
    const stops = (state.currentRouteStops || []);
    const clean = (typeof window.deduplicateRouteStops === 'function' && typeof cleanStopsForStorage === 'function')
      ? window.deduplicateRouteStops(cleanStopsForStorage(stops)) : stops;
    return {
      stops: clean,
      startLocation: state.routeStartLocation || null,
      endLocation: state.routeEndLocation || null,
      isRoundTrip: Boolean(state.isRoundTrip),
      routeRoadPolyline: typeof compressPolylineForHandoff === 'function' ? compressPolylineForHandoff(state.mapRoutePolylineCoords || null) : null,
      totalDistanceKm: state.calculatedRoadDistanceKm || null,
    };
  }
  UI.shareLinkFor = (code) => `${SLTS.publicWebUrl()}/?share=${encodeURIComponent(code)}`;

  function qrSvg(text, cell = 6) {
    if (typeof qrcode !== 'function') return '';
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: cell, margin: 3, scalable: true, alt: 'QR Code' });
  }
  function qrPngDataUrl(text, cell = 10) {
    const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
    const n = qr.getModuleCount(); const m = 4; const size = (n + m * 2) * cell;
    const c = document.createElement('canvas'); c.width = size; c.height = size + 70;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) g.fillRect((col + m) * cell, (r + m) * cell, cell, cell);
    return { canvas: c, ctx: g, size };
  }

  UI.openShareRouteQR = async function () {
    if (!me()) return openLoginModal(true);
    const route = currentRoutePayload();
    if (!route.stops.length) return Swal.fire('ไม่มีเส้นทาง', 'กรุณาจัดรายการส่งหมายในแผนที่ก่อน แล้วค่อยสร้าง QR แชร์เส้นทาง', 'info');
    if (!(await SLTS.net.check())) return Swal.fire('ไม่มีอินเทอร์เน็ต', 'การสร้าง QR แชร์เส้นทางต้องเชื่อมต่ออินเทอร์เน็ต (เพื่อเก็บเส้นทางไว้ที่เซิร์ฟเวอร์)', 'warning');

    Swal.fire({ title: 'กำลังสร้าง QR Code...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    let res;
    try { res = await SLTS.api('create_share_code', { ...route, expiresInDays: 7 }); } catch (_) { res = { status: 'error', message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' }; }
    if (res.status !== 'success') return Swal.fire('สร้าง QR ไม่สำเร็จ', res.message || '', 'error');

    const link = UI.shareLinkFor(res.code);
    const exp = new Date(res.expiresAt).toLocaleDateString('th-TH', { dateStyle: 'medium' });
    Swal.fire({
      title: 'QR แชร์เส้นทาง',
      html: `
        <div class="slts-qr-box">${qrSvg(link)}</div>
        <p class="slts-qr-code" aria-label="รหัสแชร์">${esc(res.code.slice(0, 4))}-${esc(res.code.slice(4))}</p>
        <p class="slts-muted">${res.stopsCount} จุดส่งหมาย • ใช้ได้ถึง ${esc(exp)}<br>ให้ผู้รับเปิดกล้องมือถือ หรือกดปุ่ม <b>สแกน QR</b> ในแอปแล้วส่องที่ภาพนี้</p>
        <div class="slts-btn-row">
          <button type="button" class="slts-btn" id="sltsQrShare"><i class="fa-solid fa-share-nodes"></i> ส่งลิงก์</button>
          <button type="button" class="slts-btn" id="sltsQrCopy"><i class="fa-solid fa-copy"></i> คัดลอก</button>
          <button type="button" class="slts-btn" id="sltsQrSave"><i class="fa-solid fa-download"></i> บันทึกรูป QR</button>
        </div>`,
      showConfirmButton: true, confirmButtonText: 'เสร็จสิ้น', confirmButtonColor: '#2563eb', showCloseButton: true,
      didOpen: () => {
        document.getElementById('sltsQrShare').onclick = async () => {
          const text = `เส้นทางส่งหมาย ${res.stopsCount} จุด จาก ${me().name || me().username} (รหัส ${res.code})`;
          if (navigator.share) { try { await navigator.share({ title: 'แชร์เส้นทางส่งหมาย', text, url: link }); } catch (_) {} }
          else { await navigator.clipboard.writeText(`${text}\n${link}`).catch(() => {}); UI.toast('คัดลอกลิงก์แล้ว'); }
        };
        document.getElementById('sltsQrCopy').onclick = async () => {
          try { await navigator.clipboard.writeText(link); UI.toast('คัดลอกลิงก์แล้ว'); } catch (_) { Swal.showValidationMessage(link); }
        };
        document.getElementById('sltsQrSave').onclick = () => {
          const { canvas, ctx, size } = qrPngDataUrl(link);
          ctx.fillStyle = '#111'; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(`${res.code.slice(0, 4)}-${res.code.slice(4)}`, size / 2, size + 30);
          ctx.font = '18px sans-serif'; ctx.fillText(`เส้นทาง ${res.stopsCount} จุด • ถึง ${exp}`, size / 2, size + 58);
          const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = `SLTS-route-${res.code}.png`;
          document.body.appendChild(a); a.click(); a.remove();
        };
      },
    });
  };

  // ปุ่มแชร์เดิม (แชร์ให้ผู้ใช้ในระบบ) → เพิ่มทางเลือก QR Code
  const origOpenShare = window.openShareRouteModal;
  window.openShareRouteModal = async function () {
    if (!me()) return origOpenShare.apply(this, arguments);
    const count = (state.currentRouteStops || []).length;
    if (!count) return origOpenShare.apply(this, arguments);
    const r = await Swal.fire({
      title: 'แชร์เส้นทางการส่งหมาย',
      html: `<p class="slts-muted mb-3">${count} จุดส่งหมาย — เลือกวิธีแชร์</p>
        <div class="slts-choice">
          <button type="button" class="slts-choice-btn" data-v="qr"><i class="fa-solid fa-qrcode"></i><span><b>QR Code</b><small>ให้อีกเครื่องสแกน (แนะนำ เร็วที่สุด)</small></span></button>
          <button type="button" class="slts-choice-btn" data-v="users"><i class="fa-solid fa-users"></i><span><b>ส่งให้ผู้ใช้ในระบบ</b><small>เลือกรายชื่อ ผู้รับได้รับแจ้งอัตโนมัติ</small></span></button>
        </div>`,
      showConfirmButton: false, showCloseButton: true,
      didOpen: (pop) => pop.querySelectorAll('.slts-choice-btn').forEach((b) => { b.onclick = () => Swal.close({ isConfirmed: true, value: b.dataset.v }); }),
    });
    if (r.value === 'qr') return UI.openShareRouteQR();
    if (r.value === 'users') return origOpenShare.apply(this, arguments);
  };

  // =====================================================================
  // 2.1) สแกน QR รับเส้นทาง
  // =====================================================================
  function extractShareCode(text) {
    const t = String(text || '').trim();
    try {
      const u = new URL(t);
      const c = u.searchParams.get('share') || (u.hash.match(/share=([A-Za-z0-9-]+)/) || [])[1];
      if (c) return c.replace(/-/g, '').toUpperCase();
    } catch (_) {}
    const m = t.replace(/[\s-]/g, '').toUpperCase().match(/^[2-9A-HJ-NP-Z]{8}$/);
    return m ? m[0] : '';
  }

  let jsQRPromise = null;
  function loadJsQR() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (!jsQRPromise) {
      jsQRPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/vendor/jsQR.js?v=' + SLTS.version;
        s.onload = () => resolve(window.jsQR);
        s.onerror = () => { jsQRPromise = null; reject(new Error('โหลดตัวอ่าน QR ไม่สำเร็จ')); };
        document.head.appendChild(s);
      });
    }
    return jsQRPromise;
  }

  UI.openScanRouteQR = async function () {
    let stream = null; let raf = 0; let stopped = false; let detector = null;
    const mainCameraWasOpen = elements.cameraModal && !elements.cameraModal.classList.contains('hidden');
    const stopAll = () => {
      stopped = true; cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
    };
    const restoreMainCamera = () => {
      if (mainCameraWasOpen && typeof startCameraStream === 'function') setTimeout(() => startCameraStream().catch(() => {}), 250);
    };
    try { if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch (_) {}

    const result = await Swal.fire({
      title: 'สแกน QR รับเส้นทาง',
      html: `
        <div class="slts-scan-wrap"><video id="sltsScanVideo" playsinline muted></video><div class="slts-scan-frame"></div></div>
        <p id="sltsScanHint" class="slts-muted">ส่องกล้องไปที่ QR Code ของผู้แชร์</p>
        <div class="slts-code-entry">
          <input id="sltsScanCode" class="swal2-input" placeholder="หรือพิมพ์รหัส 8 ตัว เช่น ABCD-2345" maxlength="12" autocapitalize="characters" autocomplete="off">
        </div>`,
      showCancelButton: true, confirmButtonText: 'รับเส้นทาง', cancelButtonText: 'ปิด', confirmButtonColor: '#2563eb',
      didOpen: async () => {
        // กล้องหลักของแอปต้องหยุดก่อน (iOS ใช้กล้องพร้อมกัน 2 ที่ไม่ได้)
        if (mainCameraWasOpen && state.cameraStream) { try { state.cameraStream.getTracks().forEach((t) => t.stop()); } catch (_) {} }
        const video = document.getElementById('sltsScanVideo');
        const hint = document.getElementById('sltsScanHint');
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
          if (stopped) return stopAll();
          video.srcObject = stream; await video.play();
        } catch (err) {
          hint.textContent = 'เปิดกล้องไม่ได้ — พิมพ์รหัสแชร์ในช่องด้านล่างแทน';
          return;
        }
        const jsQR = detector ? null : await loadJsQR().catch(() => null);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        let last = 0;
        const tick = async (ts) => {
          if (stopped) return;
          raf = requestAnimationFrame(tick);
          if (ts - last < 150 || video.readyState < 2) return;
          last = ts;
          let text = '';
          try {
            if (detector) {
              const codes = await detector.detect(video);
              text = codes && codes[0] && codes[0].rawValue;
            } else if (jsQR) {
              const w = Math.min(640, video.videoWidth); const h = Math.round(video.videoHeight * (w / video.videoWidth));
              canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
              const img = ctx.getImageData(0, 0, w, h);
              const found = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
              text = found && found.data;
            }
          } catch (_) {}
          const code = text && extractShareCode(text);
          if (code) {
            if (navigator.vibrate) navigator.vibrate(60);
            stopAll();
            Swal.close({ isConfirmed: true, value: code });
          } else if (text) {
            hint.textContent = 'QR นี้ไม่ใช่ QR เส้นทางของระบบ';
          }
        };
        raf = requestAnimationFrame(tick);
      },
      preConfirm: () => {
        const code = extractShareCode(document.getElementById('sltsScanCode').value);
        if (!code) return Swal.showValidationMessage('รหัสแชร์ไม่ถูกต้อง (8 ตัวอักษร)');
        return code;
      },
      willClose: () => stopAll(),
    });
    stopAll();
    restoreMainCamera();
    if (result.isConfirmed && result.value) UI.importShareCode(result.value);
  };

  /** ดึงเส้นทางจากรหัส แล้วนำเข้าแผนที่/รายการส่งหมาย */
  UI.importShareCode = async function (code) {
    code = extractShareCode(code);
    if (!code) return;
    if (!me() || !SLTS.auth.getToken()) {
      localStorage.setItem('slts_pending_share_code', code);
      Swal.fire({ icon: 'info', title: 'เข้าสู่ระบบเพื่อรับเส้นทาง', text: 'เข้าสู่ระบบแล้วระบบจะนำเข้าเส้นทางให้อัตโนมัติ', confirmButtonColor: '#2563eb' })
        .then(() => openLoginModal(true));
      return;
    }
    Swal.fire({ title: 'กำลังดึงเส้นทาง...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    let res;
    try { res = await SLTS.api('get_share_code', { code }, { method: 'GET' }); } catch (_) { res = { status: 'error', message: 'ไม่มีอินเทอร์เน็ต — กรุณาเชื่อมต่อแล้วสแกนอีกครั้ง' }; }
    if (res.status !== 'success') {
      if (res._http === 0 || !navigator.onLine) localStorage.setItem('slts_pending_share_code', code);
      return Swal.fire('รับเส้นทางไม่สำเร็จ', res.message || '', 'error');
    }
    localStorage.removeItem('slts_pending_share_code');
    const route = res.route || {};
    const stops = route.stops || [];
    const hasCurrent = (state.currentRouteStops || []).length > 0;
    const ok = await Swal.fire({
      icon: 'question',
      title: `รับเส้นทาง ${stops.length} จุด?`,
      html: `จาก <b>${esc(res.createdByName || res.createdBy)}</b><br><span class="slts-muted">สร้างเมื่อ ${fmtDate(res.createdAt)}</span>` +
        (hasCurrent ? `<p class="slts-warn mt-2">เส้นทางปัจจุบันของคุณ (${state.currentRouteStops.length} จุด) จะถูกแทนที่</p>` : ''),
      showCancelButton: true, confirmButtonText: 'รับเส้นทาง', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#059669',
    });
    if (!ok.isConfirmed) return;
    const handoff = {
      ...route, type: 'share_route', action: 'share_route', status: 'pending',
      user_id: me().username, target_user_id: me().username,
      from_user_id: res.createdBy, from_user_name: res.createdByName || res.createdBy,
      timestamp: new Date().toISOString(),
    };
    try {
      if (typeof applyReceivedHandoff === 'function') applyReceivedHandoff(handoff);
      if (typeof window.saveRouteToServer === 'function') setTimeout(() => window.saveRouteToServer(), 800);
      if (typeof logServerActivity === 'function') logServerActivity('ROUTE_QR_IMPORTED', `รับเส้นทาง ${stops.length} จุดจาก QR ${code}`);
      if (!isMobile() && typeof switchTab === 'function') switchTab('map');
      UI.toast(`รับเส้นทาง ${stops.length} จุดเรียบร้อย`);
    } catch (err) {
      SLTS.reportError(err, { where: 'importShareCode' });
      Swal.fire('นำเข้าเส้นทางไม่สำเร็จ', err.message || '', 'error');
    }
  };

  UI.consumePendingShareCode = function () {
    const code = localStorage.getItem('slts_pending_share_code');
    if (code && me() && SLTS.auth.getToken()) setTimeout(() => UI.importShareCode(code), 600);
  };

  // ลิงก์ ?share=CODE (เปิดจากกล้องมือถือทั่วไป / LINE / ข้อความ)
  function readShareParam() {
    const u = new URL(location.href);
    const code = u.searchParams.get('share') || (u.hash.match(/share=([A-Za-z0-9-]+)/) || [])[1];
    if (!code) return;
    localStorage.setItem('slts_pending_share_code', extractShareCode(code));
    u.searchParams.delete('share'); u.hash = '';
    history.replaceState(null, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams : ''));
  }
  readShareParam();

  // =====================================================================
  // 3) คลังภาพในเครื่อง + สถานะออฟไลน์
  // =====================================================================
  async function refreshPendingIndicators() {
    try {
      const st = await SLTS.vault.stats();
      const dot = document.getElementById('cameraMenuPendingDot');
      if (dot) dot.classList.toggle('hidden', !st.pending);
      UI._vaultStats = st;
    } catch (_) {}
  }

  function ensureNetBanner() {
    let el = document.getElementById('sltsNetBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sltsNetBanner';
      el.className = 'slts-net-banner hidden';
      el.setAttribute('role', 'status');
      el.onclick = () => UI.openVault();
      document.body.appendChild(el);
    }
    return el;
  }
  async function renderNetBanner(stateName) {
    const el = ensureNetBanner();
    const queue = typeof getBackgroundQueue === 'function' ? getBackgroundQueue() : [];
    const n = queue.length;
    if (stateName === 'offline' || stateName === 'server-down') {
      el.className = 'slts-net-banner offline';
      el.innerHTML = `<i class="fa-solid fa-wifi"></i> ${stateName === 'offline' ? 'ออฟไลน์' : 'เซิร์ฟเวอร์ไม่ตอบ'} • ถ่ายต่อได้${n ? ` • รอส่ง ${n} ภาพ` : ''}`;
      el.title = 'ภาพทุกใบเก็บในเครื่องก่อน และจะส่งขึ้นระบบอัตโนมัติเมื่อมีสัญญาณ (แตะเพื่อดูคลังภาพ)';
    } else if (n > 0) {
      el.className = 'slts-net-banner syncing';
      el.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> กำลังส่งภาพที่ค้าง ${n} รายการ...`;
    } else {
      el.className = 'slts-net-banner hidden';
    }
    refreshPendingIndicators();
  }
  SLTS.net.onChange((s) => {
    renderNetBanner(s);
    if (s === 'online' && typeof window.resumeBackgroundQueueNow === 'function') window.resumeBackgroundQueueNow();
  });
  setInterval(() => { renderNetBanner(SLTS.net.state); }, 5000);

  UI.openVault = async function () {
    const all = await SLTS.vault.list();
    const queue = typeof getBackgroundQueue === 'function' ? getBackgroundQueue() : [];
    const inQueue = new Set(queue.map((q) => q.id));
    const st = await SLTS.vault.stats();
    const urls = [];
    const label = { pending: ['รอส่ง', 'pending'], uploaded: ['ส่งแล้ว', 'ok'], manual: ['ยืนยันเอง', 'ok'], cancelled: ['ยกเลิก', 'muted'] };
    const rows = all.slice(0, 60).map((r) => {
      const url = URL.createObjectURL(r.blob); urls.push(url);
      const [txt, cls] = label[r.status] || [r.status, 'muted'];
      return `<li class="slts-vault-item">
        <img src="${url}" alt="" loading="lazy">
        <div class="slts-vault-meta">
          <b>${esc(r.caseNumber || r.fileName)}</b>
          <small>${fmtDate(r.createdAt)}${r.savedToDevice ? ' • <i class="fa-solid fa-mobile-screen"></i> ในเครื่องแล้ว' : ''}</small>
          <span class="slts-pill ${cls}">${txt}${r.status === 'pending' && !inQueue.has(r.id) ? ' (ไม่อยู่ในคิว)' : ''}</span>
        </div>
        <div class="slts-vault-actions">
          <button type="button" class="slts-icon-btn" data-act="save" data-id="${esc(r.id)}" title="บันทึกลงเครื่อง"><i class="fa-solid fa-download"></i></button>
          ${r.status === 'pending' && !inQueue.has(r.id) ? `<button type="button" class="slts-icon-btn" data-act="requeue" data-id="${esc(r.id)}" title="ส่งใหม่"><i class="fa-solid fa-rotate"></i></button>` : ''}
        </div>
      </li>`;
    }).join('');
    const mb = (st.bytes / 1048576).toFixed(1);
    await Swal.fire({
      title: 'คลังภาพในเครื่อง',
      html: `
        <div class="slts-stats">
          <div><b>${st.pending || 0}</b><span>รอส่ง</span></div>
          <div><b>${(st.uploaded || 0) + (st.manual || 0)}</b><span>ส่งแล้ว</span></div>
          <div><b>${mb} MB</b><span>พื้นที่ใช้</span></div>
        </div>
        <label class="slts-switch"><input type="checkbox" id="sltsAutoSave" ${SLTS.vault.autoSaveEnabled() ? 'checked' : ''}> บันทึกสำเนาภาพลงเครื่อง (โฟลเดอร์ดาวน์โหลด/เอกสาร) ทุกครั้งที่ถ่าย</label>
        <p class="slts-muted">ภาพทุกใบถูกเก็บในแอปก่อนอัปโหลดเสมอ ภาพที่ส่งสำเร็จแล้วจะถูกล้างอัตโนมัติหลัง 14 วัน</p>
        <ul class="slts-vault-list">${rows || '<li class="slts-empty">ยังไม่มีภาพในคลัง</li>'}</ul>
        <div class="slts-btn-row">
          <button type="button" class="slts-btn" id="sltsVaultSync"><i class="fa-solid fa-cloud-arrow-up"></i> ส่งภาพที่ค้างตอนนี้</button>
        </div>`,
      showConfirmButton: false, showCloseButton: true, width: 560,
      didOpen: (pop) => {
        pop.querySelector('#sltsAutoSave').onchange = (e) => SLTS.vault.setAutoSave(e.target.checked);
        pop.querySelector('#sltsVaultSync').onclick = async () => {
          SLTS.net.markUnknown();
          const ok = await SLTS.net.check(true);
          if (!ok) return UI.toast('ยังติดต่อเซิร์ฟเวอร์ไม่ได้ ระบบจะส่งให้อัตโนมัติเมื่อมีสัญญาณ', 'warning', 3000);
          const restored = await SLTS.vault.reconcile(getBackgroundQueue, enqueueBackgroundUpload);
          window.resumeBackgroundQueueNow();
          UI.toast(restored ? `นำ ${restored} ภาพกลับเข้าคิวและเริ่มส่งแล้ว` : 'เริ่มส่งภาพที่ค้างแล้ว');
        };
        pop.querySelectorAll('[data-act]').forEach((b) => {
          b.onclick = async () => {
            const id = b.dataset.id;
            if (b.dataset.act === 'save') {
              try { await SLTS.vault.exportToDevice(id, { force: true }); UI.toast('บันทึกภาพลงเครื่องแล้ว'); } catch (err) { UI.toast('บันทึกไม่สำเร็จ: ' + err.message, 'error'); }
            } else if (b.dataset.act === 'requeue') {
              const rec = await SLTS.vault.get(id);
              if (rec) { await SLTS.vault.setStatus(id, 'pending', { createdAt: 0 }); }
              const n = await SLTS.vault.reconcile(getBackgroundQueue, enqueueBackgroundUpload);
              window.resumeBackgroundQueueNow();
              UI.toast(n ? 'นำภาพกลับเข้าคิวแล้ว' : 'ภาพนี้อยู่ในคิวแล้ว');
              b.remove();
            }
          };
        });
      },
      willClose: () => urls.forEach((u) => URL.revokeObjectURL(u)),
    });
  };

  // =====================================================================
  // 4) เมนูแบบง่าย + มุมมองแบบง่าย + เวอร์ชัน
  // =====================================================================
  UI.isSimple = () => localStorage.getItem('slts_simple_view') !== '0';
  UI.applySimpleView = (on) => {
    document.documentElement.classList.toggle('slts-simple', on);
    localStorage.setItem('slts_simple_view', on ? '1' : '0');
  };
  UI.applySimpleView(UI.isSimple());

  UI.openQuickMenu = async function () {
    await refreshPendingIndicators();
    const st = UI._vaultStats || {};
    const stops = (state.currentRouteStops || []).length;
    const items = [
      { id: 'scan', icon: 'fa-qrcode', color: '#d97706', title: 'สแกน QR รับเส้นทาง', sub: 'รับเส้นทางจากเพื่อนร่วมงาน' },
      { id: 'share', icon: 'fa-share-nodes', color: '#4f46e5', title: 'แชร์เส้นทางเป็น QR', sub: stops ? `${stops} จุดส่งหมาย` : 'ยังไม่มีเส้นทาง', disabled: !stops },
      ...(mobileLogic() && stops ? [{ id: 'clearroute', icon: 'fa-trash-can', color: '#e11d48', title: 'ล้างเส้นทางที่ได้รับ', sub: `${stops} จุด (ไม่กระทบภาพที่ถ่ายแล้ว)` }] : []),
      { id: 'vault', icon: 'fa-images', color: '#059669', title: 'คลังภาพในเครื่อง', sub: st.pending ? `${st.pending} ภาพรอส่ง` : 'ภาพทั้งหมดส่งแล้ว', badge: st.pending || 0 },
      { id: 'simple', icon: 'fa-eye', color: '#0ea5e9', title: UI.isSimple() ? 'ปิดมุมมองแบบง่าย' : 'เปิดมุมมองแบบง่าย', sub: 'ปุ่มใหญ่ ตัวอักษรอ่านง่าย' },
      { id: 'about', icon: 'fa-circle-info', color: '#64748b', title: `เวอร์ชัน ${SLTS.version}`, sub: 'ประวัติการอัปเดตระบบ' },
    ];
    if (isAdmin()) items.push({ id: 'admin', icon: 'fa-shield-halved', color: '#7c3aed', title: 'ศูนย์ผู้ดูแลระบบ', sub: 'บันทึกจุดบกพร่อง • ประวัติใช้งาน • สถานะระบบ' });
    const r = await Swal.fire({
      title: 'เมนู',
      html: `<div class="slts-menu">${items.map((i) => `
        <button type="button" class="slts-menu-item" data-id="${i.id}" ${i.disabled ? 'disabled' : ''}>
          <span class="slts-menu-icon" style="background:${i.color}"><i class="fa-solid ${i.icon}"></i></span>
          <span class="slts-menu-text"><b>${esc(i.title)}</b><small>${esc(i.sub)}</small></span>
          ${i.badge ? `<span class="slts-badge">${i.badge}</span>` : '<i class="fa-solid fa-chevron-right slts-chev"></i>'}
        </button>`).join('')}</div>`,
      showConfirmButton: false, showCloseButton: true, customClass: { popup: 'slts-sheet' },
      didOpen: (pop) => pop.querySelectorAll('.slts-menu-item').forEach((b) => { b.onclick = () => Swal.close({ isConfirmed: true, value: b.dataset.id }); }),
    });
    switch (r.value) {
      case 'scan': return UI.openScanRouteQR();
      case 'share': return UI.openShareRouteQR();
      case 'vault': return UI.openVault();
      case 'clearroute': return UI.confirmClearMobileRoute();
      case 'simple': UI.applySimpleView(!UI.isSimple()); return UI.toast(UI.isSimple() ? 'เปิดมุมมองแบบง่ายแล้ว' : 'ปิดมุมมองแบบง่ายแล้ว');
      case 'about': return UI.openAbout();
      case 'admin': return UI.openAdminCenter();
      default:
    }
  };

  async function fetchVersionInfo() {
    const base = SLTS.isNative ? SLTS.apiBase() : '';
    const res = await SLTS.nativeFetch(`${base}/version.json?_t=${Date.now()}`, { cache: 'no-store' });
    return res.json();
  }

  UI.openAbout = async function () {
    let info = null;
    try { info = await fetchVersionInfo(); } catch (_) {}
    const releases = (info && info.releases) || [];
    Swal.fire({
      title: `SLTS เวอร์ชัน ${esc(SLTS.version)}`,
      html: `${info && semverGt(info.version, SLTS.version) ? `<p class="slts-warn">มีเวอร์ชันใหม่ ${esc(info.version)} — <a href="#" onclick="location.reload();return false;">โหลดใหม่</a></p>` : ''}
        <div class="slts-releases">${releases.map((r) => `
          <section><h4>v${esc(r.version)} <small>${esc(r.date)}</small></h4><p><b>${esc(r.title || '')}</b></p>
          <ul>${(r.notes || []).map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>`).join('') || '<p class="slts-muted">โหลดประวัติไม่ได้ (ออฟไลน์)</p>'}</div>`,
      confirmButtonText: 'ปิด', confirmButtonColor: '#2563eb', width: 600,
    });
  };

  // ตรวจเวอร์ชันใหม่: เว็บ → โหลดใหม่, แอป → แจ้งให้อัปเดต
  async function checkForUpdate() {
    try {
      const info = await fetchVersionInfo();
      if (!info || !semverGt(info.version, SLTS.version)) return;
      if (sessionStorage.getItem('slts_update_notified') === info.version) return;
      sessionStorage.setItem('slts_update_notified', info.version);
      const busy = (typeof getBackgroundQueue === 'function' ? getBackgroundQueue().length : 0) > 0;
      Swal.fire({
        toast: true, position: 'bottom', icon: 'info', showConfirmButton: true,
        title: `มีอัปเดตระบบ v${info.version}`,
        text: SLTS.isNative ? 'โปรดอัปเดตแอปเป็นเวอร์ชันล่าสุด' : (busy ? 'จะโหลดใหม่หลังส่งภาพที่ค้างเสร็จ' : 'แตะเพื่อโหลดเวอร์ชันใหม่'),
        confirmButtonText: SLTS.isNative ? 'รับทราบ' : 'โหลดใหม่',
      }).then((r) => { if (r.isConfirmed && !SLTS.isNative && !busy) location.reload(); });
    } catch (_) {}
  }

  // =====================================================================
  // 5) ศูนย์ผู้ดูแลระบบ
  // =====================================================================
  UI.openAdminCenter = async function (tab = 'errors') {
    if (!isAdmin()) return Swal.fire('ไม่มีสิทธิ์', 'เฉพาะผู้ดูแลระบบ (Admin)', 'error');
    const tabs = [
      ['errors', 'fa-bug', 'จุดบกพร่อง'], ['activity', 'fa-clock-rotate-left', 'ประวัติใช้งาน'],
      ['shares', 'fa-qrcode', 'QR ที่แชร์'], ['system', 'fa-server', 'สถานะระบบ'], ['releases', 'fa-code-branch', 'เวอร์ชัน'],
    ];
    Swal.fire({
      title: 'ศูนย์ผู้ดูแลระบบ',
      html: `<nav class="slts-tabs">${tabs.map(([id, ic, t]) => `<button type="button" data-tab="${id}" class="${id === tab ? 'active' : ''}"><i class="fa-solid ${ic}"></i> ${t}</button>`).join('')}</nav>
             <div id="sltsAdminBody" class="slts-admin-body"><p class="slts-muted">กำลังโหลด...</p></div>`,
      showConfirmButton: false, showCloseButton: true, width: 980, customClass: { popup: 'slts-admin' },
      didOpen: (pop) => {
        pop.querySelectorAll('[data-tab]').forEach((b) => {
          b.onclick = () => {
            pop.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
            renderAdminTab(b.dataset.tab);
          };
        });
        renderAdminTab(tab);
      },
    });
  };

  async function renderAdminTab(tab) {
    const body = document.getElementById('sltsAdminBody');
    if (!body) return;
    body.innerHTML = '<p class="slts-muted"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลด...</p>';
    try {
      if (tab === 'errors') return await renderErrors(body);
      if (tab === 'activity') {
        const r = await SLTS.api('get_activity_logs', { limit: 200 }, { method: 'GET' });
        if (r.status !== 'success') throw new Error(r.message);
        body.innerHTML = `<div class="slts-table-wrap"><table class="slts-table"><thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>รายการ</th><th>รายละเอียด</th></tr></thead><tbody>${
          r.logs.map((l) => `<tr><td>${fmtDate(l.at)}</td><td>@${esc(l.username)}</td><td><code>${esc(l.action_type)}</code></td><td>${esc(l.details)}</td></tr>`).join('')}</tbody></table></div>`;
        return;
      }
      if (tab === 'shares') {
        const r = await SLTS.api('list_share_codes', { all: 1 }, { method: 'GET' });
        if (r.status !== 'success') throw new Error(r.message);
        body.innerHTML = `<div class="slts-table-wrap"><table class="slts-table"><thead><tr><th>รหัส</th><th>ผู้สร้าง</th><th>จุด</th><th>เปิดแล้ว</th><th>หมดอายุ</th><th></th></tr></thead><tbody>${
          r.shares.map((s) => `<tr><td><code>${esc(s.code)}</code></td><td>@${esc(s.created_by)}</td><td>${s.stops_count}</td><td>${s.open_count}</td>
            <td>${fmtDate(s.expires_at)}${s.revoked ? ' <span class="slts-pill muted">ยกเลิก</span>' : ''}</td>
            <td>${s.revoked ? '' : `<button type="button" class="slts-btn sm danger" data-revoke="${esc(s.code)}">ยกเลิก</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="slts-empty">ยังไม่มีการแชร์</td></tr>'}</tbody></table></div>`;
        body.querySelectorAll('[data-revoke]').forEach((b) => { b.onclick = async () => { await SLTS.api('revoke_share_code', { code: b.dataset.revoke }); renderAdminTab('shares'); }; });
        return;
      }
      if (tab === 'system') {
        const h = await SLTS.nativeFetch(SLTS.healthUrl() + '?_t=' + Date.now(), { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
        const vs = await SLTS.vault.stats().catch(() => ({}));
        const queue = typeof getBackgroundQueue === 'function' ? getBackgroundQueue() : [];
        const ok = (v) => v ? '<span class="slts-pill ok">พร้อม</span>' : '<span class="slts-pill bad">ยังไม่พร้อม</span>';
        body.innerHTML = `
          <dl class="slts-dl">
            <dt>API</dt><dd><code>${esc(SLTS.apiUrl())}</code> ${ok(h && h.ok)}</dd>
            <dt>ฐานข้อมูล Neon</dt><dd>${ok(h && h.db)}</dd>
            <dt>ที่เก็บไฟล์ภาพ</dt><dd>${ok(h && h.driveBridge)} <small class="slts-muted">${h && h.photoStorage === 'google-drive' ? 'Google Drive (ผ่าน Apps Script)' : 'Neon Postgres'}</small></dd>
            <dt>Neon AI Gateway</dt><dd>${ok(h && h.aiGateway)} <small class="slts-muted">ใช้ช่วยอ่านบัญชีจ่ายหมาย</small></dd>
            <dt>เวอร์ชัน</dt><dd>เครื่องนี้ v${esc(SLTS.version)} • เซิร์ฟเวอร์ v${esc(h && h.version || '-')}</dd>
            <dt>อุปกรณ์</dt><dd>${esc(SLTS.platform)} • คิวรอส่ง ${queue.length} • คลังภาพรอส่ง ${vs.pending || 0}</dd>
          </dl>
          ${SLTS.isNative ? `<label class="slts-field">ที่อยู่เซิร์ฟเวอร์ (สำหรับแอปมือถือ)<input id="sltsApiBase" class="swal2-input" value="${esc(SLTS.apiBase())}" placeholder="https://your-app.vercel.app"></label>
          <button type="button" class="slts-btn" id="sltsSaveApiBase">บันทึก</button>` : ''}`;
        const sb = document.getElementById('sltsSaveApiBase');
        if (sb) sb.onclick = () => { localStorage.setItem('slts_api_base', document.getElementById('sltsApiBase').value.trim()); UI.toast('บันทึกแล้ว'); };
        return;
      }
      if (tab === 'releases') {
        const info = await fetchVersionInfo();
        body.innerHTML = `<p class="slts-muted">เพิ่มเวอร์ชันใหม่ด้วยคำสั่ง <code>npm run version:bump -- patch "รายละเอียด"</code> (patch=แก้บั๊ก, minor=เพิ่มฟีเจอร์, major=เปลี่ยนใหญ่)</p>
          <div class="slts-releases">${(info.releases || []).map((r) => `<section><h4>v${esc(r.version)} <small>${esc(r.date)}</small></h4>
          <p><b>${esc(r.title || '')}</b></p><ul>${(r.notes || []).map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>`).join('')}</div>`;
      }
    } catch (err) {
      body.innerHTML = `<p class="slts-warn">โหลดข้อมูลไม่สำเร็จ: ${esc(err.message)}</p>`;
    }
  }

  async function renderErrors(body, status = '') {
    const r = await SLTS.api('list_errors', { status }, { method: 'GET' });
    if (r.status !== 'success') throw new Error(r.message);
    const c = r.counts || {};
    const st = { new: 'ใหม่', investigating: 'กำลังตรวจสอบ', fixed: 'แก้แล้ว', ignored: 'ไม่ต้องแก้' };
    body.innerHTML = `
      <div class="slts-filter">${['', 'new', 'investigating', 'fixed', 'ignored'].map((s) =>
        `<button type="button" data-st="${s}" class="${s === status ? 'active' : ''}">${s ? st[s] : 'ทั้งหมด'} ${s ? `(${c[s] || 0})` : ''}</button>`).join('')}</div>
      <p class="slts-muted">ระบบบันทึกข้อผิดพลาดจากทุกเครื่องอัตโนมัติ (รวมรายการซ้ำเป็นแถวเดียว) — ตรวจสอบ ใส่บันทึกการแก้ไข และระบุเวอร์ชันที่แก้</p>
      <div class="slts-err-list">${r.errors.map((e) => `
        <details class="slts-err ${esc(e.status)}">
          <summary><span class="slts-pill ${e.status === 'fixed' ? 'ok' : e.status === 'new' ? 'bad' : 'muted'}">${st[e.status]}</span>
            <b>${esc(e.message)}</b><small>×${e.occurrences} • ${fmtDate(e.last_seen_at)} • v${esc(e.app_version || '-')} • ${esc(e.source)}${e.username ? ' • @' + esc(e.username) : ''}</small></summary>
          <div class="slts-err-body">
            <p><b>อุปกรณ์:</b> ${esc(e.device || '-')}<br><b>หน้า:</b> ${esc(e.url || '-')}</p>
            ${e.stack ? `<pre>${esc(e.stack)}</pre>` : ''}
            ${e.context ? `<pre>${esc(JSON.stringify(e.context, null, 2))}</pre>` : ''}
            <div class="slts-err-form">
              <select data-f="status">${Object.entries(st).map(([k, v]) => `<option value="${k}" ${k === e.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
              <input data-f="ver" placeholder="แก้ในเวอร์ชัน เช่น 2.0.1" value="${esc(e.fixed_in_version || '')}">
              <textarea data-f="note" placeholder="บันทึกวิธีแก้ / คำแนะนำ">${esc(e.admin_note || '')}</textarea>
              <button type="button" class="slts-btn sm" data-save="${e.id}">บันทึก</button>
              ${e.resolved_by ? `<small class="slts-muted">ปิดโดย @${esc(e.resolved_by)} ${fmtDate(e.resolved_at)}</small>` : ''}
            </div>
          </div>
        </details>`).join('') || '<p class="slts-empty">ไม่พบรายการ 🎉</p>'}</div>`;
    body.querySelectorAll('[data-st]').forEach((b) => { b.onclick = () => renderErrors(body, b.dataset.st).catch(() => {}); });
    body.querySelectorAll('[data-save]').forEach((b) => {
      b.onclick = async () => {
        const box = b.closest('.slts-err-form');
        const res = await SLTS.api('update_error', {
          id: b.dataset.save, status: box.querySelector('[data-f=status]').value,
          fixedInVersion: box.querySelector('[data-f=ver]').value, adminNote: box.querySelector('[data-f=note]').value,
        });
        UI.toast(res.status === 'success' ? 'บันทึกแล้ว' : (res.message || 'บันทึกไม่สำเร็จ'), res.status === 'success' ? 'success' : 'error');
        if (res.status === 'success') renderErrors(body, status);
      };
    });
  }

  // =====================================================================
  // 6) AI ช่วยอ่านบัญชีจ่ายหมาย (Neon AI Gateway) — ใช้เมื่ออ่าน OCR แล้วได้ 0 รายการ
  // =====================================================================
  if (typeof window.extractDispatchRecordsFromLines === 'function' || typeof extractDispatchRecordsFromLines === 'function') {
    UI.aiExtractDispatch = async function (ocrText) {
      const res = await SLTS.api('ai_extract_dispatch', { text: ocrText, province: state.selectedProvince || '' }, { timeoutMs: 60000 });
      return res.status === 'success' ? res.records : [];
    };
  }

  // =====================================================================
  // 7) v2.2: เก็บเส้นทางที่ได้รับไว้ในเครื่อง — รีเฟรช/ปิดแอป/ไม่มีเน็ต เส้นทางไม่หาย และล้างได้จริง
  // =====================================================================
  const mobileLogic = () => (typeof window.sltsMobileLogic === 'function' ? window.sltsMobileLogic() : window.innerWidth <= 768);
  const uid = () => String((me() || {}).username || '').trim().toLowerCase();
  const routeKey = (kind) => `slts_route_keep_v22_${kind}_${uid()}`;
  const clearedKey = (kind) => `slts_route_cleared_keys_v22_${kind}_${uid()}`;
  const kindNow = () => (mobileLogic() ? 'mobile' : 'batch');
  const stopsOf = (kind) => (kind === 'mobile' ? state.currentRouteStops : state.routeBatchStops) || [];
  function keysOfStops(stops) {
    const out = new Set();
    (Array.isArray(stops) ? stops : []).forEach((st) => {
      if (!st || typeof st !== 'object') return;
      const k = (st.id && String(st.id)) || (st.caseNumber && 'c:' + String(st.caseNumber).replace(/\s+/g, '').toLowerCase())
        || (st.locationText && 'l:' + String(st.locationText).replace(/\s+/g, '').toLowerCase());
      if (k) out.add(k);
    });
    return [...out];
  }
  const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } };
  let lastPersisted = { mobile: '', batch: '' };

  const R = (SLTS.route = {
    keysOfStops,
    load(kind = kindNow()) {
      if (!uid()) return null;
      const r = readJSON(routeKey(kind));
      if (!r || !Array.isArray(r.stops) || !r.stops.length) return null;
      const cleared = new Set(readJSON(clearedKey(kind)) || []);
      const keys = keysOfStops(r.stops);
      if (cleared.size && keys.length && keys.every((k) => cleared.has(k))) return null;
      return r;
    },
    persist(kind = kindNow()) {
      if (!uid()) return;
      const stops = stopsOf(kind);
      if (!Array.isArray(stops) || !stops.length) return;
      const clean = typeof cleanStopsForStorage === 'function' ? cleanStopsForStorage(stops) : stops;
      const prev = readJSON(routeKey(kind)) || {};
      const sameRoute = keysOfStops(prev.stops).join('|') === keysOfStops(clean).join('|');
      const data = {
        stops: clean,
        startLocation: state.routeStartLocation || null,
        endLocation: state.routeEndLocation || null,
        isRoundTrip: Boolean(state.isRoundTrip),
        routeRoadPolyline: kind === 'mobile' && Array.isArray(state.routeRoadPolylineCoords) ? state.routeRoadPolylineCoords.slice(0, 3000) : (prev.routeRoadPolyline || null),
        totalDistanceKm: state.calculatedRoadDistanceKm || null,
        user_id: uid(), target_user_id: uid(), status: 'active_route', type: 'device_saved_route',
        timestamp: (sameRoute && prev.timestamp) || new Date().toISOString(),
      };
      const json = JSON.stringify(data);
      if (json === lastPersisted[kind]) return;
      try {
        localStorage.setItem(routeKey(kind), json);
        localStorage.removeItem(clearedKey(kind)); // ได้รับ/ใช้งานเส้นทางใหม่แล้ว
        lastPersisted[kind] = json;
      } catch (e) {
        // พื้นที่เต็ม: ตัดเส้นถนนออกแล้วลองใหม่
        try { data.routeRoadPolyline = null; localStorage.setItem(routeKey(kind), JSON.stringify(data)); } catch (_) {}
      }
    },
    /** คืนเส้นทางจากเครื่องเมื่อหน้าจอว่าง (หลังรีเฟรช / ระบบเดิมล้าง state ผิดจังหวะ) */
    restore(reason = '') {
      const kind = kindNow();
      if (!uid() || stopsOf(kind).length) return false;
      const r = R.load(kind);
      if (!r) return false;
      const stops = typeof deduplicateRouteStops === 'function' ? deduplicateRouteStops(r.stops) : r.stops;
      if (kind === 'mobile') {
        state.currentRouteStops = stops;
        if (r.startLocation) state.routeStartLocation = r.startLocation;
        if (r.endLocation) state.routeEndLocation = r.endLocation;
        if (r.isRoundTrip !== undefined) state.isRoundTrip = r.isRoundTrip;
        if (Array.isArray(r.routeRoadPolyline) && r.routeRoadPolyline.length) {
          state.routeRoadPolylineCoords = r.routeRoadPolyline;
          state.mapRoutePolylineCoords = r.routeRoadPolyline;
        }
        if (r.totalDistanceKm) state.calculatedRoadDistanceKm = r.totalDistanceKm;
        if (typeof syncStopsWithDeliveryStatus === 'function') { try { syncStopsWithDeliveryStatus(state.currentRouteStops); } catch (_) {} }
        if (typeof updateMobileRouteMapButtonBadge === 'function') { try { updateMobileRouteMapButtonBadge(stops.length); } catch (_) {} }
        if (document.querySelector('.slts-province-modal') && typeof renderMobileRouteList === 'function') { try { renderMobileRouteList(); } catch (_) {} }
      } else {
        state.routeBatchStops = stops;
        const tab = document.getElementById('tabContentRouteBatch');
        if (tab && !tab.classList.contains('hidden') && typeof renderRouteBatchTab === 'function') { try { renderRouteBatchTab(); } catch (_) {} }
      }
      lastPersisted[kind] = JSON.stringify(r);
      console.log(`[SLTS.route] restored ${stops.length} stops (${kind}, ${reason})`);
      return true;
    },
    /** ล้างเส้นทางที่เก็บในเครื่อง; reason='server' = ถูกล้างจากเครื่องอื่น → ล้างหน้าจอด้วย */
    clearLocal(reason = 'user', kind = kindNow()) {
      const prev = readJSON(routeKey(kind));
      const keys = new Set([...(readJSON(clearedKey(kind)) || []), ...keysOfStops(prev && prev.stops), ...keysOfStops(stopsOf(kind))]);
      try { localStorage.setItem(clearedKey(kind), JSON.stringify([...keys])); } catch (_) {}
      localStorage.removeItem(routeKey(kind));
      lastPersisted[kind] = '';
      if (reason === 'server' && stopsOf(kind).length) {
        if (kind === 'mobile') {
          state.currentRouteStops = [];
          state.activeRouteStopTarget = null;
          ['slts_shared_route_stops', 'slts_shared_route_polyline', 'slts_shared_route_start', 'slts_shared_route_end', 'slts_latest_handoff']
            .forEach((k) => localStorage.removeItem(k));
          localStorage.removeItem('slts_user_route_' + uid());
          localStorage.removeItem('slts_device_handoff_' + uid());
          if (typeof updateMobileRouteMapButtonBadge === 'function') { try { updateMobileRouteMapButtonBadge(0); } catch (_) {} }
          if (document.querySelector('.slts-province-modal') && typeof renderMobileRouteList === 'function') { try { renderMobileRouteList(); } catch (_) {} }
        } else {
          state.routeBatchStops = [];
          if (typeof renderRouteBatchTab === 'function') { try { renderRouteBatchTab(); } catch (_) {} }
        }
        UI.toast('เส้นทางถูกล้างจากอีกเครื่องแล้ว', 'info', 2500);
      }
    },
    onServerCleared(clearedKeys) {
      const kind = kindNow();
      const local = keysOfStops(stopsOf(kind).length ? stopsOf(kind) : (readJSON(routeKey(kind)) || {}).stops);
      const set = new Set(clearedKeys || []);
      if (local.length && set.size && local.every((k) => set.has(k))) R.clearLocal('server', kind);
    },
    /** ส่งคำสั่งล้างไปเซิร์ฟเวอร์ — ถ้าออฟไลน์จะจำไว้แล้วส่งเมื่อกลับมาออนไลน์ */
    async requestServerClear(user = uid(), channel = 'active') {
      if (!user) return;
      const pendingKey = 'slts_pending_route_clear_v22';
      const pend = readJSON(pendingKey) || {};
      pend[user + '|' + channel] = Date.now();
      localStorage.setItem(pendingKey, JSON.stringify(pend));
      return R.flushPendingClears();
    },
    async flushPendingClears() {
      const pendingKey = 'slts_pending_route_clear_v22';
      const pend = readJSON(pendingKey) || {};
      const items = Object.keys(pend);
      if (!items.length || !SLTS.auth.getToken()) return;
      for (const item of items) {
        const [user, channel] = item.split('|');
        if (user !== uid()) continue;
        try {
          const r = await SLTS.api('clear_user_route', { user_id: user, channel }, { timeoutMs: 15000 });
          if (r && r.status === 'success') delete pend[item];
        } catch (_) { /* ออฟไลน์ ลองใหม่ภายหลัง */ }
      }
      localStorage.setItem(pendingKey, JSON.stringify(pend));
    },
  });

  // ระบบเดิมอ่านเส้นทางจากคีย์ที่มีเงื่อนไขเวลาซับซ้อน (หายได้ง่าย) → ถ้าไม่พบ ให้ใช้สำเนาในเครื่องแทน
  if (typeof window.getUserActiveRoute === 'function') {
    const origGetActive = window.getUserActiveRoute;
    window.getUserActiveRoute = function () {
      const r = origGetActive.apply(this, arguments);
      if (r && Array.isArray(r.stops) && r.stops.length) return r;
      if (mobileLogic()) {
        const kept = R.load('mobile');
        if (kept) return kept;
      }
      return r;
    };
  }
  if (typeof window.initMobileHandoffReceiver === 'function') {
    const origInit = window.initMobileHandoffReceiver;
    window.initMobileHandoffReceiver = function () {
      const out = origInit.apply(this, arguments);
      setTimeout(() => R.restore('after-init'), 50);
      return out;
    };
  }
  if (typeof window.clearRouteBatchOnly === 'function') {
    const origClearBatch = window.clearRouteBatchOnly;
    window.clearRouteBatchOnly = function () {
      R.clearLocal('user', 'batch');
      return origClearBatch.apply(this, arguments);
    };
  }

  // ปุ่ม "ล้างเส้นทาง" ในหน้ารายการเส้นทางบนมือถือ (เดิมมีแค่ในแถบแจ้งเตือนที่หายไปเองภายในไม่กี่วินาที)
  UI.confirmClearMobileRoute = async function () {
    const n = (state.currentRouteStops || []).length;
    const r = await Swal.fire({
      icon: 'warning', title: 'ล้างเส้นทางในเครื่องนี้?',
      text: `รายการส่งหมาย ${n} จุดที่ได้รับจากคอมพิวเตอร์จะถูกลบออกจากมือถือ (ภาพที่ถ่ายแล้วไม่หาย)`,
      showCancelButton: true, confirmButtonText: 'ล้างเส้นทาง', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#e11d48',
    });
    if (!r.isConfirmed) return;
    if (typeof window.clearMobileRouteHandoff === 'function') window.clearMobileRouteHandoff();
    else { R.clearLocal('user'); state.currentRouteStops = []; R.requestServerClear(); }
    if (document.querySelector('.slts-province-modal') && typeof renderMobileRouteList === 'function') { try { renderMobileRouteList(); } catch (_) {} }
    UI.toast('ล้างเส้นทางแล้ว');
  };
  if (typeof window.renderMobileRouteList === 'function') {
    const origRenderList = window.renderMobileRouteList;
    window.renderMobileRouteList = function () {
      const out = origRenderList.apply(this, arguments);
      const box = document.getElementById('mobileMapRouteStopsList');
      const n = (state.currentRouteStops || []).length;
      if (box && n && !box.querySelector('.slts-route-clear-bar')) {
        const bar = document.createElement('div');
        bar.className = 'slts-route-clear-bar';
        bar.innerHTML = `<span><i class="fa-solid fa-route"></i> เส้นทาง ${n} จุด</span>
          <button type="button" class="slts-btn sm danger"><i class="fa-solid fa-trash-can"></i> ล้างเส้นทาง</button>`;
        bar.querySelector('button').onclick = (e) => { e.stopPropagation(); UI.confirmClearMobileRoute(); };
        box.prepend(bar);
      }
      return out;
    };
  }

  // v2.3: 2.5 วิ → 6 วิ และหยุดขณะแอปอยู่เบื้องหลัง (ยังบันทึกทันทีตอนสลับแอป/ปิดหน้าผ่าน pagehide/visibilitychange)
  setInterval(() => {
    if (!uid() || document.hidden) return;
    const kind = kindNow();
    if (stopsOf(kind).length) R.persist(kind);
    else R.restore('watchdog');
  }, 6000);
  const persistNow = () => { try { if (uid() && stopsOf(kindNow()).length) R.persist(); } catch (_) {} };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { persistNow(); return; }
    // กลับมาที่แอป: ตรวจเส้นทางใหม่จากคอมพิวเตอร์ทันที (ระหว่างอยู่เบื้องหลังระบบหยุดถามเซิร์ฟเวอร์)
    if (uid()) {
      R.restore('resume');
      try { if (typeof checkHandoffForCurrentUser === 'function') checkHandoffForCurrentUser(); } catch (_) {}
      try { if (typeof window.fetchActiveRouteFromServer === 'function') window.fetchActiveRouteFromServer(); } catch (_) {}
      if (typeof window.resumeBackgroundQueueNow === 'function') window.resumeBackgroundQueueNow();
    }
  });
  window.addEventListener('pagehide', persistNow);
  window.addEventListener('online', () => setTimeout(() => R.flushPendingClears(), 1500));
  if (window.BroadcastChannel) {
    try {
      const bcRoute = new BroadcastChannel('slts_device_handoff');
      bcRoute.onmessage = (ev) => {
        const d = ev && ev.data;
        if (d && (d.type === 'clear_user_route' || d.action === 'clear_user_route') && String(d.user_id || '').toLowerCase() === uid()) {
          R.clearLocal('user');
        }
      };
    } catch (_) {}
  }

  // =====================================================================
  // เริ่มทำงาน
  // =====================================================================
  document.addEventListener('DOMContentLoaded', () => {
    const fv = document.getElementById('footerVersion');
    if (fv) fv.textContent = 'v' + SLTS.version;

    // ตรวจ token กับเซิร์ฟเวอร์ (เช่น ถูกเปลี่ยนรหัส/ปิดบัญชีจากเครื่องอื่น)
    if (SLTS.auth.getToken()) {
      SLTS.api('me', {}, { method: 'GET', timeoutMs: 10000 }).then((r) => {
        if (r && r.status === 'success' && r.user) {
          applyLoggedInUser(r.user);
          if (typeof updateAuthUI === 'function') updateAuthUI();
          if (r.user.mustChangePassword) UI.forcePasswordChange();
          else UI.consumePendingShareCode();
        }
      }).catch(() => { /* ออฟไลน์: ใช้เซสชันในเครื่องต่อไป */ });
    } else if (localStorage.getItem('slts_v2_relogin_notice')) {
      setTimeout(() => UI.toast('ระบบอัปเดตเป็นเวอร์ชัน 2 — กรุณาเข้าสู่ระบบอีกครั้ง', 'info', 4000), 1200);
    }

    SLTS.net.check(true).then((ok) => renderNetBanner(ok ? 'online' : SLTS.net.state));
    setTimeout(() => { try { SLTS.route.restore('startup'); SLTS.route.flushPendingClears(); } catch (e) { SLTS.reportError(e, { where: 'route.restore' }); } }, 1200);
    setTimeout(async () => {
      try {
        if (typeof getBackgroundQueue === 'function' && typeof enqueueBackgroundUpload === 'function') {
          const n = await SLTS.vault.reconcile(getBackgroundQueue, enqueueBackgroundUpload);
          if (n) { UI.toast(`กู้คืนภาพที่ยังไม่ได้ส่ง ${n} ภาพ เข้าคิวแล้ว`, 'info', 3500); window.resumeBackgroundQueueNow(); }
        }
        await SLTS.vault.purge(14);
      } catch (e) { SLTS.reportError(e, { where: 'vault.reconcile' }); }
      refreshPendingIndicators();
    }, 6000);
    setTimeout(checkForUpdate, 15000);
    setInterval(checkForUpdate, 30 * 60 * 1000);
  });
})();
