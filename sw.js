/**
 * sw.js — Service Worker INNOVA STC
 * Estrategia: Network-first para JS/CSS (siempre frescos),
 * Cache-first para Firebase SDK y fuentes (raramente cambian).
 */

const CACHE_NAME = 'innova-stc-v6';

const IMMUTABLE_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

// ── Instalación ───────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(IMMUTABLE_ASSETS))
  );
  self.skipWaiting();
});

// ── Activación: limpiar caches viejos ────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Firebase → siempre red
  if (url.includes('firestore.googleapis.com') ||
      url.includes('identitytoolkit.googleapis.com') ||
      url.includes('securetoken.googleapis.com') ||
      url.includes('googleapis.com/identitytoolkit')) {
    return;
  }

  // Assets inmutables (SDK, fuentes) → cache-first
  if (IMMUTABLE_ASSETS.some(a => url.startsWith(a))) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
    return;
  }

  // App propia → network-first (siempre descarga lo más nuevo)
  if (url.includes('alexgf004-maker.github.io/STC-innova')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Guardar copia fresca en caché
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // Sin red → usar caché
          return caches.match(event.request).then(cached => {
            return cached || caches.match('/STC-innova/index.html');
          });
        })
    );
    return;
  }
});
