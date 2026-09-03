var CACHE_NAME = 'pogoda-motocyklowa-v2';
var urlsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (name) {
          return name !== CACHE_NAME;
        }).map(function (name) {
          return caches.delete(name);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  var url = event.request.url;

  // Dane pogodowe maja byc zawsze swieze - nigdy nie cachujemy zapytan do Open-Meteo.
  if (url.indexOf('open-meteo.com') !== -1) {
    return;
  }

  // Powloka aplikacji (HTML/CSS/JS): najpierw siec (zawsze swiezy kod gdy jest internet),
  // cache tylko jako fallback offline. Dzieki temu kolejne aktualizacje aplikacji
  // beda widoczne od razu po odswiezeniu, bez czekania na wykrycie zmiany w samym
  // pliku service-worker.js.
  event.respondWith(
    fetch(event.request).then(function (response) {
      var responseClone = response.clone();
      caches.open(CACHE_NAME).then(function (cache) {
        cache.put(event.request, responseClone);
      });
      return response;
    }).catch(function () {
      return caches.match(event.request);
    })
  );
});
