/* Empaqueta la app en un único archivo HTML autocontenido.
   Sirve para publicarla donde no se pueden subir varios archivos.

   Uso:  node build.mjs        → dist/voz-a-texto.html
   Requiere esbuild (se baja solo con npx la primera vez). */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const html = await readFile('index.html', 'utf8');
const css  = await readFile('assets/styles.css', 'utf8');

// Los módulos ES se juntan en un solo script
const js = execFileSync('npx', ['--yes', 'esbuild@0.24.0', 'js/app.js',
  '--bundle', '--format=iife', '--target=es2022', '--minify'], { encoding: 'utf8' });

const body = html
  .replace(/[\s\S]*<body>/, '')
  .replace(/<\/body>[\s\S]*/, '')
  .replace(/<script type="module"[^>]*><\/script>/, '')
  // El botón de instalar no aplica al archivo suelto: no hay manifiesto que servir
  .replace(/<button id="btnInstall"[\s\S]*?<\/button>/, '')
  .replace(/<div id="installHint"[\s\S]*?<\/div>/, '');

const out = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Voz a Texto — Grabación y transcripción continua</title>
<style>${css}</style>
</head>
<body>
${body.trim()}
<script>${js}</script>
</body>
</html>`;

await mkdir('dist', { recursive: true });
await writeFile('dist/voz-a-texto.html', out);
console.log(`dist/voz-a-texto.html — ${(out.length / 1024).toFixed(0)} KB`);
