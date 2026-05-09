// FIX 4c: Cambia este número con cada deploy para invalidar el cache antiguo.
// Puedes usar la fecha: 'mi-espacio-v20250509' o simplemente incrementar el número.
const CACHE_NAME = 'mi-espacio-v3';

const ASSETS = [
  './index.html',
  './daily-habits-dashboard.html',
  './startup-dashboard.html',
  './academic-dashboard.html',
  './profile.html',
  './manifest.json',
  './auth.js',
  './mi-espacio-sync.js',
  './icon-192.png',
  './icon-512.png',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // allSettled: si un asset falla (ej. iconos no existen), el SW se instala igual
      Promise.allSettled(ASSETS.map(url =>
        cache.add(url).catch(err => console.warn('[SW] No se pudo cachear:', url, err))
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => {
            console.log('[SW] Borrando cache antiguo:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // Para auth.js y archivos JS críticos: Network First (siempre intenta red)
  // Así los cambios en auth.js llegan inmediatamente sin esperar al cache
  const url = new URL(event.request.url);
  const isCriticalScript = url.pathname.endsWith('auth.js') ||
                           url.pathname.endsWith('mi-espacio-sync.js');

  if (isCriticalScript) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Para el resto: Cache First con actualización en background
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || networkFetch;
    })
  );
});