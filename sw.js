/* Service worker: deja la app usable sin internet y mantiene las versiones
   consistentes.

   Cada versión guarda su propio juego completo de archivos y se sirve desde
   ahí. Así nunca se mezclan piezas de dos versiones distintas, que es lo que
   pasaba antes: cada archivo competía contra un cronómetro y, en una
   conexión lenta, unos llegaban nuevos y otros salían de la copia vieja.

   Cuando entra una versión nueva se avisa a la pantalla para que ofrezca
   recargar, en vez de dejarte con una versión vieja sin saberlo.

   El dictado en vivo necesita internet (lo resuelve el servicio de voz del
   navegador). Sin conexión podés escribir, grabar, escuchar y exportar. */

const VERSION = 'v11';
const CACHE = `voz-a-texto-${VERSION}`;

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
  './js/transcribe-file.js',
  './js/whisper-worker.js',
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
    // Sin caché del navegador de por medio: se quiere la copia recién publicada
    await Promise.allSettled(
      SHELL.map(url => fetch(new Request(url, { cache: 'reload' }))
        .then(r => (r && r.ok ? cache.put(url, r) : null))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const nombres = await caches.keys();
    const habiaAnterior = nombres.some(n => n.startsWith('voz-a-texto-') && n !== CACHE);
    await Promise.all(nombres.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();

    // Si venía de una versión anterior, la pantalla ofrece recargar
    if (habiaAnterior) {
      const clientes = await self.clients.matchAll({ type: 'window' });
      for (const c of clientes) c.postMessage({ tipo: 'version-nueva', version: VERSION });
    }
  })());
});

self.addEventListener('message', e => {
  if (e.data?.tipo === 'que-version') {
    e.source?.postMessage({ tipo: 'version', version: VERSION });
  }
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // nada externo que cachear

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // La versión instalada se sirve entera desde su propio juego de archivos
    const guardado = await cache.match(request, { ignoreSearch: true });
    if (guardado) return guardado;

    try {
      const fresco = await fetch(request);
      if (fresco && fresco.ok) cache.put(request, fresco.clone());
      return fresco;
    } catch {
      // Navegación sin conexión y sin copia exacta: vale la portada
      if (request.mode === 'navigate') {
        const portada = await cache.match('./index.html');
        if (portada) return portada;
      }
      return new Response('Sin conexión y sin copia guardada.', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
