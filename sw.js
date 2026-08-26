/**
 * sw.js - Service Worker for Offline-First PWA Support
 * ระบบจัดเก็บข้อมูลพิกัดส่งหมาย - ศาลจังหวัดอุดรธานี
 */

const CACHE_NAME = 'slts-court-cache-v4';

const STATIC_ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'sw.js',
  'css/style.css',
  'js/app.js',
  'js/data.js',
  'js/watermark.js',
  'js/compass.js',
  'js/map.js',
  'img/logo.png',
  'https://cdn.tailwindcss.com',
  'https://code.jquery.com/jquery-3.7.1.min.js',
  'https://cdn.datatables.net/1.13.7/css/jquery.dataTables.min.css',
  'https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Noto+Serif+Thai:wght@300;400;500;600;700&family=Sarabun:wght@300;400;500;600;700&display=swap'
];

// 1. Install Event: Cache all essential core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching static assets for offline use');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[Service Worker] Some assets failed to cache during install:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate Event: Clean up outdated caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Event: Stale-While-Revalidate / Network-First with Cache Fallback
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Don't intercept Google Apps Script POST requests
  if (event.request.method !== 'GET' || requestUrl.hostname.includes('script.google.com') || requestUrl.hostname.includes('googleusercontent.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch in background to update cache (Stale-while-revalidate)
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {
          // Ignore network errors when offline
        });
        return cachedResponse;
      }

      // If not in cache, fetch from network and store in cache
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic' && !event.request.url.startsWith('https://')) {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        // If offline and request is for page navigation, return index.html
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html') || caches.match('index.html');
        }
      });
    })
  );
});
