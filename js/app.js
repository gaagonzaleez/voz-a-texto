/* Voz a Texto — aplicación principal.
   Une el grabador, el dictado, el documento, la calibración, las voces
   de lectura y la exportación. Todo corre en el navegador. */

import { $, $$, fmtTime, fmtDur, fmtDate, fmtRelative, countWords, escapeHtml,
         debounce, toast, sleep, download, slug } from './util.js';
import { Sessions, Audios, Settings, newSession, storageEstimate } from './db.js';
import { Recorder, blobDuration, extFor } from './recorder.js';
import { Transcriber, isSupported as srSupported } from './recognition.js';
import { applyVocabulary, applyVoiceCommands, joinChunk, normWord } from './textproc.js';
import { Reader, sortVoices } from './tts.js';
import * as Calib from './calibration.js';
import { exportSession, copyToClipboard } from './export/exporters.js';
import { setupPWA } from './pwa.js';

/* ═══════════════ Estado ═══════════════ */
const state = {
  session: null,
  sessions: [],
  vocab: [],
  profile: null,
  prefs: { lang: 'es-AR', micId: '', vocab: true, commands: true, smart: true, keepAudio: true },
  mode: 'idle',              // idle | recording | paused
  segStart: 0,               // inicio del tramo actual
  segElapsed: 0,             // acumulado del tramo (descontando pausas)
  timerId: 0,
  undoStack: [],
  audioUrls: [],
  // Detección del conflicto "grabar y dictar a la vez" (típico de Android)
  gotResult: false,
  sawSound: false,
  conflictTimer: 0,
  diag: [],
};

const recorder = new Recorder();
const transcriber = new Transcriber({ lang: state.prefs.lang });
const reader = new Reader();

/* ═══════════════ Arranque ═══════════════ */
init();

async function init() {
  checkSupport();
  await loadPrefs();
  await loadVocab();
  state.profile = await Settings.get('profile', null);
  updateCalibStatus();
  await loadSessions();
  bindUI();
  bindEngines();
  await refreshMicList();
  setupVoices();
  setupPWA();
}

function checkSupport() {
  const problems = [];
  if (!srSupported) problems.push('Tu navegador no tiene dictado por voz: usá <b>Chrome</b> o <b>Edge</b> de escritorio para transcribir. El resto de la app funciona igual.');
  if (!recorder.supported) problems.push('Este navegador no puede grabar audio.');
  if (location.protocol === 'file:') problems.push('Abriste el archivo directamente. El micrófono necesita <b>http://localhost</b> o <b>https</b>: mirá el README para levantarlo con un comando.');
  if (problems.length) {
    const el = $('#unsupported');
    el.innerHTML = problems.join(' · ');
    el.classList.remove('hidden');
  }
}

/* ═══════════════ Preferencias ═══════════════ */
async function loadPrefs() {
  const saved = await Settings.get('prefs', null);
  if (saved) state.prefs = { ...state.prefs, ...saved };
  $('#selLang').value = state.prefs.lang;
  $('#optVocab').checked = state.prefs.vocab;
  $('#optCommands').checked = state.prefs.commands;
  $('#optSmart').checked = state.prefs.smart;
  $('#optKeepAudio').checked = state.prefs.keepAudio;
  transcriber.lang = state.prefs.lang;
}
const savePrefs = debounce(() => Settings.set('prefs', state.prefs), 300);

/* ═══════════════ Vocabulario ═══════════════ */
async function loadVocab() {
  state.vocab = await Settings.get('vocabulary', []) || [];
  renderVocab();
  syncPreferredTerms();
}
async function saveVocab() {
  await Settings.set('vocabulary', state.vocab);
  renderVocab();
  syncPreferredTerms();
}
function syncPreferredTerms() {
  transcriber.setPreferredTerms(state.vocab.map(v => v.to));
}
function renderVocab() {
  const list = $('#vocList');
  if (!state.vocab.length) {
    list.innerHTML = '<li class="empty">Todavía no cargaste correcciones. Calibrá tu voz o agregá las palabras que el dictado suele errar.</li>';
    return;
  }
  list.innerHTML = state.vocab.map((v, i) => `
    <li class="voc-item">
      <s>${escapeHtml(v.from)}</s> → <b>${escapeHtml(v.to)}</b>
      <button class="icon-btn" data-voc-del="${i}" title="Quitar">✕</button>
    </li>`).join('');
}

/* ═══════════════ Documentos ═══════════════ */
async function loadSessions() {
  state.sessions = (await Sessions.all()).sort((a, b) => b.updatedAt - a.updatedAt);
  if (!state.sessions.length) {
    const s = newSession(state.prefs.lang);
    await Sessions.put(s);
    state.sessions = [s];
  }
  const lastId = await Settings.get('lastSession', null);
  const found = state.sessions.find(s => s.id === lastId);
  await openSession(found ? found.id : state.sessions[0].id);
  renderSessions();
}

function renderSessions() {
  const list = $('#sessionList');
  $('#sessionCount').textContent = state.sessions.length;
  list.innerHTML = state.sessions.map(s => `
    <li class="session-item ${s.id === state.session?.id ? 'is-active' : ''}" data-session="${s.id}">
      <b>${escapeHtml(s.title || 'Sin título')}</b>
      <small>${countWords(s.text || '')} palabras · ${fmtRelative(s.updatedAt)}</small>
      <button class="session-del" data-del="${s.id}" title="Eliminar documento">✕</button>
    </li>`).join('');
}

async function openSession(id) {
  if (state.mode !== 'idle') {
    toast('Detené la grabación antes de cambiar de documento.', 'err');
    return;
  }
  const s = await Sessions.get(id);
  if (!s) return;
  state.session = s;
  state.undoStack = [];
  $('#docTitle').value = s.title || '';
  $('#docText').value = s.text || '';
  $('#selLang').value = s.lang || state.prefs.lang;
  transcriber.lang = s.lang || state.prefs.lang;
  updateStats();
  await Settings.set('lastSession', id);
  renderSessions();
  await renderAudios();
  setupVoices();
}

const persist = debounce(async () => {
  if (!state.session) return;
  state.session.updatedAt = Date.now();
  await Sessions.put(state.session);
  const i = state.sessions.findIndex(s => s.id === state.session.id);
  if (i >= 0) state.sessions[i] = state.session;
  state.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  renderSessions();
  $('#saveState').textContent = 'Guardado';
}, 600);

function touch() {
  $('#saveState').textContent = 'Guardando…';
  persist();
}

function updateStats() {
  const t = $('#docText').value;
  const w = countWords(t);
  $('#statWords').textContent = `${w} palabra${w === 1 ? '' : 's'}`;
  $('#statChars').textContent = `${t.length} caracteres`;
  $('#btnUndo').disabled = !state.undoStack.length;
}

