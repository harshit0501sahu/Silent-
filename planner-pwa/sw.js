// Network-first for the app shell: an installed app should always pick up the
// latest deployed code when online, falling back to the cached copy only when
// offline. (Cache-first was causing installed apps to get permanently stuck
// on whatever version happened to be cached at install time.)
const CACHE = 'planner-shell-v22';
const SHELL_FILES = [
  './',
  './index.html',
  './summary.html',
  './profile.html',
  './export.html',
  './tasks.html',
  './food.html',
  './expenses.html',
  './manifest.json',
  './styles.css',
  './config.js',
  './auth.js',
  './sheetsApi.js',
  './gtasksApi.js',
  './core.js',
  './app.js',
  './summary.js',
  './profile.js',
  './export.js',
  './tasks.js',
  './food.js',
  './expenses.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // let Google API / GIS / CDN requests hit the network untouched

  event.respondWith(
    fetch(event.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return res;
    }).catch(() => caches.match(event.request))
  );
});
