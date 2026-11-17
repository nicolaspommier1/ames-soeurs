// Service worker : rend l'application installable et affiche un écran clair hors connexion.
// Stratégie « réseau d'abord » pour l'interface (les mises à jour arrivent tout de suite),
// jamais de cache pour l'API temps réel : une partie se joue toujours en direct avec le serveur.
const VERSION = 'as-v2';
const SHELL = ['/', '/app.js', '/style.css', '/offline.html', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/icons/icon.svg', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && SHELL.includes(url.pathname)) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(url.pathname, copy));
      }
      return res;
    } catch {
      const cached = await caches.match(url.pathname);
      if (cached && req.mode !== 'navigate') return cached;
      if (req.mode === 'navigate') return (await caches.match('/offline.html')) || Response.error();
      return cached || Response.error();
    }
  })());
});