/* ═══════════════ Grabación ═══════════════ */
async function startRecording() {
  if (!state.session) return;

  // Antes de la primera grabación conviene calibrar
  if (!state.profile) {
    openCalib(true);
    toast('Hacé primero la prueba de voz: así el dictado no se equivoca.', '', 5000);
    return;
  }

  // El dictado arranca PRIMERO y sin esperas: algunos Android sólo permiten
  // iniciar el reconocimiento de voz dentro del gesto que lo pidió, y
  // cualquier await previo (abrir el micrófono) rompía esa condición.
  state.mode = 'recording';
  state.segStart = performance.now();
  state.segElapsed = 0;
  state.gotResult = false;
  state.sawSound = false;
  startTimer();
  setStatus('recording');
  hideRecAlert();
  logDiag('app', 'REC', state.prefs.keepAudio ? 'con audio' : 'sin audio');
  transcriber.start($('#selLang').value);
  vigilarTranscripcion();

  // Y recién después se prepara la grabación del audio, si corresponde
  if (!state.prefs.keepAudio) {
    recorder.closeMic();
    setMeter(0, 0);
    return;
  }
  try {
    await recorder.openMic(state.prefs.micId, state.profile?.constraints);
    await refreshMicList();
    await recorder.start();
  } catch (err) {
    const msg = micError(err);
    logDiag('audio', 'ERROR', err?.name || '');
    toast(msg + ' El dictado sigue funcionando.', 'err', 8000);
    $('#recHint').textContent = msg;   // el aviso flotante puede quedar fuera de pantalla
  }
}

function pauseRecording() {
  if (state.mode !== 'recording') return;
  recorder.pause();
  transcriber.stop();
  clearTimeout(state.conflictTimer);
  state.segElapsed += performance.now() - state.segStart;
  state.mode = 'paused';
  stopTimer();
  setStatus('paused');
  toast('En pausa. Cuando sigas, el texto continúa en el mismo documento.');
}

async function resumeRecording() {
  if (state.mode !== 'paused') return;
  state.mode = 'recording';
  state.segStart = performance.now();
  state.gotResult = false;
  startTimer();
  setStatus('recording');
  transcriber.start($('#selLang').value);      // primero el dictado, dentro del gesto
  vigilarTranscripcion();

  if (!state.prefs.keepAudio) return;
  try {
    if (!recorder.stream) await recorder.openMic(state.prefs.micId, state.profile?.constraints);
    if (recorder.rec) recorder.resume();
    else await recorder.start();
  } catch (err) {
    logDiag('audio', 'ERROR', err?.name || '');
    toast(micError(err) + ' El dictado sigue funcionando.', 'err');
  }
}

async function stopRecording() {
  if (state.mode === 'idle') return;
  if (state.mode === 'recording') state.segElapsed += performance.now() - state.segStart;

  transcriber.stop();
  stopTimer();
  clearTimeout(state.conflictTimer);
  hideRecAlert();
  setStatus('guardando');

  const blob = await recorder.stop();
  recorder.closeMic();

  const dictated = Math.round(state.segElapsed);
  state.session.dictatedMs = (state.session.dictatedMs || 0) + dictated;

  await guardarAudio(blob, dictated);

  state.mode = 'idle';
  state.segElapsed = 0;
  $('#timer').textContent = '00:00:00';
  setMeter(0, 0);
  $('#interim').textContent = '';
  setStatus('idle');
  touch();
}

/* ── Cuando el teléfono no deja grabar y dictar a la vez ──────────────
   Varios Android le dan el micrófono a una sola cosa: si está grabando el
   audio, el motor de dictado se queda mudo. Se detecta solo y se ofrece
   apagar el guardado de audio sin cortar la sesión. */

function vigilarTranscripcion() {
  clearTimeout(state.conflictTimer);
  state.conflictTimer = setTimeout(() => {
    if (state.mode !== 'recording' || state.gotResult) return;

    if (state.prefs.keepAudio && state.sawSound) {
      mostrarRecAlert(
        '<b>Estoy grabando pero no transcribo</b>' +
        'Tu teléfono no permite grabar el audio y dictar al mismo tiempo. ' +
        'Puedo apagar el guardado de audio y seguir dictando sin cortar lo que venís haciendo. ' +
        'La grabación de hasta acá se guarda igual.',
        true);
    } else if (!state.sawSound && state.prefs.keepAudio) {
      mostrarRecAlert(
        '<b>No estoy escuchando nada</b>' +
        'Revisá que el micrófono no esté silenciado y que estés hablando cerca del teléfono.',
        false, true);
    } else if (!state.gotResult) {
      mostrarRecAlert(
        '<b>Todavía no transcribí nada</b>' +
        'El dictado necesita internet: revisá la conexión. Si estás en silencio, ignorá este aviso.',
        false, true);
    }
  }, 14000);
}

function mostrarRecAlert(html, conBoton, info = false) {
  const box = $('#recAlert');
  box.querySelector('.rec-alert-txt').innerHTML = html;
  $('#btnFixConflict').classList.toggle('hidden', !conBoton);
  box.classList.toggle('is-info', info);
  box.classList.remove('hidden');
}

function hideRecAlert() {
  $('#recAlert').classList.add('hidden');
}

/** Guarda lo grabado, suelta el micrófono y sigue dictando, sin cortar la sesión. */
async function apagarAudioYSeguir() {
  const btn = $('#btnFixConflict');
  btn.disabled = true;

  const blob = await recorder.stop();
  recorder.closeMic();
  setMeter(0, 0);
  await guardarAudio(blob, Math.round(state.segElapsed + (performance.now() - state.segStart)));

  state.prefs.keepAudio = false;
  $('#optKeepAudio').checked = false;
  savePrefs();

  // El motor se reinicia ahora que el micrófono quedó libre
  transcriber.stop();
  state.gotResult = false;
  transcriber.start($('#selLang').value);
  vigilarTranscripcion();

  btn.disabled = false;
  hideRecAlert();
  setStatus('recording');
  toast('Listo: seguí hablando, ahora sí te transcribo.', 'ok', 5000);
}

/** Guarda un blob de audio dentro del documento actual. */
async function guardarAudio(blob, msAproximados) {
  if (!blob || !blob.size || !state.session) return;
  let duration = await blobDuration(blob);
  if (!duration) duration = msAproximados;
  await Audios.put({
    id: 'aud-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    sessionId: state.session.id,
    blob, mime: blob.type, size: blob.size,
    duration, createdAt: Date.now(),
  });
  await renderAudios();
  toast('Grabación guardada. La podés escuchar en «Grabaciones».', 'ok');
}

function micError(err) {
  const name = err?.name || '';
  const embedded = window.self !== window.top;
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return embedded
      ? 'La página incrustada no puede usar el micrófono. Abrí la app en una pestaña propia del navegador.'
      : 'No diste permiso al micrófono. Habilitalo en el candado de la barra de direcciones.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No se encontró ese micrófono. Elegí otro en la lista.';
  if (name === 'NotReadableError')
    return 'Otra aplicación está usando el micrófono. Cerrala y volvé a intentar.';
  return 'No se pudo abrir el micrófono: ' + (err?.message || name || 'error desconocido');
}

