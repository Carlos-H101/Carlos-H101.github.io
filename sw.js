// Service Worker for Carlos Hernandez Portfolio
//
// Website visitors: network-first, so admin panel publishes show up on the
// next load; a small runtime cache is only an offline fallback.
//
// Installed app (Add to Home Screen / Install app): the page asks for an
// "offline pack": every file index.html uses, plus its web fonts, icons and
// the 3D viewer, so the whole portfolio opens with no internet. Pack files
// are served cache-first (instant and offline-safe), and every launch with
// internet refreshes the pack in the background (unchanged files cost only
// a quick 304 check). Bump CACHE_NAME whenever this file's strategy changes;
// activation deletes every older runtime cache.

const CACHE_NAME = 'carlos-portfolio-v3';
const OFFLINE = 'carlos-portfolio-offline';
const PRECACHE = ['/', '/manifest.json', '/favicon.png'];
// Never park big assets in the website's runtime cache (the browser's HTTP
// cache handles those); the installed app's pack takes everything.
const MAX_CACHE_BYTES = 4 * 1024 * 1024;
// In the app, a weak convention Wi-Fi must never leave a blank screen:
// wait this long for a fresh page, then open the saved one.
const NAV_TIMEOUT = 3500;
// Hosts the pack may copy from (fonts, icons, the 3D viewer).
const CDN = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|unpkg\.com)\//;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== OFFLINE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ── offline pack ─────────────────────────────────────────────────────── */

