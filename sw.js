const PREFIX = 'prompt-vault:' + self.registration.scope + ':';
const CACHE = PREFIX + 'shell-v3';
const FILES = [
  './', 'index.html', 'assets/vault.css?v=3', 'assets/icon.svg?v=3',
  'assets/icon-192.png?v=3', 'assets/icon-512.png?v=3', 'manifest.webmanifest?v=3',
  'js/core.js?v=3', 'js/store.js', 'js/sync.js', 'js/app.js?v=3'
];
const urls = new Set(FILES.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(FILES);
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) {
    if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
  }
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const withinScope = url.href.startsWith(self.registration.scope);
  if (event.request.mode === 'navigate' && withinScope) {
    event.respondWith((async () => {
      try { return await fetch(event.request); }
      catch { return (await caches.open(CACHE)).match('index.html'); }
    })());
  } else if (urls.has(url.href)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request)) || fetch(event.request)));
  }
});