/* Cronómetro */
function startTimer() {
  stopTimer();
  state.timerId = setInterval(() => {
    const ms = state.segElapsed + (performance.now() - state.segStart);
    $('#timer').textContent = fmtTime(ms);
  }, 250);
}
function stopTimer() { clearInterval(state.timerId); state.timerId = 0; }

/* Estado visual */
function setStatus(mode) {
  const pill = $('#statusPill'), btn = $('#btnRec'), label = btn.querySelector('.rec-label');
  const txt = pill.querySelector('span');
  pill.className = 'pill';
  btn.classList.remove('is-rec', 'is-paused');

  if (mode === 'recording') {
    pill.classList.add('pill-rec'); txt.textContent = 'Grabando';
    btn.classList.add('is-rec'); label.textContent = 'PAUSA';
    btn.title = 'Pausar (Ctrl+Espacio)';
    $('#btnPause').disabled = false; $('#btnStop').disabled = false;
    $('#btnPause').innerHTML = '⏸ Pausar';
    $('#recHint').textContent = state.prefs.keepAudio
      ? 'Estoy escuchando. Todo lo que digas se escribe abajo.'
      : 'Estoy escuchando. Todo lo que digas se escribe abajo. (Sin medidor: el micrófono queda libre para el dictado.)';
  } else if (mode === 'paused') {
    pill.classList.add('pill-pause'); txt.textContent = 'En pausa';
    btn.classList.add('is-paused'); label.textContent = 'SEGUIR';
    btn.title = 'Reanudar (Ctrl+Espacio)';
    $('#btnPause').disabled = false; $('#btnStop').disabled = false;
    $('#btnPause').innerHTML = '▶ Reanudar';
    $('#recHint').textContent = 'Pausado. Podés seguir ahora o más tarde: se escribe en el mismo documento.';
  } else if (mode === 'preparando' || mode === 'guardando') {
    pill.classList.add('pill-idle'); txt.textContent = mode === 'preparando' ? 'Preparando…' : 'Guardando…';
    label.textContent = '…';
    $('#btnPause').disabled = true; $('#btnStop').disabled = true;
  } else {
    pill.classList.add('pill-idle'); txt.textContent = 'Detenido';
    label.textContent = 'REC'; btn.title = 'Empezar a grabar (Ctrl+Espacio)';
    $('#btnPause').disabled = true; $('#btnStop').disabled = true;
    $('#btnPause').innerHTML = '⏸ Pausar';
    $('#recHint').textContent = 'Pulsá REC y hablá. Podés pausar y seguir más tarde: todo se escribe en el mismo documento.';
  }
}

function setMeter(level, peak) {
  $('#meterFill').style.width = (level * 100).toFixed(1) + '%';
  $('#meterPeak').style.left = (peak * 100).toFixed(1) + '%';
}

/* ═══════════════ Motores ═══════════════ */
function bindEngines() {
  recorder.addEventListener('level', e => {
    setMeter(e.detail.level, e.detail.peak);
    if (state.mode === 'recording' && e.detail.level > 0.14) state.sawSound = true;
    if (calib.open) {
      $('#calibMeterFill').style.width = (e.detail.level * 100).toFixed(1) + '%';
      $('#calibMeterPeak').style.left = (e.detail.peak * 100).toFixed(1) + '%';
      $('#phraseMeterFill').style.width = (e.detail.level * 100).toFixed(1) + '%';
      $('#phraseMeterPeak').style.left = (e.detail.peak * 100).toFixed(1) + '%';
    }
  });
  recorder.addEventListener('error', () => {
    logDiag('audio', 'ERROR', 'se cortó la grabación');
    toast('Se cortó la grabación de audio.', 'err');
  });
  recorder.addEventListener('start', () => logDiag('audio', 'grabando'));
  recorder.addEventListener('stop', () => logDiag('audio', 'grabación detenida'));
  recorder.addEventListener('pause', () => logDiag('audio', 'en pausa'));
  recorder.addEventListener('resume', () => logDiag('audio', 'reanudado'));
  window.addEventListener('online', () => logDiag('red', 'volvió la conexión'));
  window.addEventListener('offline', () => logDiag('red', 'se cortó la conexión'));

  transcriber.addEventListener('log', e => logDiag('dictado', e.detail.evento, e.detail.detalle));
  transcriber.addEventListener('final', e => {
    state.gotResult = true;
    clearTimeout(state.conflictTimer);
    hideRecAlert();
    appendChunk(e.detail.text);
  });
  transcriber.addEventListener('interim', e => {
    if (e.detail.text) { state.gotResult = true; clearTimeout(state.conflictTimer); hideRecAlert(); }
    let t = e.detail.text;
    if (t && state.prefs.vocab) t = applyVocabulary(t, state.vocab);
    $('#interim').textContent = t;
  });
  transcriber.addEventListener('error', e => {
    logDiag('dictado', 'ERROR', e.detail.code || '');
    let msg = e.detail.message;
    // En Android, grabar el audio y dictar a la vez puede pelearse por el micrófono
    if (state.prefs.keepAudio && (e.detail.code === 'audio-capture' || e.detail.code === 'not-allowed')) {
      msg += ' Si estás en el celular, probá destildar «Guardar audio»: algunos teléfonos no dejan grabar y dictar al mismo tiempo.';
    }
    toast(msg, 'err', 9000);
    $('#recHint').textContent = msg;
    if (state.mode === 'recording') stopRecording();
  });
  transcriber.addEventListener('warn', e => {
    logDiag('dictado', 'aviso', e.detail.code || '');
    toast(e.detail.message, '', 2500);
  });

  reader.addEventListener('progress', e => {
    $('#ttsProgress').textContent = `Leyendo ${e.detail.index + 1} de ${e.detail.total}`;
  });
  reader.addEventListener('end', () => {
    $('#ttsProgress').textContent = 'Lectura terminada';
    ttsButtons(false);
  });
  reader.addEventListener('stop', () => ttsButtons(false));
  reader.addEventListener('error', e => { toast(e.detail, 'err'); ttsButtons(false); });
}

/** Agrega al documento lo que se acaba de dictar. */
function appendChunk(raw) {
  if (!raw || !state.session) return;
  let chunk = raw;
  if (state.prefs.commands) chunk = applyVoiceCommands(chunk);
  if (state.prefs.vocab) chunk = applyVocabulary(chunk, state.vocab);
  // Se recortan espacios pero NO los saltos de línea: si el tramo terminó con
  // «nuevo párrafo», ese corte tiene que llegar al documento.
  chunk = chunk.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
  if (!chunk.trim() && !/\n/.test(chunk)) return;

  const ta = $('#docText');
  const before = ta.value;
  state.undoStack.push(before);
  if (state.undoStack.length > 40) state.undoStack.shift();

  const atEnd = ta.selectionStart >= before.length - 1;
  ta.value = joinChunk(before, chunk, { smart: state.prefs.smart });
  state.session.text = ta.value;
  if (atEnd) {
    ta.scrollTop = ta.scrollHeight;
    ta.selectionStart = ta.selectionEnd = ta.value.length;
  }
  $('#interim').textContent = '';
  updateStats();
  touch();
}

