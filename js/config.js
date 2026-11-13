/**
 * js/config.js — ค่าตั้งค่าฝั่งหน้าเว็บ/แอป
 *
 * API_BASE:
 *   - เว็บบน Vercel: ปล่อยว่าง ('') → เรียก /api/slts ของโดเมนเดียวกัน
 *   - แอป Android/iOS (Capacitor): ต้องใส่โดเมนเว็บจริง เช่น 'https://slts.vercel.app'
 *     (แอปเปิดไฟล์จากเครื่อง จึงต้องรู้ว่าจะเรียก API ที่ไหน)
 * PUBLIC_WEB_URL: ลิงก์ที่ฝังใน QR Code แชร์เส้นทาง (ให้กล้องมือถือทั่วไปเปิดได้)
 */
window.SLTS_CONFIG = Object.assign({
  API_BASE: '',
  PUBLIC_WEB_URL: '',
  HEALTH_TIMEOUT_MS: 6000,
}, window.SLTS_CONFIG || {});
