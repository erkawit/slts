/**
 * js/slts-core.js — แกนกลางระบบ v2 (โหลดก่อน app.js)
 *
 *  SLTS.apiUrl()      ที่อยู่ API (/api/slts บน Vercel + Neon)
 *  SLTS.auth          token การเข้าสู่ระบบ
 *  SLTS.api()         เรียก API
 *  SLTS.net           ตรวจสัญญาณอินเทอร์เน็ตจริง (ไม่เชื่อ navigator.onLine อย่างเดียว)
 *  SLTS.vault         คลังภาพถ่ายในเครื่อง (IndexedDB) — บันทึกก่อนอัปโหลดเสมอ
 *  SLTS.reportError() ส่งบันทึกจุดบกพร่องให้ผู้ดูแลระบบ
 *
 * ตัวดัก fetch: คำขอเดิมที่ยิงไป Google Apps Script จะถูกส่งไป API ใหม่พร้อม token อัตโนมัติ
 */
(function () {
  'use strict';
  const CFG = window.SLTS_CONFIG || {};
  const SLTS = (window.SLTS = window.SLTS || {});
  const LS = window.localStorage;
  const safeGet = (k) => { try { return LS.getItem(k); } catch (_) { return null; } };
  const safeSet = (k, v) => { try { LS.setItem(k, v); } catch (_) {} };
  const safeDel = (k) => { try { LS.removeItem(k); } catch (_) {} };

  // ------------------------------------------------------------------
  // เวอร์ชัน & แพลตฟอร์ม
  // ------------------------------------------------------------------
  const metaVer = document.querySelector('meta[name="slts-version"]');
  SLTS.version = (metaVer && /^\d/.test(metaVer.content)) ? metaVer.content : '2.0.0';
  SLTS.isNative = Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  SLTS.platform = SLTS.isNative ? (window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : 'native')
    : (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) ? 'ios-web'
      : /Android/i.test(navigator.userAgent) ? 'android-web' : 'desktop-web';

  SLTS.apiBase = function () {
    const override = (safeGet('slts_api_base') || '').trim();
    const base = override || (CFG.API_BASE || '').trim();
    return base.replace(/\/+$/, '');
  };
  SLTS.apiUrl = function () { return SLTS.apiBase() + '/api/slts'; };
  SLTS.healthUrl = function () { return SLTS.apiBase() + '/api/health'; };
  SLTS.publicWebUrl = function () {
    const u = (CFG.PUBLIC_WEB_URL || '').trim() || (SLTS.isNative ? SLTS.apiBase() : (location.origin + location.pathname.replace(/index\.html$/, '')));
    return u.replace(/\/+$/, '');
  };

  // ------------------------------------------------------------------
  // ลิงก์รูปภาพ: รองรับทั้งภาพใน Neon (fileId = db-<id>-<sig>) และภาพเดิมใน Google Drive
  // ------------------------------------------------------------------
  const isNeonPhoto = (id) => /^db-\d+-/.test(String(id || '').trim());
  window.sltsImgUrl = function (fileId, size) {
    const id = String(fileId || '').trim();
    if (!id) return '';
    if (isNeonPhoto(id)) return SLTS.apiBase() + '/api/photo?f=' + encodeURIComponent(id);
    return `https://lh3.googleusercontent.com/d/${id}=w${size || 1600}`;
  };
  window.sltsThumbUrl = function (fileId, size) {
    const id = String(fileId || '').trim();
    if (!id) return '';
    if (isNeonPhoto(id)) return window.sltsImgUrl(id, size);
    return `https://drive.google.com/thumbnail?id=${id}&sz=w${size || 800}`;
  };

  // ------------------------------------------------------------------
  // ล้างข้อมูลเสี่ยงจากเวอร์ชันเดิม (รหัสผ่าน plaintext ที่เคยเก็บในเครื่อง)
  // ------------------------------------------------------------------
  (function migrateLegacyStorage() {
    try {
      const users = JSON.parse(safeGet('slts_users') || '[]');
      if (Array.isArray(users) && users.some((u) => u && 'password' in u)) {
        safeSet('slts_users', JSON.stringify(users.map((u) => { const c = { ...u }; delete c.password; return c; })));
      }
    } catch (_) { safeDel('slts_users'); }
    safeDel('slts_apps_script_url');
    if (safeGet('slts_default_reset_pass') === 'caogikojt02') safeDel('slts_default_reset_pass');
    // เซสชันแบบเดิม (ไม่มี token จากเซิร์ฟเวอร์) ใช้ไม่ได้แล้ว → ให้ล็อกอินใหม่ 1 ครั้ง
    if (!safeGet('slts_auth_token') && safeGet('slts_current_user')) {
      safeDel('slts_current_user');
      safeSet('slts_v2_relogin_notice', '1');
    }
  })();

  // ------------------------------------------------------------------
  // Auth token
  // ------------------------------------------------------------------
  let expiredNotified = 0;
  SLTS.auth = {
    getToken: () => safeGet('slts_auth_token') || '',
    setToken: (t) => { if (t) safeSet('slts_auth_token', t); else safeDel('slts_auth_token'); },
    clear: () => safeDel('slts_auth_token'),
    onExpired() {
      if (!SLTS.auth.getToken()) return;
      SLTS.auth.clear();
      if (Date.now() - expiredNotified < 10000) return;
      expiredNotified = Date.now();
      setTimeout(() => {
        try {
          if (typeof window.Swal !== 'undefined') {
            Swal.fire({
              icon: 'info', title: 'กรุณาเข้าสู่ระบบอีกครั้ง',
              text: 'เซสชันหมดอายุ ข้อมูลและภาพที่ค้างอยู่ยังเก็บในเครื่องครบ จะส่งต่อทันทีหลังเข้าสู่ระบบ',
              confirmButtonText: 'เข้าสู่ระบบ', confirmButtonColor: '#2563eb', allowOutsideClick: false,
            }).then(() => { if (typeof window.openLoginModal === 'function') window.openLoginModal(true); });
          } else if (typeof window.openLoginModal === 'function') {
            window.openLoginModal(true);
          }
        } catch (_) {}
      }, 50);
    },
  };

  // ------------------------------------------------------------------
  // ตัวดัก fetch → ส่งคำขอ Apps Script เดิมไป API ใหม่ + แนบ token
  // ------------------------------------------------------------------
  const nativeFetch = window.fetch.bind(window);
  SLTS.nativeFetch = nativeFetch;
  const GAS_RE = /^https:\/\/script\.google(?:usercontent)?\.com\/macros\//i;

  function isApiRequest(url) {
    if (!url) return false;
    if (GAS_RE.test(url)) return true;
    try {
      const u = new URL(url, location.href);
      const api = new URL(SLTS.apiUrl(), location.href);
      return u.origin === api.origin && u.pathname === api.pathname;
    } catch (_) { return false; }
  }

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
    if (!isApiRequest(url)) return nativeFetch(input, init);
    let search = '';
    try { search = new URL(url, location.href).search; } catch (_) {}
    const opts = Object.assign({}, init || {});
    const headers = new Headers(opts.headers || (input && input.headers) || undefined);
    const token = SLTS.auth.getToken();
    if (token && !headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
    headers.set('X-App-Version', SLTS.version);
    opts.headers = headers;
    delete opts.redirect; // ไม่ต้อง follow redirect แบบ Apps Script แล้ว
    if (opts.method && opts.method.toUpperCase() === 'GET') delete opts.body;
    return nativeFetch(SLTS.apiUrl() + search, opts).then((res) => {
      if (res.status === 401 && token) {
        res.clone().json().then((j) => { if (j && j.code === 'AUTH_REQUIRED') SLTS.auth.onExpired(); }).catch(() => {});
      }
      if (res.ok) SLTS.net && SLTS.net._markOnline();
      return res;
    });
  };

  /** เรียก API แบบสะดวก: คืน JSON (ไม่ throw เมื่อ status=error แต่ throw เมื่อเน็ตล่ม) */
  SLTS.api = async function (action, data = {}, { method = 'POST', timeoutMs = 30000 } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const qs = method === 'GET' ? '?' + new URLSearchParams({ action, ...data, _t: Date.now() }).toString() : '';
      const res = await window.fetch(SLTS.apiUrl() + qs, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ action, ...data }) : undefined,
        signal: ctrl.signal,
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({ status: 'error', message: 'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (HTTP ' + res.status + ')' }));
      json._http = res.status;
      return json;
    } finally {
      clearTimeout(t);
    }
  };

  // ------------------------------------------------------------------
  // ตรวจสัญญาณอินเทอร์เน็ตจริง
  // ------------------------------------------------------------------
  const net = { state: 'unknown', checkedAt: 0, inflight: null, listeners: [] };
  function setNetState(s) {
    const changed = net.state !== s;
    net.state = s; net.checkedAt = Date.now();
    if (changed) net.listeners.forEach((fn) => { try { fn(s); } catch (_) {} });
  }
  SLTS.net = {
    get state() { return net.state; },
    onChange(fn) { net.listeners.push(fn); },
    markUnknown() { net.checkedAt = 0; },
    _markOnline() { setNetState('online'); },
    /** true = ติดต่อเซิร์ฟเวอร์ได้จริง (cache 15 วินาที) */
    async check(force = false) {
      if (!navigator.onLine) { setNetState('offline'); return false; }
      if (!force && net.checkedAt && Date.now() - net.checkedAt < 15000) return net.state === 'online';
      if (net.inflight) return net.inflight;
      net.inflight = (async () => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), CFG.HEALTH_TIMEOUT_MS || 6000);
        try {
          const res = await nativeFetch(SLTS.healthUrl() + '?_t=' + Date.now(), { cache: 'no-store', signal: ctrl.signal });
          const ok = res.ok;
          setNetState(ok ? 'online' : 'server-down');
          return ok;
        } catch (_) {
          setNetState('offline');
          return false;
        } finally {
          clearTimeout(t);
          net.inflight = null;
        }
      })();
      return net.inflight;
    },
  };
  window.addEventListener('online', () => { SLTS.net.markUnknown(); SLTS.net.check(true).then((ok) => ok && flushErrors()); });
  window.addEventListener('offline', () => setNetState('offline'));

  // ------------------------------------------------------------------
  // บันทึกจุดบกพร่อง (Error log) → ส่งให้แอดมินดูในหน้า "บันทึกจุดบกพร่อง"
  // ------------------------------------------------------------------
  const ERR_KEY = 'slts_error_buffer';
  const IGNORE = [/ResizeObserver loop/i, /^Script error\.?$/i, /extension:\/\//i, /Non-Error promise rejection captured/i, /AbortError/i];
  let flushTimer = null;
  function deviceInfo() {
    return `${SLTS.platform} ${window.innerWidth}x${window.innerHeight} ${navigator.userAgent.slice(0, 160)}`;
  }
  function currentUsername() {
    try { return (JSON.parse(safeGet('slts_current_user') || 'null') || {}).username || ''; } catch (_) { return ''; }
  }
  SLTS.reportError = function (err, context) {
    try {
      const message = String((err && (err.message || err.reason)) || err || '').slice(0, 1000);
      if (!message || IGNORE.some((re) => re.test(message))) return;
      const stack = String((err && err.stack) || '').slice(0, 4000);
      const firstFrame = (stack.split('\n').find((l) => /\.js/.test(l)) || '').trim().slice(-120);
      const item = {
        message, stack, url: location.pathname + location.search.slice(0, 80), appVersion: SLTS.version,
        device: deviceInfo(), username: currentUsername(), context: context || null,
        fingerprint: 'client:' + message.slice(0, 160) + ':' + firstFrame, at: new Date().toISOString(),
      };
      const buf = JSON.parse(safeGet(ERR_KEY) || '[]');
      if (buf.some((b) => b.fingerprint === item.fingerprint) && buf.length > 5) return;
      buf.push(item);
      safeSet(ERR_KEY, JSON.stringify(buf.slice(-30)));
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flushErrors, 3000);
    } catch (_) { /* never throw */ }
  };
  async function flushErrors() {
    let buf;
    try { buf = JSON.parse(safeGet(ERR_KEY) || '[]'); } catch (_) { buf = []; }
    if (!buf.length || !navigator.onLine) return;
    try {
      const res = await SLTS.api('log_error', { errors: buf, appVersion: SLTS.version, device: deviceInfo() }, { timeoutMs: 10000 });
      if (res && res.status === 'success') safeDel(ERR_KEY);
    } catch (_) { /* keep for later */ }
  }
  SLTS.flushErrors = flushErrors;
  window.addEventListener('error', (e) => {
    if (e && e.target && e.target !== window && (e.target.src || e.target.href)) return; // resource load errors
    SLTS.reportError(e.error || e.message, { where: 'window.onerror', src: e.filename, line: e.lineno, col: e.colno });
  });
  window.addEventListener('unhandledrejection', (e) => SLTS.reportError(e.reason || 'unhandledrejection', { where: 'unhandledrejection' }));
  setTimeout(flushErrors, 8000);

  // ------------------------------------------------------------------
  // คลังภาพถ่ายในเครื่อง (Photo Vault) — IndexedDB แยกจากคิว เพื่อป้องกันภาพสูญหาย
  // สถานะ: pending (รอส่ง) | uploaded | manual (ยืนยันว่าส่งแล้วเอง) | cancelled (ผู้ใช้ยกเลิก)
  // ------------------------------------------------------------------
  const VAULT_DB = 'SLTS_PhotoVault';
  let vaultDbPromise = null;
  function openVault() {
    if (vaultDbPromise) return vaultDbPromise;
    vaultDbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB not supported'));
      const req = indexedDB.open(VAULT_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('photos')) {
          const st = db.createObjectStore('photos', { keyPath: 'id' });
          st.createIndex('status', 'status');
          st.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { vaultDbPromise = null; reject(req.error); };
    });
    return vaultDbPromise;
  }
  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    });
  }
  function dataUrlToBlob(dataUrl) {
    const [head, b64] = String(dataUrl).split(',');
    const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  SLTS.vault = {
    /** บันทึกภาพ (รอจนเขียนลงดิสก์เสร็จจริง) */
    async save({ id, caseNumber, fileName, dataUrl, payload, meta }) {
      const db = await openVault();
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').put({
        id, caseNumber: caseNumber || '', fileName: fileName || (id + '.jpg'), blob: dataUrlToBlob(dataUrl),
        payload: payload || null, meta: meta || null, status: 'pending', createdAt: Date.now(), updatedAt: Date.now(),
        savedToDevice: false,
      });
      await txDone(tx);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      return id;
    },
    async get(id) {
      const db = await openVault();
      return new Promise((resolve) => {
        const req = db.transaction('photos').objectStore('photos').get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    },
    async list({ status } = {}) {
      const db = await openVault();
      return new Promise((resolve) => {
        const st = db.transaction('photos').objectStore('photos');
        const req = status ? st.index('status').getAll(status) : st.getAll();
        req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.createdAt - a.createdAt));
        req.onerror = () => resolve([]);
      });
    },
    async setStatus(id, status, extra) {
      try {
        const db = await openVault();
        const tx = db.transaction('photos', 'readwrite');
        const st = tx.objectStore('photos');
        const rec = await new Promise((res) => { const r = st.get(id); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
        if (rec) {
          Object.assign(rec, extra || {}, { status, updatedAt: Date.now() });
          st.put(rec);
        }
        await txDone(tx);
      } catch (e) { console.warn('[Vault] setStatus', e); }
    },
    async getDataUrl(id) {
      const rec = await SLTS.vault.get(id);
      return rec && rec.blob ? blobToDataUrl(rec.blob) : null;
    },
    async stats() {
      const all = await SLTS.vault.list();
      const out = { total: all.length, pending: 0, uploaded: 0, manual: 0, cancelled: 0, bytes: 0 };
      all.forEach((r) => { out[r.status] = (out[r.status] || 0) + 1; out.bytes += (r.blob && r.blob.size) || 0; });
      return out;
    },
    /** ลบภาพที่อัปโหลดสำเร็จแล้วเกิน N วัน (ภาพที่ยังไม่ส่งจะไม่ถูกลบ) */
    async purge(days = 14) {
      const cutoff = Date.now() - days * 86400000;
      const db = await openVault();
      const tx = db.transaction('photos', 'readwrite');
      const st = tx.objectStore('photos');
      const all = await new Promise((res) => { const r = st.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); });
      let n = 0;
      all.forEach((r) => {
        if (['uploaded', 'manual', 'cancelled'].includes(r.status) && r.updatedAt < cutoff) { st.delete(r.id); n++; }
      });
      await txDone(tx);
      return n;
    },
    autoSaveEnabled() {
      const v = safeGet('slts_autosave_device');
      if (v === '1') return true;
      if (v === '0') return false;
      return SLTS.platform === 'android-web' || SLTS.isNative; // iOS เว็บต้องกดบันทึกเอง (ข้อจำกัดของ Safari)
    },
    setAutoSave(on) { safeSet('slts_autosave_device', on ? '1' : '0'); },
    /** บันทึกสำเนาภาพลงเครื่อง (แกลเลอรี/ดาวน์โหลด) */
    async exportToDevice(id, { force = false } = {}) {
      if (!force && !SLTS.vault.autoSaveEnabled()) return false;
      const rec = await SLTS.vault.get(id);
      if (!rec || !rec.blob) return false;
      const stamp = new Date(rec.createdAt);
      const p = (n) => String(n).padStart(2, '0');
      const devName = String(rec.fileName || 'photo.jpg').replace(/\.jpg$/i, '') +
        `_${stamp.getFullYear()}${p(stamp.getMonth() + 1)}${p(stamp.getDate())}-${p(stamp.getHours())}${p(stamp.getMinutes())}${p(stamp.getSeconds())}.jpg`;
      const plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
      if (SLTS.isNative && plugins.Filesystem) {
        const b64 = (await blobToDataUrl(rec.blob)).split(',')[1];
        await plugins.Filesystem.writeFile({ path: 'SLTS/' + devName, data: b64, directory: 'DOCUMENTS', recursive: true });
      } else if (force && navigator.canShare && SLTS.platform === 'ios-web') {
        const file = new File([rec.blob], devName, { type: 'image/jpeg' });
        if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: rec.caseNumber || devName });
      } else {
        const url = URL.createObjectURL(rec.blob);
        const a = document.createElement('a');
        a.href = url; a.download = devName; a.style.display = 'none';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
      await SLTS.vault.setStatus(id, rec.status, { savedToDevice: true });
      return true;
    },
    /**
     * กู้คืนงานที่ภาพยังอยู่ในคลังแต่หายจากคิว (เช่น ปิดแอปตอนกำลังบันทึกคิว)
     * @param getQueue ฟังก์ชันอ่านคิว  @param enqueue ฟังก์ชันเพิ่มงานเข้าคิว
     */
    async reconcile(getQueue, enqueue) {
      const pending = await SLTS.vault.list({ status: 'pending' });
      const queue = getQueue() || [];
      const inQueue = new Set(queue.map((q) => q.id));
      let restored = 0;
      for (const rec of pending) {
        if (inQueue.has(rec.id) || Date.now() - rec.createdAt < 120000 || !rec.payload) continue;
        const dataUrl = await blobToDataUrl(rec.blob);
        const m = rec.meta || {};
        const item = enqueue({
          id: rec.id, caseNumber: rec.caseNumber, originalCaseNumber: m.originalCaseNumber, routeStopIndex: m.routeStopIndex,
          stopId: m.stopId, courtType: m.courtType, locationText: m.locationText, fileName: rec.fileName,
          capturedPhotoUrl: dataUrl, payload: { ...rec.payload, imageBase64: dataUrl, clientUploadId: rec.id, action: 'upload_image' },
        });
        if (item) restored++;
      }
      return restored;
    },
  };
})();
