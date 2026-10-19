/* ═══════════════════════════════════════════════════════════════
   BernAudio — audio-engine.js
   Gestión de AudioContext, micrófono, analizador FFT y toques
   (taps) de bloques para medición multicanal.
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const AE = {
    ctx: null,
    stream: null,
    srcNode: null,
    analyser: null,
    freqDb: null,      // Float32Array dB/bin (getFloatFrequencyData)
    timeData: null,    // Float32Array forma de onda (getFloatTimeDomainData)
    running: false,
    deviceId: null,
    sampleRate: 48000,
    fftSize: 8192,
    _tap: null,
    _mute: null,
    _blockSubs: [],

    /* ── Permisos y arranque ── */
    async start(deviceId) {
      if (this.running) await this.stop();
      const constraints = {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      };
      if (deviceId) constraints.audio.deviceId = { exact: deviceId };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.deviceId = deviceId || null;

      this.ctx = new (global.AudioContext || global.webkitAudioContext)({
        latencyHint: 'interactive',
      });
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.sampleRate = this.ctx.sampleRate;

      this.srcNode = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      this.analyser.smoothingTimeConstant = 0; // promediado manual
      this.freqDb = new Float32Array(this.analyser.frequencyBinCount);
      this.timeData = new Float32Array(this.analyser.fftSize);

      /* Tap de bloques crudos (para TF e IR) */
      this._tap = this.ctx.createScriptProcessor(4096, 1, 1);
      this._mute = this.ctx.createGain();
      this._mute.gain.value = 0;
      this._tap.onaudioprocess = (e) => {
        if (!this.running) return;
        const block = e.inputBuffer.getChannelData(0);
        for (const fn of this._blockSubs) {
          try { fn(new Float32Array(block)); } catch (err) { console.error('[tap]', err); }
        }
      };

      this.srcNode.connect(this.analyser);
      this.srcNode.connect(this._tap);
      this._tap.connect(this._mute);
      this._mute.connect(this.ctx.destination);

      this.running = true;
      return this.sampleRate;
    },

    async stop() {
      this.running = false;
      this._blockSubs = [];
      if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
      if (this._tap) { this._tap.onaudioprocess = null; try { this._tap.disconnect(); } catch (e) {} this._tap = null; }
      if (this.srcNode) { try { this.srcNode.disconnect(); } catch (e) {} this.srcNode = null; }
      if (this.analyser) { try { this.analyser.disconnect(); } catch (e) {} this.analyser = null; }
      if (this._mute) { try { this._mute.disconnect(); } catch (e) {} this._mute = null; }
      if (this.ctx) { try { await this.ctx.close(); } catch (e) {} this.ctx = null; }
    },

    /* ── Contexto sin micrófono (solo generador) ── */
    async startCtxOnly() {
      if (this.running) await this.stop();
      this.ctx = new (global.AudioContext || global.webkitAudioContext)({
        latencyHint: 'interactive',
      });
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.sampleRate = this.ctx.sampleRate;
      this.noMic = true;
      return this.sampleRate;
    },

    /* ── Lista de entradas ── */
    async inputs() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter((d) => d.kind === 'audioinput');
    },

    /* ── FFT ── */
    setFftSize(n) {
      this.fftSize = n;
      if (this.analyser) {
        this.analyser.fftSize = n;
        this.freqDb = new Float32Array(this.analyser.frequencyBinCount);
        this.timeData = new Float32Array(n);
      }
    },

    /* Llenar freqDb / timeData (llamar 1× por frame desde el módulo activo) */
    poll() {
      if (!this.running) return false;
      this.analyser.getFloatFrequencyData(this.freqDb);
      this.analyser.getFloatTimeDomainData(this.timeData);
      return true;
    },

    /* ── Suscripción a bloques del mic ── */
    onBlock(fn) {
      this._blockSubs.push(fn);
      return () => { this._blockSubs = this._blockSubs.filter((f) => f !== fn); };
    },

    /* RMS de la forma de onda actual */
    rms() {
      let s = 0;
      for (let i = 0; i < this.timeData.length; i++) s += this.timeData[i] * this.timeData[i];
      return Math.sqrt(s / this.timeData.length);
    },
    peak() {
      let p = 0;
      for (let i = 0; i < this.timeData.length; i++) { const a = Math.abs(this.timeData[i]); if (a > p) p = a; }
      return p;
    },
  };

  global.AE = AE;
})(window);
