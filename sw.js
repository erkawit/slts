/**
 * sw.js - Service Worker for Offline-First PWA Support
 * ระบบจัดเก็บข้อมูลพิกัดส่งหมาย - ศาลจังหวัดอุดรธานี
 *
 * v2.0:
 *  - ชื่อแคชผูกกับเลขเวอร์ชัน (build-public.js แทนค่า __APP_VERSION__) → อัปเดตแล้วล้างแคชเก่าเอง
 *  - ไม่แคช /api/* (ข้อมูลส่วนบุคคล + ต้องสดเสมอ)
 *  - แคชไลบรารีจาก CDN (Tailwind, SweetAlert2, Leaflet, FontAwesome ...) แบบ opaque ได้
 *    (เดิมไม่แคช → เปิดแอปตอนไม่มีเน็ตแล้วหน้าจอพัง)
 */

const APP_VERSION = '__APP_VERSION__';
const CACHE_NAME = 'slts-court-cache-' + APP_VERSION;
const CDN_CACHE = 'slts-cdn-cache-v1';

const STATIC_ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'version.json',
  'css/style.css',
  'css/simple-view.css',
  'css/official.css',
  'js/config.js',
  'js/slts-core.js',
  'js/slts-geo.js',
  'js/slts-features.js',
  'js/report-logic.js',
  'js/report-docx.js',
  'js/report-xlsx.js',
  'js/report-exports.js',
  'js/slts-report.js',
  'js/pc-sidebar.js',
  'js/app.js',
  'js/data.js',
  'js/watermark.js',
  'js/compass.js',
  'js/map.js',
  'js/vendor/qrcode.js',
  'js/vendor/jsQR.js',
  'img/logo.png'
];

const CDN_HOSTS = [
  'cdn.tailwindcss.com', 'code.jquery.com', 'cdn.datatables.net', 'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net', 'unpkg.com', 'cdn.sheetjs.com'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS).catch((err) => {
      console.warn('[Service Worker] Pre-cache warning:', err);
    }))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.map((name) => {
        if (name !== CACHE_NAME && name !== CDN_CACHE && name !== 'slts-offline-backup') {
          return caches.delete(name);
        }
        return null;
      })
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ไม่ยุ่งกับ API ของระบบ, Apps Script และไฟล์ภาพจาก Google
  if (url.pathname.startsWith('/api/') || url.hostname.includes('script.google.com') ||
      url.hostname.includes('googleusercontent.com') || url.hostname.includes('tile') ||
      url.hostname.includes('openstreetmap') || url.hostname.includes('arcgisonline')) {
    return;
  }

  // ไลบรารีจาก CDN: ใช้แคชก่อน (stale-while-revalidate) รองรับ opaque response
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(CDN_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req).then((res) => {
          if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // ไฟล์ของแอป: Network-First แล้วใช้แคชเมื่อออฟไลน์
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      if (req.mode === 'navigate') return caches.match('index.html');
      return undefined;
    }))
  );
});

// Background Sync: แจ้งหน้าเว็บให้เริ่มส่งคิวเมื่อกลับมาออนไลน์
self.addEventListener('sync', (event) => {
  if (event.tag === 'slts-sync-queue') {
    event.waitUntil(notifyClientsToProcessQueue());
  }
});

async function notifyClientsToProcessQueue() {
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({ type: 'TRIGGER_BACKGROUND_QUEUE' }));
  } catch (err) {
    console.warn('[Service Worker] Background sync notification error:', err);
  }
}
