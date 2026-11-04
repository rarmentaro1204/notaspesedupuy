// Service worker minimo: salva solo la "scocca" dell'app (HTML/CSS/JS/modulo) per aprirla subito.
// Le chiamate /api (dati, foto, login) NON vengono mai messe in cache.
const CACHE = 'nota-spese-v4';
const SHELL = ['./', 'style.css', 'app.js', 'export.js', 'vendor/exceljs.min.js', 'vendor/jszip.min.js', 'template/Modulo_Nota_Spese.xlsx', 'manifest.webmanifest', 'icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/api/') || u.pathname.endsWith('/admin.html') || u.pathname.endsWith('/admin.js')) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then(m => m || caches.match('./'))));
});
