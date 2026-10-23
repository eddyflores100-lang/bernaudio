/* ═══════════════════════════════════════════════════════════════
   BernAudio — modules-tf.js
   Módulos: Generador · Función de Transferencia · Impulso (IR)
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  const DSP = global.DSP, AE = global.AE, BAU = global.BAU;

  /* ════════════════ GENERADOR ════════════════ */
  const Gen = {
    src: null, osc: null, gain: null, analyser: null,
    playing: false, type: 'pink', _token: 0, _generation: 0,
    _refSubs: new Set(), _owners: new Set(), _userOwned: false,
    el: {},
    init() {
      ['genType', 'genFreq', 'genFreqChip', 'genSineCtl', 'genSweepCtl', 'genSweepDur',
       'genLevel', 'genLevelChip', 'genPlay', 'genStopBtn', 'genToTf', 'cvGen']
        .forEach((id) => (this.el[id] = document.getElementById(id)));
      this.el.genType.addEventListener('change', () => {
        this.type = this.el.genType.value;
        this.el.genSineCtl.style.display = this.type === 'sine' ? '' : 'none';
        this.el.genSweepCtl.style.display = this.type === 'sweep' ? '' : 'none';
        if (this.playing || this._starting) { this.stop(); this.play(); }
      });
      this.el.genFreq.addEventListener('input', () => {
        this.el.genFreqChip.textContent = this.el.genFreq.value + ' Hz';
        if (this.playing && this.osc) this.osc.frequency.value = +this.el.genFreq.value;
      });
      this.el.genLevel.addEventListener('input', () => {
        const db = +this.el.genLevel.value;
        this.el.genLevelChip.textContent = (db <= -60 ? '−∞' : db) + ' dB';
        if (this.gain && this._ctxRef === AE.ctx) {
          const frame = Math.round(AE.ctx.currentTime * AE.sampleRate);
          const value = this._outputGain();
          this.gain.gain.value = value;
          this._gainEvents.push({ frame, value });
        }
      });
      this.el.genPlay.addEventListener('click', () => { this.stop(); this.play(); });
      this.el.genStopBtn.addEventListener('click', () => this.stop());
      this.el.genToTf.addEventListener('click', () => {
        global.UI.showTab('tf');
        global.MOD_TF.start();
      });
    },
    _outputGain() {
      const db = Number(this.el.genLevel.value);
      return Number.isFinite(db) && db > -60 ? DSP.ampFromDb(DSP.clamp(db, -60, 0)) * 0.95 : 0;
    },
    _ensureNodes() {
      const ctx = AE.ctx;
      if (!ctx || ctx.state === 'closed') return null;
      if (this.gain && this._ctxRef === ctx) return ctx;
      this._disposeNodes();
      this._ctxRef = ctx;
      this.gain = ctx.createGain();
      this.gain.gain.value = this._outputGain();
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.gain.connect(ctx.destination);
      this.gain.connect(this.analyser);
      return ctx;
    },
    _disposeNodes() {
      for (const n of [this.gain, this.analyser]) if (n) { try { n.disconnect(); } catch (e) {} }
      this.gain = this.analyser = null;
      this._ctxRef = null;
    },
    onRefBlock(fn) {
      this._refSubs.add(fn);
      return () => this._refSubs.delete(fn);
    },
    async acquire(owner) {
      if (this.playing && this.type === 'pink') { this._owners.add(owner); return true; }
      this.stop();
      this.el.genType.value = 'pink';
      this.el.genSineCtl.style.display = this.el.genSweepCtl.style.display = 'none';
      const ok = await this.play({ owner });
      return ok;
    },
    release(owner) {
      this._owners.delete(owner);
      if (!this._userOwned && !this._owners.size) this.stop();
    },
    async play(options = {}) {
      if (this.playing) {
        if (options.owner) this._owners.add(options.owner); else this._userOwned = true;
        return true;
      }
      const type = this.el.genType.value;
      if (type === 'silence') { this.stop(); global.UI.setStatus('generador: silencio'); return false; }
      if (!['pink', 'white', 'sine', 'sweep'].includes(type) || !AE.ctx) return false;
      if (global.MOD_IR && ['rec', 'computing', 'preparing'].includes(global.MOD_IR.state)) {
        global.UI.setStatus('IR en curso — cancela el barrido antes de reproducir'); return false;
      }
      const token = ++this._token, ctx = AE.ctx;
      this._starting = true;
      try {
        if (ctx.state === 'suspended') await ctx.resume();
        if (token !== this._token || ctx !== AE.ctx || ctx.state === 'closed') return false;
        if (!this._ensureNodes()) return false;
        const sr = ctx.sampleRate;
        let source;
        this.type = type;
        this._signal = null;
        this._loop = type === 'pink' || type === 'white';
        this._frequency = DSP.clamp(+this.el.genFreq.value || 1000, 20, sr * 0.45);
        if (type === 'sine') {
          source = ctx.createOscillator();
          source.type = 'sine'; source.frequency.value = this._frequency;
          this.osc = source;
        } else {
          const dur = DSP.clamp(+this.el.genSweepDur.value || 10, 0.1, 60);
          const sig = type === 'sweep'
            ? DSP.makeSweep(sr, 20, Math.min(20000, sr * 0.45), dur, 0.25)
            : type === 'pink' ? DSP.makePinkNoise(sr * 4) : DSP.makeWhiteNoise(sr * 4);
          // Peak normalization leaves 0.45 dB of output headroom at 0 dB.
          let peak = 0;
          for (let i = 0; i < sig.length; i++) peak = Math.max(peak, Math.abs(sig[i]));
          if (peak > 0) for (let i = 0; i < sig.length; i++) sig[i] /= peak;
          this._signal = sig;
          const ab = ctx.createBuffer(1, sig.length, sr); ab.copyToChannel(sig, 0);
          source = ctx.createBufferSource(); source.buffer = ab; source.loop = this._loop;
          this.src = source;
        }
        this._startFrame = Math.ceil((ctx.currentTime + 0.02) * sr);
        this._gainEvents = [{ frame: this._startFrame, value: this._outputGain() }];
        this.gain.gain.value = this._outputGain();
        source.connect(this.gain);
        source.onended = () => { if (token === this._token && (source === this.src || source === this.osc)) this.stop(); };
        source.start(this._startFrame / sr);
        this.playing = true;
        this._generation++;
        if (options.owner) this._owners.add(options.owner); else this._userOwned = true;
        this._refUnsub = AE.onBlock((b, meta) => {
          if (!meta || !this.playing || !this._refSubs.size) return;
          const ref = this.referenceBlock(meta.startFrame, b.length);
          if (ref) for (const fn of this._refSubs) { try { fn(ref, meta); } catch (e) { console.error('[referencia]', e); } }
        });
        global.UI.setStatus('generador: ' + type);
        return true;
      } catch (e) {
        if (token === this._token) this.stop();
        global.UI.setStatus('No se pudo iniciar el generador');
        console.error(e);
        return false;
      } finally { if (token === this._token) this._starting = false; }
    },
    // The source is scheduled at an exact AudioContext frame. Reconstructing its
    // buffer at the microphone's frame avoids unrelated callback/FIFO offsets.
    referenceBlock(startFrame, length) {
      if (!this.playing || this._ctxRef !== AE.ctx || !Number.isFinite(startFrame)) return null;
      const out = new Float32Array(length), sr = this._ctxRef.sampleRate;
      let event = 0, gain = this._gainEvents[0].value;
      for (let i = 0; i < length; i++) {
        const frame = startFrame + i, offset = frame - this._startFrame;
        while (event + 1 < this._gainEvents.length && this._gainEvents[event + 1].frame <= frame) gain = this._gainEvents[++event].value;
        if (offset < 0) continue;
        if (this._signal) {
          if (this._loop || offset < this._signal.length) out[i] = this._signal[this._loop ? offset % this._signal.length : offset] * gain;
        } else out[i] = Math.sin(2 * Math.PI * this._frequency * offset / sr) * gain;
      }
      return out;
    },
    stop() {
      ++this._token; this._starting = false;
      this.playing = false;
      if (this._refUnsub) { this._refUnsub(); this._refUnsub = null; }
      for (const key of ['osc', 'src']) {
        const source = this[key]; this[key] = null;
        if (source) { source.onended = null; try { source.stop(); } catch (e) {} try { source.disconnect(); } catch (e) {} }
      }
      this._owners.clear(); this._userOwned = false;
      this._signal = null;
    },
    onAudioStop() { this.stop(); this._disposeNodes(); this._refSubs.clear(); },
    onAudioStart() { this.onAudioStop(); },
    onShow() { this.tick(); },
    tick() {
      const section = document.getElementById('mod-gen');
      if (section && !section.classList.contains('active')) return;
      const fitted = BAU.fitCanvas(this.el.cvGen); if (!fitted) return;
      const { ctx, w, h } = fitted;
      ctx.clearRect(0, 0, w, h);
      if (!this.playing || !this.analyser) {
        ctx.fillStyle = 'rgba(140,163,160,0.5)'; ctx.font = '12px Inter, sans-serif';
        ctx.fillText('Sin señal — pulsa Reproducir', 16, h / 2); return;
      }
      const N = 1024, data = new Float32Array(N);
      try { this.analyser.getFloatTimeDomainData(data); } catch (e) { return; }
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * w, y = h / 2 - data[i] * h * 0.45;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#FFA23E'; ctx.lineWidth = 1.4; ctx.stroke();
    },
  };

  /* ════════════════ FUNCIÓN DE TRANSFERENCIA ════════════════ */
  const TF = {
    W: 8192, FIFO: 1 << 17,
    refFifo: null, micFifo: null, refW: 0, micW: 0,
    SxyRe: null, SxyIm: null, Sxx: null, Syy: null,
    magDb: null, phaseDeg: null, coher: null,
    delaySamples: null, autoDelay: true, lastDelaySearch: 0,
    refSource: 'gen', polarity: false, traces: [], _traceSerial: 0,
    measuring: false, updates: 0, _fft: null, _startToken: 0,
    el: {},
    init() {
      ['tfStart', 'tfStop', 'tfAutoDelay', 'tfFindDelay', 'tfSmooth', 'tfView', 'tfDelayChip',
       'tfRef', 'tfDelayMs', 'tfDelayMsChip', 'tfPolarity', 'tfSaveTrace', 'tfClearTraces',
       'tfExportCsv', 'tfExportPng', 'cvTf']
        .forEach((id) => (this.el[id] = document.getElementById(id)));
      this.el.tfStart.addEventListener('click', () => this.start());
      this.el.tfStop.addEventListener('click', () => this.stop());
      this.el.tfAutoDelay.addEventListener('change', () => {
        this.autoDelay = this.el.tfAutoDelay.checked;
        this.resetAvg();
        if (!this.autoDelay) this.delaySamples = 0;
      });
      this.el.tfFindDelay.addEventListener('click', () => this.searchDelay(true));
      this.el.tfRef.addEventListener('change', () => {
        this.refSource = this.el.tfRef.value;
        this.stop(); this.resetAvg();
        global.UI.setStatus('Referencia seleccionada — pulsa Medir para iniciar');
      });
      this.el.tfDelayMs.addEventListener('input', () => {
        this.el.tfDelayMsChip.textContent = (+this.el.tfDelayMs.value).toFixed(1) + ' ms';
        this.resetAvg(true); this._updDelayChip();
      });
      this.el.tfPolarity.addEventListener('change', () => {
        this.polarity = this.el.tfPolarity.checked;
        this.resetAvg(true);
      });
      this.el.tfSaveTrace.addEventListener('click', () => this.saveTrace());
      this.el.tfClearTraces.addEventListener('click', () => { this.traces = []; this._traceSerial = 0; this.draw(); });
      this.el.tfSmooth.addEventListener('change', () => this.draw());
      this.el.tfView.addEventListener('change', () => this.draw());
      this.el.tfExportCsv.addEventListener('click', () => this.exportCsv());
      this.el.tfExportPng.addEventListener('click', () => this.exportPng());
      const size = this.W / 2 + 1;
      for (const key of ['SxyRe', 'SxyIm', 'Sxx', 'Syy', 'magDb', 'phaseDeg', 'coher']) this[key] = new Float64Array(size);
      this.refFifo = new Float32Array(this.FIFO); this.micFifo = new Float32Array(this.FIFO);
      this._sampleRate = AE.sampleRate;
      this.refSource = this.el.tfRef.value;
      this.autoDelay = this.el.tfAutoDelay.checked;
      this.polarity = this.el.tfPolarity.checked;
    },
    async start() {
      if (this.measuring || this._starting) return;
      if (!AE.running || !AE.analyser) { global.UI.setStatus('Inicia el micrófono antes de medir TF'); return; }
      if (global.MOD_IR && ['rec', 'computing', 'preparing'].includes(global.MOD_IR.state)) {
        global.UI.setStatus('IR en curso — cancela el barrido antes de medir TF'); return;
      }
      if (this.refSource === 'ch2' && (AE.realChannels < 2 || !AE.onPairBlock)) {
        global.UI.setStatus('Referencia canal 2 no disponible — conecta una entrada estéreo real'); return;
      }
      const token = ++this._startToken;
      this._starting = true;
      this._sampleRate = AE.sampleRate; this._ctx = AE.ctx; this._sessionId = AE.sessionId;
      this.resetAvg();
      try {
        if (this.refSource === 'gen') {
          if (!await Gen.acquire('tf')) return;
          if (token !== this._startToken || this._ctx !== AE.ctx || !AE.running) { Gen.release('tf'); return; }
          this._genGeneration = Gen._generation;
        }
        if (token !== this._startToken) return;
        this.measuring = true;
        if (!this.autoDelay) this.delaySamples = 0;
        if (this.refSource === 'ch2') {
          this._unsubPair = AE.onPairBlock((mic, ref, meta) => {
            if (!ref || AE.realChannels < 2) { this.stop(); global.UI.setStatus('Se perdió la referencia de canal 2'); return; }
            this._receivePair(mic, ref, meta);
          });
        } else {
          this._unsubMic = AE.onBlock((mic, meta) => {
            if (!Gen.playing || Gen._generation !== this._genGeneration) {
              this.stop(); global.UI.setStatus('Referencia interna detenida o cambiada — vuelve a medir'); return;
            }
            if (!meta || !Number.isFinite(meta.startFrame)) return;
            const ref = Gen.referenceBlock(meta.startFrame, mic.length);
            if (ref) this._receivePair(mic, ref, meta);
          });
        }
        this.lastDelaySearch = -Infinity;
        global.UI.setStatus('TF midiendo…');
      } finally { if (token === this._startToken) this._starting = false; }
    },
    stop() {
      ++this._startToken; this._starting = false; this.measuring = false;
      for (const key of ['_unsubMic', '_unsubRef', '_unsubPair']) {
        if (this[key]) this[key](); this[key] = null;
      }
      Gen.release('tf');
      global.UI.setStatus('TF detenida — puedes guardar la traza');
    },
    onAudioStop() { this.stop(); this.resetAvg(); },
    onAudioStart() { this.stop(); this._sampleRate = AE.sampleRate; this.resetAvg(); },
    onShow() { this.draw(); },
    _receivePair(mic, ref, meta) {
      if (!this.measuring || !mic || !ref || mic.length !== ref.length) return;
      if (meta && meta.sessionId != null && meta.sessionId !== this._sessionId) return;
      if (meta && meta.sampleRate && meta.sampleRate !== this._sampleRate) {
        this.stop(); global.UI.setStatus('Cambió la frecuencia de muestreo — vuelve a medir'); return;
      }
      const frame = meta && Number.isFinite(meta.startFrame) ? Math.round(meta.startFrame) : this.micW;
      if (this._lastFrame != null && frame !== this._lastFrame) this.resetAvg();
      this._push(this.micFifo, mic, 'mic', { startFrame: frame });
      this._push(this.refFifo, ref, 'ref', { startFrame: frame });
      this._lastFrame = frame + mic.length;
    },

    /* Exportar medición actual: CSV (f, mag, fase, coherencia) y PNG del gráfico */
    exportCsv() {
      if (!this.updates) {
        global.UI.setStatus('No hay medición que exportar — mide primero con ruido rosa');
        return;
      }
      const sr = this._sampleRate || AE.sampleRate;
      const N = this.W, n2 = N / 2, binHz = sr / N;
      const fMin = 20, fMax = Math.min(20000, sr / 2 * 0.95);
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
    _clearSpectra() {
      for (const key of ['SxyRe', 'SxyIm', 'Sxx', 'Syy', 'magDb', 'phaseDeg', 'coher']) if (this[key]) this[key].fill(0);
      this.updates = 0; this._lastWindowEnd = null;
    },
    resetAvg(keepDelay = false) {
      this._clearSpectra();
      if (!keepDelay) this.delaySamples = null;
      this.refW = this.micW = 0;
      this._refStart = this._micStart = null;
      this._lastFrame = this._lastDelayEnd = null;
      this._acc = 0;
      if (this.refFifo) this.refFifo.fill(0);
      if (this.micFifo) this.micFifo.fill(0);
      this._updDelayChip();
      this.draw();
    },
    _push(fifo, block, tag, meta) {
      const F = fifo.length, counter = tag === 'mic' ? 'micW' : 'refW';
      const first = tag === 'mic' ? '_micStart' : '_refStart';
      const start = meta && Number.isFinite(meta.startFrame) ? Math.round(meta.startFrame) : this[counter];
      if (this[first] == null || start !== this[counter]) this[first] = start;
      let w = start & (F - 1);
      for (let i = 0; i < block.length; i++) { fifo[w] = block[i]; w = (w + 1) & (F - 1); }
      this[counter] = start + block.length;
      this[first] = Math.max(this[first], this[counter] - F);
    },
    _segment(fifo, endPos, len, out) {
      const F = fifo.length, endMod = endPos & (F - 1);
      for (let i = 0; i < len; i++) out[len - 1 - i] = fifo[(endMod - 1 - i) & (F - 1)];
    },
    _hasRange(tag, end, len) {
      const first = tag === 'mic' ? this._micStart : this._refStart;
      const last = tag === 'mic' ? this.micW : this.refW;
      return first != null && end - len >= first && end <= last;
    },
    _correlationUsable(res) {
      if (!Number.isFinite(res.lag) || !Number.isFinite(res.conf) || res.conf < 0.25) return false;
      if (!res.corr || !res.corr.length) return false;
      // Repeated high peaks (e.g. a tone) do not identify a unique delay.
      const n = res.corr.length, peak = (Math.round(res.lag) + n) % n;
      const strength = Math.abs(res.peak);
      if (!(strength > 0)) return false;
      for (let i = 0; i < n; i++) {
        const d = Math.min((i - peak + n) % n, (peak - i + n) % n);
        if (d > 64 && Math.abs(res.corr[i]) > strength * 0.95) return false;
      }
      return true;
    },
    searchDelay(force) {
      if (!this.measuring && !force) return false;
      const N = this.W, end = Math.min(this.micW, this.refW);
      if (!this._hasRange('mic', end, N) || !this._hasRange('ref', end, N)) return false;
      if (!force && end === this._lastDelayEnd) return false;
      this._lastDelayEnd = end;
      const m = new Float64Array(N), r = new Float64Array(N);
      this._segment(this.micFifo, end, N, m); this._segment(this.refFifo, end, N, r);
      if (!this._fft) this._fft = new DSP.FFT(N);
      const res = DSP.xcorrPeak(r, m, this._fft);
      if (!this._correlationUsable(res)) {
        if (force || this.delaySamples == null) global.UI.setStatus('Delay sin correlación fiable — usa ruido de banda ancha y revisa la referencia');
        return false;
      }
      if (this.delaySamples !== res.lag) { this.delaySamples = res.lag; this._clearSpectra(); }
      this._updDelayChip();
      return true;
    },
    _updDelayChip() {
      if (!this.el.tfDelayChip) return;
      if (this.delaySamples == null) { this.el.tfDelayChip.textContent = 'delay: —'; return; }
      const sr = this._sampleRate || AE.sampleRate;
      const eff = this.delaySamples + Math.round((+this.el.tfDelayMs.value / 1000) * sr);
      this.el.tfDelayChip.textContent = 'retardo de cadena: ' + ((eff / sr) * 1000).toFixed(1) + ' ms';
    },
    saveTrace() {
      if (this.updates < 2) return;
      const serial = this._traceSerial++, name = String.fromCharCode(65 + serial % 26) + (serial >= 26 ? Math.floor(serial / 26) + 1 : '');
      this.traces.push({ name, sampleRate: this._sampleRate || AE.sampleRate, fftSize: this.W,
        mag: Float64Array.from(this.magDb), phase: Float64Array.from(this.phaseDeg) });
      if (this.traces.length > 3) this.traces.shift();
      global.UI.setStatus('Traza ' + name + ' guardada — compara fuentes');
      this.draw();
    },

    update() {
      if (!this.measuring || !AE.running) return;
      if (AE.sampleRate !== this._sampleRate || AE.ctx !== this._ctx) { this.onAudioStop(); return; }
      const N = this.W, half = N / 2, now = performance.now();
      if (this.autoDelay && now - this.lastDelaySearch > 2000) {
        this.lastDelaySearch = now; this.searchDelay(false);
      }
      if (this.delaySamples == null) return;
      const sr = this._sampleRate;
      const effDelay = this.delaySamples + Math.round((+this.el.tfDelayMs.value / 1000) * sr);
      // Pick a common timeline endpoint. For a negative correction, hold back
      // the microphone too, so the reference never reads unwritten future data.
      const end = Math.min(this.micW, this.refW + effDelay);
      if (!this._hasRange('mic', end, N) || !this._hasRange('ref', end - effDelay, N)) return;
      if (this._lastWindowEnd != null && end - this._lastWindowEnd < N / 2) return;
      const m = new Float64Array(N), r = new Float64Array(N), Mi = new Float64Array(N), Ri = new Float64Array(N);
      this._segment(this.micFifo, end, N, m); this._segment(this.refFifo, end - effDelay, N, r);
      const w = DSP.hannWindow(N);
      for (let i = 0; i < N; i++) { m[i] *= w[i] * (this.polarity ? -1 : 1); r[i] *= w[i]; }
      if (!this._fft) this._fft = new DSP.FFT(N);
      this._fft.forward(m, Mi); this._fft.forward(r, Ri);
      const alpha = this.updates ? 0.12 : 1, binHz = sr / N;
      const calFn = global.BA_STATE && global.BA_STATE.micCalDb;
      for (let k = 0; k <= half; k++) {
        const Xr = r[k], Xi = Ri[k], Yr = m[k], Yi = Mi[k];
        const sxyR = Yr * Xr + Yi * Xi, sxyI = Yi * Xr - Yr * Xi;
        const sxx = Xr * Xr + Xi * Xi, syy = Yr * Yr + Yi * Yi;
        this.SxyRe[k] += alpha * (sxyR - this.SxyRe[k]); this.SxyIm[k] += alpha * (sxyI - this.SxyIm[k]);
        this.Sxx[k] += alpha * (sxx - this.Sxx[k]); this.Syy[k] += alpha * (syy - this.Syy[k]);
        const real = this.SxyRe[k], imag = this.SxyIm[k];
        const mag = Math.hypot(real, imag) / (this.Sxx[k] + 1e-20);
        this.magDb[k] = DSP.dbFromAmp(mag) + (calFn ? calFn(k * binHz) : 0);
        this.phaseDeg[k] = Math.atan2(imag, real) * 180 / Math.PI;
        this.coher[k] = DSP.clamp((real * real + imag * imag) / (this.Sxx[k] * this.Syy[k] + 1e-20), 0, 1);
      }
      this._lastWindowEnd = end; this.updates++;
      this.draw();
    },

    draw() {
      const section = document.getElementById('mod-tf');
      if (section && !section.classList.contains('active')) return;
      const fitted = BAU.fitCanvas(this.el.cvTf); if (!fitted) return;
      const { ctx, w, h } = fitted;
      const padL = 40, padB = 22, padT = 8;
      const plotW = w - padL - 8, plotH = h - padB - padT;
      ctx.clearRect(0, 0, w, h);
      const sr = this._sampleRate || AE.sampleRate;
      const fmin = 20, fmax = Math.min(20000, sr / 2 * 0.95);
      const binHz = sr / this.W;

      const view = this.el.tfView.value;
      const smoothing = +this.el.tfSmooth.value;

      /* preparar curvas (con suavizado opcional) */
      const nb = this.W / 2 + 1;
      const freqs = new Float64Array(nb);
      for (let k = 0; k < nb; k++) freqs[k] = k * binHz;
      let mag = this.magDb, phase = this.phaseDeg, coh = this.coher;
      if (smoothing > 0) {
        mag = DSP.fracOctSmooth(freqs, this.magDb, smoothing);
        phase = DSP.fracOctSmoothPhase(freqs, this.phaseDeg, smoothing);
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

      const plotLine = (vals, yFn, color, lw, alpha, sourceBinHz = binHz, isPhase = false) => {
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        let started = false, previous = null;
        for (let k = 1; k < vals.length; k++) {
          const f = k * sourceBinHz;
          if (f < fmin || f > fmax) continue;
          if (!Number.isFinite(vals[k])) { started = false; previous = null; continue; }
          const xx = xOf(f), yy = yFn(vals[k]);
          if (isPhase && previous != null && Math.abs(vals[k] - previous) > 180) started = false;
          if (!started) { ctx.moveTo(xx, yy); started = true; } else ctx.lineTo(xx, yy);
          previous = vals[k];
        }
        ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();
        ctx.globalAlpha = 1;
      };

      /* trazas memorizadas A/B/C (comparar dos o más fuentes) */
      const traceColors = ['#F5B04C', '#B794F6', '#F97066'];
      for (let t = 0; t < this.traces.length; t++) {
        const tr = this.traces[t];
        const trBinHz = tr.sampleRate / tr.fftSize;
        if (view === 'both' || view === 'mag') plotLine(tr.mag, yOfMag, traceColors[t % 3], 1.2, 0.6, trBinHz);
        if (view === 'both' || view === 'phase') plotLine(tr.phase, yOfPh, traceColors[t % 3], 1, 0.45, trBinHz, true);
      }

      if (this.updates < 2) { this._legend(ctx, padL, padT); return; }

      /* coherencia (sombra inferior) */
      plotLine(coh, yOfCoh, '#8CA3A0', 1, 0.25);

      /* magnitud en vivo */
      if (view === 'both' || view === 'mag') plotLine(mag, yOfMag, '#FFA23E', 1.6, 1);
      /* fase en vivo */
      if (view === 'both' || view === 'phase') plotLine(phase, yOfPh, 'rgba(245,176,76,0.85)', 1.2, 1, binHz, true);

      this._legend(ctx, padL, padT);
    },

    _legend(ctx, padL, padT) {
      ctx.font = '11px Inter, sans-serif';
      ctx.fillStyle = '#FFA23E'; ctx.fillText('— Magnitud (dB)', padL + 8, padT + 12);
      ctx.fillStyle = 'rgba(245,176,76,0.9)'; ctx.fillText('— Fase', padL + 120, padT + 12);
      ctx.fillStyle = '#8CA3A0'; ctx.fillText('▁ coherencia', padL + 180, padT + 12);
      const traceColors = ['#F5B04C', '#B794F6', '#F97066'];
      for (let t = 0; t < this.traces.length; t++) {
        ctx.fillStyle = traceColors[t % 3];
        ctx.fillText('— ' + this.traces[t].name, padL + 262 + t * 56, padT + 12);
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
    state: 'idle', sweep: null, rec: null, recLen: 0, recTotal: 0,
    ir: null, sr: 0, peakIdx: 0, unsub: null, _token: 0, el: {},
    init() {
      ['irMeasure', 'irCancel', 'irDur', 'irExport', 'irStatusChip', 'irProgress',
       'irDelay', 'irDist', 'irRt60', 'irRt60L', 'irEdt', 'irT30', 'irC50', 'irC80', 'irPeakLvl', 'cvIr']
        .forEach((id) => (this.el[id] = document.getElementById(id)));
      this.el.irMeasure.addEventListener('click', () => this.measure());
      if (this.el.irCancel) this.el.irCancel.addEventListener('click', () => this.cancel());
      this.el.irExport.addEventListener('click', () => this.exportWav());
      this._controls(false);
    },
    _controls(busy) {
      this.el.irMeasure.disabled = busy;
      if (this.el.irCancel) this.el.irCancel.disabled = !busy;
      this.el.irDur.disabled = busy;
      this.el.irExport.disabled = busy || !this.ir;
    },
    _clearResults() {
      this.ir = null; this.peakIdx = 0;
      for (const id of ['irDelay', 'irDist', 'irRt60', 'irEdt', 'irT30', 'irC50', 'irC80', 'irPeakLvl']) this.el[id].textContent = '--';
      this.el.irRt60L.textContent = 'RT60 estimado';
      this.draw();
    },
    _cleanupCapture() {
      if (this._captureTimer != null) { clearTimeout(this._captureTimer); this._captureTimer = null; }
      if (this.unsub) { this.unsub(); this.unsub = null; }
      if (this._src) {
        this._src.onended = null;
        try { this._src.stop(); } catch (e) {}
        try { this._src.disconnect(); } catch (e) {}
        this._src = null;
      }
      if (this._gain) { try { this._gain.disconnect(); } catch (e) {} this._gain = null; }
    },
    _cleanupCompute() {
      if (this._timer != null) { clearTimeout(this._timer); this._timer = null; }
      if (this._worker) { this._worker.terminate(); this._worker = null; }
    },
    cancel(message = 'cancelado') {
      ++this._token; this._cleanupCapture(); this._cleanupCompute();
      this.state = 'idle'; this.rec = this.sweep = null; this.recLen = this.recTotal = 0;
      this.el.irProgress.style.display = 'none'; this.el.irStatusChip.textContent = message;
      this._controls(false);
    },
    onAudioStop() { this.cancel('medición detenida'); this._clearResults(); this._controls(false); },
    onAudioStart() { this.onAudioStop(); this.el.irStatusChip.textContent = 'sin medición'; },
    onShow() { this.draw(); },
    async measure() {
      if (['preparing', 'rec', 'computing'].includes(this.state)) return;
      if (!AE.running || !AE.analyser || !AE.ctx) { global.UI.setStatus('Inicia el micrófono antes de medir IR'); return; }
      this.cancel(); this._clearResults();
      const token = this._token, ctx = AE.ctx;
      this._ctx = ctx; this._sessionId = AE.sessionId; this.state = 'preparing'; this._controls(true);
      // A sweep needs exclusive output and a continuous recording timeline.
      if (global.MOD_TF.measuring || global.MOD_TF._starting) global.MOD_TF.stop();
      if (global.MOD_DELAY && (global.MOD_DELAY.state !== 'idle' || global.MOD_DELAY._unsubPair)) global.MOD_DELAY.onAudioStop();
      Gen.stop();
      try {
        if (ctx.state === 'suspended') await ctx.resume();
        if (token !== this._token || ctx !== AE.ctx || !AE.running) return;
        const dur = DSP.clamp(+this.el.irDur.value || 10, 0.01, 20);
        this.sr = ctx.sampleRate;
        const fftLength = DSP.nextPow2(Math.round(this.sr * (2 * dur + 1.5)));
        const workerAvailable = !!(global.Worker && document.baseURI);
        if (fftLength > (workerAvailable ? 1 << 22 : 1 << 20)) {
          this.cancel('captura demasiado grande — reduce duración o frecuencia de muestreo'); return;
        }
        const level = Number(Gen.el.genLevel.value);
        const gain = Number.isFinite(level) && level > -60 ? DSP.ampFromDb(DSP.clamp(level, -60, 0)) : 0;
        if (!(gain > 0)) { this.cancel('nivel de salida en silencio'); return; }
        this.sweep = DSP.makeSweep(this.sr, 20, Math.min(20000, this.sr * 0.45), dur, 0.25);
        for (let i = 0; i < this.sweep.length; i++) this.sweep[i] *= 0.95;
        this.recTotal = Math.round(this.sr * (dur + 1.5));
        this.rec = new Float32Array(this.recTotal); this.recLen = 0; this._clipped = false;
        this._recStartFrame = Math.ceil((ctx.currentTime + 0.05) * this.sr);
        const ab = ctx.createBuffer(1, this.sweep.length, this.sr); ab.copyToChannel(this.sweep, 0);
        this._src = ctx.createBufferSource(); this._src.buffer = ab;
        this._gain = ctx.createGain(); this._gain.gain.value = gain;
        this._src.connect(this._gain); this._gain.connect(ctx.destination);
        this.el.irProgress.style.display = ''; this.el.irProgress.firstElementChild.style.width = '0%';
        this.el.irStatusChip.textContent = 'grabando…'; this.state = 'rec';
        // Subscribe before start(), and trim by capture frame rather than by
        // callback arrival time, so peak delay includes the actual audio chain.
        this.unsub = AE.onBlock((block, meta) => {
          if (token !== this._token || this.state !== 'rec') return;
          if (meta && meta.sessionId != null && meta.sessionId !== this._sessionId) return;
          if (AE.ctx !== ctx || !AE.running || !meta || meta.sampleRate !== this.sr || !Number.isFinite(meta.startFrame)) {
            this.cancel('captura interrumpida — repite la medición'); return;
          }
          const first = Math.max(0, this._recStartFrame - meta.startFrame);
          const offset = Math.max(0, meta.startFrame - this._recStartFrame);
          if (first >= block.length) return;
          if (offset > this.recLen) { this.cancel('faltan bloques de audio — repite la medición'); return; }
          const skip = Math.max(first, this.recLen - (meta.startFrame - this._recStartFrame));
          const n = Math.min(block.length - skip, this.recTotal - this.recLen);
          if (n <= 0) return;
          for (let i = skip; i < skip + n; i++) {
            if (!Number.isFinite(block[i])) { this.cancel('captura inválida — repite la medición'); return; }
            if (Math.abs(block[i]) >= 0.999) this._clipped = true;
          }
          this.rec.set(block.subarray(skip, skip + n), this.recLen); this.recLen += n;
          this.el.irProgress.firstElementChild.style.width = (100 * this.recLen / this.recTotal).toFixed(0) + '%';
          if (this.recLen >= this.recTotal) this.finish();
        });
        this._src.start(this._recStartFrame / this.sr);
        this._captureTimer = setTimeout(() => {
          if (token === this._token && this.state === 'rec') this.cancel('captura interrumpida — repite la medición');
        }, (dur + 5) * 1000);
        global.UI.setStatus('IR: barrido en curso…');
      } catch (e) {
        if (token === this._token) this.cancel('no se pudo iniciar el barrido');
        console.error(e);
      }
    },
    finish() {
      if (this.state !== 'rec') return;
      this._cleanupCapture();
      this.state = 'computing'; this.el.irStatusChip.textContent = 'calculando…';
      const token = this._token, rec = this.rec, sweep = this.sweep, sr = this.sr;
      this._recordLength = rec.length; this._sweepLength = sweep.length;
      this._timer = setTimeout(() => {
        this._timer = null;
        if (token !== this._token || this.state !== 'computing') return;
        // Long transforms run in a cancellable local worker when supported.
        if (global.Worker && document.baseURI) {
          try {
            const workerUrl = new URL('js/app/analysis-worker.js', document.baseURI).href;
            this._worker = new global.Worker(workerUrl);
            this._worker.onmessage = (e) => {
              if (token !== this._token) return;
              this._cleanupCompute();
              if (e.data.error) this.cancel('error de cálculo'); else this._complete(e.data, token);
            };
            this._worker.onerror = () => { if (token === this._token) this.cancel('error de cálculo — repite la medición'); };
            this._worker.postMessage({ rec, sweep, sr }, [rec.buffer, sweep.buffer]);
            return;
          } catch (e) { this._cleanupCompute(); }
        }
        if (DSP.nextPow2(rec.length + sweep.length) > 1 << 20) {
          this.cancel('calculador local no disponible — reduce la duración del barrido'); return;
        }
        try {
          const { ir } = DSP.deconvolveIR(rec, sweep), pk = DSP.findPeak(ir);
          this._complete({ ir, pk, referenceCorrelation: this._referenceCorrelation(rec, sweep, pk.idx),
            rt: DSP.schroederRT60(ir, sr, pk.idx), cc: DSP.clarityC(ir, sr, pk.idx) }, token);
        } catch (e) { if (token === this._token) this.cancel('error de cálculo'); console.error(e); }
      }, 30);
    },
    _referenceCorrelation(rec, sweep, offset) {
      const n = sweep.length;
      if (!n || !Number.isInteger(offset) || offset < 0 || offset + n > rec.length) return 0;
      let sx = 0, sy = 0, xx = 0, yy = 0, xy = 0;
      for (let i = 0; i < n; i++) {
        const x = sweep[i], y = rec[offset + i];
        if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
        sx += x; sy += y; xx += x * x; yy += y * y; xy += x * y;
      }
      const norm = Math.sqrt(Math.max(0, xx - sx * sx / n) * Math.max(0, yy - sy * sy / n));
      return norm > 0 ? DSP.clamp((xy - sx * sy / n) / norm, -1, 1) : 0;
    },
    _quality(ir, peak) {
      const maxLag = this._recordLength - this._sweepLength;
      if (!Number.isInteger(peak.idx) || peak.idx < 0 || peak.idx > maxLag || !(peak.val > 1e-10)) return { valid: false };
      // This is a conservative estimate of peak prominence, not calibrated SNR
      // or proof of room-acoustic accuracy. A causal peak needs a full recorded
      // sweep and at least 20 dB over both global and late IR background RMS.
      const guard = Math.max(8, Math.round(this.sr * 0.005));
      const tailStart = Math.floor(maxLag * 0.75), tailEnd = Math.min(ir.length, maxLag + 1);
      let energy = 0, count = 0, tailEnergy = 0, tailCount = 0;
      for (let i = 0; i < ir.length; i++) {
        const value = ir[i];
        if (!Number.isFinite(value)) return { valid: false };
        if (Math.abs(i - peak.idx) <= guard) continue;
        energy += value * value; count++;
        if (i >= tailStart && i < tailEnd) { tailEnergy += value * value; tailCount++; }
      }
      if (!count || !tailCount) return { valid: false };
      const background = Math.max(Math.sqrt(energy / count), Math.sqrt(tailEnergy / tailCount));
      const peakToNoiseDb = background > 0 ? 20 * Math.log10(peak.val / background) : Infinity;
      return { valid: peakToNoiseDb >= 20, peakToNoiseDb };
    },
    _complete(result, token) {
      if (token !== this._token || this.state !== 'computing' || AE.ctx !== this._ctx || !AE.running) return;
      const { ir, pk, rt, cc } = result;
      if (!ir || !ir.length || !Number.isFinite(pk.val) || !(pk.val > 1e-10)) {
        this.cancel('sin señal de barrido detectable'); return;
      }
      if (!Number.isFinite(result.referenceCorrelation) || Math.abs(result.referenceCorrelation) < 0.1) {
        this._clearResults(); this.cancel('barrido sin correlación con la captura — revisa la salida y repite'); return;
      }
      const quality = this._quality(ir, pk);
      if (this._clipped || !quality.valid) {
        this._clearResults();
        this.cancel(this._clipped ? 'captura saturada — baja la ganancia y repite' : 'respuesta no fiable — baja el ruido y repite'); return;
      }
      this.ir = ir; this.peakIdx = pk.idx;
      const delayMs = pk.idx / this.sr * 1000;
      this.el.irDelay.textContent = delayMs.toFixed(1); this.el.irDist.textContent = (delayMs * 0.343).toFixed(2);
      this.el.irRt60.textContent = rt.rt60 != null ? rt.rt60.toFixed(2) : '--';
      this.el.irRt60L.textContent = 'RT60 estimado (' + rt.detail + ')';
      this.el.irEdt.textContent = rt.edt != null ? rt.edt.toFixed(2) : '--';
      this.el.irT30.textContent = rt.t30 != null ? rt.t30.toFixed(2) : '--';
      this.el.irC50.textContent = cc.c50 != null ? cc.c50.toFixed(1) : '--';
      this.el.irC80.textContent = cc.c80 != null ? cc.c80.toFixed(1) : '--';
      this.el.irPeakLvl.textContent = DSP.dbFromAmp(pk.val).toFixed(1);
      const prominence = Number.isFinite(quality.peakToNoiseDb) ? quality.peakToNoiseDb.toFixed(0) : '>80';
      this.el.irStatusChip.textContent = 'listo ✓ · |r|=' + Math.abs(result.referenceCorrelation).toFixed(2) +
        ' · pico/ruido estimado: ' + prominence + ' dB';
      this.el.irProgress.style.display = 'none'; this.state = 'done';
      this.rec = this.sweep = null; this._controls(false); this.draw();
      global.UI.setStatus('IR terminada · retardo total de cadena, incluida la interfaz');
    },

    draw() {
      const section = document.getElementById('mod-ir');
      if (section && !section.classList.contains('active')) return;
      const fitted = BAU.fitCanvas(this.el.cvIr); if (!fitted) return;
      const { ctx, w, h } = fitted;
      ctx.clearRect(0, 0, w, h);
      if (!this.ir) return;
      const sr = this.sr;
      /* ventana de visualización: 100 ms antes del pico → +2.5 s (o hasta el fin) */
      const from = Math.max(0, this.peakIdx - Math.round(0.1 * sr));
      const to = Math.min(this.ir.length, this.peakIdx + Math.round(2.5 * sr));
      const n = to - from;
      if (n < 2) return;
      const padL = 40, padB = 20, padT = 8;
      const plotW = w - padL - 8, plotH = h - padB - padT;

      /* rejilla ms */
      const durMs = ((n - 1) / sr) * 1000, firstMs = ((from - this.peakIdx) / sr) * 1000;
      ctx.fillStyle = 'rgba(140,163,160,0.55)'; ctx.strokeStyle = 'rgba(140,163,160,0.14)';
      ctx.font = '10px JetBrains Mono, monospace'; ctx.lineWidth = 1;
      const stepMs = durMs > 1500 ? 250 : durMs > 400 ? 100 : 50;
      for (let ms = Math.ceil(firstMs / stepMs) * stepMs; ms <= firstMs + durMs; ms += stepMs) {
        const xx = padL + ((ms - firstMs) / durMs) * plotW;
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
      ctx.fillText('pico de la cadena', px - 24, padT + 12);
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
