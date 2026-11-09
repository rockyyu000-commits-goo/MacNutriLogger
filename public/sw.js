// Service worker: makes the app installable and usable offline.
//  - App shell (HTML/CSS/JS): answered from cache right away and refreshed in the background,
//    so an update shows up the next time the app is opened.
//  - /api/data (the menus): network first, falling back to the last copy when offline.
//  - /api/admin/* and anything that isn't a GET: never touched.
const CACHE = 'mnl-v2';
const SHELL = [
  '/', '/css/app.css', '/manifest.webmanifest', '/icon.svg', '/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png',
  '/js/main.js', '/js/app.js', '/js/ui.js', '/js/sheets.js',
  '/js/lib/nutrition.js', '/js/lib/search.js', '/js/lib/store.js',
  '/js/views/today.js', '/js/views/places.js', '/js/views/place.js', '/js/views/search.js', '/js/views/trends.js', '/js/views/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))) // also removes v1's "macnutri-v1"
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request.url, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request.url);
    if (!cached) throw err;
    // Tell the page this is the saved copy so it can show an "offline" note.
    const headers = new Headers(cached.headers);
    headers.set('x-mnl-offline', '1');
    return new Response(cached.body, { status: cached.status, headers });
  }
}

async function staleWhileRevalidate(request, key) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key);
  const refresh = fetch(request).then((res) => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  if (cached) { refresh.catch(() => {}); return cached; }
  return refresh;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/api/data') return e.respondWith(networkFirst(req));
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin') || url.pathname.startsWith('/js/admin')) return;
  // The app is a single page: every navigation gets the cached shell.
  const key = req.mode === 'navigate' ? '/' : url.pathname;
  e.respondWith(staleWhileRevalidate(req, key));
});
