// Minimal service worker so the dashboard is installable as an app (PWA).
// Caches only the static shell (same-origin GETs: HTML, JS, CSS, images) and
// always tries the network first, so a deploy shows up on the next load and
// the cache is only a fallback when offline. Cross-origin requests (the
// Supabase API, fonts, CDN libraries) and anything under /api/ are never
// touched, so data is never served stale.
const CACHE = 'sayakaya-shell-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./') : undefined))),
  );
});
