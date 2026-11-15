const CACHE = 'crew-health-v74';
const FILES = ['./data/testing/astronaut-health-data.csv', './data/testing/astronaut-health-stable.csv', './data/testing/astronaut-health-worsening.csv', './device-csv.js', './device-config.js', './mission-demo.js', './demo-editor.js', './motion.js', './assets/lenis.js', './assets/lenis-LICENSE.txt', './hazard-csv.js', './data/fixtures/five-hazards-synthetic.csv', './', './index.html', './app.js', './model.js', './csv.js', './style.css', './assets/mars-viking.jpg', './assets/anatomy.glb', './assets/meshopt_decoder.js', './assets/anatomy-LICENSE.md', './assets/anatomy-ATTRIBUTION.md', './assets/meshopt-LICENSE.md', './assets/model-viewer.min.js', './manifest.webmanifest'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('crew-health-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method === 'GET' && new URL(event.request.url).origin === self.location.origin) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
  }
});
