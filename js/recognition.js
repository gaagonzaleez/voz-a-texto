/* Reconocimiento de voz continuo (Web Speech API).

   El motor del navegador corta la escucha cada tanto por su cuenta; acá se
   reinicia solo mientras el usuario no haya pulsado Pausa o Detener, así el
   dictado queda encendido todo el tiempo que haga falta. */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const isSupported = !!SR;

export class Transcriber extends EventTarget {
  constructor({ lang = 'es-AR', maxAlternatives = 1 } = {}) {
    super();
    this.lang = lang;
    this.maxAlternatives = maxAlternatives;
    this.active = false;          // el usuario quiere dictar
    this.running = false;         // el motor está escuchando ahora
    this.preferredTerms = [];     // vocabulario propio: desempata alternativas
    this._rec = null;
    this._gen = 0;                // generación: invalida motores viejos
    this._restartTimer = 0;
    this._watchdog = 0;
    this._lastFinal = '';
    this._lastFinalAt = 0;
    this._idleTicks = 0;
    this._lastActivity = 0;
    this._backoff = 300;
  }

  get supported() { return isSupported; }
  get rec() { return this._rec; }

  /** Traza para el panel de diagnóstico */
  _log(evento, detalle = '') {
    this.dispatchEvent(new CustomEvent('log', { detail: { evento, detalle, t: Date.now() } }));
  }

  /* Desconecta y frena el motor actual.
     Subir la generación es lo importante: los eventos que lleguen tarde del
     motor viejo quedan huérfanos y no tocan el estado del nuevo. Sin esto,
     el 'end' de un motor descartado disparaba otro reinicio y terminaban dos
     o tres motores peleando por el micrófono — que en Android deja la
     sesión de voz muerta hasta recargar. */
  _kill() {
    this._gen++;
    const rec = this._rec;
    this._rec = null;
    this.running = false;
    if (!rec) return;
    rec.onstart = rec.onresult = rec.onerror = rec.onend = null;
    try { rec.abort(); } catch {}
    try { rec.stop(); } catch {}
  }

