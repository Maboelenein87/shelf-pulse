/* Shelf Pulse service worker.
   Bump CACHE_NAME (e.g. 'shelf-pulse-v5') every time index.html is redeployed, so old caches get
   cleared out on activate and everyone picks up the new version. */
const CACHE_NAME = 'shelf-pulse-v4';
const APP_SHELL = ['./', './index.html'];
const PAGE_TIMEOUT_MS = 4000;

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

/* The page itself is fetched from the network FIRST (falling back to the saved copy only if the
   connection is slow or down) — serving the saved copy first meant a phone could run an older version
   of the app for a whole extra load after every update, and an older version can behave differently
   against the shared database. Everything else on this site (the vendor libraries) stays
   stale-while-revalidate. Firebase and other cross-origin requests are never intercepted. */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const res = await Promise.race([
          fetch(req),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), PAGE_TIMEOUT_MS)),
        ]);
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      } catch (e) {
        const cached = (await cache.match(req, { ignoreSearch: true })) || (await cache.match('./index.html'));
        return cached || new Response('Offline and this page has never loaded successfully on this device yet.',
          { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req).then(res => {
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await networkFetch) || new Response('Offline and nothing cached yet.', { status: 503 });
    })
  );
});
