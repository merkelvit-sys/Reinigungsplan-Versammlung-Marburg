const CACHE_NAME = 'reinigungsplan-marburg-v3';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './icon.svg'
];

// Install: Pre-cache local core assets atomically
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn('Fehler beim Pre-Caching:', err);
      })
  );
});

// Activate: Remove all outdated cache versions
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

// Fetch: Stale-While-Revalidate for app shell, Network-First for Apps Script API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Google Apps Script Web App API calls
  if (url.origin.includes('script.google.com') || url.origin.includes('googleusercontent.com')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 2. Static Assets & Third-Party CDN (FontAwesome)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
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
