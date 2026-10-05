/* Shelf Pulse service worker.
   Bump CACHE_NAME (e.g. 'shelf-pulse-v6') every time this file changes, so old caches get cleared on
   activate. index.html itself no longer needs a bump — it's always revalidated (see below). */
const CACHE_NAME = 'shelf-pulse-v5';
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

/* The page itself: network first, saved copy only if the connection is slow or down. Two things make
   sure an update actually reaches the phone:
   - the request asks to REVALIDATE ({cache:'no-cache'}) instead of trusting the browser's own HTTP
     cache — GitHub Pages marks pages cacheable for 10 minutes, so a plain fetch can quietly return a
     page that's minutes old even though it looks like a network request. A revalidation is cheap
     (a 304 if nothing changed).
   - if we give up waiting and show the saved copy, the download is NOT abandoned: it carries on in the
     background (event.waitUntil keeps the worker alive for it) and replaces the saved copy, so the next
     open is current. Before, a slow connection discarded it and stayed stale.
   Everything else on this site (the vendor libraries) stays stale-while-revalidate. Firebase and other
   cross-origin requests are never intercepted. */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' || req.destination === 'document') {
    let stored = Promise.resolve();
    const network = fetch(req, { cache: 'no-cache' }).then(res => {
      if (res && res.status === 200) {
        const copy = res.clone();
        stored = caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
      }
      return res;
    });
    event.waitUntil(network.then(() => stored, () => {}).catch(() => {}));
    event.respondWith((async () => {
      try {
        return await Promise.race([
          network,
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), PAGE_TIMEOUT_MS)),
        ]);
      } catch (e) {
        const cache = await caches.open(CACHE_NAME);
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
