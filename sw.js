/**
 * sw.js - Service Worker for Offline-First PWA Support
 * ระบบจัดเก็บข้อมูลพิกัดส่งหมาย - ศาลจังหวัดอุดรธานี
 */

const CACHE_NAME = 'slts-court-cache-v42';

const STATIC_ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/app.js',
  'js/data.js',
  'js/watermark.js',
  'js/compass.js',
  'js/map.js',
  'img/logo.png'
];

// 1. Install Event: Cache all essential local core assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[Service Worker] Pre-cache warning:', err);
      });
    })
  );
});

// 2. Activate Event: Clean up all outdated caches immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[Service Worker] Purging old cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Event: Network-First with Cache Fallback for instant update delivery
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Skip Google Apps Script & external non-GET APIs
  if (event.request.method !== 'GET' || requestUrl.hostname.includes('script.google.com') || requestUrl.hostname.includes('googleusercontent.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request).then((networkResponse) => {
      if (networkResponse && networkResponse.status === 200) {
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
      }
      return networkResponse;
    }).catch(() => {
      // Offline fallback: serve from cache
      return caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html') || caches.match('index.html');
        }
      });
    })
  );
});
