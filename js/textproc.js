/* Procesamiento del texto reconocido:
   1) correcciones del vocabulario personal
   2) puntuación dictada por voz
   3) formato automático (mayúsculas y espaciado)
   4) comparación palabra por palabra (se usa en la calibración) */

const deacc = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export const normWord = s =>
  deacc(String(s).toLowerCase()).replace(/[^\p{L}\p{N}]/gu, '');

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ── 1. Vocabulario personal ──────────────────────────────
   Cada regla {from,to} reemplaza la palabra/frase mal entendida.
   La búsqueda ignora acentos y mayúsculas, y respeta límites de palabra. */
export function applyVocabulary(text, rules = []) {
  if (!rules.length || !text) return text;
  // Se trabaja en forma descompuesta (NFD) para que «Gastón» y «Gaston»
  // se detecten igual; al final se vuelve a la forma normal (NFC).
  let out = text.normalize('NFD');

  for (const rule of rules) {
    const from = (rule.from || '').trim();
    const to = (rule.to ?? '').trim();
    if (!from) continue;

    // Patrón tolerante a acentos: cada letra acepta su versión acentuada
    const pattern = from.split(/\s+/).map(w =>
      deacc(w).split('').map(ch => {
        const e = escapeRe(ch);
        return /[a-z]/i.test(ch) ? `${e}[\\u0300-\\u036f]*` : e;
      }).join('')
    ).join('\\s+');

    let re;
    try {
      re = new RegExp(`(?<![\\p{L}\\p{N}])(${pattern})(?![\\p{L}\\p{N}])`, 'giu');
    } catch {
      re = new RegExp(`\\b(${pattern})\\b`, 'gi');
    }

    out = out.replace(re, (match) => matchCase(match.normalize('NFC'), to));
  }
  return out.normalize('NFC');
}

/** Si lo escuchado venía en mayúscula inicial, la corrección la conserva. */
function matchCase(original, replacement) {
  if (!replacement) return replacement;
  const isUpper = original === original.toUpperCase() && /\p{L}/u.test(original);
  if (isUpper && original.length > 1) return replacement.toUpperCase();
  if (/^\p{Lu}/u.test(original) && !/^\p{Lu}/u.test(replacement))
    return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

/* ── 2. Puntuación dictada ────────────────────────────────
   El orden importa: primero las expresiones más largas. */
const COMMANDS = [
  [['nuevo parrafo', 'nuevo párrafo', 'punto y aparte'], '\n\n'],
  [['nueva linea', 'nueva línea', 'salto de linea', 'salto de línea'], '\n'],
  [['punto y seguido', 'punto y final', 'punto final'], '.'],
  [['punto y coma'], ';'],
  [['dos puntos'], ':'],
  [['puntos suspensivos'], '…'],
  [['signo de interrogacion', 'signo de interrogación', 'cierra interrogacion', 'cierra interrogación'], '?'],
  [['abre interrogacion', 'abre interrogación'], '¿'],
  [['signo de exclamacion', 'signo de exclamación', 'cierra exclamacion', 'cierra exclamación'], '!'],
  [['abre exclamacion', 'abre exclamación'], '¡'],
  [['abre parentesis', 'abre paréntesis'], '('],
  [['cierra parentesis', 'cierra paréntesis'], ')'],
  [['abre comillas', 'cierra comillas', 'comillas'], '"'],
  [['guion', 'guión'], '-'],
  [['raya'], '—'],
  [['barra'], '/'],
  [['arroba'], '@'],
  [['punto'], '.'],
  [['coma'], ','],
];

export function applyVoiceCommands(text) {
  if (!text) return text;
  let out = text.normalize('NFD');
  for (const [phrases, symbol] of COMMANDS) {
    for (const phrase of phrases) {
      const pattern = phrase.split(' ').map(w =>
        deacc(w).split('').map(ch => `${escapeRe(ch)}[\\u0300-\\u036f]*`).join('')
      ).join('\\s+');
      let re;
      try {
        re = new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'giu');
      } catch {
        re = new RegExp(`\\b${pattern}\\b`, 'gi');
      }
      out = out.replace(re, symbol);
    }
  }
  return out.normalize('NFC');
}

/* ── 3. Formato automático ────────────────────────────── */
export function tidy(text) {
  if (!text) return text;
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:!?…])/g, '$1')            // sin espacio antes del signo
    .replace(/([,;:])(?=\S)/g, '$1 ')             // espacio después de coma
    .replace(/([.!?…])(?=\p{L})/gu, '$1 ')        // espacio después de punto
    .replace(/([¿¡])\s+/g, '$1')                  // sin espacio tras signo de apertura
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimStart();
}

/** Mayúscula al empezar y después de . ! ? … y de salto de línea */
export function capitalize(text) {
  if (!text) return text;
  return text.replace(/(^|[.!?…¿¡]\s+|\n\s*)(\p{Ll})/gu,
    (_, pre, ch) => pre + ch.toUpperCase());
}