// Every URL-looking token in index.html that ends in an asset extension
// (attributes, inline styles and script strings alike), plus the Google
// Fonts stylesheet. cad-models.js is the 17MB file:// fallback: skipped.
const ASSET = /(?:https:\/\/[^\s"'()<>\\]+|\.{0,2}\/[^\s"'()<>\\]+)\.(?:webp|png|jpe?g|gif|svg|ico|mp4|webm|glb|gltf|pdf|json|js|css|woff2?)(?:\?[^\s"'()<>\\]*)?/gi;
const FONTS_CSS = /https:\/\/fonts\.googleapis\.com\/css2\?[^"'\s<>]+/g;

function packUrls(html, base) {
  const out = new Set([new URL('/', base).href]);
  const text = html.replace(/&amp;/g, '&');
  for (const m of text.match(ASSET) || []) add(out, m, base);
  for (const m of text.match(FONTS_CSS) || []) add(out, m, base);
  return out;
}
function add(set, raw, base) {
  if (/cad-models\.js|\/sw\.js/.test(raw)) return;
  let u;
  try { u = new URL(raw, base); } catch (e) { return; }
  if (u.origin === self.location.origin || CDN.test(u.href)) set.add(u.href);
}
const sameOrigin = (href) => href.startsWith(self.location.origin);

// refresh one file into the pack; returns false if it could not be saved
async function refresh(cache, href) {
  const old = await cache.match(href);
  if (!sameOrigin(href)) {
    // CDN files are versioned / immutable: fetch once, then keep
    if (old) return true;
    const res = await fetch(href, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return false;
    await cache.put(href, res);
    return true;
  }
  const headers = {};
  const etag = old && old.headers.get('ETag');
  const mod = old && old.headers.get('Last-Modified');
  if (etag) headers['If-None-Match'] = etag; else if (mod) headers['If-Modified-Since'] = mod;
  const res = await fetch(href, { headers, cache: 'no-store' });
  if (res.status === 304 && old) return true;
  if (!res.ok) return false;
  await cache.put(href, res);
  return true;
}

let syncing = null;
async function syncPack(report) {
  const cache = await caches.open(OFFLINE);
  const shell = await fetch('/', { cache: 'no-store' });
  if (!shell.ok) throw new Error('page ' + shell.status);
  const html = await shell.clone().text();
  await cache.put(new URL('/', self.location.origin).href, shell);

  const urls = packUrls(html, self.location.origin);
  // stylesheets bring their fonts along (Google Fonts, Font Awesome)
  for (const href of [...urls]) {
    if (!/\.css(\?|$)|fonts\.googleapis\.com\/css2/.test(href)) continue;
    try {
      const css = await (await fetch(href, { mode: 'cors', credentials: 'omit' })).text();
      // woff2 only: every current tablet browser reads it, so the older
      // .ttf/.woff copies in Font Awesome's stylesheet are skipped
      for (const m of css.matchAll(/url\(\s*['"]?([^'")]+\.woff2)(?:\?[^'")]*)?['"]?\s*\)/g)) {
        add(urls, new URL(m[1], href).href, href);
      }
    } catch (e) { /* counted as a failure when the file itself is fetched */ }
  }

  const list = [...urls].filter((u) => u !== new URL('/', self.location.origin).href);
  let done = 0, failed = 0;
  report({ done, total: list.length });
  const queue = list.slice();
  async function worker() {
    while (queue.length) {
      const href = queue.shift();
      let ok = false;
      try { ok = await refresh(cache, href); } catch (e) { ok = false; }
      if (!ok) failed++;
      done++;
      report({ done, total: list.length });
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);

  // drop files the page no longer uses
  const keep = new Set([...urls]);
  for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
  return { total: list.length, failed };
}

self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'sync-offline') return;
  const client = event.source;
  const report = (m) => { if (client) client.postMessage(Object.assign({ type: 'offline-progress' }, m)); };
  if (!syncing) syncing = syncPack(report).finally(() => { syncing = null; });
  event.waitUntil(
    syncing.then((r) => report(Object.assign({ finished: true }, r)))
           // no internet: say whether a saved copy is there to fall back on
           .catch((e) => caches.open(OFFLINE).then((c) => c.keys())
             .then((keys) => report({ finished: true, error: String(e), saved: keys.length })))
  );
});

/* ── serving ──────────────────────────────────────────────────────────── */

async function packMatch(req) {
  if (!(await caches.has(OFFLINE))) return null;
  const cache = await caches.open(OFFLINE);
  return cache.match(req.url);
}

// <video> asks for byte ranges; answer them from the saved file
async function partial(req, full) {
  const blob = await full.blob();
  const size = blob.size;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  let start = 0, end = size - 1;
  if (m && m[1] !== '') { start = +m[1]; if (m[2] !== '') end = Math.min(+m[2], size - 1); }
  else if (m && m[2] !== '') { start = Math.max(0, size - +m[2]); }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': full.headers.get('Content-Type') || 'video/mp4',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

function runtimeFetch(req, key) {
  return fetch(req)
    .then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const len = Number(res.headers.get('content-length') || 0);
        if (req.mode === 'navigate' || (len > 0 && len <= MAX_CACHE_BYTES)) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(key, copy));
        }
      }
      return res;
    });
}

async function navigate(req, url) {
  // page visits are stored under their plain path, so ?intro=1 etc. don't
  // pile up duplicate copies of index.html
  const key = url.origin + url.pathname;
  const packed = await packMatch({ url: key });
  const net = runtimeFetch(req, key);
  if (!packed) {
    return net.catch(() => caches.match(key).then((hit) => hit || caches.match('/')));
  }
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), NAV_TIMEOUT));
  try { return await Promise.race([net, timeout]); }
  catch (e) { return packed; }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    if (url.origin === self.location.origin) event.respondWith(navigate(req, url));
    return;
  }
  const local = url.origin === self.location.origin;
  // only same-origin files and the pack's CDN files are handled here;
  // everything else goes straight to the network as before
  if (!local && !CDN.test(req.url)) return;

  event.respondWith((async () => {
    const hit = await packMatch(req);
    if (hit) return req.headers.has('range') ? partial(req, hit) : hit;
    if (!local || req.headers.has('range')) return fetch(req);
    return runtimeFetch(req, req).catch(() =>
      caches.match(req).then((cached) => cached || Response.error()));
  })());
});
