/* Asistente de calibración: se corre antes de grabar para asegurarse de que
   el micrófono se escucha bien y de que el dictado entiende cada palabra.

   Paso 1  Micrófono: ruido de fondo y volumen de voz.
   Paso 2  Dicción: frases de prueba comparadas palabra por palabra.
   Paso 3  Vocabulario: correcciones para las palabras que falló. */

import { diffWords, suggestionsFromDiff, normWord } from './textproc.js';
import { listenOnce, isSupported } from './recognition.js';
import { sleep } from './util.js';

/* Frases elegidas para cubrir sonidos difíciles del español, números,
   nombres propios y puntuación dictada. */
export const PHRASES = {
  es: [
    'El veloz murciélago hindú comía feliz cardillo y kiwi.',
    'Ayer llegaron treinta y siete cajas a las nueve y media de la mañana.',
    'La cigüeña y el ñandú cruzaron el arroyo con mucha desconfianza.',
    'Necesito revisar el informe del jueves antes de la reunión con el equipo.',
  ],
  en: [
    'The quick brown fox jumps over the lazy dog near the river.',
    'Thirty seven boxes arrived yesterday at half past nine.',
    'I need to review the report before the meeting with the team.',
    'She quickly realized the strange machine was working perfectly.',
  ],
};

export function phrasesFor(lang = 'es-AR') {
  return PHRASES[lang.slice(0, 2).toLowerCase()] || PHRASES.es;
}

/* ── Medición con el micrófono ───────────────────────────
   Se toman muestras del medidor del grabador durante N ms. */
export async function measure(recorder, ms, onTick) {
  const samples = [];
  const start = performance.now();
  const listener = e => {
    samples.push(e.detail.rms);
    onTick?.({
      elapsed: performance.now() - start,
      remaining: Math.max(0, ms - (performance.now() - start)),
      level: e.detail.level,
    });
  };
  recorder.addEventListener('level', listener);
  await sleep(ms);
  recorder.removeEventListener('level', listener);

  if (!samples.length) return { rms: 0, db: -100, peakDb: -100, samples: 0 };
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const peak = Math.max(...samples);
  const toDb = v => 20 * Math.log10(v || 1e-8);
  return { rms: avg, db: toDb(avg), peakDb: toDb(peak), samples: samples.length };
}

/** ¿Qué tan silencioso está el ambiente? */
export function judgeNoise(db) {
  if (db < -58) return { level: 'ok',   tag: 'excelente',  text: 'Ambiente muy silencioso. Ideal para dictar.' };
  if (db < -48) return { level: 'ok',   tag: 'bien',       text: 'Poco ruido de fondo. Vas a transcribir sin problemas.' };
  if (db < -38) return { level: 'warn', tag: 'aceptable',  text: 'Se escucha algo de ruido. Si podés, cerrá ventanas o alejate de ventiladores.' };
  return          { level: 'bad',  tag: 'ruidoso',    text: 'Hay bastante ruido. Buscá un lugar más silencioso o usá auriculares con micrófono.' };
}

/** ¿Se escucha tu voz con buen volumen, sin saturar? */
export function judgeLevel(db, peakDb) {
  if (peakDb > -1.5)  return { level: 'warn', tag: 'saturado', text: 'Tu voz satura el micrófono. Alejate unos centímetros o bajá la ganancia de entrada.' };
  if (db < -45)       return { level: 'bad',  tag: 'muy bajo', text: 'Casi no se te escucha. Acercate al micrófono o subí el volumen de entrada del sistema.' };
  if (db < -34)       return { level: 'warn', tag: 'bajo',     text: 'Se te escucha bajo. Acercate un poco más al micrófono.' };
  if (db > -12)       return { level: 'warn', tag: 'alto',     text: 'Se escucha fuerte. Alejate un poco para evitar distorsión.' };
  return                     { level: 'ok',   tag: 'perfecto', text: 'Volumen de voz ideal para transcribir.' };
}

/** Diferencia entre tu voz y el ruido: cuanto más alta, menos errores. */
export function signalToNoise(voiceDb, noiseDb) {
  const snr = voiceDb - noiseDb;
  if (snr >= 25) return { level: 'ok',   text: `Tu voz se destaca ${Math.round(snr)} dB sobre el ruido: excelente.` };
  if (snr >= 15) return { level: 'ok',   text: `Tu voz se destaca ${Math.round(snr)} dB sobre el ruido: suficiente.` };
  if (snr >= 8)  return { level: 'warn', text: `Tu voz supera al ruido por sólo ${Math.round(snr)} dB. Puede haber errores.` };
  return             { level: 'bad',  text: 'El ruido de fondo compite con tu voz. Conviene cambiar de lugar o de micrófono.' };
}

/** Corre una frase de prueba y la compara con lo que se entendió. */
export async function testPhrase(phrase, lang, onState = null) {
  if (!isSupported) throw new Error('unsupported');
  const heard = await listenOnce({ lang, maxMs: 15000, silenceMs: 2200, onState });
  const result = diffWords(phrase, heard);
  return { phrase, heard, ...result, suggestions: suggestionsFromDiff(result.ops) };
}

/** Nota final del paso 2 */
export function judgeAccuracy(pct) {
  if (pct >= 95) return { label: 'Excelente', tip: 'El dictado te entiende muy bien. Podés grabar tranquilo.' };
  if (pct >= 85) return { label: 'Muy bueno', tip: 'Buen reconocimiento. Cargá las pocas palabras que falló y quedás listo.' };
  if (pct >= 70) return { label: 'Aceptable', tip: 'Hablá un poco más pausado y agregá las correcciones sugeridas al vocabulario.' };
  return           { label: 'A mejorar', tip: 'Probá acercarte al micrófono, hablar más despacio y revisar el ruido de fondo del paso 1.' };
}

/** Une sugerencias evitando duplicados y correcciones absurdas. */
export function mergeSuggestions(existing, incoming) {
  const out = [...existing];
  for (const s of incoming) {
    const from = (s.from || '').trim(), to = (s.to || '').trim();
    if (!from || !to) continue;
    if (from === to) continue;   // sólo se descarta la corrección idéntica
    if (from.length < 2 || to.length < 2) continue;
    if (out.some(x => normWord(x.from) === normWord(from))) continue;
    out.push({ from, to });
  }
  return out;
}

/** Perfil que se guarda al terminar la calibración */
export function buildProfile({ deviceId, noise, level, accuracy, lang }) {
  return {
    deviceId: deviceId || '',
    lang,
    noiseDb: noise?.db ?? null,
    voiceDb: level?.db ?? null,
    peakDb: level?.peakDb ?? null,
    accuracy: accuracy ?? null,
    // Ajustes recomendados para la captura, según lo medido
    constraints: {
      noiseSuppression: { ideal: !noise || noise.db > -48 },
      autoGainControl:  { ideal: !level || level.db < -30 },
      echoCancellation: { ideal: true },
    },
    calibratedAt: Date.now(),
  };
}