/* ── Separación en líneas ──────────────────────────────────
   'corrido'  todo seguido, como un párrafo
   'lineas'   cada oración en su renglón
   'guiones'  cada oración en su renglón, empezando con "- " */

const CIERRA_ORACION = /[.!?…]+["»)]?\s*$/;

/** Une el tramo nuevo con lo que ya había en el documento.
    Sólo se da formato al tramo nuevo: el texto que el usuario editó a mano
    nunca se reescribe. */
export function joinChunk(prev, chunk, { smart = true, modo = 'corrido' } = {}) {
  if (!chunk) return prev;
  let piece = smart ? tidy(chunk) : chunk;
  if (!piece) return prev;

  if (!prev) return marcar(smart ? capitalize(piece) : piece, modo);

  const cerroOracion = CIERRA_ORACION.test(prev);
  const tabulado = /\n\s*$/.test(prev);
  let sep;
  let arrancaLinea = false;

  // Con separación activada, después de cada punto se sigue abajo
  if (modo !== 'corrido' && cerroOracion && !tabulado) {
    sep = '\n';
    arrancaLinea = true;
  } else if (tabulado || /\s$/.test(prev)) {
    sep = '';
    arrancaLinea = modo !== 'corrido' && tabulado;
  } else if (/^[\s,.;:!?…)\n]/.test(piece)) {
    sep = '';
  } else {
    sep = ' ';
  }

  // La mayúscula va antes del guion: si no, el guion la tapa y no se aplica
  if (smart && (cerroOracion || tabulado)) piece = upperFirst(piece);
  if (arrancaLinea) piece = marcar(piece, modo);

  return prev + sep + piece;
}

/** Antepone el guion cuando corresponde, sin duplicarlo. */
function marcar(linea, modo) {
  if (modo !== 'guiones') return linea;
  return /^\s*[-–—•]/.test(linea) ? linea : '- ' + linea.replace(/^\s+/, '');
}

/** Reacomoda un texto ya escrito: una oración por renglón. */
export function separarLineas(texto, modo = 'lineas') {
  if (!texto || !texto.trim()) return texto;

  let t = texto
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    // Corta después del punto (y del signo de cierre si lo hay)
    .replace(/([.!?…]+["»)]?)[ \t]+/g, '$1\n')
    .replace(/\n{3,}/g, '\n\n');

  if (modo === 'guiones') {
    t = t.split('\n')
      .map(l => (l.trim() ? marcar(capitalize(l.trim()), 'guiones') : ''))
      .join('\n');
  } else {
    t = t.split('\n')
      .map(l => (l.trim() ? capitalize(l.trim()) : ''))
      .join('\n');
  }

  return t.replace(/\n{3,}/g, '\n\n').trim();
}

function upperFirst(s) {
  return s.replace(/^(\s*[¿¡"«(]*)(\p{Ll})/u, (_, pre, ch) => pre + ch.toUpperCase());
}

/* ── 4. Comparación palabra por palabra ──────────────────
   Alineación tipo Levenshtein sobre palabras: devuelve precisión
   y la lista de operaciones para pintar el diff de la calibración. */
export function diffWords(expected, heard) {
  const a = tokenize(expected), b = tokenize(heard);
  const n = a.length, m = b.length;

  const d = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1].norm === b[j - 1].norm ? 0 : 1)
      );

  // Retroceso para recuperar las operaciones
  const ops = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1].norm === b[j - 1].norm && d[i][j] === d[i - 1][j - 1]) {
      ops.push({ op: 'ok', expected: a[i - 1].raw, heard: b[j - 1].raw }); i--; j--;
    } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
      ops.push({ op: 'sub', expected: a[i - 1].raw, heard: b[j - 1].raw }); i--; j--;
    } else if (j > 0 && d[i][j] === d[i][j - 1] + 1) {
      ops.push({ op: 'extra', expected: '', heard: b[j - 1].raw }); j--;
    } else {
      ops.push({ op: 'missing', expected: a[i - 1].raw, heard: '' }); i--;
    }
  }
  ops.reverse();

  const errors = d[n][m];
  const accuracy = n === 0 ? 0 : Math.max(0, Math.round((1 - errors / n) * 100));
  return { accuracy, errors, total: n, ops };
}

function tokenize(text) {
  return String(text || '')
    .split(/\s+/)
    .map(raw => ({ raw, norm: normWord(raw) }))
    .filter(t => t.norm);
}

/** Sugerencias de vocabulario a partir de un diff (lo escuchado → lo correcto). */
export function suggestionsFromDiff(ops) {
  const out = [];
  for (const op of ops) {
    if (op.op === 'sub' && op.heard && op.expected &&
        normWord(op.heard) !== normWord(op.expected)) {
      out.push({ from: op.heard.replace(/[.,;:!?¿¡"]/g, ''), to: op.expected.replace(/[.,;:!?¿¡"]/g, '') });
    }
  }
  return out;
}
