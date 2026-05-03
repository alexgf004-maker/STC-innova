/**
 * sw.js — Service Worker INNOVA STC
 * Cachea el shell estático para funcionar offline.
 * Los datos de Firebase siempre van a la red.
 */

const CACHE_NAME = 'innova-stc-v1';

const STATIC_ASSETS = [
  '/STC-innova/',
  '/STC-innova/index.html',
  '/STC-innova/login.html',
  '/STC-innova/manifest.json',
  '/STC-innova/css/styles.css',
  '/STC-innova/js/firebase.js',
  '/STC-innova/js/crypto.js',
  '/STC-innova/js/auth.js',
  '/STC-innova/js/ui.js',
  '/STC-innova/js/router.js',
  '/STC-innova/js/app.js',
  '/STC-innova/js/views/home.js',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js',
];

// ── Instalación: cachear assets estáticos ─────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── Activación: limpiar caches viejos ─────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: cache-first para estáticos, network para Firebase ──
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Firebase siempre va a la red
  if (url.includes('firestore.googleapis.com') ||
      url.includes('identitytoolkit.googleapis.com') ||
      url.includes('securetoken.googleapis.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).catch(() => {
        // Si falla la red y no hay caché, devolver login offline
        if (event.request.destination === 'document') {
          return caches.match('/STC-innova/login.html');
        }
      });
    })
  );
});
