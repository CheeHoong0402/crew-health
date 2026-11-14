const CACHE = 'crew-health-v22';
const FILES = ['./', './index.html', './app.js', './model.js', './csv.js', './style.css', './assets/anatomy.glb', './assets/meshopt_decoder.js', './assets/anatomy-LICENSE.md', './assets/anatomy-ATTRIBUTION.md', './assets/meshopt-LICENSE.md', './assets/model-viewer.min.js', './manifest.webmanifest', './data/testing/healthy-data.csv', './data/testing/unhealthy-data.csv'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('crew-health-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method === 'GET' && new URL(event.request.url).origin === self.location.origin) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
  }
});
