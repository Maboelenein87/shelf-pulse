/* Shelf Pulse service worker.
   Bump CACHE_NAME (e.g. 'shelf-pulse-v2') every time index.html is redeployed, so old caches get
   cleared out on activate and everyone picks up the new version on their next successful load. */
const CACHE_NAME = 'shelf-pulse-v2';
const APP_SHELL = ['./', './index.html'];

self.addEventListener('install', event => {
  self.skipWaiting(); // don't wait for old tabs to close — take over as soon as possible
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

/* Stale-while-revalidate for the app's own page: serve instantly from cache (works even with zero
   or failing connectivity — this is what fixes ERR_TIMED_OUT / "can't open this page" once someone
   has loaded the app at least once), while fetching a fresh copy in the background so the NEXT load
   already has whatever was just shipped. Firebase/Firestore calls and any other cross-origin request
   are left completely alone and go straight to the network as normal — only this site's own GET
   requests are intercepted. */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req).then(res => {
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await networkFetch) || new Response(
        'Offline and this page has never loaded successfully on this device yet.',
        { status: 503, headers: { 'Content-Type': 'text/plain' } }
      );
    })
  );
});
