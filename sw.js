/* Service worker: deja la app usable sin internet.

   Estrategia "red primero, caché de respaldo": si hay conexión siempre se
   sirve la versión más nueva; si no, la última que quedó guardada. Así no
   se puede quedar pegada una versión vieja, que es el problema clásico de
   las apps instaladas.

   Ojo: el dictado por voz sí necesita internet (lo resuelve el servicio de
   voz del navegador). Sin conexión podés escribir, grabar audio, escuchar
   tus grabaciones y exportar. */

const VERSION = 'v8';
const CACHE = `voz-a-texto-${VERSION}`;
const TIMEOUT_MS = 3500;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/styles.css',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png',
  './js/app.js',
  './js/pwa.js',
  './js/db.js',
  './js/util.js',
  './js/recorder.js',
  './js/recognition.js',
  './js/calibration.js',
  './js/textproc.js',
  './js/tts.js',
  './js/export/exporters.js',
  './js/export/pdf.js',
  './js/export/docx.js',
  './js/export/zip.js',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Si algún archivo falla, la instalación no se cae por eso
    await Promise.allSettled(SHELL.map(url => cache.add(url)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // nada externo que cachear

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    try {
      const fresh = await withTimeout(fetch(request), TIMEOUT_MS);
      if (fresh && fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    } catch {
      const cached = await cache.match(request) || await cache.match('./index.html');
      if (cached) return cached;
      return new Response('Sin conexión y sin copia guardada.', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(r => { clearTimeout(timer); resolve(r); },
                 e => { clearTimeout(timer); reject(e); });
  });
}
