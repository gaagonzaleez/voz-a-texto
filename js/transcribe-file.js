/* Puente entre la app y el worker de Whisper.

   Se encarga de convertir el audio guardado al formato que el modelo
   necesita: una sola pista, 16.000 muestras por segundo. */

const TASA = 16000;

export const MODELOS = [
  { id: 'Xenova/whisper-tiny',  nombre: 'Rápido',  detalle: 'menos preciso · ~40 MB' },
  { id: 'Xenova/whisper-base',  nombre: 'Preciso', detalle: 'más lento · ~80 MB' },
  { id: 'Xenova/whisper-small', nombre: 'Máximo',  detalle: 'muy lento en celular · ~250 MB' },
];

/** Convierte cualquier audio grabado a mono de 16 kHz. */
export async function decodificar(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error('Este navegador no puede decodificar el audio.');

  const bytes = await blob.arrayBuffer();
  const ctx = new AC();
  let crudo;
  try {
    crudo = await ctx.decodeAudioData(bytes);
  } finally {
    ctx.close().catch(() => {});
  }

  // Mezcla los canales a uno solo
  const canales = crudo.numberOfChannels;
  const largo = crudo.length;
  const mono = new Float32Array(largo);
  for (let c = 0; c < canales; c++) {
    const datos = crudo.getChannelData(c);
    for (let i = 0; i < largo; i++) mono[i] += datos[i] / canales;
  }

  if (crudo.sampleRate === TASA) return mono;

  // Remuestreo a 16 kHz con un contexto fuera de pantalla
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const destino = Math.round(largo * TASA / crudo.sampleRate);
  const off = new OAC(1, destino, TASA);
  const buf = off.createBuffer(1, largo, crudo.sampleRate);
  buf.getChannelData(0).set(mono);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const salida = await off.startRendering();
  return salida.getChannelData(0);
}

/* El archivo único (dist/) no puede crear el worker: al empaquetarlo se
   pierde import.meta, y además la librería pesa 21 MB aparte. En esa
   versión la función se oculta en vez de fallar. */
export const SOPORTA_TRANSCRIPCION = (() => {
  try {
    return typeof Worker !== 'undefined' && typeof import.meta?.url === 'string';
  } catch { return false; }
})();

let worker = null;
let siguienteId = 1;

function obtenerWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
  return worker;
}

/**
 * @param {Blob} blob audio guardado
 * @param {{modelo:string, idioma:string, onProgreso:Function}} opciones
 * @returns {Promise<string>} texto transcripto
 */
export async function transcribirAudio(blob, { modelo, idioma = 'spanish', onProgreso } = {}) {
  if (!SOPORTA_TRANSCRIPCION) {
    throw new Error('Esta versión de la app no incluye el motor de transcripción. ' +
                    'Usá la app publicada en el sitio.');
  }
  onProgreso?.({ fase: 'decodificando' });
  const audio = await decodificar(blob);
  if (!audio.length) throw new Error('La grabación está vacía.');

  const w = obtenerWorker();
  const id = siguienteId++;

  return new Promise((resolve, reject) => {
    const escuchar = e => {
      const m = e.data;
      if (!m || m.id !== id) return;
      if (m.tipo === 'progreso') { onProgreso?.(m); return; }
      w.removeEventListener('message', escuchar);
      if (m.tipo === 'listo') resolve(m.texto);
      else reject(new Error(m.mensaje || 'No se pudo transcribir.'));
    };
    w.addEventListener('message', escuchar);
    w.addEventListener('error', ev => {
      w.removeEventListener('message', escuchar);
      reject(new Error(ev.message || 'El motor de transcripción no pudo arrancar.'));
    }, { once: true });

    // El audio se transfiere, no se copia: son varios MB
    w.postMessage({ id, audio, modelo, idioma }, [audio.buffer]);
  });
}

/** Idioma de Whisper a partir del código del documento */
export function idiomaWhisper(lang = 'es-AR') {
  const base = lang.slice(0, 2).toLowerCase();
  return { es: 'spanish', en: 'english', pt: 'portuguese', it: 'italian', fr: 'french' }[base] || 'spanish';
}
