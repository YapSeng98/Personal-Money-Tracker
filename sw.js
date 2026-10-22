// PFMT offline shell. The page, its icons and its pinned libraries are cached,
// so the app opens with no connection: it shows this device's copy of the
// book, and anything added offline waits in the outbox until the connection
// returns. The page itself is fetched network-first, so a new version is used
// as soon as the site is reachable; the cache is only the fallback. Supabase
// requests are never cached: data comes from the server or the outbox.
const CACHE = 'pfmt-shell-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
const PINNED = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.min.js';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const keep = (req, res) => {
  if (res && (res.ok || res.type === 'opaque')) {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy));
  }
  return res;
};

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return;
  // A pinned library version and the fonts never change: cache first.
  if (req.url === PINNED || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => keep(req, res))));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(req).then(res => keep(req, res)).catch(() =>
    caches.match(req, { ignoreSearch: req.mode === 'navigate' })
      .then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
