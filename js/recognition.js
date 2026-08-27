/* Reconocimiento de voz continuo (Web Speech API).

   El motor del navegador corta la escucha cada tanto por su cuenta; acá se
   reinicia solo mientras el usuario no haya pulsado Pausa o Detener, así el
   dictado queda encendido todo el tiempo que haga falta. */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const isSupported = !!SR;

export class Transcriber extends EventTarget {
  constructor({ lang = 'es-AR', maxAlternatives = 3 } = {}) {
    super();
    this.lang = lang;
    this.maxAlternatives = maxAlternatives;
    this.active = false;          // el usuario quiere dictar
    this.running = false;         // el motor está escuchando ahora
    this.rec = null;
    this.preferredTerms = [];     // vocabulario propio: desempata alternativas
    this._restartTimer = 0;
    this._watchdog = 0;
    this._lastActivity = 0;
    this._backoff = 300;
    this._fatal = null;
  }

  get supported() { return isSupported; }

  _build() {
    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = this.maxAlternatives;

    rec.onstart = () => {
      this.running = true;
      this._backoff = 300;
      this._lastActivity = Date.now();
      this.dispatchEvent(new Event('listening'));
    };

    rec.onresult = e => {
      this._lastActivity = Date.now();
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          const text = this._bestAlternative(result);
          if (text.trim()) {
            this.dispatchEvent(new CustomEvent('final', {
              detail: { text: text.trim(), confidence: result[0].confidence ?? null },
            }));
          }
        } else {
          interim += result[0].transcript;
        }
      }
      this.dispatchEvent(new CustomEvent('interim', { detail: { text: interim.trim() } }));
    };

    rec.onerror = e => {
      const err = e.error;
      // 'no-speech' y 'aborted' son normales: simplemente se reinicia
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        this._fatal = err;
        this.active = false;
        this.dispatchEvent(new CustomEvent('error', {
          detail: { code: err, message: 'El navegador bloqueó el micrófono. Habilitá el permiso y volvé a intentar.' },
        }));
      } else if (err === 'audio-capture') {
        this._fatal = err;
        this.active = false;
        this.dispatchEvent(new CustomEvent('error', {
          detail: { code: err, message: 'No se detecta ningún micrófono conectado.' },
        }));
      } else if (err === 'network') {
        this.dispatchEvent(new CustomEvent('warn', {
          detail: { code: err, message: 'Problema de red con el servicio de dictado. Reintentando…' },
        }));
      } else if (err === 'language-not-supported') {
        this._fatal = err;
        this.active = false;
        this.dispatchEvent(new CustomEvent('error', {
          detail: { code: err, message: 'Ese idioma no está disponible en este navegador.' },
        }));
      }
    };

    rec.onend = () => {
      this.running = false;
      this.dispatchEvent(new Event('ended'));
      if (this.active) this._scheduleRestart();
    };

    return rec;
  }

  /** Entre las alternativas, prefiere la que contenga palabras de mi vocabulario. */
  _bestAlternative(result) {
    const n = Math.min(result.length, this.maxAlternatives);
    if (n <= 1 || !this.preferredTerms.length) return result[0].transcript;

    let best = result[0].transcript, bestScore = -1;
    for (let i = 0; i < n; i++) {
      const text = result[i].transcript;
      const hay = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      let score = (result[i].confidence ?? 0.5) * 0.5;
      for (const term of this.preferredTerms) {
        if (term && hay.includes(term)) score += 1;
      }
      if (i === 0) score += 0.15;            // ligera preferencia por la primera
      if (score > bestScore) { bestScore = score; best = text; }
    }
    return best;
  }

  _scheduleRestart() {
    clearTimeout(this._restartTimer);
    this._restartTimer = setTimeout(() => {
      if (!this.active) return;
      try {
        this.rec = this._build();
        this.rec.start();
      } catch {
        this._backoff = Math.min(this._backoff * 2, 5000);
        this._scheduleRestart();
      }
    }, this._backoff);
  }

  /** Vigila que el motor siga vivo aunque no dispare 'end' (pasa en sesiones largas). */
  _startWatchdog() {
    clearInterval(this._watchdog);
    this._watchdog = setInterval(() => {
      if (!this.active) return;
      if (!this.running) { this._scheduleRestart(); return; }
      // Si hace más de 25 s que no llega nada, se reinicia por las dudas
      if (Date.now() - this._lastActivity > 25000) {
        this._lastActivity = Date.now();
        try { this.rec.stop(); } catch {}
      }
    }, 5000);
  }

  start(lang = this.lang) {
    if (!isSupported) {
      this.dispatchEvent(new CustomEvent('error', {
        detail: { code: 'unsupported', message: 'Este navegador no tiene dictado por voz. Usá Chrome o Edge de escritorio.' },
      }));
      return false;
    }
    this.lang = lang;
    this._fatal = null;
    this.active = true;
    this._lastActivity = Date.now();
    if (!this.running) {
      try {
        this.rec = this._build();
        this.rec.start();
      } catch {
        this._scheduleRestart();
      }
    }
    this._startWatchdog();
    return true;
  }

  stop() {
    this.active = false;
    clearTimeout(this._restartTimer);
    clearInterval(this._watchdog);
    if (this.rec) {
      try { this.rec.stop(); } catch {}
      try { this.rec.abort(); } catch {}
    }
    this.running = false;
    this.dispatchEvent(new CustomEvent('interim', { detail: { text: '' } }));
  }

  setLang(lang) {
    this.lang = lang;
    if (this.active) { this.stop(); this.start(lang); }
  }

  /** Términos del vocabulario propio, normalizados, para desempatar alternativas. */
  setPreferredTerms(terms) {
    this.preferredTerms = (terms || [])
      .map(t => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim())
      .filter(Boolean);
  }
}

/** Escucha una sola frase y devuelve lo que se entendió (se usa en la calibración). */
export function listenOnce({ lang = 'es-AR', maxMs = 12000, silenceMs = 2500,
                             startMs = 4000, onState = null, onPartial = null } = {}) {
  return new Promise((resolve, reject) => {
    if (!isSupported) return reject(new Error('unsupported'));
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let finalText = '', interimText = '', silenceTimer = 0, done = false, started = false;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(silenceTimer);
      clearTimeout(hardStop);
      clearTimeout(startTimer);
      try { rec.stop(); } catch {}
      onState?.('done');
      resolve((finalText || interimText).trim());
    };
    const hardStop = setTimeout(finish, maxMs);

    // Si el motor de voz no llega a arrancar, no tiene sentido esperar
    const startTimer = setTimeout(() => {
      if (started || done) return;
      done = true;
      clearTimeout(hardStop);
      try { rec.abort(); } catch {}
      reject(new Error('no-start'));
    }, startMs);

    rec.onstart = () => {
      started = true;
      clearTimeout(startTimer);
      onState?.('listening');
    };

    rec.onresult = e => {
      interimText = '';
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText = e.results[i][0].transcript;
        else interimText += e.results[i][0].transcript;
      }
      onPartial?.((finalText + ' ' + interimText).trim());
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(finish, silenceMs);   // fin por pausa al hablar
    };
    rec.onerror = e => {
      if (e.error === 'no-speech') return finish();
      if (done) return;
      done = true;
      clearTimeout(hardStop);
      clearTimeout(startTimer);
      reject(new Error(e.error || 'error'));
    };
    rec.onend = () => finish();

    onState?.('starting');
    try { rec.start(); } catch (err) { clearTimeout(startTimer); reject(err); }
  });
}
