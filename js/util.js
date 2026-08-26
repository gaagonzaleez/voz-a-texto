/* Utilidades generales */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const uid = () =>
  Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** ms → "hh:mm:ss" */
export function fmtTime(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(t / 3600)).padStart(2, '0');
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const s = String(t % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** ms → "3 min 12 s" */
export function fmtDur(ms) {
  const t = Math.round(ms / 1000);
  if (t < 60) return `${t} s`;
  const m = Math.floor(t / 60), s = t % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

export function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

export function fmtRelative(ts) {
  const diff = Date.now() - ts;
  if (diff < 60e3) return 'recién';
  if (diff < 3600e3) return `hace ${Math.floor(diff / 60e3)} min`;
  if (diff < 86400e3) return `hace ${Math.floor(diff / 3600e3)} h`;
  if (diff < 7 * 86400e3) return `hace ${Math.floor(diff / 86400e3)} d`;
  return new Date(ts).toLocaleDateString('es', { day: '2-digit', month: 'short' });
}

export function countWords(text) {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── Descarga de archivos ──────────────────────────────────
   En un navegador normal se usa un enlace <a download>. Cuando la app
   corre incrustada en un visor que bloquea las descargas (por ejemplo un
   artifact de Claude), se le pide al anfitrión que guarde el archivo. */

let saverPromise;
function hostSaver() {
  if (!saverPromise) {
    saverPromise = (window.claude && typeof window.claude.use === 'function')
      ? Promise.resolve(window.claude.use('downloads')).catch(() => null)
      : Promise.resolve(null);
  }
  return saverPromise;
}

function anchorDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * @returns {Promise<'saved'|'declined'|'download'>}
 * @throws {Error} con un mensaje listo para mostrar si el visor lo rechaza
 */
export async function download(blob, filename) {
  const saver = await hostSaver();
  if (!saver) { anchorDownload(blob, filename); return 'download'; }

  try {
    await saver.save({ filename, data: blob });
    return 'saved';
  } catch (err) {
    const code = err?.code || 'unavailable';
    const ext = (filename.split('.').pop() || '').toUpperCase();
    if (code === 'declined') return 'declined';
    if (code === 'rate_limited')
      throw new Error('Hay otra descarga esperando confirmación. Probá de nuevo en unos segundos.');
    if (code === 'extension_not_enabled' || code === 'rejected_extension')
      throw new Error(`Esta vista no permite guardar archivos ${ext}. Usá Notas (.txt), Markdown (.md) o JSON, o abrí la app desde tu propio servidor para el resto de los formatos.`);
    if (code === 'too_large')
      throw new Error('El archivo pasa el límite de 16 MB de esta vista.');
    // El anfitrión no puede guardar: se intenta el camino común
    anchorDownload(blob, filename);
    return 'download';
  }
}

/** Nombre de archivo seguro a partir de un título */
export function slug(s, fallback = 'documento') {
  const out = String(s).trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s._-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return out || fallback;
}

export function debounce(fn, ms = 400) {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  return wrapped;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

let toastTimer;
export function toast(msg, kind = '', ms = 3200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}