/* ═══════════════ Diagnóstico ═══════════════
   Deja a la vista qué está haciendo el motor de dictado. Cuando algo no
   transcribe, esto dice por qué sin tener que adivinar. */

function logDiag(fuente, evento, detalle = '') {
  state.diag.push({ t: Date.now(), fuente, evento, detalle });
  if (state.diag.length > 80) state.diag.shift();
  if ($('.tab-panel[data-panel="diag"]')?.classList.contains('is-active')) renderDiagLog();
}

function renderDiagLog() {
  const log = $('#diagLog');
  if (!log) return;
  log.innerHTML = state.diag.map(d => {
    const hora = new Date(d.t).toLocaleTimeString('es', { hour12: false }) +
      '.' + String(new Date(d.t).getMilliseconds()).padStart(3, '0').slice(0, 2);
    const clase = /error|no arrancó|caído/i.test(d.evento) ? 'bad'
                : /texto|escuchando/i.test(d.evento) ? 'ok' : '';
    return `<li><time>${hora}</time><span class="src">${escapeHtml(d.fuente)}</span>` +
           `<span class="msg ${clase}">${escapeHtml(d.evento)}${d.detalle ? ' — ' + escapeHtml(d.detalle) : ''}</span></li>`;
  }).join('');
  log.scrollTop = log.scrollHeight;
}

async function renderDiagEstado() {
  const ul = $('#diagEstado');
  if (!ul) return;

  let permiso = 'desconocido';
  try {
    const st = await navigator.permissions?.query({ name: 'microphone' });
    if (st) permiso = st.state === 'granted' ? 'concedido'
                    : st.state === 'denied' ? 'bloqueado' : 'pendiente';
  } catch { /* Firefox no expone este permiso */ }

  const filas = [
    ['Dictado por voz', srSupported ? 'disponible' : 'no disponible en este navegador', srSupported ? 'ok' : 'bad'],
    ['Permiso del micrófono', permiso, permiso === 'concedido' ? 'ok' : permiso === 'bloqueado' ? 'bad' : 'warn'],
    ['Conexión', navigator.onLine ? 'en línea' : 'sin conexión', navigator.onLine ? 'ok' : 'bad'],
    ['Motor escuchando ahora', transcriber.running ? 'sí' : 'no', transcriber.running ? 'ok' : ''],
    ['Dictado activo', transcriber.active ? 'sí' : 'no', ''],
    ['Micrófono tomado por la app', recorder.stream ? 'sí (medidor/grabación)' : 'no', ''],
    ['Guardar audio', state.prefs.keepAudio ? 'activado' : 'apagado', ''],
    ['Idioma', $('#selLang').value, ''],
    ['Instalada como app', window.matchMedia?.('(display-mode: standalone)').matches ? 'sí' : 'no', ''],
    ['Palabras en el documento', String(countWords($('#docText').value)), ''],
  ];
  ul.innerHTML = filas.map(([k, v, c]) =>
    `<li><span>${escapeHtml(k)}</span><b class="${c}">${escapeHtml(v)}</b></li>`).join('');
}

function textoDiagnostico() {
  const est = [...$('#diagEstado').querySelectorAll('li')]
    .map(li => li.querySelector('span').textContent + ': ' + li.querySelector('b').textContent);
  const ev = state.diag.map(d =>
    new Date(d.t).toLocaleTimeString('es', { hour12: false }) +
    ` [${d.fuente}] ${d.evento}${d.detalle ? ' — ' + d.detalle : ''}`);
  return ['DIAGNÓSTICO — Voz a Texto', new Date().toLocaleString('es'),
          navigator.userAgent, '', '— Estado —', ...est, '', '— Eventos —', ...ev].join('\n');
}

/* ═══════════════ Audios guardados ═══════════════ */
async function renderAudios() {
  state.audioUrls.forEach(URL.revokeObjectURL);
  state.audioUrls = [];

  const list = $('#audioList');
  if (!state.session) { list.innerHTML = ''; return; }
  const audios = (await Audios.bySession(state.session.id)).sort((a, b) => a.createdAt - b.createdAt);

  $('#btnDeleteAllAudio').disabled = !audios.length;
  if (!audios.length) {
    list.innerHTML = '<li class="empty">Todavía no hay audios en este documento. Grabá con «Guardar audio» activado y van a aparecer acá.</li>';
    return;
  }

  const total = audios.reduce((n, a) => n + (a.size || 0), 0);
  list.innerHTML = audios.map((a, i) => {
    const url = URL.createObjectURL(a.blob);
    state.audioUrls.push(url);
    return `
    <li class="audio-item">
      <div class="audio-top">
        <span class="audio-name">Grabación ${i + 1}</span>
        <span class="audio-meta">${fmtDate(a.createdAt)} · ${fmtDur(a.duration)} · ${(a.size / 1048576).toFixed(2)} MB</span>
      </div>
      <audio controls preload="metadata" src="${url}"></audio>
      <div class="audio-btns">
        <button class="btn btn-mini" data-audio-dl="${a.id}">⬇ Descargar</button>
        <button class="btn btn-mini btn-danger" data-audio-del="${a.id}">🗑 Eliminar</button>
      </div>
    </li>`;
  }).join('');

  // Los .webm de MediaRecorder no traen la duración en la cabecera: se la
  // calculamos al reproductor para que la barra de avance funcione bien.
  list.querySelectorAll('audio').forEach(fixDuration);

  const est = await storageEstimate();
  const free = est ? ` · espacio libre aprox.: ${((est.quota - est.usage) / 1073741824).toFixed(1)} GB` : '';
  list.insertAdjacentHTML('beforeend',
    `<li class="audio-meta" style="text-align:right">${audios.length} grabaciones · ${(total / 1048576).toFixed(2)} MB en total${free}</li>`);
}

/** Fuerza al navegador a calcular la duración de un audio sin cabecera. */
function fixDuration(el) {
  el.addEventListener('loadedmetadata', () => {
    if (el.duration !== Infinity) return;
    const onSeek = () => {
      el.removeEventListener('timeupdate', onSeek);
      el.currentTime = 0;
    };
    el.addEventListener('timeupdate', onSeek);
    el.currentTime = 1e101;
  }, { once: true });
}

