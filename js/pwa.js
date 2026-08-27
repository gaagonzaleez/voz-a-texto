/* Instalación como app y funcionamiento sin internet.

   Android/Chrome ofrecen instalar la app; iOS no tiene esa API, así que
   ahí se muestran las instrucciones de "Agregar a inicio". */

import { $, toast } from './util.js';

const esStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

const esIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function setupPWA() {
  registrarServiceWorker();
  prepararInstalacion();
}

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!location.protocol.startsWith('http')) return;   // no aplica al archivo suelto

  // Cuando entra una versión nueva se ofrece recargar, en vez de dejar al
  // usuario con una versión vieja sin enterarse.
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.tipo === 'version-nueva') mostrarAvisoVersion();
    if (e.data?.tipo === 'version') mostrarVersion(e.data.version);
  });

  const registrar = async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
      reg.addEventListener('updatefound', () => {
        const nuevo = reg.installing;
        nuevo?.addEventListener('statechange', () => {
          // Ya había una versión andando: la nueva espera a que recargues
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
            mostrarAvisoVersion();
          }
        });
      });
      // En la primera visita la página todavía no está bajo control del
      // service worker: se vuelve a preguntar cuando lo toma.
      preguntarVersion();
      navigator.serviceWorker.addEventListener('controllerchange', preguntarVersion);
      setTimeout(preguntarVersion, 1200);
      setTimeout(preguntarVersion, 3000);
      // Al volver a la app se revisa si hay algo nuevo publicado
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reg.update().catch(() => {});
      });
    } catch { /* sin service worker la app anda igual, sin modo sin conexión */ }
  };

  if (document.readyState === 'complete') registrar();
  else window.addEventListener('load', registrar, { once: true });

  const btn = document.getElementById('btnUpdate');
  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Buscando…';
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
      await new Promise(r => setTimeout(r, 1500));
      if (document.getElementById('updateBanner').classList.contains('hidden')) {
        btn.textContent = '✓ Ya tenés la última';
        setTimeout(() => { btn.textContent = '↻ Buscar actualización'; btn.disabled = false; }, 2500);
      }
    } catch {
      btn.textContent = '↻ Buscar actualización';
      btn.disabled = false;
    }
  });

  document.getElementById('btnReload')?.addEventListener('click', () => location.reload());
}

function mostrarAvisoVersion() {
  document.getElementById('updateBanner')?.classList.remove('hidden');
}

function preguntarVersion() {
  navigator.serviceWorker.controller?.postMessage({ tipo: 'que-version' });
}

function mostrarVersion(v) {
  const el = document.getElementById('appVersion');
  if (el) el.textContent = 'Versión ' + v;
}

function prepararInstalacion() {
  const btn = $('#btnInstall');
  const hint = $('#installHint');
  if (!btn || !hint) return;

  if (esStandalone()) return;          // ya está instalada

  let prompt = null;

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    prompt = e;
    btn.classList.remove('hidden');
    hint.classList.add('hidden');
  });

  btn.addEventListener('click', async () => {
    if (!prompt) return;
    btn.disabled = true;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    prompt = null;
    btn.disabled = false;
    if (outcome === 'accepted') {
      btn.classList.add('hidden');
      toast('Instalada. Buscá el ícono en tu pantalla de inicio.', 'ok', 5000);
    }
  });

  window.addEventListener('appinstalled', () => {
    btn.classList.add('hidden');
    hint.classList.add('hidden');
  });

  // iOS no dispara beforeinstallprompt: se explica el camino manual
  if (esIOS()) {
    hint.innerHTML = '<b>Instalar en iPhone</b>Tocá el botón Compartir de Safari y elegí «Agregar a inicio».';
    hint.classList.remove('hidden');
  }
}
