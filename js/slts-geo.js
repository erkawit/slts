/**
 * js/slts-geo.js — อ่านพิกัดจากไฟล์ภาพ (ใช้ทั้งมือถือ แท็บเล็ต และ PC)
 *
 * ลำดับการอ่าน:
 *   1) EXIF GPS ของไฟล์ (เร็ว แม่นที่สุด) — หมายเหตุ: Android หลายรุ่นตัด GPS ออกเมื่อเลือกรูปผ่าน "แกลเลอรี/Photo Picker"
 *   2) OCR ลายน้ำพิกัดบนภาพ (เช่น "17.4144°N 102.7881°E" ที่ระบบ SLTS ประทับไว้) — เน้นกล่องมุมขวาล่างก่อน
 *
 * SLTS.geo.extractFromFile(file, { dataUrl, onProgress }) → { lat, lng, source: 'exif'|'watermark', raw } | null
 */
(function () {
  'use strict';
  const SLTS = (window.SLTS = window.SLTS || {});

  const inThailandish = (lat, lng) => lat >= 4 && lat <= 22 && lng >= 96 && lng <= 107;
  const valid = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0);

  async function readExif(file) {
    if (!file || typeof window.exifr === 'undefined') return null;
    try {
      const gps = await window.exifr.gps(file);
      if (gps && valid(gps.latitude, gps.longitude)) return { lat: gps.latitude, lng: gps.longitude, source: 'exif' };
    } catch (_) { /* no exif */ }
    return null;
  }

  /**
   * แปลงข้อความ OCR เป็นพิกัด — ทนต่อการอ่านเครื่องหมายองศาผิด (° → o, º, 0, 9 ฯลฯ)
   * รูปแบบลายน้ำ SLTS: 17.4144°N 102.7881°E (ทศนิยม 4 ตำแหน่ง)
   */
  function parseWatermarkText(text) {
    if (!text) return null;
    const t = String(text)
      .replace(/[\n\r]+/g, ' ')
      .replace(/[,，](?=\d)/g, '.')            // 17,4144 → 17.4144
      .replace(/(\d)\s*\.\s*(\d)/g, '$1.$2')   // 17 . 4144 → 17.4144
      .replace(/[º˚o°*]/gi, (m) => (/[oO]/.test(m) ? 'o' : '°'));
    // lat ... N/S ... lng ... E/W โดยยอมให้มีอักขระแปลก (องศา) คั่นได้ไม่เกิน 2 ตัว
    const re = /(\d{1,2}\.\d{3,8})\s?([^\d\s]{0,2}|\d?)\s*([NS])[^\d]{0,6}?(\d{2,3}\.\d{3,8})\s?([^\d\s]{0,2}|\d?)\s*([EW])/i;
    const m = t.match(re);
    let out = null;
    if (m) {
      let latStr = m[1];
      let lngStr = m[4];
      // ถ้าองศาถูกอ่านเป็นตัวเลขต่อท้าย ("17.41440N") และทั้งสองค่ามีทศนิยม 5 ตำแหน่ง ให้ตัดหลักสุดท้ายออก
      const latDec = latStr.split('.')[1].length;
      const lngDec = lngStr.split('.')[1].length;
      if (latDec === 5 && lngDec === 5 && latStr.slice(-1) === lngStr.slice(-1)) {
        latStr = latStr.slice(0, -1);
        lngStr = lngStr.slice(0, -1);
      }
      let lat = parseFloat(latStr);
      let lng = parseFloat(lngStr);
      if (m[3].toUpperCase() === 'S') lat = -lat;
      if (m[6].toUpperCase() === 'W') lng = -lng;
      if (valid(lat, lng)) out = { lat, lng };
    }
    if (!out && typeof window.parseCoordinatesFromText === 'function') {
      out = window.parseCoordinatesFromText(t);
    }
    if (!out && typeof parseCoordinatesFromText === 'function') {
      try { out = parseCoordinatesFromText(t); } catch (_) {}
    }
    return out && valid(out.lat, out.lng) ? out : null;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('อ่านไฟล์ภาพไม่ได้'));
      i.src = src;
    });
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  /** ตัดภาพตามสัดส่วน → ขยาย → ขาวดำ (ตัวหนังสือดำบนพื้นขาว) เพื่อให้ OCR อ่านง่าย */
  function prepareCrop(img, fx, fy, fw, fh, targetW) {
    const W = img.naturalWidth || img.width;
    const H = img.naturalHeight || img.height;
    const sx = Math.round(W * fx), sy = Math.round(H * fy);
    const sw = Math.round(W * fw), sh = Math.round(H * fh);
    const scale = Math.min(3, targetW / sw);
    const c = document.createElement('canvas');
    c.width = Math.round(sw * scale);
    c.height = Math.round(sh * scale);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height);
    const px = d.data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) {
      const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      px[i] = y; sum += y;
    }
    const mean = sum / (px.length / 4);
    const invert = mean < 128; // ลายน้ำ SLTS = ตัวหนังสือขาวบนกล่องดำ
    for (let i = 0; i < px.length; i += 4) {
      let y = px[i];
      if (invert) y = 255 - y;
      const v = y > 150 ? 255 : (y < 90 ? 0 : y);
      px[i] = px[i + 1] = px[i + 2] = v;
      px[i + 3] = 255;
    }
    g.putImageData(d, 0, 0);
    return c;
  }

  let workerPromise = null;
  async function getWorker() {
    if (typeof window.Tesseract === 'undefined') throw new Error('OCR ไม่พร้อม');
    if (!workerPromise) {
      workerPromise = window.Tesseract.createWorker('eng', 1, { logger: () => {} })
        .then(async (w) => {
          try { await w.setParameters({ tessedit_pageseg_mode: '6' }); } catch (_) {}
          return w;
        })
        .catch((e) => { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  // ------------------------------------------------------------------
  // วันที่ส่งหมายจากภาพ: EXIF (วันที่ถ่าย) → ตัวอักษรวันที่บนภาพ (OCR) → วันที่ของไฟล์
  // ------------------------------------------------------------------
  const MONTHS_EN = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function mkDate(y, mo, d, hh, mi, ss, ampm) {
    y = Number(y); mo = Number(mo); d = Number(d);
    if (y < 100) y += 2000;
    if (y > 2400) y -= 543; // พ.ศ.
    let h = Number(hh || 0); const m = Number(mi || 0); const sec = Number(ss || 0);
    if (ampm) { const pm = /p/i.test(ampm); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h <= 23 && m <= 59)) return null;
    const dt = new Date(y, mo - 1, d, h, m, sec);
    if (dt.getMonth() !== mo - 1) return null;
    const now = Date.now();
    if (dt.getTime() > now + 864e5 || dt.getTime() < now - 2 * 365 * 864e5) return null; // ไม่อยู่ในอนาคต / ไม่เกิน 2 ปีย้อนหลัง
    return dt;
  }
  /** แปลงข้อความ (OCR) เป็นวันที่-เวลา เช่น 25/11/2025 10:30, 2025-11-25 10:30:12, Nov 25, 2025 10:30 AM, 25/11/2568 */
  function parseDateText(text) {
    if (!text) return null;
    const t = String(text).replace(/[\n\r]+/g, ' ').replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0').replace(/(?<=\d)[lI|](?=\d)/g, '1');
    const TIME = '(?:[^\\d]{0,4}(\\d{1,2})[:.](\\d{2})(?:[:.](\\d{2}))?\\s*([AaPp]\\.?[Mm]\\.?)?)?';
    let m;
    const reYmd = new RegExp('(20\\d{2}|25\\d{2})[\\/\\-.](\\d{1,2})[\\/\\-.](\\d{1,2})' + TIME);
    if ((m = t.match(reYmd))) { const d = mkDate(m[1], m[2], m[3], m[4], m[5], m[6], m[7]); if (d) return d; }
    const reDmy = new RegExp('(\\d{1,2})[\\/\\-.](\\d{1,2})[\\/\\-.](\\d{4}|\\d{2})(?!\\d)' + TIME);
    if ((m = t.match(reDmy))) {
      let dd = Number(m[1]); let mm = Number(m[2]);
      if (mm > 12 && dd <= 12) { const x = dd; dd = mm; mm = x; } // รูปแบบ เดือน/วัน/ปี
      const d = mkDate(m[3], mm, dd, m[4], m[5], m[6], m[7]); if (d) return d;
    }
    const reDMonY = new RegExp('(\\d{1,2})\\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?,?\\s*(\\d{4})' + TIME, 'i');
    if ((m = t.match(reDMonY))) { const d = mkDate(m[3], MONTHS_EN[m[2].toLowerCase()], m[1], m[4], m[5], m[6], m[7]); if (d) return d; }
    const reMonDY = new RegExp('(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s*(\\d{1,2}),?\\s*(\\d{4})' + TIME, 'i');
    if ((m = t.match(reMonDY))) { const d = mkDate(m[3], MONTHS_EN[m[1].toLowerCase()], m[2], m[4], m[5], m[6], m[7]); if (d) return d; }
    return null;
  }
  async function readExifDate(file) {
    if (!file || typeof window.exifr === 'undefined') return null;
    try {
      const x = await window.exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized']);
      const v = x && (x.DateTimeOriginal || x.CreateDate || x.DateTimeDigitized);
      const d = v instanceof Date ? v : (v ? new Date(v) : null);
      if (d && !isNaN(d) && d.getTime() <= Date.now() + 864e5 && d.getFullYear() > 2000) return d;
    } catch (_) { /* no exif */ }
    return null;
  }
  const ocrCache = new Map(); // dataUrl (ย่อ) → ข้อความ OCR ที่อ่านแล้ว
  const ocrKey = (u) => (u ? u.length + ':' + u.slice(-80) : '');
  /** อ่านข้อความทั้งภาพแบบเร็ว (ครึ่งล่าง → ครึ่งบน) เพื่อหาวันที่ */
  async function ocrTexts(dataUrl) {
    const key = ocrKey(dataUrl);
    const prev = ocrCache.get(key) || [];
    if (prev.length >= 2) return prev;
    if (typeof window.Tesseract === 'undefined' || !dataUrl) return prev;
    if (!navigator.onLine && !localStorage.getItem('slts_ocr_ready')) return prev;
    const img = await loadImage(dataUrl);
    const worker = await getWorker();
    const out = prev.slice();
    for (const [fx, fy, fw, fh] of [[0, 0.5, 1, 0.5], [0, 0, 1, 0.45]]) {
      const { data } = await worker.recognize(prepareCrop(img, fx, fy, fw, fh, 1600));
      out.push((data && data.text) || '');
      if (parseDateText(out.join(' '))) break;
    }
    ocrCache.set(key, out);
    return out;
  }
  /**
   * วันที่ส่งหมายจากภาพ → { date: Date, source: 'exif'|'ocr'|'file' } | null
   * @param {File|Blob} file  @param {string} dataUrl
   */
  async function readPhotoDate(file, dataUrl, opts = {}) {
    const ex = await readExifDate(file);
    if (ex) return { date: ex, source: 'exif' };
    if (opts.ocr !== false) {
      try {
        if (!dataUrl && file) dataUrl = await fileToDataUrl(file);
        const texts = await ocrTexts(dataUrl);
        const d = parseDateText(texts.join(' '));
        if (d) return { date: d, source: 'ocr' };
      } catch (e) { console.warn('[geo] date OCR failed', e); }
    }
    if (file && file.lastModified) {
      const d = new Date(file.lastModified);
      if (d.getTime() <= Date.now() + 60e3 && d.getTime() > Date.now() - 365 * 864e5) return { date: d, source: 'file' };
    }
    return null;
  }

  async function readWatermark(dataUrl, onProgress) {
    if (typeof window.Tesseract === 'undefined' || !dataUrl) return null;
    if (!navigator.onLine && !localStorage.getItem('slts_ocr_ready')) return null; // ครั้งแรกต้องดาวน์โหลดตัวอ่านภาษา
    const img = await loadImage(dataUrl);
    const landscape = (img.naturalWidth || img.width) > (img.naturalHeight || img.height);
    // [fx, fy, fw, fh] — กล่องข้อมูลลายน้ำ SLTS อยู่มุมขวาล่าง; แล้วค่อยขยายเป็นครึ่งล่าง และทั้งภาพ
    const regions = [
      landscape ? [0.22, 0.45, 0.78, 0.55] : [0.24, 0.55, 0.76, 0.45],
      [0, 0.5, 1, 0.5],
      [0, 0, 1, 0.45],
    ];
    const worker = await getWorker();
    for (let i = 0; i < regions.length; i++) {
      if (onProgress) onProgress(i + 1, regions.length);
      const [fx, fy, fw, fh] = regions[i];
      const canvas = prepareCrop(img, fx, fy, fw, fh, 1600);
      const { data } = await worker.recognize(canvas);
      try { localStorage.setItem('slts_ocr_ready', '1'); } catch (_) {}
      if (i > 0) { const k = ocrKey(dataUrl); ocrCache.set(k, (ocrCache.get(k) || []).concat((data && data.text) || '')); }
      const found = parseWatermarkText(data && data.text);
      if (found) return { ...found, source: 'watermark', raw: (data.text || '').slice(0, 300) };
    }
    return null;
  }

  SLTS.geo = {
    parseWatermarkText,
    parseDateText,
    readExifDate,
    readPhotoDate,
    readExif,
    _prepareCrop: prepareCrop,
    _loadImage: loadImage,
    readWatermark,
    inThailandish,
    /**
     * @param {File|Blob} file
     * @param {{dataUrl?: string, onProgress?: (step:string)=>void, preferWatermark?: boolean}} opts
     */
    async extractFromFile(file, opts = {}) {
      const step = opts.onProgress || (() => {});
      step('exif');
      const exif = await readExif(file);
      if (exif && !opts.preferWatermark) return exif;
      let dataUrl = opts.dataUrl;
      if (!dataUrl && file) { try { dataUrl = await fileToDataUrl(file); } catch (_) {} }
      step('ocr');
      let wm = null;
      try { wm = await readWatermark(dataUrl, (i, n) => step(`ocr:${i}/${n}`)); } catch (e) { console.warn('[geo] OCR failed', e); }
      return wm || exif || null;
    },
  };
})();