/* ═══════════════ Voces de lectura ═══════════════ */
function setupVoices() {
  if (!reader.supported) {
    $('#ttsVoice').innerHTML = '<option>No disponible en este navegador</option>';
    $('#ttsPlay').disabled = true;
    return;
  }
  reader.onVoicesReady(voices => {
    const lang = $('#selLang').value || 'es';
    const sorted = sortVoices(voices, lang);
    const prev = $('#ttsVoice').value;
    $('#ttsVoice').innerHTML = sorted.map(v =>
      `<option value="${escapeHtml(v.voiceURI)}">${escapeHtml(v.name)} — ${escapeHtml(v.lang)}${v.localService ? '' : ' (en línea)'}</option>`
    ).join('') || '<option value="">Sin voces instaladas</option>';
    if (prev && sorted.some(v => v.voiceURI === prev)) $('#ttsVoice').value = prev;

    // Sin voces instaladas no tiene sentido habilitar la lectura
    const none = sorted.length === 0;
    $('#ttsPlay').disabled = none;
    $('#ttsProgress').textContent = none
      ? 'Tu sistema no tiene voces instaladas. Agregá voces desde la configuración del sistema operativo.'
      : $('#ttsProgress').textContent;
  });
}

function ttsButtons(playing) {
  $('#ttsPlay').disabled = playing;
  $('#ttsPauseBtn').disabled = !playing;
  $('#ttsStop').disabled = !playing;
}

/* ═══════════════ Micrófonos ═══════════════ */
async function refreshMicList() {
  const mics = await recorder.listMics();
  const options = ['<option value="">Predeterminado del sistema</option>']
    .concat(mics.map((m, i) =>
      `<option value="${m.deviceId}">${escapeHtml(m.label || `Micrófono ${i + 1}`)}</option>`));
  for (const sel of [$('#selMic'), $('#calibMic')]) {
    const prev = sel.value || state.prefs.micId;
    sel.innerHTML = options.join('');
    if (prev && mics.some(m => m.deviceId === prev)) sel.value = prev;
  }
}

