// Basic offline app shell — network-first, falling back to cache only when
// the network is unreachable. This project has no build/deploy versioning
// (vanilla JS, served as-is), so a stale cached shell overriding a fresh
// deploy would be a worse bug than no offline support at all.
//
// API requests are never intercepted here: they go to a different origin
// than the static frontend (see js/config.js), and serving cached
// ticket/auth responses to a guard scanning at the gate would be actively
// wrong for a live access-control system, not just stale.
const CACHE_NAME = 'tourist-access-shell-v1';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.json',
  '/js/main.js',
  '/js/config.js',
  '/js/store.js',
  '/js/api.js',
  '/js/auth.js',
  '/js/utils/dom.js',
  '/js/utils/formatters.js',
  '/js/utils/notifications.js',
  '/js/features/dashboard.js',
  '/js/features/fraud-dashboard.js',
  '/js/features/executive-dashboard.js',
  '/js/features/scanner.js',
  '/js/features/tickets.view.js',
  '/js/features/tickets.service.js',
  '/js/features/users.js',
  '/js/features/cash-report.js',
  '/js/features/password.js',
  '/js/features/audit-log.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // Best-effort: an asset 404ing (e.g. a stale entry after a rename)
      // shouldn't block the whole install.
      .then((cache) => Promise.all(SHELL_ASSETS.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
  );
});
