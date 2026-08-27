/* Grabación de audio con MediaRecorder + medidor de nivel en tiempo real.
   Soporta pausar y reanudar sin cortar el archivo. */

export const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  '',
];

export function pickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of MIME_CANDIDATES) {
    if (!m) return '';
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

export function extFor(mime = '') {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'mp4';
  return 'webm';
}

export class Recorder extends EventTarget {
  constructor() {
    super();
    this.stream = null;
    this.rec = null;
    this.chunks = [];
    this.state = 'inactive';      // inactive | recording | paused
    this.deviceId = '';
    this.constraintsExtra = {};
    this._ctx = null;
    this._analyser = null;
    this._raf = 0;
    this.level = 0;
    this.peak = 0;
    this._peakAt = 0;
  }

  get supported() { return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices; }

  async openMic(deviceId = this.deviceId, extra = this.constraintsExtra) {
    this.deviceId = deviceId || '';
    this.constraintsExtra = extra || {};
    this.closeMic();
    const audio = {
      channelCount: { ideal: 1 },
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true },
      ...this.constraintsExtra,
    };
    if (this.deviceId) audio.deviceId = { exact: this.deviceId };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    this._startMeter();
    return this.stream;
  }

  /** Lista de micrófonos (requiere permiso previo para ver los nombres). */
  async listMics() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'audioinput');
  }

  _startMeter() {
    if (!this.stream) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this._ctx = new AC();
    const src = this._ctx.createMediaStreamSource(this.stream);
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = 1024;
    this._analyser.smoothingTimeConstant = 0.6;
    src.connect(this._analyser);
    const buf = new Float32Array(this._analyser.fftSize);

    const tick = () => {
      // El cuadro pendiente puede llegar después de cerrar el micrófono
      if (!this._analyser) return;
      this._analyser.getFloatTimeDomainData(buf);
      let sum = 0, max = 0;
      for (let i = 0; i < buf.length; i++) {
        sum += buf[i] * buf[i];
        const a = Math.abs(buf[i]);
        if (a > max) max = a;
      }
      const rms = Math.sqrt(sum / buf.length);
      // dBFS → 0..1 (rango útil: -60 dB a 0 dB)
      const db = 20 * Math.log10(rms || 1e-8);
      this.level = Math.min(1, Math.max(0, (db + 60) / 60));
      this.rms = rms;
      this.instantPeak = max;
      const now = performance.now();
      if (this.level >= this.peak || now - this._peakAt > 900) {
        this.peak = this.level; this._peakAt = now;
      }
      this.dispatchEvent(new CustomEvent('level', {
        detail: { level: this.level, peak: this.peak, rms, max },
      }));
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  closeMic() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this._ctx) { this._ctx.close().catch(() => {}); this._ctx = null; }
    this._analyser = null;
    this.level = this.peak = 0;
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }

  async start() {
    if (!this.stream) await this.openMic();
    this.chunks = [];
    this.mime = pickMime();
    const opts = this.mime ? { mimeType: this.mime, audioBitsPerSecond: 128000 } : {};
    this.rec = new MediaRecorder(this.stream, opts);
    this.rec.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.onerror = e => this.dispatchEvent(new CustomEvent('error', { detail: e.error || e }));
    this.rec.start(1000);         // un fragmento por segundo: nada se pierde si el navegador se cierra
    this.state = 'recording';
    this.dispatchEvent(new Event('start'));
  }

  pause() {
    if (this.rec && this.rec.state === 'recording') {
      this.rec.pause();
      this.state = 'paused';
      this.dispatchEvent(new Event('pause'));
    }
  }

  resume() {
    if (this.rec && this.rec.state === 'paused') {
      this.rec.resume();
      this.state = 'recording';
      this.dispatchEvent(new Event('resume'));
    }
  }

  /** Detiene y devuelve el Blob del audio (o null si no se grabó nada). */
  stop() {
    return new Promise(resolve => {
      if (!this.rec || this.rec.state === 'inactive') {
        this.state = 'inactive';
        return resolve(null);
      }
      this.rec.onstop = () => {
        const type = this.mime || this.chunks[0]?.type || 'audio/webm';
        const blob = this.chunks.length ? new Blob(this.chunks, { type }) : null;
        this.chunks = [];
        this.state = 'inactive';
        this.rec = null;
        this.dispatchEvent(new Event('stop'));
        resolve(blob);
      };
      try { this.rec.stop(); } catch { resolve(null); }
    });
  }
}

/** Duración real de un blob de audio (los webm de MediaRecorder no traen cabecera de duración). */
export function blobDuration(blob) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    const a = new Audio();
    let done = false;
    const finish = d => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) && d > 0 ? d * 1000 : 0);
    };
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      if (a.duration === Infinity) {
        // Truco conocido: forzar la búsqueda al final para que se calcule la duración
        a.currentTime = 1e101;
        a.ontimeupdate = () => { a.ontimeupdate = null; finish(a.duration); };
      } else finish(a.duration);
    };
    a.onerror = () => finish(0);
    a.src = url;
    setTimeout(() => finish(a.duration), 3000);
  });
}
