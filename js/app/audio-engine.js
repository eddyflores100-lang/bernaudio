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
    noMic: false,
    deviceId: null,
    channels: 1,       // canales de entrada solicitados (1 o 2)
    realChannels: 1,   // canales que entrega realmente el dispositivo
    sampleRate: 48000,
    fftSize: 8192,
    _tap: null,
    _mute: null,
    _blockSubs: [],    // canal 0 (medición)
    _ch1Subs: [],      // canal 1 (referencia loopback / 2º micro)

    /* ── Permisos y arranque ── */
    async start(deviceId, channels) {
      if (this.running) await this.stop();
      this.channels = Math.max(1, Math.min(2, channels || 1));
      const constraints = {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: this.channels },
        },
      };
      if (deviceId) constraints.audio.deviceId = { exact: deviceId };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.deviceId = deviceId || null;
      this.noMic = false;

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

      /* Tap de bloques crudos (para TF, IR y delay finder) */
      this._tap = this.ctx.createScriptProcessor(4096, this.channels, 1);
      this._mute = this.ctx.createGain();
      this._mute.gain.value = 0;
      this._tap.onaudioprocess = (e) => {
        if (!this.running) return;
        const nCh = Math.min(this.channels, e.inputBuffer.numberOfChannels);
        this.realChannels = nCh;
        const b0 = new Float32Array(e.inputBuffer.getChannelData(0));
        for (const fn of this._blockSubs) {
          try { fn(b0); } catch (err) { console.error('[tap ch0]', err); }
        }
        if (nCh > 1) {
          const b1 = new Float32Array(e.inputBuffer.getChannelData(1));
          for (const fn of this._ch1Subs) {
            try { fn(b1); } catch (err) { console.error('[tap ch1]', err); }
          }
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
      this._ch1Subs = [];
      this.realChannels = 1;
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
      this.realChannels = 0;
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

    /* ── Suscripción a bloques del mic (canal 0) ── */
    onBlock(fn) {
      this._blockSubs.push(fn);
      return () => { this._blockSubs = this._blockSubs.filter((f) => f !== fn); };
    },

    /* Suscripción al canal 1 (requiere modo 2 canales + interfaz estéreo) */
    onBlockCh1(fn) {
      this._ch1Subs.push(fn);
      return () => { this._ch1Subs = this._ch1Subs.filter((f) => f !== fn); };
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
