/* ═══════════════════════════════════════════════════════════════
   BernAudio — dsp.js
   Motor DSP puro (sin DOM): FFT, ventanas, ponderaciones A/C,
   bandas de octava, señales de prueba, deconvolución y RT60.
   Compatible con Node (tests) y navegador.
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ── Utilidades de nivel ─────────────────────────────────── */
  const dbFromPower = (p) => (p > 0 ? 10 * Math.log10(p) : -Infinity);
  const dbFromAmp   = (a) => (a > 0 ? 20 * Math.log10(a) : -Infinity);
  const powerFromDb = (db) => Math.pow(10, db / 10);
  const ampFromDb   = (db) => Math.pow(10, db / 20);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function nextPow2(n) {
    let p = 1;
    while (p < n) p *= 2;
    return p;
  }

  /* ── FFT radix-2 iterativa (convención e^{-iθ}, in-place) ── */
  class FFT {
    constructor(n) {
      n = n | 0;
      if (n < 2 || (n & (n - 1)) !== 0) throw new Error('FFT: el tamaño debe ser potencia de 2');
      this.n = n;
      this.levels = Math.round(Math.log2(n));
      this.cosTable = new Float64Array(n / 2);
      this.sinTable = new Float64Array(n / 2);
      for (let i = 0; i < n / 2; i++) {
        this.cosTable[i] = Math.cos((2 * Math.PI * i) / n);
        this.sinTable[i] = Math.sin((2 * Math.PI * i) / n);
      }
      this.rev = new Uint32Array(n);
      for (let i = 0; i < n; i++) {
        let x = i, r = 0;
        for (let b = 0; b < this.levels; b++) { r = (r << 1) | (x & 1); x >>= 1; }
        this.rev[i] = r;
      }
    }

    /* FFT hacia adelante, in-place sobre re/im (Float64Array de longitud n) */
    forward(re, im) {
      const n = this.n, rev = this.rev, cosT = this.cosTable, sinT = this.sinTable;
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
        }
      }
      for (let size = 2; size <= n; size *= 2) {
        const half = size >> 1, step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = i, k = 0; j < i + half; j++, k += step) {
            const l = j + half;
            const c = cosT[k], s = sinT[k];
            const tre = re[l] * c + im[l] * s;
            const tim = -re[l] * s + im[l] * c;
            re[l] = re[j] - tre; im[l] = im[j] - tim;
            re[j] += tre;        im[j] += tim;
          }
        }
      }
    }

    /* FFT inversa (escala 1/n), in-place */
    inverse(re, im) {
      const n = this.n;
      for (let i = 0; i < n; i++) im[i] = -im[i];
      this.forward(re, im);
      for (let i = 0; i < n; i++) { re[i] /= n; im[i] = -im[i] / n; }
    }
  }

  /* ── Ventanas ────────────────────────────────────────────── */
  function hannWindow(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
    return w;
  }
  function blackmanHarris(n) {
    const w = new Float64Array(n), a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
    for (let i = 0; i < n; i++) {
      const t = (2 * Math.PI * i) / n;
      w[i] = a0 - a1 * Math.cos(t) + a2 * Math.cos(2 * t) - a3 * Math.cos(3 * t);
    }
    return w;
  }
  /* Ganancia de potencia coherente (corrección de amplitud) */
  function windowPowerGain(w) {
    let s = 0;
    for (let i = 0; i < w.length; i++) s += w[i];
    const mean = s / w.length;
    return mean * mean; // corrección de potencia sobre |X|²
  }

  /* ── Ponderaciones de frecuencia (IEC 61672 aprox.) ──────── */
  const A_CORR = 2.0, C_CORR = 0.062;
  function aWeightDb(f) {
    const f2 = f * f;
    const num = 12194 * 12194 * f2 * f2;
    const den = (f2 + 20.6 * 20.6) *
      Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) *
      (f2 + 12194 * 12194);
    return 20 * Math.log10(num / den) + A_CORR;
  }
  function cWeightDb(f) {
    const f2 = f * f;
    const num = 12194 * 12194 * f2;
    const den = (f2 + 20.6 * 20.6) * (f2 + 12194 * 12194);
    return 20 * Math.log10(num / den) + C_CORR;
  }

  /* ── Bandas de octava (base 2, ANSI) ─────────────────────── */
  /* nPerOct: 1 o 3 → devuelve [{fc, lo, hi}] */
  function octaveBands(nPerOct, fMin, fMax) {
    const centers = [];
    const base = [31.25, 25, 31.5]; // fc inicial para 1/1 y 1/3 (nominal 31.5)
    const start = nPerOct === 3 ? 20 : 31.5;
    // generar centros exactos base-2 desde 20 Hz hacia arriba
    let fc = start;
    const ratio = Math.pow(2, 1 / nPerOct);
    while (fc <= fMax * Math.pow(2, 1 / (2 * nPerOct))) {
      centers.push(fc);
      fc *= ratio;
    }
    return centers
      .map((c) => ({
        fc: c,
        lo: c / Math.pow(2, 1 / (2 * nPerOct)),
        hi: c * Math.pow(2, 1 / (2 * nPerOct)),
      }))
      .filter((b) => b.hi >= fMin);
  }

  /* Etiquetas nominales ANSI */
  function bandLabel(fc) {
    if (fc >= 1000) {
      const k = fc / 1000;
      return (k % 1 === 0 ? k : k.toFixed(1)) + 'k';
    }
    return fc < 100 ? fc.toFixed(0) : fc.toFixed(0);
  }

  /* ── Suma de energía de bins FFT a bandas ──────────────────
     freqDb: Float32Array dB/bin (del AnalyserNode o cálculo propio)
     binHz:  ancho de bin en Hz
     corrDb: corrección global de ventana/ganancia en dB            */
  function bandLevels(freqDb, binHz, bands, corrDb, weightFn) {
    const n = freqDb.length;
    const out = new Float64Array(bands.length);
    const powers = new Float64Array(bands.length);
    let b = 0;
    for (let i = 1; i < n; i++) {
      const f = i * binHz;
      while (b < bands.length && f >= bands[b].hi) b++;
      if (b >= bands.length) break;
      if (f >= bands[b].lo) {
        let l = freqDb[i] + corrDb;
        if (weightFn) l += weightFn(f);
        powers[b] += Math.pow(10, l / 10);
      }
    }
    for (let i = 0; i < bands.length; i++) out[i] = dbFromPower(powers[i]);
    return out;
  }

  /* ── Señales de prueba ───────────────────────────────────── */
  function makeWhiteNoise(n) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.random() * 2 - 1;
    return out;
  }

  /* Ruido rosa — filtro Paul Kellet (precisión) */
  function makePinkNoise(n) {
    const out = new Float32Array(n);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return out;
  }

  /* Barrido logarítmico (exponencial) con fades */
  function makeSweep(sr, f1, f2, durSec, fadeSec) {
    const N = Math.round(sr * durSec);
    const out = new Float32Array(N);
    const R = Math.log(f2 / f1);
    const fade = Math.max(1, Math.round((fadeSec || 0.25) * sr));
    for (let i = 0; i < N; i++) {
      const t = i / sr;
      const phase = (2 * Math.PI * f1 * durSec) / R * (Math.exp((t * R) / durSec) - 1);
      let env = 1;
      if (i < fade) env = 0.5 * (1 - Math.cos((Math.PI * i) / fade));
      else if (i > N - fade) env = 0.5 * (1 - Math.cos((Math.PI * (N - i)) / fade));
      out[i] = Math.sin(phase) * env;
    }
    return out;
  }

  /* ── Deconvolución sweep → IR (Wiener regularizada) ────────
     rec: grabación (Float32Array), sweep: señal enviada, sr
     devuelve { ir: Float32Array, n: longitud FFT usada }         */
  function deconvolveIR(rec, sweep) {
    const N = nextPow2(rec.length + sweep.length);
    const Sre = new Float64Array(N), Sim = new Float64Array(N);
    const Yre = new Float64Array(N), Yim = new Float64Array(N);
    Sre.set(sweep.subarray(0, Math.min(sweep.length, N)));
    Yre.set(rec.subarray(0, Math.min(rec.length, N)));
    const fft = new FFT(N);
    fft.forward(Sre, Sim);
    fft.forward(Yre, Yim);
    let maxP = 0;
    for (let i = 0; i < N; i++) maxP = Math.max(maxP, Sre[i] * Sre[i] + Sim[i] * Sim[i]);
    const eps = maxP * 1e-6 + 1e-12;
    for (let i = 0; i < N; i++) {
      const sr2 = Sre[i], si2 = Sim[i];
      const den = sr2 * sr2 + si2 * si2 + eps;
      /* H = Y · conj(S) / (|S|² + eps) */
      const hre = (Yre[i] * sr2 + Yim[i] * si2) / den;
      const him = (Yim[i] * sr2 - Yre[i] * si2) / den;
      Sre[i] = hre; Sim[i] = him;
    }
    fft.inverse(Sre, Sim);
    const ir = new Float32Array(N);
    for (let i = 0; i < N; i++) ir[i] = Sre[i];
    return { ir, N };
  }

  /* Pico absoluto de un array → { idx, val } */
  function findPeak(arr) {
    let idx = 0, val = 0;
    for (let i = 0; i < arr.length; i++) {
      const a = Math.abs(arr[i]);
      if (a > val) { val = a; idx = i; }
    }
    return { idx, val };
  }

  /* ── RT60 por integración inversa de Schroeder (T20) ───────
     ir, sr → { rt60: s|null, detail: 'T20'|'T30'|'--', decayDb } */
  function schroederRT60(ir, sr, peakIdx) {
    const start = clamp((peakIdx | 0) + Math.round(0.01 * sr), 0, ir.length - 1);
    // energía acumulada hacia atrás
    const E = new Float64Array(ir.length - start);
    let acc = 0;
    for (let i = E.length - 1; i >= 0; i--) {
      acc += ir[start + i] * ir[start + i];
      E[i] = acc;
    }
    if (E[0] <= 0) return { rt60: null, detail: '--', decayDb: 0 };
    const dB = new Float64Array(E.length);
    for (let i = 0; i < E.length; i++) dB[i] = 10 * Math.log10(E[i] / E[0]);
    const t5 = findCross(dB, -5);
    const t25 = findCross(dB, -25);
    if (t5 == null || t25 == null || t25 <= t5) return { rt60: null, detail: '--', decayDb: -dB[dB.length - 1] };
    const rt60 = 3 * ((t25 - t5) / sr);
    return { rt60, detail: 'T20', decayDb: -dB[dB.length - 1] };
  }
  function findCross(dB, level) {
    for (let i = 1; i < dB.length; i++) {
      if (dB[i - 1] > level && dB[i] <= level) {
        // interpolación lineal
        const f = (dB[i - 1] - level) / (dB[i - 1] - dB[i] || 1e-12);
        return i - 1 + f;
      }
    }
    return null;
  }

  /* ── Export WAV PCM 16-bit mono ──────────────────────────── */
  function encodeWav(samples, sr) {
    const n = samples.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const wstr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    wstr(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); wstr(8, 'WAVE');
    wstr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    wstr(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      let s = clamp(samples[i], -1, 1);
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  /* ── Suavizado por bandas fraccionarias de octava (visual) ── */
  function fracOctSmooth(freqs, valuesDb, frac) {
    const out = new Float64Array(valuesDb.length);
    const ratio = Math.pow(2, frac / 2);
    for (let i = 0; i < valuesDb.length; i++) {
      const f = freqs[i];
      let sum = 0, wsum = 0;
      for (let j = Math.max(0, i - 64); j < Math.min(valuesDb.length, i + 65); j++) {
        const r = freqs[j] / f;
        if (r < 1 / ratio || r > ratio) continue;
        const w = 1 - Math.abs(Math.log2(r)) / (frac / 2);
        sum += valuesDb[j] * w; wsum += w;
      }
      out[i] = wsum > 0 ? sum / wsum : valuesDb[i];
    }
    return out;
  }

  /* ── Colormaps para espectrograma ────────────────────────── */
  function colormap(name) {
    const stops = {
      audio:  [[0,0,0],[8,12,64],[16,120,180],[24,190,140],[240,200,60],[255,255,255]],
      inferno:[[0,0,4],[40,11,84],[101,21,110],[159,42,99],[212,72,66],[245,125,21],[250,193,39],[252,255,164]],
      gray:   [[0,0,0],[255,255,255]],
      viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],
    };
    const s = stops[name] || stops.audio;
    const lut = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = (i / 255) * (s.length - 1);
      const k = Math.min(s.length - 2, Math.floor(t));
      const f = t - k;
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(s[k][c] + (s[k + 1][c] - s[k][c]) * f);
    }
    return lut;
  }

  /* ── Export ──────────────────────────────────────────────── */
  const DSP = {
    FFT, hannWindow, blackmanHarris, windowPowerGain,
    aWeightDb, cWeightDb, octaveBands, bandLabel, bandLevels,
    dbFromPower, dbFromAmp, powerFromDb, ampFromDb, clamp, nextPow2,
    makeWhiteNoise, makePinkNoise, makeSweep,
    deconvolveIR, findPeak, schroederRT60, encodeWav, fracOctSmooth, colormap,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = DSP;
  else global.DSP = DSP;
})(typeof window !== 'undefined' ? window : globalThis);
