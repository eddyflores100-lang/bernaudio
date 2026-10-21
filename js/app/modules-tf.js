/* ═══════════════════════════════════════════════════════════════
   BernAudio — modules-tf.js
   Módulos: Generador · Función de Transferencia · Impulso (IR)
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  const DSP = global.DSP, AE = global.AE, BAU = global.BAU;

  /* ════════════════ GENERADOR ════════════════ */
  const Gen = {
    src: null, gain: null, analyser: null, tapNode: null,
    playing: false, type: 'pink',
    el: {},
    init() {
      ['genType', 'genFreq', 'genFreqChip', 'genSineCtl', 'genSweepCtl', 'genSweepDur',
       'genLevel', 'genLevelChip', 'genPlay', 'genStopBtn', 'genToTf', 'cvGen']
        .forEach((id) => (this.el[id] = document.getElementById(id)));

      this.el.genType.addEventListener('change', () => {
        this.type = this.el.genType.value;
        this.el.genSineCtl.style.display = this.type === 'sine' ? '' : 'none';
        this.el.genSweepCtl.style.display = this.type === 'sweep' ? '' : 'none';
        if (this.playing) { this.stop(); this.play(); }
      });
      this.el.genFreq.addEventListener('input', () => {
        this.el.genFreqChip.textContent = this.el.genFreq.value + ' Hz';
        if (this.playing && this.osc) this.osc.frequency.value = +this.el.genFreq.value;
      });
      this.el.genLevel.addEventListener('input', () => {
        const db = +this.el.genLevel.value;
        this.el.genLevelChip.textContent = (db <= -60 ? '−∞' : db) + ' dB';
        if (this.gain) this.gain.gain.value = DSP.ampFromDb(db);
      });
      this.el.genPlay.addEventListener('click', () => { this.stop(); this.play(); });
      this.el.genStopBtn.addEventListener('click', () => this.stop());
      this.el.genToTf.addEventListener('click', () => {
        this.el.genType.value = 'pink'; this.el.genType.dispatchEvent(new Event('change'));
        if (!this.playing) { this.stop(); this.play(); }
        global.UI.showTab('tf');
        global.MOD_TF.start();
      });
    },
    _ensureNodes() {
      const ctx = AE.ctx;
      if (this.gain && this._ctxRef === ctx) return ctx;
      this._ctxRef = ctx;
      this.gain = null; this.analyser = null; this.tapNode = null;
      if (!this.gain) {
        this.gain = ctx.createGain();
        this.gain.gain.value = DSP.ampFromDb(+this.el.genLevel.value);
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        /* tap de referencia para TF */
        this.tapNode = ctx.createScriptProcessor(4096, 1, 1);
        const mute = ctx.createGain(); mute.gain.value = 0;
        this.gain.connect(ctx.destination);
        this.gain.connect(this.analyser);
        this.gain.connect(this.tapNode);
        this.tapNode.connect(mute); mute.connect(ctx.destination);
        this._refSubs = [];
        this.tapNode.onaudioprocess = (e) => {
          if (!this.playing) return;
          const block = e.inputBuffer.getChannelData(0);
          for (const fn of this._refSubs) fn(new Float32Array(block));
        };
      }
      return ctx;
    },
    onRefBlock(fn) { if (this.tapNode) this._refSubs.push(fn); return () => { this._refSubs = this._refSubs.filter((f) => f !== fn); }; },
    play() {
      if (this.playing || !AE.ctx) return;
      const ctx = this._ensureNodes();
      const type = this.el.genType.value;
      try {
        if (type === 'sine') {
          this.osc = ctx.createOscillator();
          this.osc.type = 'sine';
          this.osc.frequency.value = +this.el.genFreq.value;
          this.osc.connect(this.gain);
          this.osc.start();
        } else if (type === 'sweep') {
          const dur = +this.el.genSweepDur.value;
          const buf = DSP.makeSweep(AE.sampleRate, 20, 20000, dur, 0.25);
          const ab = ctx.createBuffer(1, buf.length, AE.sampleRate);
          ab.copyToChannel(buf, 0);
          this.src = ctx.createBufferSource();
          this.src.buffer = ab;
          this.src.onended = () => this.stop();
          this.src.connect(this.gain);
          this.src.start();
        } else if (type === 'pink' || type === 'white') {
          const sig = type === 'pink' ? DSP.makePinkNoise(AE.sampleRate * 4) : DSP.makeWhiteNoise(AE.sampleRate * 4);
          const ab = ctx.createBuffer(1, sig.length, AE.sampleRate);
          ab.copyToChannel(sig, 0);
          this.src = ctx.createBufferSource();
          this.src.buffer = ab; this.src.loop = true;
          this.src.connect(this.gain);
          this.src.start();
        }
        this.playing = true;
        global.UI.setStatus('generador: ' + type);
      } catch (e) { console.error(e); }
    },
    stop() {
      if (this.osc) { try { this.osc.stop(); } catch (e) {} this.osc = null; }
      if (this.src) { try { this.src.stop(); } catch (e) {} this.src = null; }
      if (this.playing) { this.playing = false; global.UI.setStatus('medición activa'); }
    },
    tick() {
      if (!this.analyser) return;
      const { ctx, w, h } = BAU.fitCanvas(this.el.cvGen);
      ctx.clearRect(0, 0, w, h);
      if (!this.playing) {
        ctx.fillStyle = 'rgba(140,163,160,0.5)';
        ctx.font = '12px Inter, sans-serif';
        ctx.fillText('Sin señal — pulsa Reproducir', 16, h / 2);
        return;
      }
      const N = 1024, data = new Float32Array(N);
      try { this.analyser.getFloatTimeDomainData(data); } catch (e) { return; }
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * w;
        const y = h / 2 - data[i] * h * 0.45;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#FFA23E'; ctx.lineWidth = 1.4; ctx.stroke();
    },
  };

  /* ════════════════ FUNCIÓN DE TRANSFERENCIA ════════════════ */
  const TF = {
    W: 8192,                       // ventana de análisis
    FIFO: 1 << 17,
    refFifo: null, micFifo: null, refW: 0, micW: 0,
    SxyRe: null, SxyIm: null, Sxx: null, Syy: null,
    magDb: null, phaseDeg: null, coher: null, freqs: null,
    delaySamples: null, autoDelay: true, lastDelaySearch: 0,
    refSource: 'gen',              // 'gen' | 'ch2' (loopback hardware)
    polarity: false,               // inversión de polaridad (ajuste de fase)
    traces: [],                    // trazas memorizadas A/B/C para comparar fuentes
    measuring: false, updates: 0,
    _fft: null, _stall: 0, _lastRefW: -1,
    el: {},

    init() {
      ['tfStart', 'tfStop', 'tfAutoDelay', 'tfFindDelay', 'tfSmooth', 'tfView', 'tfDelayChip',
       'tfRef', 'tfDelayMs', 'tfDelayMsChip', 'tfPolarity', 'tfSaveTrace', 'tfClearTraces',
       'tfExportCsv', 'tfExportPng', 'cvTf']
        .forEach((id) => (this.el[id] = document.getElementById(id)));
      this.el.tfStart.addEventListener('click', () => this.start());
      this.el.tfStop.addEventListener('click', () => this.stop());
      this.el.tfAutoDelay.addEventListener('change', () => { this.autoDelay = this.el.tfAutoDelay.checked; });
      this.el.tfFindDelay.addEventListener('click', () => { this.searchDelay(true); });
      this.el.tfRef.addEventListener('change', () => {
        this.refSource = this.el.tfRef.value;
        if (this.measuring) { this.stop(); this.start(); }
      });
      this.el.tfDelayMs.addEventListener('input', () => {
        this.el.tfDelayMsChip.textContent = (+this.el.tfDelayMs.value).toFixed(1) + ' ms';
        this._updDelayChip();
      });
      this.el.tfPolarity.addEventListener('change', () => { this.polarity = this.el.tfPolarity.checked; });
      this.el.tfSaveTrace.addEventListener('click', () => this.saveTrace());
      this.el.tfClearTraces.addEventListener('click', () => { this.traces = []; });
      this.el.tfExportCsv.addEventListener('click', () => this.exportCsv());
      this.el.tfExportPng.addEventListener('click', () => this.exportPng());
      const n2 = this.W / 2;
      this.SxyRe = new Float64Array(n2 + 1); this.SxyIm = new Float64Array(n2 + 1);
      this.Sxx = new Float64Array(n2 + 1); this.Syy = new Float64Array(n2 + 1);
      this.magDb = new Float64Array(n2 + 1); this.phaseDeg = new Float64Array(n2 + 1);
      this.coher = new Float64Array(n2 + 1);
      this.refFifo = new Float32Array(this.FIFO); this.micFifo = new Float32Array(this.FIFO);
    },

    start() {
      if (this.measuring) return;
      if (!AE.running || !AE.analyser) {
        global.UI.setStatus('Sin micrófono activo — pulsa «Detener» e inicia de nuevo dando permiso de micro');
        return;
      }
      /* referencia por canal 2 solo si se pidieron 2 canales */
      if (this.refSource === 'ch2' && AE.channels < 2) {
        this.refSource = 'gen';
        this.el.tfRef.value = 'gen';
        global.UI.setStatus('Canal 2 no activo — usando generador interno');
      }
      /* ruido rosa sonando de fondo (solo con referencia interna) */
      if (this.refSource === 'gen' && (!Gen.playing || Gen.el.genType.value !== 'pink')) {
        Gen.el.genType.value = 'pink'; Gen.el.genType.dispatchEvent(new Event('change'));
        Gen.stop(); Gen.play();
      }
      this.resetAvg();
      this._unsubMic = AE.onBlock((b) => this._push(this.micFifo, b, 'mic'));
      if (this.refSource === 'ch2' && AE.channels >= 2) {
        this._unsubRef = AE.onBlockCh1((b) => this._push(this.refFifo, b, 'ref'));
      } else {
        this._unsubRef = Gen.onRefBlock((b) => this._push(this.refFifo, b, 'ref'));
      }
      this.measuring = true;
      this.lastDelaySearch = 0;
      global.UI.setStatus('TF midiendo…');
    },
    stop() {
      this.measuring = false;
      if (this._unsubMic) { this._unsubMic(); this._unsubMic = null; }
      if (this._unsubRef) { this._unsubRef(); this._unsubRef = null; }
      global.UI.setStatus('TF detenida — puedes guardar traza A/B/C');
    },

    /* Exportar medición actual: CSV (f, mag, fase, coherencia) y PNG del gráfico */
    exportCsv() {
      if (!this.updates) {
        global.UI.setStatus('No hay medición que exportar — mide primero con ruido rosa');
        return;
      }
      const N = this.W, n2 = N / 2, binHz = AE.sampleRate / N;
      const fMin = 20, fMax = Math.min(20000, AE.sampleRate / 2 * 0.95);
      let rows = '\uFEFFfrecuencia_hz,magnitud_db,fase_deg,coherencia\n';
      for (let k = 1; k <= n2; k++) {
        const f = k * binHz;
        if (f < fMin || f > fMax) continue;
        const coh = Math.min(1, Math.max(0, this.coher[k]));
        rows += f.toFixed(2) + ',' + this.magDb[k].toFixed(3) + ',' +
          this.phaseDeg[k].toFixed(3) + ',' + coh.toFixed(4) + '\n';
      }
      const blob = new Blob([rows], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'bernaudio_tf.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      global.UI.setStatus('TF exportada a CSV (' + this.updates + ' promedios)');
    },

    exportPng() {
      try {
        const a = document.createElement('a');
        a.href = this.el.cvTf.toDataURL('image/png');
        a.download = 'bernaudio_tf.png';
        a.click();
        global.UI.setStatus('Gráfico exportado a PNG');
      } catch (e) {
        global.UI.setStatus('No se pudo exportar el PNG');
      }
    },
    resetAvg() {
      this.SxyRe.fill(0); this.SxyIm.fill(0); this.Sxx.fill(0); this.Syy.fill(0);
      this.updates = 0; this.delaySamples = null;
      this._stall = 0; this._lastRefW = -1;
      this.el.tfDelayChip.textContent = 'delay: —';
    },
    _push(fifo, block, tag) {
      const F = fifo.length;
      let w;
      if (tag === 'mic') { w = this.micW & (F - 1); this.micW += block.length; }
      else { w = this.refW & (F - 1); this.refW += block.length; }
      for (let i = 0; i < block.length; i++) {
        fifo[w] = block[i];
        w = (w + 1) & (F - 1);
      }
    },

    /* segmento de fifo: últimas len muestras terminando en endPos (índice absoluto) */
    _segment(fifo, endPos, len, out) {
      const F = fifo.length;
      const endMod = endPos & (F - 1);
      for (let i = 0; i < len; i++) {
        out[len - 1 - i] = fifo[(endMod - 1 - i) & (F - 1)];
      }
    },

    searchDelay(force) {
      if (!this.measuring && !force) return;
      const N = this.W;
      if (this.micW < N + 8192 || this.refW < N + 8192) return;
      const m = new Float64Array(N), r = new Float64Array(N);
      this._segment(this.micFifo, this.micW, N, m);
      this._segment(this.refFifo, this.refW, N, r);
      const w = DSP.hannWindow(N);
      for (let i = 0; i < N; i++) { m[i] *= w[i]; r[i] *= w[i]; }
      if (!this._fft) this._fft = new DSP.FFT(N);
      /* IFFT(conj(ref)·mic): pico en +D cuando el micro recibe la
         referencia D muestras después (delay acústico real).        */
      const res = DSP.xcorrPeak(r, m, this._fft);
      if (res.conf < 0.08 && this.delaySamples != null) return; // pico débil: mantener anterior
      this.delaySamples = res.lag;
      this._updDelayChip();
    },

    _updDelayChip() {
      if (this.delaySamples == null) { this.el.tfDelayChip.textContent = 'delay: —'; return; }
      const eff = this.delaySamples + Math.round((+this.el.tfDelayMs.value / 1000) * AE.sampleRate);
      const ms = (eff / AE.sampleRate) * 1000;
      this.el.tfDelayChip.textContent = 'delay: ' + ms.toFixed(1) + ' ms · ' + (ms * 0.343).toFixed(2) + ' m';
    },

    saveTrace() {
      if (this.updates < 2) return;
      const names = ['A', 'B', 'C'];
      this.traces.push({
        name: names[this.traces.length % 3],
        mag: Float64Array.from(this.magDb),
        phase: Float64Array.from(this.phaseDeg),
      });
      if (this.traces.length > 3) this.traces.shift();
      global.UI.setStatus('Traza ' + names[(this.traces.length - 1) % 3] + ' guardada — compara fuentes');
    },

    update() {
      if (!this.measuring) return;
      const N = this.W, half = N / 2;
      /* auto delay cada ~2 s */
      const now = performance.now();
      if (this.autoDelay && now - this.lastDelaySearch > 2000) {
        this.lastDelaySearch = now;
        this.searchDelay(false);
      }
      if (this.delaySamples == null) return;

      /* detector de atasco: ref = canal 2 sin datos → fallback a generador */
      if (this.refSource === 'ch2') {
        if (this.refW === this._lastRefW) {
          this._stall++;
          if (this._stall > 8) {
            this._stall = 0;
            this.refSource = 'gen';
            this.el.tfRef.value = 'gen';
            if (this._unsubRef) this._unsubRef();
            this._unsubRef = Gen.onRefBlock((b) => this._push(this.refFifo, b, 'ref'));
            global.UI.setStatus('Canal 2 sin señal — referencia interna activada');
          }
        } else { this._stall = 0; this._lastRefW = this.refW; }
      }

      /* delay efectivo = auto + ajuste fino manual */
      const effDelay = this.delaySamples + Math.round((+this.el.tfDelayMs.value / 1000) * AE.sampleRate);
      const need = N + Math.abs(effDelay) + 4096;
      if (this.micW < need || this.refW < need) return;

      const m = new Float64Array(N), r = new Float64Array(N);
      const Mi = new Float64Array(N), Ri = new Float64Array(N);
      /* mic termina en micW; ref correspondiente termina en refW − delay */
      this._segment(this.micFifo, this.micW, N, m);
      this._segment(this.refFifo, this.refW - effDelay, N, r);
      if (this.polarity) for (let i = 0; i < N; i++) m[i] = -m[i];

      const w = DSP.hannWindow(N);
      if (!this._fft) this._fft = new DSP.FFT(N);
      for (let i = 0; i < N; i++) { m[i] *= w[i]; r[i] *= w[i]; }
      this._fft.forward(m, Mi); this._fft.forward(r, Ri);

      const alpha = 0.12;
      const calFn = global.BA_STATE && global.BA_STATE.micCalDb;
      const binHz = AE.sampleRate / N;
      for (let k = 0; k <= half; k++) {
        const Xr = r[k], Xi = Ri[k], Yr = m[k], Yi = Mi[k];
        const sxyR = (Yr * Xr + Yi * Xi);       // Y · conj(X)
        const sxyI = (Yi * Xr - Yr * Xi);
        const sxx = Xr * Xr + Xi * Xi;
        const syy = Yr * Yr + Yi * Yi;
        this.SxyRe[k] += alpha * (sxyR - this.SxyRe[k]);
        this.SxyIm[k] += alpha * (sxyI - this.SxyIm[k]);
        this.Sxx[k] += alpha * (sxx - this.Sxx[k]);
        this.Syy[k] += alpha * (syy - this.Syy[k]);

        const sr2 = this.SxyRe[k], si2 = this.SxyIm[k];
        /* H = Sxy/Sxx — cociente sin escala: FFT y ventana se cancelan.
           Se suma la curva de calibración del micro (si está activa).    */
        const mag = Math.hypot(sr2, si2) / (this.Sxx[k] + 1e-20);
        this.magDb[k] = DSP.dbFromAmp(mag) + (calFn ? calFn(k * binHz) : 0);
        this.phaseDeg[k] = (Math.atan2(si2, sr2) * 180) / Math.PI;
        const num = sr2 * sr2 + si2 * si2;
        this.coher[k] = num / (this.Sxx[k] * this.Syy[k] + 1e-20);
      }
      this.updates++;
      this.draw();
    },

    draw() {
      const { ctx, w, h } = BAU.fitCanvas(this.el.cvTf);
      const padL = 40, padB = 22, padT = 8;
      const plotW = w - padL - 8, plotH = h - padB - padT;
      ctx.clearRect(0, 0, w, h);
      const fmin = 20, fmax = Math.min(20000, AE.sampleRate / 2 * 0.95);
      const binHz = AE.sampleRate / this.W;

      const view = this.el.tfView.value;
      const smoothing = +this.el.tfSmooth.value;

      /* preparar curvas (con suavizado opcional) */
      const nb = this.W / 2 + 1;
      const freqs = new Float64Array(nb);
      for (let k = 0; k < nb; k++) freqs[k] = k * binHz;
      let mag = this.magDb, phase = this.phaseDeg, coh = this.coher;
      if (smoothing > 0) {
        mag = DSP.fracOctSmooth(freqs, this.magDb, smoothing);
        phase = DSP.fracOctSmooth(freqs, this.phaseDeg, smoothing);
      }

      /* rejilla dB */
      const magRange = 30; // ±30 dB
      ctx.strokeStyle = 'rgba(140,163,160,0.14)';
      ctx.fillStyle = 'rgba(140,163,160,0.55)';
      ctx.font = '10px JetBrains Mono, monospace'; ctx.lineWidth = 1;
      for (let db = -magRange; db <= magRange; db += 10) {
        const yy = padT + plotH * (1 - (db + magRange) / (2 * magRange));
        ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
        ctx.fillText((db > 0 ? '+' : '') + db, 6, yy + 3);
      }
      /* décadas de frecuencia */
      [100, 1000, 10000].forEach((f) => {
        const xx = padL + (Math.log10(f / fmin) / Math.log10(fmax / fmin)) * plotW;
        ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + plotH); ctx.stroke();
        ctx.fillText(f >= 1000 ? f / 1000 + 'k' : f, xx - 8, h - 6);
      });
      /* 0 dB y 0° */
      const y0 = padT + plotH / 2;
      ctx.strokeStyle = 'rgba(255,162,62,0.25)';
      ctx.beginPath(); ctx.moveTo(padL, y0); ctx.lineTo(padL + plotW, y0); ctx.stroke();

      if (this.updates < 2 && !this.traces.length) return;

      const xOf = (f) => padL + (Math.log10(Math.max(f, fmin) / fmin) / Math.log10(fmax / fmin)) * plotW;
      const yOfMag = (v) => padT + plotH * (1 - (DSP.clamp(v, -magRange, magRange) + magRange) / (2 * magRange));
      const yOfPh = (v) => padT + plotH * (1 - (DSP.clamp(v, -180, 180) + 180) / 360);
      const yOfCoh = (v) => padT + plotH - DSP.clamp(v, 0, 1) * plotH * 0.12;

      const plotLine = (vals, yFn, color, lw, alpha) => {
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        let started = false;
        for (let k = 2; k < nb; k++) {
          const f = freqs[k];
          if (f < fmin || f > fmax) continue;
          const xx = xOf(f), yy = yFn(vals[k]);
          if (!started) { ctx.moveTo(xx, yy); started = true; } else ctx.lineTo(xx, yy);
        }
        ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();
        ctx.globalAlpha = 1;
      };

      /* trazas memorizadas A/B/C (comparar dos o más fuentes) */
      const traceColors = ['#F5B04C', '#B794F6', '#F97066'];
      for (let t = 0; t < this.traces.length; t++) {
        const tr = this.traces[t];
        if (view === 'both' || view === 'mag') plotLine(tr.mag, yOfMag, traceColors[t % 3], 1.2, 0.6);
        if (view === 'both' || view === 'phase') plotLine(tr.phase, yOfPh, traceColors[t % 3], 1, 0.45);
      }

      if (this.updates < 2) { this._legend(ctx, padL, padT); return; }

      /* coherencia (sombra inferior) */
      plotLine(coh, yOfCoh, '#8CA3A0', 1, 0.25);

      /* magnitud en vivo */
      if (view === 'both' || view === 'mag') plotLine(mag, yOfMag, '#FFA23E', 1.6, 1);
      /* fase en vivo */
      if (view === 'both' || view === 'phase') plotLine(phase, yOfPh, 'rgba(245,176,76,0.85)', 1.2, 1);

      this._legend(ctx, padL, padT);
    },

    _legend(ctx, padL, padT) {
      ctx.font = '11px Inter, sans-serif';
      ctx.fillStyle = '#FFA23E'; ctx.fillText('— Magnitud (dB)', padL + 8, padT + 12);
      ctx.fillStyle = 'rgba(245,176,76,0.9)'; ctx.fillText('— Fase', padL + 120, padT + 12);
      ctx.fillStyle = '#8CA3A0'; ctx.fillText('▁ coherencia', padL + 180, padT + 12);
      const traceColors = ['#F5B04C', '#B794F6', '#F97066'];
      const names = ['A', 'B', 'C'];
      for (let t = 0; t < this.traces.length; t++) {
        ctx.fillStyle = traceColors[t % 3];
        ctx.fillText('— traza ' + names[t], padL + 262 + t * 72, padT + 12);
      }
    },

    tick(dtMs) {
      /* actualizaciones a ~12 Hz */
      this._acc = (this._acc || 0) + dtMs;
      if (this._acc >= 80) { this._acc = 0; this.update(); }
    },
  };

  /* ════════════════ IMPULSO (IR) ════════════════ */
  const IRMod = {
    state: 'idle', // idle | rec | computing | done
    sweep: null, rec: null, recLen: 0, recTotal: 0,
    ir: null, sr: 0, peakIdx: 0, unsub: null, _unsubGen: null,
    el: {},

    init() {
      ['irMeasure', 'irDur', 'irExport', 'irStatusChip', 'irProgress',
       'irDelay', 'irDist', 'irRt60', 'irRt60L', 'irPeakLvl', 'cvIr']
        .forEach((id) => (this.el[id] = document.getElementById(id)));
      this.el.irMeasure.addEventListener('click', () => this.measure());
      this.el.irExport.addEventListener('click', () => this.exportWav());
    },

    async measure() {
      if (this.state === 'rec' || this.state === 'computing') return;
      if (!AE.running || !AE.analyser) {
        global.UI.setStatus('Sin micrófono activo — pulsa «Detener» e inicia de nuevo dando permiso de micro');
        return;
      }
      Gen.stop();
      const dur = +this.el.irDur.value;
      this.sr = AE.sampleRate;
      this.sweep = DSP.makeSweep(this.sr, 20, 20000, dur, 0.25);
      this.recTotal = Math.round(this.sr * (dur + 1.5)); // cola extra
      this.rec = new Float32Array(this.recTotal);
      this.recLen = 0;
      this.el.irProgress.style.display = '';
      this.el.irProgress.firstElementChild.style.width = '0%';
      this.el.irStatusChip.textContent = 'grabando…';
      this.state = 'rec';

      /* reproducir sweep (a nivel del generador) */
      const ctx = AE.ctx;
      const ab = ctx.createBuffer(1, this.sweep.length, this.sr);
      ab.copyToChannel(this.sweep, 0);
      const src = ctx.createBufferSource();
      src.buffer = ab;
      const lvl = ctx.createGain();
      lvl.gain.value = DSP.ampFromDb(+Gen.el.genLevel.value || -18);
      src.connect(lvl);
      lvl.connect(ctx.destination);
      src.onended = () => { try { lvl.disconnect(); } catch (e) {} };
      src.start();

      /* grabar mic */
      this.unsub = AE.onBlock((b) => {
        if (this.state !== 'rec') return;
        const n = Math.min(b.length, this.rec.length - this.recLen);
        this.rec.set(b.subarray(0, n), this.recLen);
        this.recLen += n;
        const p = Math.min(1, this.recLen / this.recTotal);
        this.el.irProgress.firstElementChild.style.width = (p * 100).toFixed(0) + '%';
        if (this.recLen >= this.recTotal) this.finish();
      });
      global.UI.setStatus('IR: barrido en curso…');
    },

    finish() {
      if (this.unsub) { this.unsub(); this.unsub = null; }
      this.state = 'computing';
      this.el.irStatusChip.textContent = 'calculando…';
      /* deconvolución en tarea diferida */
      setTimeout(() => {
        try {
          const { ir } = DSP.deconvolveIR(this.rec, this.sweep);
          this.ir = ir;
          const pk = DSP.findPeak(ir);
          this.peakIdx = pk.idx;
          const delayMs = (pk.idx / this.sr) * 1000;
          const rt = DSP.schroederRT60(ir, this.sr, pk.idx);
          this.el.irDelay.textContent = delayMs.toFixed(1);
          this.el.irDist.textContent = (delayMs * 0.343).toFixed(2);
          this.el.irRt60.textContent = rt.rt60 ? rt.rt60.toFixed(2) : '--';
          this.el.irRt60L.textContent = 'RT60 (' + rt.detail + ')';
          this.el.irPeakLvl.textContent = DSP.dbFromAmp(pk.val).toFixed(1);
          this.el.irStatusChip.textContent = 'listo ✓';
          this.el.irProgress.style.display = 'none';
          this.state = 'done';
          this.draw();
          global.UI.setStatus('medición activa');
        } catch (e) {
          console.error(e);
          this.el.irStatusChip.textContent = 'error';
          this.state = 'idle';
          this.el.irProgress.style.display = 'none';
        }
      }, 50);
    },

    draw() {
      if (!this.ir) return;
      const { ctx, w, h } = BAU.fitCanvas(this.el.cvIr);
      ctx.clearRect(0, 0, w, h);
      const sr = this.sr;
      /* ventana de visualización: 100 ms antes del pico → +2.5 s (o hasta el fin) */
      const from = Math.max(0, this.peakIdx - Math.round(0.1 * sr));
      const to = Math.min(this.ir.length, this.peakIdx + Math.round(2.5 * sr));
      const n = to - from;
      const padL = 40, padB = 20, padT = 8;
      const plotW = w - padL - 8, plotH = h - padB - padT;

      /* rejilla ms */
      const durMs = (n / sr) * 1000;
      ctx.fillStyle = 'rgba(140,163,160,0.55)'; ctx.strokeStyle = 'rgba(140,163,160,0.14)';
      ctx.font = '10px JetBrains Mono, monospace'; ctx.lineWidth = 1;
      const stepMs = durMs > 1500 ? 250 : durMs > 400 ? 100 : 50;
      for (let ms = 0; ms <= durMs; ms += stepMs) {
        const xx = padL + (ms / durMs) * plotW;
        ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + plotH); ctx.stroke();
        ctx.fillText(ms + '', xx - 8, h - 6);
      }
      /* rejilla dB */
      for (let db = 0; db >= -80; db -= 20) {
        const yy = padT + (-db / 80) * plotH;
        ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
        ctx.fillText(db + '', 8, yy + 3);
      }

      /* envolvente dB */
      const peak = Math.abs(this.ir[this.peakIdx]) || 1e-9;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const v = Math.abs(this.ir[from + i]);
        const db = DSP.dbFromAmp(v / peak);
        const xx = padL + (i / (n - 1)) * plotW;
        const yy = padT + (DSP.clamp(-db, 0, 80) / 80) * plotH;
        i === 0 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
      }
      ctx.strokeStyle = '#FFA23E'; ctx.lineWidth = 1.4; ctx.stroke();
      /* pico */
      const px = padL + ((this.peakIdx - from) / (n - 1)) * plotW;
      ctx.strokeStyle = 'rgba(245,176,76,0.6)'; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(px, padT); ctx.lineTo(px, padT + plotH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(245,176,76,0.9)';
      ctx.fillText('llegada', px - 24, padT + 12);
    },

    exportWav() {
      if (!this.ir) return;
      const from = Math.max(0, this.peakIdx - Math.round(0.5 * this.sr));
      const to = Math.min(this.ir.length, this.peakIdx + Math.round(3 * this.sr));
      const slice = this.ir.slice(from, to);
      const buf = DSP.encodeWav(slice, this.sr);
      const blob = new Blob([buf], { type: 'audio/wav' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'bernaudio-ir-' + Date.now() + '.wav';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    },
  };

  global.MOD_GEN = Gen;
  global.MOD_TF = TF;
  global.MOD_IR = IRMod;
})(window);
