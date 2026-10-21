/* ═══════════════════════════════════════════════════════════════
   BernAudio — modules-delay.js
   DELAY FINDER — tiempo de delay entre dos fuentes sonoras
   · Modo 1 micro (secuencial): mide la llegada de la fuente A y de
     la fuente B con ruido rosa + correlación contra la referencia
     interna → Δt, Δdistancia y recomendación de ajuste.
   · Modo 2 micros (interfaz estéreo): correlación cruzada en vivo
     entre canal 1 y canal 2 (cada micro pegado a su fuente).
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  const DSP = global.DSP, AE = global.AE, BAU = global.BAU, Gen = global.MOD_GEN;

  const Delay = {
    W: 8192,                 // ventana de correlación (~170 ms @48k)
    FIFO: 1 << 16,
    mode: 'seq',             // 'seq' | 'dual'
    state: 'idle',           // idle | measA | measB
    dA: null, dB: null,      // llegada de A/B (muestras tras la referencia)
    confA: 0, confB: 0, conf: 0,
    corr: null,              // curva de correlación para dibujar
    _chMic: null, _chRef: null, _chA: null, _chB: null,
    _unsubMic: null, _unsubRef: null, _unsubA: null, _unsubB: null,
    _fft: null, _acc: 0, _measStart: 0, _measSrc: 'A', _lastSec: -1, _avg: null,
    el: {},

    init() {
      ['dlMode', 'dlMeasureA', 'dlMeasureB', 'dlReset', 'dlStatus',
       'dlDelta', 'dlDist', 'dlConf', 'dlRec', 'cvDelay', 'dlHelp1', 'dlHelp2']
        .forEach((id) => (this.el[id] = document.getElementById(id)));
      this.el.dlMode.addEventListener('change', () => this.setMode(this.el.dlMode.value));
      this.el.dlMeasureA.addEventListener('click', () => this.measureSource('A'));
      this.el.dlMeasureB.addEventListener('click', () => this.measureSource('B'));
      this.el.dlReset.addEventListener('click', () => this.resetAll());
      this.el.dlHelp2.style.display = 'none';
    },

    setMode(m) {
      this.mode = m;
      this._stopSubs();
      this.state = 'idle';
      this.el.dlMeasureA.style.display = m === 'seq' ? '' : 'none';
      this.el.dlMeasureB.style.display = m === 'seq' ? '' : 'none';
      this.el.dlHelp1.style.display = m === 'seq' ? '' : 'none';
      this.el.dlHelp2.style.display = m === 'dual' ? '' : 'none';
      this._avg = null; this.corr = null;
      this.resetReadouts();
      if (m === 'dual') {
        if (!AE.running) { this.el.dlStatus.textContent = 'inicia la medición (micrófono) primero'; return; }
        if (AE.channels < 2) { this.el.dlStatus.textContent = 'elige «2 (estéreo)» en Canales (barra superior)'; return; }
        this._chA = this._mk(); this._chB = this._mk();
        this._unsubA = AE.onBlock((b) => this._push(this._chA, b));
        this._unsubB = AE.onBlockCh1((b) => this._push(this._chB, b));
        this.el.dlStatus.textContent = 'correlación en vivo (micro 1 = A · micro 2 = B)';
      } else {
        this.el.dlStatus.textContent = 'listo';
      }
    },

    resetAll() {
      this._stopSubs();
      this.state = 'idle';
      this.dA = this.dB = null;
      this.confA = this.confB = this.conf = 0;
      this._avg = null; this.corr = null;
      this.resetReadouts();
      this.el.dlStatus.textContent = 'listo';
      if (this.mode === 'dual') this.setMode('dual');
    },

    resetReadouts() {
      this.el.dlDelta.textContent = '--';
      this.el.dlDist.textContent = '--';
      this.el.dlConf.textContent = '--';
      this.el.dlRec.textContent = '--';
    },

    _stopSubs() {
      if (this._unsubMic) { this._unsubMic(); this._unsubMic = null; }
      if (this._unsubRef) { this._unsubRef(); this._unsubRef = null; }
      if (this._unsubA) { this._unsubA(); this._unsubA = null; }
      if (this._unsubB) { this._unsubB(); this._unsubB = null; }
    },

    _mk() { return { fifo: new Float32Array(this.FIFO), w: 0 }; },

    _push(ch, block) {
      const F = ch.fifo.length;
      let w = ch.w & (F - 1);
      for (let i = 0; i < block.length; i++) {
        ch.fifo[w] = block[i];
        w = (w + 1) & (F - 1);
      }
      ch.w += block.length;
    },

    _segment(ch, endPos, len, out) {
      const F = ch.fifo.length;
      const endMod = endPos & (F - 1);
      for (let i = 0; i < len; i++) out[len - 1 - i] = ch.fifo[(endMod - 1 - i) & (F - 1)];
    },

    /* ── Modo secuencial: medir una fuente ── */
    measureSource(src) {
      if (!AE.running) { this.el.dlStatus.textContent = 'inicia la medición (micrófono) primero'; return; }
      if (this.state === 'measA' || this.state === 'measB') return;
      /* asegurar ruido rosa sonando (referencia interna) */
      if (!Gen.playing || Gen.el.genType.value !== 'pink') {
        Gen.el.genType.value = 'pink';
        Gen.el.genType.dispatchEvent(new Event('change'));
        Gen.stop(); Gen.play();
      }
      this._chMic = this._mk(); this._chRef = this._mk();
      this._unsubMic = AE.onBlock((b) => this._push(this._chMic, b));
      this._unsubRef = Gen.onRefBlock((b) => this._push(this._chRef, b));
      this._measStart = performance.now();
      this._measSrc = src;
      this._lastSec = -1;
      this.state = src === 'A' ? 'measA' : 'measB';
      this.el.dlStatus.textContent = 'midiendo fuente ' + src + '…';
    },

    _finishMeas() {
      this._stopSubs();
      const N = this.W;
      if (this._chMic.w < N + 8192 || this._chRef.w < N + 8192) {
        this.state = 'idle';
        this.el.dlStatus.textContent = 'señal insuficiente — sube el nivel del generador';
        return;
      }
      const m = new Float64Array(N), r = new Float64Array(N);
      this._segment(this._chMic, this._chMic.w, N, m);
      this._segment(this._chRef, this._chRef.w, N, r);
      const w = DSP.hannWindow(N);
      for (let i = 0; i < N; i++) { m[i] *= w[i]; r[i] *= w[i]; }
      if (!this._fft) this._fft = new DSP.FFT(N);
      /* pico en +D: el micro recibe la fuente D muestras después de la referencia */
      const res = DSP.xcorrPeak(r, m, this._fft);
      this.corr = res.corr;
      if (this._measSrc === 'A') {
        this.dA = res.lag; this.confA = res.conf;
        this.el.dlStatus.textContent = 'fuente A: ' + ((res.lag / AE.sampleRate) * 1000).toFixed(1) + ' ms de llegada';
      } else {
        this.dB = res.lag; this.confB = res.conf;
        this.el.dlStatus.textContent = 'fuente B: ' + ((res.lag / AE.sampleRate) * 1000).toFixed(1) + ' ms de llegada';
      }
      this.updateResults();
      this.draw();
    },

    updateResults() {
      const sr = AE.sampleRate;
      if (this.dA != null && this.dB != null) {
        const ms = ((this.dB - this.dA) / sr) * 1000;
        this.el.dlDelta.textContent = (ms > 0 ? '+' : '') + ms.toFixed(1);
        this.el.dlDist.textContent = Math.abs(ms * 0.343).toFixed(2);
        this.el.dlConf.textContent = Math.round(Math.min(this.confA, this.confB) * 100) + '%';
        if (Math.abs(ms) < 0.3) {
          this.el.dlRec.textContent = 'alineadas ✓';
        } else {
          const early = ms > 0 ? 'A' : 'B';   // la que llega antes recibe el delay
          this.el.dlRec.textContent = '+' + Math.abs(ms).toFixed(1) + ' ms → ' + early;
        }
      } else {
        const d = this.dA != null ? this.dA : this.dB;
        if (d == null) return;
        const c = this.dA != null ? this.confA : this.confB;
        this.el.dlConf.textContent = Math.round(c * 100) + '%';
      }
    },

    tick(dtMs) {
      /* medición secuencial en curso */
      if (this.state === 'measA' || this.state === 'measB') {
        const el = performance.now() - this._measStart;
        const sec = Math.min(3, Math.floor(el / 1000));
        if (sec !== this._lastSec) {
          this._lastSec = sec;
          this.el.dlStatus.textContent = 'midiendo fuente ' + this._measSrc + '… (' + (3 - sec) + ' s)';
        }
        if (el >= 3000) this._finishMeas();
        return;
      }
      if (this.mode !== 'dual' || !this._unsubA) return;
      /* correlación en vivo a 4 Hz */
      this._acc += dtMs;
      if (this._acc < 250) return;
      this._acc = 0;
      const N = this.W;
      if (this._chA.w < N + 8192 || this._chB.w < N + 8192) return;
      const a = new Float64Array(N), b = new Float64Array(N);
      this._segment(this._chA, this._chA.w, N, a);
      this._segment(this._chB, this._chB.w, N, b);
      const w = DSP.hannWindow(N);
      for (let i = 0; i < N; i++) { a[i] *= w[i]; b[i] *= w[i]; }
      if (!this._fft) this._fft = new DSP.FFT(N);
      const res = DSP.xcorrPeak(a, b, this._fft);
      /* promediado exponencial de la curva de correlación */
      if (!this._avg) this._avg = Float64Array.from(res.corr);
      else for (let i = 0; i < N; i++) this._avg[i] += 0.4 * (res.corr[i] - this._avg[i]);
      /* pico sobre la curva promediada */
      let best = 0, bestV = -Infinity;
      for (let i = 0; i < N; i++) if (this._avg[i] > bestV) { bestV = this._avg[i]; best = i; }
      const lag = best > N / 2 ? best - N : best;
      let s2 = 0;
      for (let i = 0; i < N; i++) s2 += this._avg[i] * this._avg[i];
      const conf = DSP.clamp(bestV / (Math.sqrt(s2 / N) * 40), 0, 1);
      this.corr = this._avg;
      this.conf = conf;
      const ms = (lag / AE.sampleRate) * 1000;
      this.el.dlDelta.textContent = (ms > 0 ? '+' : '') + ms.toFixed(1);
      this.el.dlDist.textContent = Math.abs(ms * 0.343).toFixed(2);
      this.el.dlConf.textContent = Math.round(conf * 100) + '%';
      this.el.dlRec.textContent = conf < 0.15
        ? 'señal débil…'
        : (Math.abs(ms) < 0.3 ? 'alineadas ✓' : '+' + Math.abs(ms).toFixed(1) + ' ms → ' + (ms > 0 ? 'A' : 'B'));
      this.draw();
    },

    draw() {
      if (!this.corr) return;
      const { ctx, w, h } = BAU.fitCanvas(this.el.cvDelay);
      ctx.clearRect(0, 0, w, h);
      const N = this.corr.length, sr = AE.sampleRate;
      const maxLagMs = 40, padL = 44, padB = 20, padT = 8;
      const plotW = w - padL - 8, plotH = h - padB - padT;
      const kC = N / 2, kSpan = Math.round((maxLagMs / 1000) * sr);
      let mx = 1e-12;
      for (let k = kC - kSpan; k <= kC + kSpan; k++) mx = Math.max(mx, Math.abs(this.corr[k] || 0));

      /* rejilla de ms */
      ctx.strokeStyle = 'rgba(140,163,160,0.14)';
      ctx.fillStyle = 'rgba(140,163,160,0.55)';
      ctx.font = '10px JetBrains Mono, monospace'; ctx.lineWidth = 1;
      for (let ms = -maxLagMs; ms <= maxLagMs; ms += 10) {
        const xx = padL + ((ms + maxLagMs) / (2 * maxLagMs)) * plotW;
        ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + plotH); ctx.stroke();
        ctx.fillText((ms > 0 ? '+' : '') + ms, xx - 8, h - 6);
      }
      /* línea de 0 ms */
      const x0 = padL + plotW / 2;
      ctx.strokeStyle = 'rgba(255,162,62,0.3)';
      ctx.beginPath(); ctx.moveTo(x0, padT); ctx.lineTo(x0, padT + plotH); ctx.stroke();

      /* curva de correlación */
      ctx.beginPath();
      for (let k = kC - kSpan; k <= kC + kSpan; k++) {
        const xx = padL + ((k - kC + kSpan) / (2 * kSpan)) * plotW;
        const yy = padT + plotH * (1 - ((this.corr[k] || 0) / mx + 1) / 2);
        k === kC - kSpan ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
      }
      ctx.strokeStyle = '#FFA23E'; ctx.lineWidth = 1.4; ctx.stroke();

      /* marcador del pico */
      let best = kC, bestV = -Infinity;
      for (let k = kC - kSpan; k <= kC + kSpan; k++) if (this.corr[k] > bestV) { bestV = this.corr[k]; best = k; }
      const lagMs = ((best - kC) / sr) * 1000;
      if (bestV > mx * 0.25) {
        const px = padL + ((best - kC + kSpan) / (2 * kSpan)) * plotW;
        ctx.strokeStyle = 'rgba(245,176,76,0.7)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(px, padT); ctx.lineTo(px, padT + plotH); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(245,176,76,0.95)';
        ctx.fillText((lagMs > 0 ? '+' : '') + lagMs.toFixed(1) + ' ms', px + 5, padT + 12);
      }
      /* leyenda */
      ctx.font = '11px Inter, sans-serif';
      ctx.fillStyle = '#8CA3A0';
      ctx.fillText(this.mode === 'dual'
        ? 'correlación micro 1 vs micro 2 — pico = delay de B respecto a A'
        : 'correlación micro vs referencia interna — pico = llegada de la fuente',
        padL + 8, padT + 12);
    },
  };

  global.MOD_DELAY = Delay;
})(window);
