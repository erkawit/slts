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
      const found = parseWatermarkText(data && data.text);
      if (found) return { ...found, source: 'watermark', raw: (data.text || '').slice(0, 300) };
    }
    return null;
  }

  SLTS.geo = {
    parseWatermarkText,
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
