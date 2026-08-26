/* Exportación del documento a los distintos formatos. */

import { download, slug, fmtDate, countWords, escapeHtml, fmtDur, toast } from '../util.js';
import { buildPdf } from './pdf.js';
import { buildDocx } from './docx.js';

/** Datos comunes que encabezan cada exportación */
function header(session) {
  const words = countWords(session.text || '');
  const meta = [
    `Creado el ${fmtDate(session.createdAt)} · ${words} palabra${words === 1 ? '' : 's'}`,
  ];
  if (session.dictatedMs) meta.push(`Tiempo dictado: ${fmtDur(session.dictatedMs)}`);
  return meta;
}

export const FORMATS = {
  pdf:  { label: 'PDF',      ext: 'pdf' },
  docx: { label: 'Word',     ext: 'docx' },
  txt:  { label: 'Notas',    ext: 'txt' },
  md:   { label: 'Markdown', ext: 'md' },
  html: { label: 'HTML',     ext: 'html' },
  json: { label: 'JSON',     ext: 'json' },
};

export async function exportSession(session, fmt, extra = {}) {
  const title = (session.title || 'Documento sin título').trim();
  const body = session.text || '';
  const meta = header(session);
  const name = slug(title);

  switch (fmt) {
    case 'pdf': {
      return report(await download(buildPdf({ title, body, meta, footer: 'Página {n} de {total}' }), `${name}.pdf`), 'PDF');
    }
    case 'docx': {
      return report(await download(buildDocx({ title, body, meta }), `${name}.docx`), 'Word');
    }
    case 'txt': {
      // Formato pensado para pegar en Notas / Google Keep / cualquier bloc
      const txt = `${title}\n${'='.repeat(Math.min(title.length, 60))}\n${meta.join('\n')}\n\n${body}\n`;
      return report(await download(new Blob([txt], { type: 'text/plain;charset=utf-8' }), `${name}.txt`), 'Notas');
    }
    case 'md': {
      const md = `# ${title}\n\n${meta.map(m => `_${m}_`).join('  \n')}\n\n${body.replace(/\n/g, '\n\n').replace(/\n{3,}/g, '\n\n')}\n`;
      return report(await download(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${name}.md`), 'Markdown');
    }
    case 'html': {
      return report(await download(new Blob([htmlDoc(title, body, meta)], { type: 'text/html;charset=utf-8' }), `${name}.html`), 'HTML');
    }
    case 'json': {
      const data = {
        title, text: body, lang: session.lang,
        createdAt: new Date(session.createdAt).toISOString(),
        updatedAt: new Date(session.updatedAt).toISOString(),
        dictatedMs: session.dictatedMs || 0,
        words: countWords(body),
        recordings: (extra.audios || []).map(a => ({
          id: a.id, createdAt: new Date(a.createdAt).toISOString(),
          durationMs: a.duration, mime: a.mime, bytes: a.size,
        })),
        exportedAt: new Date().toISOString(),
        app: 'Voz a Texto',
      };
      return report(await download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${name}.json`), 'JSON');
    }
    case 'clipboard': {
      await copyToClipboard(`${title}\n\n${body}`);
      return 'Texto copiado al portapapeles';
    }
    case 'print': {
      printDoc(title, body, meta);
      return 'Abriendo la ventana de impresión';
    }
    default:
      throw new Error('Formato desconocido: ' + fmt);
  }
}

/** Mensaje según cómo terminó la descarga */
function report(result, label) {
  if (result === 'saved')    return `${label} guardado`;
  if (result === 'declined') return 'Descarga cancelada';
  return `Descargando ${label}…`;
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

function htmlDoc(title, body, meta) {
  const paras = body.split(/\n/).map(p =>
    p.trim() ? `<p>${escapeHtml(p)}</p>` : '<p class="sp"></p>').join('\n');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{max-width:46rem;margin:3rem auto;padding:0 1.4rem;
       font:16px/1.75 Georgia,'Times New Roman',serif;color:#1c2430;background:#fff}
  h1{font-size:2rem;line-height:1.2;margin:0 0 .4rem;font-family:system-ui,sans-serif}
  .meta{color:#7a8493;font-size:.82rem;font-family:system-ui,sans-serif;
        border-bottom:1px solid #e6e9ee;padding-bottom:1rem;margin-bottom:1.6rem}
  p{margin:0 0 1rem} p.sp{height:.5rem;margin:0}
  @media print{body{margin:0;max-width:none}}
  @media (prefers-color-scheme:dark){
    body{background:#12161d;color:#e6ebf3}.meta{color:#8c97a8;border-color:#2a3342}
  }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">${meta.map(escapeHtml).join(' · ')}</div>
${paras}
</body></html>`;
}

function printDoc(title, body, meta) {
  const win = window.open('', '_blank');
  if (!win) {
    toast('El navegador bloqueó la ventana emergente. Permitila para imprimir.', 'err');
    return;
  }
  win.document.write(htmlDoc(title, body, meta));
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 350);
}
