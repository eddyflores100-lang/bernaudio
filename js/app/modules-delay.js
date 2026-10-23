/* BernAudio — arrival-time estimates from correlated broadband signals.
   Sequential: generated output vs microphone; dual: synchronous hardware pair.
   Internal measurements include output/input latency, not only propagation. */
(function (global) {
  'use strict';
  const DSP = global.DSP, AE = global.AE, BAU = global.BAU, Gen = global.MOD_GEN;
  const Delay = {
    W: 8192, FIFO: 1 << 16, mode: 'seq', state: 'idle',
    dA: null, dB: null, confA: 0, confB: 0, conf: 0, corr: null,
    _fft: null, _acc: 0, _token: 0, el: {},
    init() {
      ['dlMode', 'dlMeasureA', 'dlMeasureB', 'dlReset', 'dlStatus', 'dlDelta',
       'dlDist', 'dlConf', 'dlRec', 'cvDelay', 'dlHelp1', 'dlHelp2']
        .forEach((id) => (this.el[id] = document.getElementById(id)));
      this.el.dlMode.addEventListener('change', () => this.setMode(this.el.dlMode.value));
      this.el.dlMeasureA.addEventListener('click', () => this.measureSource('A'));
      this.el.dlMeasureB.addEventListener('click', () => this.measureSource('B'));
      this.el.dlReset.addEventListener('click', () => this.resetAll());
      this.el.dlHelp2.style.display = 'none';
      this._sampleRate = AE.sampleRate;
    },
    _stopSubs() {
      for (const key of ['_unsubMic', '_unsubRef', '_unsubA', '_unsubB', '_unsubPair']) {
        if (this[key]) this[key](); this[key] = null;
      }
    },
    _cancel() {
      if (this._finishTimer != null) { clearTimeout(this._finishTimer); this._finishTimer = null; }
      ++this._token; this._stopSubs(); this.state = 'idle'; Gen.release('delay');
      this._acc = 0; this._lastEnd = null;
    },
    setMode(mode) {
      this._cancel(); this.mode = mode === 'dual' ? 'dual' : 'seq';
      this.dA = this.dB = null; this.confA = this.confB = this.conf = 0;
      this.corr = null; this._avg = null; this.resetReadouts();
      this.el.dlMeasureA.style.display = this.el.dlMeasureB.style.display = this.mode === 'seq' ? '' : 'none';
      this.el.dlHelp1.style.display = this.mode === 'seq' ? '' : 'none';
      this.el.dlHelp2.style.display = this.mode === 'dual' ? '' : 'none';
      if (this.mode !== 'dual') { this.el.dlStatus.textContent = 'listo'; return; }
      if (!AE.running) { this.el.dlStatus.textContent = 'inicia el micrófono primero'; return; }
      if (AE.realChannels < 2 || !AE.onPairBlock) {
        this.el.dlStatus.textContent = 'se requieren 2 entradas reales — revisa la interfaz y Canales'; return;
      }
      this._sampleRate = AE.sampleRate; this._ctx = AE.ctx; this._sessionId = AE.sessionId;
      this._chA = this._mk(); this._chB = this._mk();
      this._unsubPair = AE.onPairBlock((a, b, meta) => {
        if (meta && meta.sessionId != null && meta.sessionId !== this._sessionId) return;
        if (!b || AE.realChannels < 2 || AE.ctx !== this._ctx || (meta && meta.sampleRate !== this._sampleRate)) {
          this._cancel(); this.resetReadouts(); this.el.dlStatus.textContent = 'se perdió la entrada estéreo — vuelve a seleccionar el modo'; return;
        }
        const frame = meta && Number.isFinite(meta.startFrame) ? meta.startFrame : this._chA.w;
        if (this._chA.start != null && frame !== this._chA.w) {
          this._chA = this._mk(); this._chB = this._mk(); this._lastEnd = null;
        }
        this._push(this._chA, a, { startFrame: frame }); this._push(this._chB, b, { startFrame: frame });
      });
      this.el.dlStatus.textContent = 'correlación en vivo (micro 1 = A · micro 2 = B)';
    },
    resetAll() { this.setMode(this.mode); },
    resetReadouts() {
      for (const id of ['dlDelta', 'dlDist', 'dlConf', 'dlRec']) this.el[id].textContent = '--';
    },
    onAudioStop() {
      this._cancel(); this.dA = this.dB = null; this.confA = this.confB = this.conf = 0;
      this.corr = null; this.resetReadouts(); this.el.dlStatus.textContent = 'medición detenida';
    },
    onAudioStart() {
      this.onAudioStop(); this._sampleRate = AE.sampleRate;
      if (this.mode === 'dual') this.setMode('dual');
      else this.el.dlStatus.textContent = 'listo';
    },
    onShow() { this.draw(); },
    _mk() { return { fifo: new Float32Array(this.FIFO), w: 0, start: null }; },
    _push(ch, block, meta) {
      const F = ch.fifo.length;
      const frame = meta && Number.isFinite(meta.startFrame) ? Math.round(meta.startFrame) : ch.w;
      if (ch.start == null || frame !== ch.w) ch.start = frame;
      let w = frame & (F - 1);
      for (let i = 0; i < block.length; i++) { ch.fifo[w] = block[i]; w = (w + 1) & (F - 1); }
      ch.w = frame + block.length; ch.start = Math.max(ch.start, ch.w - F);
    },
    _segment(ch, endPos, len, out) {
      const F = ch.fifo.length, end = endPos & (F - 1);
      for (let i = 0; i < len; i++) out[len - 1 - i] = ch.fifo[(end - 1 - i) & (F - 1)];
    },
    _has(ch, end) { return ch && ch.start != null && end - this.W >= ch.start && end <= ch.w; },
    _usable(res) {
      const coefficient = Number.isFinite(res.coefficient) ? res.coefficient : Math.sign(res.peak) * res.conf;
      if (!Number.isFinite(res.lag) || !Number.isFinite(res.conf) || res.conf < 0.25 || coefficient <= 0) return false;
      const n = res.corr.length, peak = (Math.round(res.lag) + n) % n;
      if (!(res.peak > 0)) return false;
      for (let i = 0; i < n; i++) {
        const d = Math.min((i - peak + n) % n, (peak - i + n) % n);
        if (d > 64 && Math.abs(res.corr[i]) > res.peak * 0.95) return false;
      }
      return true;
    },
    _invalid(res) {
      this.resetReadouts();
      if (res) this.el.dlConf.textContent = Math.round(DSP.clamp(res.conf || 0, 0, 1) * 100) + '%';
      const inverted = res && (res.coefficient < 0 || res.peak < 0) && res.conf >= 0.25;
      this.el.dlRec.textContent = inverted ? 'revisa la polaridad' : 'sin correlación fiable';
      this.el.dlStatus.textContent = inverted ? 'polaridad invertida — no se recomienda alineación' : 'señal insuficiente o ambigua — usa ruido de banda ancha';
    },
    async measureSource(source) {
      if (this.mode !== 'seq' || !['A', 'B'].includes(source) || this.state !== 'idle') return;
      if (!AE.running || !AE.analyser) { this.el.dlStatus.textContent = 'inicia el micrófono primero'; return; }
      if (global.MOD_IR && ['rec', 'computing', 'preparing'].includes(global.MOD_IR.state)) {
        this.el.dlStatus.textContent = 'IR en curso — cancela el barrido primero'; return;
      }
      this._cancel(); const token = this._token;
      this.state = 'preparing'; this._measSrc = source;
      if (source === 'A') { this.dA = null; this.confA = 0; } else { this.dB = null; this.confB = 0; }
      this.resetReadouts();
      this._sampleRate = AE.sampleRate; this._ctx = AE.ctx; this._sessionId = AE.sessionId;
      if (!await Gen.acquire('delay')) {
        if (token === this._token) { this.state = 'idle'; this.el.dlStatus.textContent = 'no se pudo iniciar la referencia'; }
        return;
      }
      if (token !== this._token || !AE.running || this._ctx !== AE.ctx) { Gen.release('delay'); return; }
      this._genGeneration = Gen._generation;
      this._chMic = this._mk(); this._chRef = this._mk();
      this._unsubMic = AE.onBlock((mic, meta) => {
        if (meta && meta.sessionId != null && meta.sessionId !== this._sessionId) return;
        if (!Gen.playing || Gen._generation !== this._genGeneration || AE.ctx !== this._ctx || !meta || meta.sampleRate !== this._sampleRate) {
          this._cancel(); this._invalid(); return;
        }
        const ref = Gen.referenceBlock(meta.startFrame, mic.length);
        if (!ref) return;
        this._push(this._chMic, mic, meta); this._push(this._chRef, ref, meta);
      });
      this._measStart = performance.now(); this._lastSec = -1;
      this.state = source === 'A' ? 'measA' : 'measB';
      this._finishTimer = setTimeout(() => {
        if (token === this._token && (this.state === 'measA' || this.state === 'measB')) this._finishMeas();
      }, 3000);
      this.el.dlStatus.textContent = 'midiendo fuente ' + source + '…';
    },
    _finishMeas() {
      if (this._finishTimer != null) { clearTimeout(this._finishTimer); this._finishTimer = null; }
      this._stopSubs(); this.state = 'idle';
      const N = this.W, end = Math.min(this._chMic ? this._chMic.w : 0, this._chRef ? this._chRef.w : 0);
      if (!this._has(this._chMic, end) || !this._has(this._chRef, end)) {
        Gen.release('delay'); this._invalid(); return;
      }
      const mic = new Float64Array(N), ref = new Float64Array(N);
      this._segment(this._chMic, end, N, mic); this._segment(this._chRef, end, N, ref);
      let res;
      try {
        if (!this._fft) this._fft = new DSP.FFT(N);
        res = DSP.xcorrPeak(ref, mic, this._fft);
      } catch (error) {
        this._invalid(); this.el.dlStatus.textContent = 'error de cálculo — repite la medición'; return;
      } finally { Gen.release('delay'); }
      this.corr = res.corr; this._peakLag = res.lag;
      if (!this._usable(res)) {
        if (this._measSrc === 'A') { this.dA = null; this.confA = 0; } else { this.dB = null; this.confB = 0; }
        this._invalid(res); this.draw(); return;
      }
      if (this._measSrc === 'A') { this.dA = res.lag; this.confA = res.conf; }
      else { this.dB = res.lag; this.confB = res.conf; }
      this.el.dlStatus.textContent = 'fuente ' + this._measSrc + ': ' + (res.lag / this._sampleRate * 1000).toFixed(1) + ' ms de retardo total';
      this.updateResults(); this.draw();
    },
    updateResults() {
      this.resetReadouts();
      if (this.dA == null || this.dB == null || this.confA < 0.25 || this.confB < 0.25) {
        const confidence = this.dA != null ? this.confA : this.dB != null ? this.confB : 0;
        if (confidence) this.el.dlConf.textContent = Math.round(confidence * 100) + '%';
        return;
      }
      this._showResult(this.dB - this.dA, Math.min(this.confA, this.confB));
    },
    _showResult(lag, confidence) {
      const ms = lag / this._sampleRate * 1000;
      this.el.dlDelta.textContent = (ms > 0 ? '+' : '') + ms.toFixed(1);
      this.el.dlDist.textContent = Math.abs(ms * 0.343).toFixed(2);
      this.el.dlConf.textContent = Math.round(confidence * 100) + '%';
      this.el.dlRec.textContent = Math.abs(ms) < 0.3 ? 'alineadas ✓' : '+' + Math.abs(ms).toFixed(1) + ' ms → ' + (ms > 0 ? 'A' : 'B');
    },
    tick(dtMs) {
      if (this.state === 'measA' || this.state === 'measB') {
        if (!AE.running || AE.ctx !== this._ctx) { this.onAudioStop(); return; }
        const elapsed = performance.now() - this._measStart, sec = Math.min(3, Math.floor(elapsed / 1000));
        if (sec !== this._lastSec) {
          this._lastSec = sec; this.el.dlStatus.textContent = 'midiendo fuente ' + this._measSrc + '… (' + (3 - sec) + ' s)';
        }
        if (elapsed >= 3000) this._finishMeas();
        return;
      }
      if (this.mode !== 'dual' || !this._unsubPair) return;
      this._acc += dtMs;
      if (this._acc < 250) return;
      this._acc = 0;
      const end = Math.min(this._chA.w, this._chB.w), N = this.W;
      if (end === this._lastEnd || !this._has(this._chA, end) || !this._has(this._chB, end)) return;
      this._lastEnd = end;
      const a = new Float64Array(N), b = new Float64Array(N);
      this._segment(this._chA, end, N, a); this._segment(this._chB, end, N, b);
      if (!this._fft) this._fft = new DSP.FFT(N);
      const res = DSP.xcorrPeak(a, b, this._fft);
      this.corr = res.corr; this.conf = res.conf; this._peakLag = res.lag;
      if (!this._usable(res)) this._invalid(res);
      else { this._showResult(res.lag, res.conf); this.el.dlStatus.textContent = 'correlación en vivo (micro 1 = A · micro 2 = B)'; }
      this.draw();
    },
    draw() {
      if (!this.corr) return;
      const section = document.getElementById('mod-delay');
      if (section && !section.classList.contains('active')) return;
      const fitted = BAU.fitCanvas(this.el.cvDelay); if (!fitted) return;
      const { ctx, w, h } = fitted, N = this.corr.length, sr = this._sampleRate || AE.sampleRate;
      const span = Math.min(Math.floor(N / 2), Math.round(0.04 * sr)), maxMs = span / sr * 1000;
      const padL = 44, padB = 20, padT = 8, plotW = w - padL - 8, plotH = h - padB - padT;
      const at = (lag) => this.corr[(lag + N) % N] || 0;
      let peak = 1e-12;
      for (let lag = -span; lag <= span; lag++) peak = Math.max(peak, Math.abs(at(lag)));
      ctx.clearRect(0, 0, w, h); ctx.font = '10px JetBrains Mono, monospace'; ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(140,163,160,0.14)'; ctx.fillStyle = 'rgba(140,163,160,0.55)';
      for (let ms = Math.ceil(-maxMs / 10) * 10; ms <= maxMs; ms += 10) {
        const x = padL + (ms + maxMs) / (2 * maxMs) * plotW;
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke(); ctx.fillText((ms > 0 ? '+' : '') + ms, x - 8, h - 6);
      }
      ctx.strokeStyle = 'rgba(255,162,62,0.3)';
      ctx.beginPath(); ctx.moveTo(padL + plotW / 2, padT); ctx.lineTo(padL + plotW / 2, padT + plotH); ctx.stroke();
      ctx.beginPath();
      for (let lag = -span; lag <= span; lag++) {
        const x = padL + (lag + span) / (2 * span) * plotW, y = padT + plotH * (1 - (at(lag) / peak + 1) / 2);
        lag === -span ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#FFA23E'; ctx.lineWidth = 1.4; ctx.stroke();
      if (Number.isFinite(this._peakLag) && Math.abs(this._peakLag) <= span && Math.abs(at(this._peakLag)) > peak * 0.25) {
        const x = padL + (this._peakLag + span) / (2 * span) * plotW, ms = this._peakLag / sr * 1000;
        ctx.strokeStyle = 'rgba(245,176,76,0.7)'; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#F5B04C'; ctx.fillText((ms > 0 ? '+' : '') + ms.toFixed(1) + ' ms', x + 5, padT + 27);
      }
      ctx.font = '11px Inter, sans-serif'; ctx.fillStyle = '#8CA3A0';
      ctx.fillText(this.mode === 'dual' ? 'micro 1 vs micro 2 · retardo de B respecto a A' : 'micro vs salida interna · retardo total de cadena', padL + 8, padT + 12);
    },
  };
  global.MOD_DELAY = Delay;
})(window);