/* ═══════════════ Interfaz ═══════════════ */
function bindUI() {
  // Grabación
  $('#btnRec').addEventListener('click', () => {
    if (state.mode === 'idle') startRecording();
    else if (state.mode === 'recording') pauseRecording();
    else if (state.mode === 'paused') resumeRecording();
  });
  $('#btnPause').addEventListener('click', () => {
    if (state.mode === 'recording') pauseRecording();
    else if (state.mode === 'paused') resumeRecording();
  });
  $('#btnStop').addEventListener('click', stopRecording);
  $('#btnFixConflict').addEventListener('click', apagarAudioYSeguir);

  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.code === 'Space') { e.preventDefault(); $('#btnRec').click(); }
    if (e.key === 'Escape' && !$('#calibModal').classList.contains('hidden')) closeCalib();
  });

  // Opciones
  $('#selLang').addEventListener('change', e => {
    state.prefs.lang = e.target.value;
    if (state.session) { state.session.lang = e.target.value; touch(); }
    transcriber.setLang(e.target.value);
    savePrefs();
    setupVoices();
  });
  $('#selMic').addEventListener('change', e => {
    state.prefs.micId = e.target.value;
    $('#calibMic').value = e.target.value;
    savePrefs();
    if (state.mode !== 'idle') toast('El micrófono nuevo se usa en la próxima grabación.');
  });
  for (const [id, key] of [['#optVocab', 'vocab'], ['#optCommands', 'commands'],
                           ['#optSmart', 'smart'], ['#optKeepAudio', 'keepAudio']]) {
    $(id).addEventListener('change', e => { state.prefs[key] = e.target.checked; savePrefs(); });
  }

  // Documento
  $('#docTitle').addEventListener('input', e => {
    if (!state.session) return;
    state.session.title = e.target.value;
    touch();
  });
  $('#docText').addEventListener('input', e => {
    if (!state.session) return;
    state.session.text = e.target.value;
    updateStats();
    touch();
  });
  $('#btnUndo').addEventListener('click', () => {
    const prev = state.undoStack.pop();
    if (prev === undefined) return;
    $('#docText').value = prev;
    state.session.text = prev;
    updateStats();
    touch();
  });
  $('#btnClearDoc').addEventListener('click', () => {
    if (!$('#docText').value.trim()) return;
    if (!confirm('¿Vaciar todo el texto de este documento? Los audios no se borran.')) return;
    state.undoStack.push($('#docText').value);
    $('#docText').value = '';
    state.session.text = '';
    updateStats();
    touch();
  });

  // Documentos (sidebar)
  $('#btnNewSession').addEventListener('click', async () => {
    if (state.mode !== 'idle') return toast('Detené la grabación primero.', 'err');
    const s = newSession($('#selLang').value);
    await Sessions.put(s);
    state.sessions.unshift(s);
    await openSession(s.id);
    $('#docTitle').focus();
  });
  $('#sessionList').addEventListener('click', async e => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const id = del.dataset.del;
      const s = state.sessions.find(x => x.id === id);
      if (!confirm(`¿Eliminar «${s?.title || 'documento'}» y sus grabaciones?`)) return;
      await Audios.delBySession(id);
      await Sessions.del(id);
      state.sessions = state.sessions.filter(x => x.id !== id);
      if (!state.sessions.length) {
        const ns = newSession(state.prefs.lang);
        await Sessions.put(ns);
        state.sessions = [ns];
      }
      if (state.session?.id === id) await openSession(state.sessions[0].id);
      else renderSessions();
      toast('Documento eliminado.');
      return;
    }
    const item = e.target.closest('[data-session]');
    if (item) openSession(item.dataset.session);
  });

  // Pestañas
  $$('.tab').forEach(tab => tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.toggle('is-active', t === tab));
    $$('.tab-panel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === tab.dataset.tab));
    if (tab.dataset.tab === 'diag') { renderDiagEstado(); renderDiagLog(); }
  }));

  $('#btnCopyDiag').addEventListener('click', async () => {
    await renderDiagEstado();
    await copyToClipboard(textoDiagnostico());
    toast('Diagnóstico copiado. Pegalo donde lo necesites.', 'ok');
  });

  // Audios
  $('#audioList').addEventListener('click', async e => {
    const dl = e.target.closest('[data-audio-dl]');
    if (dl) {
      const a = await Audios.get(dl.dataset.audioDl);
      if (!a) return;
      try {
        const r = await download(a.blob, `${slug(state.session.title)}-audio.${extFor(a.mime)}`);
        if (r === 'saved') toast('Audio guardado', 'ok');
      } catch (err) {
        toast(err.message, 'err', 6000);
      }
      return;
    }
    const del = e.target.closest('[data-audio-del]');
    if (del) {
      if (!confirm('¿Eliminar esta grabación? El texto transcripto se conserva.')) return;
      await Audios.del(del.dataset.audioDel);
      await renderAudios();
      toast('Grabación eliminada.');
    }
  });
  $('#btnDeleteAllAudio').addEventListener('click', async () => {
    if (!confirm('¿Eliminar todas las grabaciones de este documento? El texto se conserva.')) return;
    const n = await Audios.delBySession(state.session.id);
    await renderAudios();
    toast(`${n} grabación(es) eliminadas.`);
  });

  // Lectura con otras voces
  $('#ttsRate').addEventListener('input', e => $('#ttsRateVal').textContent = (+e.target.value).toFixed(2) + '×');
  $('#ttsPitch').addEventListener('input', e => $('#ttsPitchVal').textContent = (+e.target.value).toFixed(2));
  $('#ttsPlay').addEventListener('click', () => {
    const text = $('#docText').value.trim();
    if (!text) return toast('El documento está vacío.', 'err');
    const voice = reader.voices().find(v => v.voiceURI === $('#ttsVoice').value) || null;
    const ok = reader.speak(text, { voice, rate: +$('#ttsRate').value, pitch: +$('#ttsPitch').value });
    if (ok) ttsButtons(true);
  });
  $('#ttsPauseBtn').addEventListener('click', () => {
    if (reader.paused) { reader.resume(); $('#ttsPauseBtn').innerHTML = '⏸ Pausar'; }
    else { reader.pause(); $('#ttsPauseBtn').innerHTML = '▶ Continuar'; }
  });
  $('#ttsStop').addEventListener('click', () => {
    reader.stop();
    $('#ttsProgress').textContent = '';
    $('#ttsPauseBtn').innerHTML = '⏸ Pausar';
  });

  // Exportar
  $$('.exp').forEach(btn => btn.addEventListener('click', async () => {
    if (!state.session) return;
    state.session.text = $('#docText').value;
    state.session.title = $('#docTitle').value;
    if (!state.session.text.trim()) return toast('El documento está vacío.', 'err');
    try {
      const audios = await Audios.bySession(state.session.id);
      const msg = await exportSession(state.session, btn.dataset.fmt, { audios });
      toast(msg, 'ok');
    } catch (err) {
      console.error(err);
      toast('No se pudo exportar: ' + err.message, 'err');
    }
  }));

  // Vocabulario
  $('#vocForm').addEventListener('submit', async e => {
    e.preventDefault();
    const from = $('#vocFrom').value.trim(), to = $('#vocTo').value.trim();
    if (!from || !to) return;
    if (from === to) return toast('Escribí una corrección distinta de lo que se escucha.', 'err');
    if (state.vocab.some(v => normWord(v.from) === normWord(from)))
      return toast('Ya existe una corrección para esa palabra.', 'err');
    state.vocab.push({ from, to });
    await saveVocab();
    $('#vocFrom').value = $('#vocTo').value = '';
    $('#vocFrom').focus();
    toast('Corrección agregada.', 'ok');
  });
  $('#vocList').addEventListener('click', async e => {
    const del = e.target.closest('[data-voc-del]');
    if (!del) return;
    state.vocab.splice(+del.dataset.vocDel, 1);
    await saveVocab();
  });

  // Calibración
  $('#btnOpenCalib').addEventListener('click', () => openCalib(false));
  bindCalib();

  // Aviso al cerrar mientras se graba
  window.addEventListener('beforeunload', e => {
    if (state.mode !== 'idle') { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => {
    // Chrome corta el reconocimiento en segundo plano; el watchdog lo revive
    if (!document.hidden && state.mode === 'recording' && !transcriber.running) {
      transcriber.start($('#selLang').value);
    }
  });
}

/* ═══════════════ Calibración ═══════════════ */
const calib = {
  open: false, auto: false, step: 1,
  noise: null, level: null,
  phraseIdx: 0, results: [], suggestions: [], micTestTimer: 0,
};

function openCalib(auto) {
  calib.open = true;
  calib.auto = auto;
  calib.step = 1;
  calib.noise = calib.level = null;
  calib.phraseIdx = 0;
  calib.results = [];
  calib.suggestions = [];
  $('#calibModal').classList.remove('hidden');
  $('#noiseVerdict').className = 'tag'; $('#noiseVerdict').textContent = 'pendiente';
  $('#levelVerdict').className = 'tag'; $('#levelVerdict').textContent = 'pendiente';
  $('#micAdvice').classList.add('hidden');
  $('#scoreBox').classList.add('hidden');
  $('#phraseHeard').classList.add('hidden');
  $('#phraseDiff').classList.add('hidden');
  renderPhrase();
  showStep(1);          // showStep(1) se encarga de abrir el micrófono
}

/** Mensaje fijo dentro del paso 1 (los avisos flotantes pueden quedar
    fuera de pantalla cuando la app corre incrustada). */
function setMicState(kind, text) {
  const el = $('#calibMicState');
  el.className = 'mic-state ' + kind;
  el.innerHTML = text;
}

let aperturaEnCurso = null;

async function openCalibMic() {
  // Dos llamadas al mismo tiempo dejaban un micrófono tomado sin dueño, y ese
  // stream huérfano era suficiente para que el dictado no escuchara nada.
  if (aperturaEnCurso) return aperturaEnCurso;
  aperturaEnCurso = abrirMicrofonoCalibracion();
  try { return await aperturaEnCurso; } finally { aperturaEnCurso = null; }
}

async function abrirMicrofonoCalibracion() {
  setMicState('', 'Conectando con el micrófono…');
  try {
    await recorder.openMic($('#calibMic').value || state.prefs.micId);
    await refreshMicList();
    const label = recorder.stream?.getAudioTracks?.()[0]?.label;
    setMicState('ok', `<b>Micrófono conectado</b>${escapeHtml(label || 'Listo para medir')}`);
    return true;
  } catch (err) {
    setMicState('err', `<b>No se pudo abrir el micrófono</b>${escapeHtml(micError(err))}`);
    updateCalibFooter();
    return false;
  }
}

function closeCalib() {
  calib.open = false;
  $('#calibModal').classList.add('hidden');
  if (state.mode === 'idle') recorder.closeMic();
  setMeter(0, 0);
}

function showStep(n) {
  calib.step = n;
  $$('.step').forEach(s => {
    const i = +s.dataset.step;
    s.classList.toggle('is-active', i === n);
    s.classList.toggle('is-done', i < n);
  });
  $$('.cstep').forEach(s => s.classList.toggle('is-active', +s.dataset.cstep === n));

  // El dictado necesita el micrófono libre: en Android, si la app lo tiene
  // tomado para el medidor, el motor de voz no escucha nada.
  if (n === 1) { if (!recorder.stream) openCalibMic(); }
  else { liberarMicrofono(); }

  $('#calibPrev').disabled = n === 1;
  $('#calibNext').textContent = n === 3 ? (calib.auto ? 'Guardar y grabar' : 'Guardar y cerrar') : 'Siguiente →';
  if (n === 3) renderSuggestions();
  updateCalibFooter();
}

/** ¿Qué falta en este paso? Se muestra en el pie, que siempre está a la vista,
    y se ofrece omitirlo para que nadie quede trabado. */
function stepPending(n) {
  if (n === 1 && (!calib.noise || !calib.level)) return 'medir';
  if (n === 2 && !calib.results.length) return 'frases';
  return null;
}

function updateCalibFooter() {
  const n = calib.step;
  const pending = stepPending(n);
  const skip = $('#calibSkip');

  skip.classList.toggle('hidden', !pending || n === 3);
  skip.textContent = n === 1 ? 'Seguir sin medir' : 'Seguir sin probar';

  $('#calibMsg').textContent =
    n === 1 ? (pending ? 'Medí el silencio y tu voz, o seguí sin medir.'
                       : 'Micrófono listo. Pasá a la prueba de dicción.') :
    n === 2 ? (pending ? 'Leé al menos una frase, o seguí sin probar.'
                       : 'Podés leer más frases o pasar al último paso.') :
              'Confirmá las correcciones y guardá tu perfil.';
}

function bindCalib() {
  $('#calibClose').addEventListener('click', closeCalib);
  $('#calibModal').addEventListener('click', e => { if (e.target.id === 'calibModal') closeCalib(); });
  $('#calibMic').addEventListener('change', async e => {
    state.prefs.micId = e.target.value;
    $('#selMic').value = e.target.value;
    savePrefs();
    await openCalibMic();
  });

  $('#btnNoise').addEventListener('click', async () => {
    const btn = $('#btnNoise');
    if (!recorder.stream && !(await openCalibMic())) return;
    btn.disabled = true;
    $('#noiseVerdict').className = 'tag run';
    const res = await Calib.measure(recorder, 4000, ({ remaining }) => {
      $('#noiseVerdict').textContent = `midiendo ${Math.ceil(remaining / 1000)} s`;
    });
    calib.noise = res;
    const v = Calib.judgeNoise(res.db);
    $('#noiseVerdict').className = 'tag ' + v.level;
    $('#noiseVerdict').textContent = v.tag;
    btn.disabled = false;
    btn.textContent = 'Medir de nuevo';
    showMicAdvice();
    updateCalibFooter();
  });

  $('#btnLevel').addEventListener('click', async () => {
    const btn = $('#btnLevel');
    if (!recorder.stream && !(await openCalibMic())) return;
    btn.disabled = true;
    $('#levelVerdict').className = 'tag run';
    const res = await Calib.measure(recorder, 5000, ({ remaining }) => {
      $('#levelVerdict').textContent = `hablá… ${Math.ceil(remaining / 1000)} s`;
    });
    calib.level = res;
    const v = Calib.judgeLevel(res.db, res.peakDb);
    $('#levelVerdict').className = 'tag ' + v.level;
    $('#levelVerdict').textContent = v.tag;
    btn.disabled = false;
    btn.textContent = 'Medir de nuevo';
    showMicAdvice();
    updateCalibFooter();
  });

  $('#btnPhrase').addEventListener('click', runPhrase);
  $('#btnMicTest').addEventListener('click', () => probarMicrofono());
  $('#btnPhraseSkip').addEventListener('click', () => { nextPhrase(); });

  $('#calibVocForm').addEventListener('submit', e => {
    e.preventDefault();
    const from = $('#calibVocFrom').value.trim(), to = $('#calibVocTo').value.trim();
    if (!from || !to) return;
    calib.suggestions = Calib.mergeSuggestions(calib.suggestions, [{ from, to }]);
    calib.suggestions.at(-1).checked = true;
    $('#calibVocFrom').value = $('#calibVocTo').value = '';
    renderSuggestions();
  });

  $('#calibPrev').addEventListener('click', () => showStep(Math.max(1, calib.step - 1)));
  $('#calibSkip').addEventListener('click', () => showStep(Math.min(3, calib.step + 1)));
  $('#calibNext').addEventListener('click', async () => {
    if (calib.step < 3) {
      // Si falta algo, el pie ya lo dice y queda el botón para seguir igual
      if (stepPending(calib.step)) { updateCalibFooter(); return; }
      return showStep(calib.step + 1);
    }
    await finishCalib();
  });
}

/** Suelta el micrófono y apaga el medidor del paso 2. */
function liberarMicrofono() {
  clearTimeout(calib.micTestTimer);
  if (state.mode === 'idle') recorder.closeMic();
  $('#phraseMeterBox').classList.add('hidden');
  $('#phraseMeterFill').style.width = '0%';
  $('#phraseMeterPeak').style.left = '0%';
  setMeter(0, 0);
}

/** Prueba puntual del micrófono en el paso 2, sin usar el dictado. */
async function probarMicrofono(segundos = 6) {
  const box = $('#phraseMeterBox'), msg = $('#phraseMeterMsg'), btn = $('#btnMicTest');
  box.classList.remove('hidden');
  msg.className = 'meter-msg';
  msg.textContent = 'Abriendo el micrófono…';
  btn.disabled = true;

  if (!recorder.stream && !(await openCalibMic())) {
    msg.className = 'meter-msg bad';
    msg.textContent = 'No se pudo abrir el micrófono. Revisá el permiso del navegador.';
    btn.disabled = false;
    return;
  }

  const res = await Calib.measure(recorder, segundos * 1000, ({ remaining }) => {
    msg.textContent = `Hablá normal… ${Math.ceil(remaining / 1000)} s`;
  });
  const v = Calib.judgeLevel(res.db, res.peakDb);
  msg.className = 'meter-msg ' + (v.level === 'ok' ? 'ok' : v.level === 'bad' ? 'bad' : '');
  msg.textContent = `${v.tag}: ${v.text}`;
  btn.disabled = false;

  // Se suelta enseguida: el dictado lo necesita libre
  calib.micTestTimer = setTimeout(() => {
    if (state.mode === 'idle') recorder.closeMic();
    $('#phraseMeterFill').style.width = '0%';
  }, 600);
}

function showMicAdvice() {
  const box = $('#micAdvice');
  const parts = [];
  if (calib.noise) parts.push(Calib.judgeNoise(calib.noise.db).text);
  if (calib.level) parts.push(Calib.judgeLevel(calib.level.db, calib.level.peakDb).text);
  if (calib.noise && calib.level) parts.push(Calib.signalToNoise(calib.level.db, calib.noise.db).text);
  if (!parts.length) return;
  box.innerHTML = '<b>Resultado</b>' + parts.map(escapeHtml).join(' ');
  box.classList.remove('hidden');
}

function renderPhrase() {
  const phrases = Calib.phrasesFor($('#selLang').value);
  $('#phraseTotal').textContent = phrases.length;
  $('#phraseIdx').textContent = Math.min(calib.phraseIdx + 1, phrases.length);
  $('#phraseText').textContent = phrases[calib.phraseIdx] || '¡Listo! Ya probaste todas las frases.';
  const done = calib.phraseIdx >= phrases.length;
  $('#btnPhrase').disabled = done;
  $('#btnPhraseSkip').disabled = done;
  $('#btnPhrase').innerHTML = '🎤 Leer esta frase';
}

async function runPhrase() {
  const phrases = Calib.phrasesFor($('#selLang').value);
  const phrase = phrases[calib.phraseIdx];
  if (!phrase) return;
  const btn = $('#btnPhrase');
  btn.disabled = true;
  $('#btnMicTest').disabled = true;
  btn.innerHTML = '🔴 Escuchando…';
  $('#phraseDiff').classList.add('hidden');
  const heardBox = $('#phraseHeard');
  heardBox.classList.remove('hidden');
  heardBox.innerHTML = '<b>Preparando</b>Abriendo el dictado…';

  // Clave en el celular: el motor de voz necesita el micrófono para él solo
  liberarMicrofono();

  let vivo = '';
  const pintarVivo = () => {
    heardBox.innerHTML = '<b>Te escucho</b><span class="phrase-live-dot"></span>' +
      (vivo ? `<span class="phrase-live">${escapeHtml(vivo)}</span>`
            : '<span class="phrase-live">Leé la frase en voz alta y natural…</span>');
  };

  try {
    const res = await Calib.testPhrase(
      phrase, $('#selLang').value,
      st => {
        if (st === 'listening') pintarVivo();
        if (st === 'done') heardBox.innerHTML = '<b>Procesando</b>Comparando lo que dijiste…';
      },
      parcial => { vivo = parcial; pintarVivo(); });
    calib.results.push(res);
    calib.suggestions = Calib.mergeSuggestions(
      calib.suggestions,
      res.suggestions.map(s => ({ ...s, checked: true })));

    $('#phraseHeard').innerHTML = res.heard
      ? `<b>Lo que entendió</b>${escapeHtml(res.heard)}`
      : '<b>No se escuchó nada</b>Probá «🔊 Probar micrófono» para ver si te toma el volumen. ' +
        'Si el medidor se mueve pero el dictado no entiende, revisá que tengas internet: ' +
        'el reconocimiento de voz lo resuelve un servicio en línea.';
    $('#phraseHeard').classList.remove('hidden');
    $('#phraseDiff').innerHTML = res.ops.map(op => {
      if (op.op === 'ok') return `<span class="w w-ok">${escapeHtml(op.expected)}</span>`;
      if (op.op === 'sub') return `<span class="w w-bad">${escapeHtml(op.heard)}</span><span class="w w-miss">${escapeHtml(op.expected)}</span>`;
      if (op.op === 'missing') return `<span class="w w-miss">${escapeHtml(op.expected)}</span>`;
      return `<span class="w w-bad">${escapeHtml(op.heard)}</span>`;
    }).join('');
    $('#phraseDiff').classList.remove('hidden');
    updateScore();
    updateCalibFooter();
    btn.innerHTML = '🎤 Repetir frase';
    btn.disabled = false;
    $('#btnMicTest').disabled = false;
    $('#btnPhraseSkip').textContent = 'Siguiente frase →';
  } catch (err) {
    btn.disabled = false;
    $('#btnMicTest').disabled = false;
    btn.innerHTML = '🎤 Leer esta frase';
    const msg =
      err.message === 'unsupported'
        ? 'Este navegador no tiene dictado por voz. Podés seguir sin probar: vas a poder grabar audio y escribir, pero no transcribir.'
      : err.message === 'no-start'
        ? 'El dictado no llegó a arrancar. Suele pasar cuando el navegador no tiene servicio de voz o la app corre incrustada: probá abrirla en una pestaña propia, o seguí sin probar.'
      : err.message === 'not-allowed' || err.message === 'service-not-allowed'
        ? 'El navegador bloqueó el micrófono para el dictado. Habilitá el permiso y volvé a intentar.'
      : err.message === 'network'
        ? 'El servicio de dictado no respondió. Revisá la conexión y volvé a intentar.'
        : 'No se pudo escuchar la frase. Revisá que el micrófono tenga permiso y volvé a intentar.';
    $('#phraseHeard').innerHTML = `<b>No se pudo probar</b>${escapeHtml(msg)}`;
    $('#phraseHeard').classList.remove('hidden');
    $('#phraseDiff').classList.add('hidden');
    updateCalibFooter();
  }
}

function nextPhrase() {
  const phrases = Calib.phrasesFor($('#selLang').value);
  calib.phraseIdx = Math.min(calib.phraseIdx + 1, phrases.length);
  $('#btnPhraseSkip').textContent = 'Saltear';
  $('#phraseHeard').classList.add('hidden');
  $('#phraseDiff').classList.add('hidden');
  renderPhrase();
  if (calib.phraseIdx >= phrases.length && calib.results.length) {
    $('#calibMsg').textContent = 'Terminaste las frases. Pasá al paso 3.';
  }
}

function calibAccuracy() {
  if (!calib.results.length) return 0;
  const totals = calib.results.reduce((acc, r) => {
    acc.words += r.total; acc.errors += r.errors; return acc;
  }, { words: 0, errors: 0 });
  return totals.words ? Math.max(0, Math.round((1 - totals.errors / totals.words) * 100)) : 0;
}

function updateScore() {
  const pct = calibAccuracy();
  const j = Calib.judgeAccuracy(pct);
  $('#scoreVal').textContent = pct;
  $('#scoreLabel').textContent = j.label;
  $('#scoreTip').textContent = j.tip;
  $('#scoreBox').classList.remove('hidden');
}

function renderSuggestions() {
  const list = $('#suggestList');
  if (!calib.suggestions.length) {
    list.innerHTML = '<li class="empty">El dictado entendió todas las palabras. Igual podés agregar nombres propios o términos que uses seguido.</li>';
    return;
  }
  list.innerHTML = calib.suggestions.map((s, i) => `
    <li class="suggest-item">
      <input type="checkbox" data-sug="${i}" ${s.checked === false ? '' : 'checked'}>
      <span>escuchó <s>${escapeHtml(s.from)}</s> → escribir <b>${escapeHtml(s.to)}</b></span>
    </li>`).join('');
  list.onchange = e => {
    const cb = e.target.closest('[data-sug]');
    if (cb) calib.suggestions[+cb.dataset.sug].checked = cb.checked;
  };
}

async function finishCalib() {
  const accepted = calib.suggestions.filter(s => s.checked !== false);
  for (const s of accepted) {
    if (state.vocab.some(v => normWord(v.from) === normWord(s.from))) continue;
    state.vocab.push({ from: s.from, to: s.to });
  }
  await saveVocab();

  state.profile = Calib.buildProfile({
    deviceId: $('#calibMic').value,
    noise: calib.noise,
    level: calib.level,
    accuracy: calibAccuracy(),
    lang: $('#selLang').value,
  });
  await Settings.set('profile', state.profile);
  updateCalibStatus();

  const wasAuto = calib.auto;
  closeCalib();
  toast(`Perfil guardado${accepted.length ? ` con ${accepted.length} corrección(es)` : ''}. ${calibAccuracy()}% de precisión.`, 'ok', 4500);
  if (wasAuto) {
    await sleep(400);
    startRecording();
  }
}

function updateCalibStatus() {
  const el = $('#calibStatus');
  if (!state.profile) {
    el.textContent = 'Sin calibrar';
    el.className = 'calib-status';
    return;
  }
  const pct = state.profile.accuracy ?? 0;
  el.textContent = `Calibrado · ${pct}% de precisión`;
  el.className = 'calib-status ' + (pct >= 90 ? 'good' : 'mid');
}
