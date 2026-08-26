/* Generador de PDF mínimo, escrito a mano (sin librerías).
   Tipografías estándar Helvetica con codificación WinAnsi: los acentos,
   la eñe y los signos ¿ ¡ salen correctos. */

const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

/* Caracteres fuera de ASCII que WinAnsi coloca en 0x80–0x9F */
const WINANSI_SPECIAL = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A,
  '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C,
  'ž': 0x9E, 'Ÿ': 0x9F,
};

/** Ancho aproximado de un carácter, en milésimas de punto */
function charWidth(ch, bold) {
  const table = bold ? W_BOLD : W_REG;
  const code = ch.codePointAt(0);
  if (code >= 32 && code <= 126) return table[code - 32];
  // Acentuadas y símbolos: se usa el ancho de su letra base
  const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const b = base.codePointAt(0);
  if (b >= 32 && b <= 126) return table[b - 32];
  if (ch === '¿') return table['?'.codePointAt(0) - 32];
  if (ch === '¡') return table['!'.codePointAt(0) - 32];
  if (ch === '…') return table['.'.codePointAt(0) - 32] * 3;
  if (ch === '—' || ch === '–') return table['-'.codePointAt(0) - 32] * 2;
  if (ch === '«' || ch === '»' || ch === '“' || ch === '”') return table['"'.codePointAt(0) - 32];
  if (ch === 'ñ' || ch === 'Ñ') return table[(ch === 'ñ' ? 'n' : 'N').codePointAt(0) - 32];
  return table['o'.codePointAt(0) - 32];
}

export function textWidth(text, size, bold = false) {
  let w = 0;
  for (const ch of text) w += charWidth(ch, bold);
  return (w * size) / 1000;
}

/** Convierte a bytes WinAnsi y escapa lo que el PDF necesita */
function pdfString(text) {
  let out = '';
  for (const ch of text) {
    let code = ch.codePointAt(0);
    if (WINANSI_SPECIAL[ch] !== undefined) code = WINANSI_SPECIAL[ch];
    else if (code > 0xFF) {
      const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      code = base.codePointAt(0) <= 0xFF ? base.codePointAt(0) : 0x3F; // '?'
    }
    if (code === 0x28 || code === 0x29 || code === 0x5C) out += '\\' + String.fromCharCode(code);
    else if (code < 32) out += ' ';
    else out += '\\' + code.toString(8).padStart(3, '0');
  }
  return out;
}

