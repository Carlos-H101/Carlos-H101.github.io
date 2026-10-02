// Service Worker for Carlos Hernandez Portfolio
// Network-first: visitors always get the latest published version (admin
// panel publishes show up on the next load), and the cache is only an
// offline fallback. Bump CACHE_NAME whenever this file's strategy changes —
// activation deletes every older cache.

const CACHE_NAME = 'carlos-portfolio-v2';
const PRECACHE = ['/', '/manifest.json', '/favicon.png'];
// Never park big assets (GLB models, videos, the 17MB cad-models.js file://
// fallback) in Cache Storage — the browser's HTTP cache handles those.
const MAX_CACHE_BYTES = 4 * 1024 * 1024;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Fonts, icons, and CDN scripts: leave to the browser's default handling.
  if (url.origin !== self.location.origin) return;
  // Range requests are video seeking — pass straight through.
  if (req.headers.has('range')) return;
  const nav = req.mode === 'navigate';
  // Page visits are stored under their plain path, so ?intro=1 etc. don't
  // pile up duplicate copies of index.html.
  const key = nav ? url.origin + url.pathname : req;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const len = Number(res.headers.get('content-length') || 0);
          if (nav || (len > 0 && len <= MAX_CACHE_BYTES)) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(key, copy));
          }
        }
        return res;
      })
      .catch(() =>
        caches.match(key).then((hit) =>
          hit || (nav ? caches.match('/') : Response.error())
        )
      )
  );
});
