var CACHE_NAME = 'pogoda-motocyklowa-v1';
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

  // Dane pogodowe maja byc zawsze swieze - nigdy nie cachujemy zapytan do Open-Meteo,
  // przechodza normalnie do sieci (dzialaja tylko online, co jest oczekiwane dla pogody).
  if (url.indexOf('open-meteo.com') !== -1) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function (response) {
      return response || fetch(event.request);
    })
  );
});
