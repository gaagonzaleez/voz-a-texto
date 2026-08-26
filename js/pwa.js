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

  // Sin service worker la app sigue andando: sólo pierde el modo sin conexión
  const registrar = () =>
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});

  // Esta función corre después de leer la base de datos, así que el evento
  // 'load' puede haber pasado ya: en ese caso hay que registrar en el acto.
  if (document.readyState === 'complete') registrar();
  else window.addEventListener('load', registrar, { once: true });
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
