/* Transcribe una grabación ya guardada, dentro del navegador.

   Corre en un worker para no congelar la pantalla: Whisper es pesado y
   tarda varios minutos en un celular. La librería está en el repositorio;
   los pesos del modelo los baja el navegador la primera vez y quedan en su
   caché, así que la segunda transcripción ya no descarga nada. */

import { pipeline, env } from '../vendor/transformers/transformers.min.js';

// El runtime de ONNX también sale del repositorio, no de un CDN
env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = new URL('../vendor/transformers/', import.meta.url).href;
// GitHub Pages no puede mandar las cabeceras que habilitan varios hilos
env.backends.onnx.wasm.numThreads = 1;

let motor = null;
let motorId = '';

async function cargarModelo(modelo, avisar) {
  if (motor && motorId === modelo) return motor;
  motor = null;
  motorId = '';
  motor = await pipeline('automatic-speech-recognition', modelo, {
    dtype: 'q8',
    progress_callback: p => {
      if (p.status === 'progress' && p.total) {
        avisar({ fase: 'descarga', archivo: p.file || '', pct: Math.round((p.loaded / p.total) * 100) });
      } else if (p.status === 'ready') {
        avisar({ fase: 'listo-modelo' });
      }
    },
  });
  motorId = modelo;
  return motor;
}

self.onmessage = async e => {
  const { id, audio, modelo, idioma } = e.data || {};
  const avisar = detalle => self.postMessage({ id, tipo: 'progreso', ...detalle });

  try {
    avisar({ fase: 'cargando' });
    const asr = await cargarModelo(modelo, avisar);

    avisar({ fase: 'transcribiendo', pct: 0 });
    const total = audio.length / 16000;      // segundos de audio
    let hechos = 0;

    const salida = await asr(audio, {
      language: idioma,
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
      chunk_callback: () => {
        hechos += 25;                        // cada tramo aporta ~25 s útiles
        avisar({ fase: 'transcribiendo', pct: Math.min(99, Math.round((hechos / total) * 100)) });
      },
    });

    const texto = (Array.isArray(salida) ? salida[0]?.text : salida?.text) || '';
    self.postMessage({ id, tipo: 'listo', texto: texto.trim() });
  } catch (err) {
    self.postMessage({ id, tipo: 'error', mensaje: err?.message || String(err) });
  }
};