/** Corta un párrafo en líneas que entren en `maxWidth` */
export function wrapText(text, size, maxWidth, bold = false) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    if (!para.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (textWidth(test, size, bold) <= maxWidth) { line = test; continue; }
      if (line) lines.push(line);
      // Palabra sola más ancha que la página: se parte por letras
      if (textWidth(word, size, bold) > maxWidth) {
        let piece = '';
        for (const ch of word) {
          if (textWidth(piece + ch, size, bold) > maxWidth) { lines.push(piece); piece = ch; }
          else piece += ch;
        }
        line = piece;
      } else line = word;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Arma el PDF.
 * @param {{title:string, body:string, meta?:string[], footer?:string}} doc
 */
export function buildPdf({ title = '', body = '', meta = [], footer = '' } = {}) {
  const PW = 595.28, PH = 841.89;          // A4 en puntos
  const M = 56;                             // márgenes
  const MAXW = PW - M * 2;
  const SIZE = 11, LH = 16.5;
  const TSIZE = 20, MSIZE = 9;

  // ── Paginado
  const pages = [];
  let cur = [], y = PH - M;

  const push = (op) => cur.push(op);
  const newPage = () => { pages.push(cur); cur = []; y = PH - M; };
  const space = (h) => { if (y - h < M + 26) newPage(); };

  if (title) {
    for (const line of wrapText(title, TSIZE, MAXW, true)) {
      space(TSIZE + 8);
      y -= TSIZE + 4;
      push({ t: line, x: M, y, size: TSIZE, bold: true });
    }
    y -= 6;
  }
  for (const line of meta) {
    space(MSIZE + 5);
    y -= MSIZE + 4;
    push({ t: line, x: M, y, size: MSIZE, bold: false, gray: true });
  }
  if (title || meta.length) {
    y -= 10;
    push({ rule: true, x: M, y, w: MAXW });
    y -= 12;
  }

  for (const para of String(body).split(/\n/)) {
    if (!para.trim()) { y -= LH * 0.6; continue; }
    for (const line of wrapText(para, SIZE, MAXW)) {
      space(LH);
      y -= LH;
      push({ t: line, x: M, y, size: SIZE });
    }
    y -= 3;
  }
  pages.push(cur);

  // ── Objetos PDF
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };   // devuelve el nº de objeto

  const fontReg = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  const pageIds = [];
  const contentIds = [];
  for (let p = 0; p < pages.length; p++) { pageIds.push(0); contentIds.push(0); }

  const pagesObjNum = objs.length + pages.length * 2 + 1;   // reservado más abajo

  const streams = pages.map((ops, idx) => {
    let s = '';
    for (const op of ops) {
      if (op.rule) {
        s += `q 0.75 w 0.8 0.8 0.8 RG ${op.x} ${op.y.toFixed(2)} m ${(op.x + op.w).toFixed(2)} ${op.y.toFixed(2)} l S Q\n`;
        continue;
      }
      const g = op.gray ? '0.42 0.42 0.42 rg' : '0 0 0 rg';
      s += `BT ${g} /${op.bold ? 'FB' : 'FR'} ${op.size} Tf 1 0 0 1 ${op.x} ${op.y.toFixed(2)} Tm (${pdfString(op.t)}) Tj ET\n`;
    }
    if (footer) {
      const label = footer.replace('{n}', String(idx + 1)).replace('{total}', String(pages.length));
      const w = textWidth(label, 8.5);
      s += `BT 0.55 0.55 0.55 rg /FR 8.5 Tf 1 0 0 1 ${(PW - M - w).toFixed(2)} ${(M - 18).toFixed(2)} Tm (${pdfString(label)}) Tj ET\n`;
    }
    return s;
  });

  for (let i = 0; i < pages.length; i++) {
    contentIds[i] = add(`<< /Length ${new TextEncoder().encode(streams[i]).length} >>\nstream\n${streams[i]}endstream`);
    pageIds[i] = add(
      `<< /Type /Page /Parent ${pagesObjNum} 0 R /MediaBox [0 0 ${PW} ${PH}] ` +
      `/Resources << /Font << /FR ${fontReg} 0 R /FB ${fontBold} 0 R >> >> ` +
      `/Contents ${contentIds[i]} 0 R >>`
    );
  }

  const pagesNum = add(`<< /Type /Pages /Kids [${pageIds.map(n => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  const now = new Date();
  const stamp = 'D:' + [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('') + "Z";
  const infoNum = add(`<< /Title (${pdfString(title || 'Documento')}) /Producer (Voz a Texto) /CreationDate (${stamp}) >>`);
  const catalogNum = add(`<< /Type /Catalog /Pages ${pagesNum} 0 R >>`);

  // ── Serialización con tabla xref
  const encoder = new TextEncoder();
  const chunks = [];
  let len = 0;
  const write = (str) => { const b = encoder.encode(str); chunks.push(b); len += b.length; return b.length; };

  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const offsets = [0];
  objs.forEach((body, i) => {
    offsets.push(len);
    write(`${i + 1} 0 obj\n${body}\nendobj\n`);
  });

  const xrefPos = len;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  write(xref);
  write(`trailer\n<< /Size ${objs.length + 1} /Root ${catalogNum} 0 R /Info ${infoNum} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  return new Blob(chunks, { type: 'application/pdf' });
}
