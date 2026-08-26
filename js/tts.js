/* Lectura del documento con otras voces (SpeechSynthesis).

   El texto se parte en fragmentos cortos porque varios navegadores cortan
   la lectura después de unos segundos si se les manda todo de una vez. */

export class Reader extends EventTarget {
  constructor() {
    super();
    this.synth = window.speechSynthesis || null;
    this.chunks = [];
    this.index = 0;
    this.playing = false;
    this.paused = false;
    this.opts = { voice: null, rate: 1, pitch: 1, volume: 1 };
    this._keepAlive = 0;
  }

  get supported() { return !!this.synth; }

  /** Voces disponibles; el navegador puede tardar en cargarlas. */
  voices() {
    if (!this.synth) return [];
    return this.synth.getVoices();
  }

  onVoicesReady(cb) {
    if (!this.synth) return;
    const fire = () => cb(this.voices());
    fire();
    this.synth.addEventListener?.('voiceschanged', fire);
    // Algunos navegadores sólo pueblan la lista después de un momento
    setTimeout(fire, 250);
    setTimeout(fire, 1200);
  }

  static split(text, maxLen = 180) {
    const out = [];
    for (const para of String(text).split(/\n+/)) {
      const clean = para.trim();
      if (!clean) continue;
      const sentences = clean.match(/[^.!?…]+[.!?…]*\s*/g) || [clean];
      let buf = '';
      for (const s of sentences) {
        if ((buf + s).length > maxLen && buf) { out.push(buf.trim()); buf = s; }
        else buf += s;
        while (buf.length > maxLen * 2) {          // frase larguísima sin puntuación
          const cut = buf.lastIndexOf(' ', maxLen);
          out.push(buf.slice(0, cut > 0 ? cut : maxLen).trim());
          buf = buf.slice(cut > 0 ? cut : maxLen);
        }
      }
      if (buf.trim()) out.push(buf.trim());
    }
    return out;
  }

  speak(text, opts = {}) {
    if (!this.synth) {
      this.dispatchEvent(new CustomEvent('error', {
        detail: 'Este navegador no puede leer texto en voz alta.' }));
      return false;
    }
    this.stop();
    this.opts = { ...this.opts, ...opts };
    this.chunks = Reader.split(text);
    if (!this.chunks.length) {
      this.dispatchEvent(new CustomEvent('error', { detail: 'No hay texto para leer.' }));
      return false;
    }
    this.index = 0;
    this.playing = true;
    this.paused = false;
    this._next();
    this._startKeepAlive();
    this.dispatchEvent(new Event('start'));
    return true;
  }

  _next() {
    if (!this.playing || this.index >= this.chunks.length) {
      if (this.playing) {
        this.playing = false;
        this._stopKeepAlive();
        this.dispatchEvent(new Event('end'));
      }
      return;
    }
    const u = new SpeechSynthesisUtterance(this.chunks[this.index]);
    if (this.opts.voice) { u.voice = this.opts.voice; u.lang = this.opts.voice.lang; }
    u.rate = this.opts.rate;
    u.pitch = this.opts.pitch;
    u.volume = this.opts.volume;
    u.onend = () => {
      if (!this.playing) return;
      this.index++;
      this.dispatchEvent(new CustomEvent('progress', {
        detail: { index: this.index, total: this.chunks.length },
      }));
      this._next();
    };
    u.onerror = e => {
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      this.playing = false;
      this._stopKeepAlive();
      this.dispatchEvent(new CustomEvent('error', { detail: 'No se pudo reproducir la voz.' }));
    };
    this._utter = u;
    this.synth.speak(u);
    this.dispatchEvent(new CustomEvent('progress', {
      detail: { index: this.index, total: this.chunks.length },
    }));
  }

  /* Chrome suspende la síntesis en lecturas largas: este latido la mantiene viva */
  _startKeepAlive() {
    this._stopKeepAlive();
    this._keepAlive = setInterval(() => {
      if (!this.playing || this.paused) return;
      if (this.synth.speaking) { this.synth.pause(); this.synth.resume(); }
    }, 9000);
  }
  _stopKeepAlive() { clearInterval(this._keepAlive); this._keepAlive = 0; }

  pause() {
    if (this.synth && this.playing && !this.paused) {
      this.synth.pause();
      this.paused = true;
      this.dispatchEvent(new Event('pause'));
    }
  }

  resume() {
    if (this.synth && this.playing && this.paused) {
      this.synth.resume();
      this.paused = false;
      this.dispatchEvent(new Event('resume'));
    }
  }

  stop() {
    if (!this.synth) return;
    this.playing = false;
    this.paused = false;
    this._stopKeepAlive();
    try { this.synth.cancel(); } catch {}
    this.dispatchEvent(new Event('stop'));
  }
}

/** Ordena las voces poniendo primero las del idioma del documento. */
export function sortVoices(voices, lang = 'es') {
  const base = lang.slice(0, 2).toLowerCase();
  return [...voices].sort((a, b) => {
    const am = a.lang.toLowerCase().startsWith(base) ? 0 : 1;
    const bm = b.lang.toLowerCase().startsWith(base) ? 0 : 1;
    if (am !== bm) return am - bm;
    const aExact = a.lang.toLowerCase() === lang.toLowerCase() ? 0 : 1;
    const bExact = b.lang.toLowerCase() === lang.toLowerCase() ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return a.name.localeCompare(b.name);
  });
}
