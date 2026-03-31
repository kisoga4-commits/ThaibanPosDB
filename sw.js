/**
 * PosThaiban - Service Worker (Fast update + cache cleanup)
 */

const CACHE_VERSION = 'v11-3-4';
const CACHE_NAME = `posthaiban-shell-${CACHE_VERSION}`;
const SHELL_CACHE_PREFIX = 'posthaiban-shell-';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
  './icon-192.png',
  './icon-512.png',
  './machine-id.js',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/html5-qrcode',
  'https://unpkg.com/dexie/dist/dexie.js',
  'https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;800;900&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith(SHELL_CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    )).then(async () => {
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach((client) => client.postMessage({ type: 'SW_ACTIVATED', version: CACHE_VERSION }));
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const normalizedPath = url.pathname.replace(/^\//, '');
  const matchesAppShell = APP_SHELL.some((asset) => {
    const normalizedAsset = String(asset).replace(/^\.\//, '');
    return normalizedAsset === normalizedPath || normalizedAsset === url.href;
  });

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', clone));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  const isStaticAsset =
    matchesAppShell ||
    APP_SHELL.includes(url.href) ||
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'font';

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
            }
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
  }
});
