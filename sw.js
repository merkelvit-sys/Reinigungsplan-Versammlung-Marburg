// ============================================================================
// Unified Service Worker for Reinigungsplan Marburg (PWA + OneSignal Web Push)
// OneSignal SDK wird strikt synchron im ersten Auswertungs-Tick importiert,
// damit dessen Event-Handler (message/push/notificationclick) vor allem
// anderen Code registriert werden.
// ============================================================================
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

const CACHE_NAME = 'reinigungsplan-v2026.1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.json',
  '/icon.svg'
];

// Install: Pre-cache local core assets & activate immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch((err) => {
        console.warn('Fehler beim Pre-Caching:', err);
      })
  );
});

// Activate: Remove all outdated cache versions immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Lösche alten Cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Strategy
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // Ignore cross-origin requests (CDNs, Google Apps Script API, OneSignal)
  if (
    url.origin !== self.location.origin ||
    url.pathname.includes('OneSignal') ||
    url.pathname.includes('onesignal') ||
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('googleapis.com')
  ) {
    return;
  }

  // 1. Navigation / HTML Requests -> Network First, fallback to Cache
  if (event.request.mode === 'navigate' || event.request.destination === 'document' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone).catch(() => {});
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }

  // 2. Static Assets (CSS, SVG, Icons) -> Cache First / Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone).catch(() => {});
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// Synchronous root-level message handler (no setTimeout/async wrappers)
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
