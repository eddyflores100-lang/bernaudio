/* Local capture with verified hardware channels and context-frame timestamps. */
(function (global) {
  'use strict';
  const AE = {
    ctx: null, stream: null, analyser: null, srcNode: null, running: false, noMic: false,
    deviceId: null, channels: 1, realChannels: 0, sampleRate: 48000, fftSize: 8192,
    backend: 'detenido', sessionId: 0, frames: 0, clipped: false, settings: {},
    _epoch: 0,
    _aborted() { const error = new Error('Inicio cancelado.'); error.name = 'AbortError'; return error; },
    _blockSubs: [], _ch1Subs: [], _pairSubs: [],
    async _context(epoch) {
      const Context = global.AudioContext || global.webkitAudioContext;
      if (!Context) throw new Error('Este navegador no admite Web Audio.');
      const ctx = new Context({ latencyHint: 'interactive' }); this.ctx = ctx;
      this.sampleRate = this.ctx.sampleRate; this.sessionId++; this._workletReady = false;
      if (this.ctx.audioWorklet && global.AudioWorkletNode) {
        try { await this.ctx.audioWorklet.addModule('js/app/capture-worklet.js?v=48be96b12ebd'); this._workletReady = true; }
        catch (e) { console.warn('Captura compatible: AudioWorklet no disponible.', e); }
      }
      if (epoch !== this._epoch) { try { await ctx.close(); } catch (_) {} throw this._aborted(); }
      this.ctx.onstatechange = () => {
        if (global.UI && this.ctx && this.running && this.ctx.state !== 'running')
          global.UI.setStatus('Audio suspendido — vuelve a pulsar Reanudar audio.');
      };
    },
    async start(deviceId, channels) {
      const stopping = this.stop(), epoch = this._epoch;
      await stopping;
      if (epoch !== this._epoch) throw this._aborted();
      this.channels = Math.max(1, Math.min(2, channels || 1));
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('El micrófono requiere HTTPS o localhost y un navegador compatible.');
      const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: this.channels } };
      if (deviceId) audio.deviceId = { exact: deviceId };
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio });
        if (epoch !== this._epoch) { stream.getTracks().forEach(t => t.stop()); throw this._aborted(); }
        this.stream = stream;
        const track = this.stream.getAudioTracks()[0];
        this.settings = track.getSettings ? track.getSettings() : {};
        this.realChannels = Math.min(this.channels, Math.max(1, this.settings.channelCount || 1));
        this.deviceId = deviceId || null;
        await this._context(epoch);
        if (epoch !== this._epoch) throw this._aborted();
        await this.ctx.resume();
        if (epoch !== this._epoch) throw this._aborted();
        this.srcNode = this.ctx.createMediaStreamSource(this.stream);
        this.analyser = this.ctx.createAnalyser(); this.analyser.smoothingTimeConstant = 0;
        this.setFftSize(this.fftSize);
        this._splitter = this.ctx.createChannelSplitter(Math.max(2, this.realChannels));
        this.srcNode.connect(this._splitter); this._splitter.connect(this.analyser, 0);
        this._mute = this.ctx.createGain(); this._mute.gain.value = 0;
        if (this._workletReady) {
          this.backend = 'AudioWorklet';
          this._tap = new global.AudioWorkletNode(this.ctx, 'bernaudio-capture', {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
            channelCount: this.realChannels, channelCountMode: 'explicit', channelInterpretation: 'discrete',
            processorOptions: { blockSize: 2048 }
          });
          this._tap.port.onmessage = e => this._dispatch(e.data.channels[0], e.data.channels[1] || null, e.data.startFrame);
        } else {
          this.backend = 'Compatibilidad (hilo principal)';
          this._tap = this.ctx.createScriptProcessor(4096, this.realChannels, 1);
          this._tap.onaudioprocess = e => {
            const b0 = new Float32Array(e.inputBuffer.getChannelData(0));
            const b1 = this.realChannels > 1 ? new Float32Array(e.inputBuffer.getChannelData(1)) : null;
            this._dispatch(b0, b1, Math.round((e.playbackTime - b0.length / this.sampleRate) * this.sampleRate));
          };
        }
        this.srcNode.connect(this._tap); this._tap.connect(this._mute); this._mute.connect(this.ctx.destination);
        this.frames = 0; this.noMic = false; this.running = true;
        track.addEventListener?.('ended', () => {
          if (this.running && epoch === this._epoch && global.UI) global.UI.shutdown('Micrófono desconectado — vuelve a iniciar con otra entrada.');
        });
        return this.sampleRate;
      } catch (e) { if (epoch === this._epoch) await this.stop(); throw e; }
    },
    _dispatch(b0, b1, startFrame) {
      if (!this.running || !b0) return;
      const meta = { startFrame, sampleRate: this.sampleRate, sessionId: this.sessionId };
      this.frames += b0.length; this.clipped = b0.some(v => Math.abs(v) >= 0.999);
      const send = (subs, ...args) => { for (const fn of [...subs]) { try { fn(...args); } catch (e) { console.error('Procesamiento de audio:', e); } } };
      send(this._blockSubs, b0, meta);
      if (this.realChannels > 1 && b1) { send(this._ch1Subs, b1, meta); send(this._pairSubs, b0, b1, meta); }
    },
    async stop() {
      this._epoch++;
      this.running = false;
      if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
      if (this._tap) {
        if (this._tap.port) { this._tap.port.onmessage = null; this._tap.port.close(); }
        this._tap.onaudioprocess = null;
      }
      for (const key of ['_tap', '_splitter', 'srcNode', 'analyser', '_mute']) { try { this[key]?.disconnect(); } catch (_) {} this[key] = null; }
      const ctx = this.ctx; this.ctx = null;
      if (ctx) ctx.onstatechange = null;
      this._blockSubs = []; this._ch1Subs = []; this._pairSubs = [];
      this.realChannels = 0; this.frames = 0; this.clipped = false; this.backend = 'detenido';
      if (ctx) try { await ctx.close(); } catch (_) {}
    },
    async startCtxOnly() {
      const stopping = this.stop(), epoch = this._epoch;
      await stopping;
      if (epoch !== this._epoch) throw this._aborted();
      try {
        await this._context(epoch);
        if (epoch !== this._epoch) throw this._aborted();
        await this.ctx.resume();
        if (epoch !== this._epoch) throw this._aborted();
      } catch (e) { if (epoch === this._epoch) await this.stop(); throw e; }
      this.noMic = true; this.realChannels = 0; return this.sampleRate;
    },
    async inputs() {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    },
    setFftSize(n) {
      if (![2048, 4096, 8192, 16384, 32768].includes(n)) throw new Error('Tamaño FFT no válido.');
      this.fftSize = n; if (this.analyser) this.analyser.fftSize = n;
      this.freqDb = new Float64Array(n / 2 + 1).fill(-Infinity); this.timeData = new Float32Array(n);
      this._fft = new global.DSP.FFT(n); this._win = global.DSP.hannWindow(n);
      this._re = new Float64Array(n); this._im = new Float64Array(n);
    },
    poll() {
      if (!this.running || !this.analyser) return false;
      this.analyser.getFloatTimeDomainData(this.timeData);
      global.DSP.powerSpectrumDb(this.timeData, this._fft, this._win, this._re, this._im, this.freqDb); return true;
    },
    onBlock(fn) { this._blockSubs.push(fn); return () => { this._blockSubs = this._blockSubs.filter(f => f !== fn); }; },
    onBlockCh1(fn) { this._ch1Subs.push(fn); return () => { this._ch1Subs = this._ch1Subs.filter(f => f !== fn); }; },
    onPairBlock(fn) { this._pairSubs.push(fn); return () => { this._pairSubs = this._pairSubs.filter(f => f !== fn); }; },
    rms() { return Math.sqrt(this.timeData.reduce((s, v) => s + v * v, 0) / this.timeData.length); },
    peak() { return this.timeData.reduce((p, v) => Math.max(p, Math.abs(v)), 0); }
  };
  global.AE = AE;
})(window);