  /** Crea y arranca un motor nuevo, descartando el anterior. */
  _spawn() {
    this._kill();
    this._lastFinal = '';        // el acumulado es propio de cada sesión del motor
    this._lastFinalAt = 0;
    const gen = this._gen;
    const mio = () => gen === this._gen;      // ¿sigo siendo el motor vigente?

    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = true;        // en Android se ignora: por eso el reinicio
    rec.interimResults = true;
    rec.maxAlternatives = this.maxAlternatives;

    rec.onstart = () => {
      if (!mio()) return;
      this.running = true;
      this._idleTicks = 0;
      this._backoff = 300;
      this._lastActivity = Date.now();
      this._log('escuchando');
      this.dispatchEvent(new Event('listening'));
    };

    rec.onresult = e => {
      if (!mio()) return;
      this._lastActivity = Date.now();
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          const nuevo = this._soloLoNuevo(this._bestAlternative(result));
          if (nuevo) {
            this._log('texto', nuevo.slice(0, 40));
            this.dispatchEvent(new CustomEvent('final', {
              detail: { text: nuevo, confidence: result[0].confidence ?? null },
            }));
          }
        } else {
          interim += result[0].transcript;
        }
      }
      this.dispatchEvent(new CustomEvent('interim', { detail: { text: interim.trim() } }));
    };

    rec.onerror = e => {
      if (!mio()) return;
      const err = e.error;
      this._log('error', err);
      // 'no-speech' y 'aborted' son normales: se reinicia y sigue
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        this.active = false;
        this.dispatchEvent(new CustomEvent('error', {
          detail: { code: err, message: 'El navegador bloqueó el micrófono para el dictado. Habilitá el permiso y volvé a intentar.' },
        }));
      } else if (err === 'audio-capture') {
        this.active = false;
        this.dispatchEvent(new CustomEvent('error', {
          detail: { code: err, message: 'El dictado no pudo tomar el micrófono. Si estás grabando audio, apagá «Guardar audio».' },
        }));
      } else if (err === 'network') {
        this.dispatchEvent(new CustomEvent('warn', {
          detail: { code: err, message: 'El servicio de dictado no responde. Revisá la conexión: reintentando…' },
        }));
      } else if (err === 'language-not-supported') {
        this.active = false;
        this.dispatchEvent(new CustomEvent('error', {
          detail: { code: err, message: 'Ese idioma no está disponible en este navegador.' },
        }));
      }
    };

    rec.onend = () => {
      if (!mio()) return;
      this.running = false;
      this._log('fin de turno');
      this.dispatchEvent(new Event('ended'));
      this._planRestart();
    };

    this._rec = rec;
    try {
      rec.start();
      this._log('arrancando');
    } catch (err) {
      this._log('no arrancó', err?.name || String(err));
      this._backoff = Math.min(this._backoff * 2, 4000);
      this._planRestart();
    }
  }

  /* Varios Android reemiten el resultado ACUMULADO de la frase cada vez que
     crece ("Hola" → "Hola ella" → "Hola ella está"…), todos marcados como
     definitivos. Si se agrega cada uno entero, el documento queda con la
     frase repetida creciendo. Acá se devuelve sólo la parte nueva. */
  _soloLoNuevo(textoCrudo) {
    const texto = (textoCrudo || '').trim();
    if (!texto) return '';

    const previo = this._lastFinal || '';
    const ahora = Date.now();
    const norm = t => t.toLowerCase().replace(/\s+/g, ' ').trim();
    const a = norm(previo), b = norm(texto);

    // Lo mismo que recién: es una reemisión, no que hayas repetido la frase.
    // Pasados unos segundos sí se toma como algo dicho de nuevo.
    if (a && a === b && ahora - (this._lastFinalAt || 0) < 5000) {
      this._lastFinalAt = ahora;
      this._log('repetido', 'omitido');
      return '';
    }

    // La frase creció: sólo se agrega la cola nueva
    if (a && b.startsWith(a)) {
      const cola = texto.slice(previo.length).trim();
      this._lastFinal = texto;
      this._lastFinalAt = ahora;
      return cola;
    }

    // Eco del final de la frase anterior, justo después: ya está escrito
    if (a && a.endsWith(b) && ahora - (this._lastFinalAt || 0) < 4000) {
      this._log('eco', 'omitido');
      return '';
    }

    this._lastFinal = texto;
    this._lastFinalAt = ahora;
    return texto;
  }

  /** Un único reinicio pendiente a la vez. */
  _planRestart(ms = this._backoff) {
    if (!this.active) return;
    clearTimeout(this._restartTimer);
    this._restartTimer = setTimeout(() => {
      if (this.active) this._spawn();
    }, ms);
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

  /* Vigila que el motor siga vivo. Sólo actúa tras dos rondas caído, para no
     pisar un reinicio que ya está en camino. */
  _startWatchdog() {
    clearInterval(this._watchdog);
    this._idleTicks = 0;
    this._watchdog = setInterval(() => {
      if (!this.active) return;

      if (!this.running) {
        this._idleTicks++;
        if (this._idleTicks >= 2) {
          this._idleTicks = 0;
          this._log('vigilante', 'motor caído, reiniciando');
          this._planRestart(200);
        }
        return;
      }

      this._idleTicks = 0;
      if (Date.now() - this._lastActivity > 25000) {
        this._lastActivity = Date.now();
        this._log('vigilante', 'sin actividad, reiniciando');
        this._planRestart(200);
      }
    }, 5000);
  }

  start(lang = this.lang) {
    if (!isSupported) {
      this.dispatchEvent(new CustomEvent('error', {
        detail: { code: 'unsupported', message: 'Este navegador no tiene dictado por voz. Usá Chrome o Edge.' },
      }));
      return false;
    }
    this.lang = lang;
    this.active = true;
    this._backoff = 300;
    this._lastActivity = Date.now();
    this._log('inicio', lang);
    this._spawn();
    this._startWatchdog();
    return true;
  }

  stop() {
    this.active = false;
    clearTimeout(this._restartTimer);
    clearInterval(this._watchdog);
    this._kill();
    this._log('detenido');
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
    // Se pide UNA sola alternativa, igual que la prueba de la calibración, que
    // es el camino que sí funciona en Android. Pedir varias era la única
    // diferencia de configuración entre los dos, y el vocabulario se aplica
    // igual por reemplazo de texto, así que no se pierde nada.
    this.maxAlternatives = 1;
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
