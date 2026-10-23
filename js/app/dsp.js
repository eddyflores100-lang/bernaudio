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
      if (!Number.isInteger(n) || n < 2 || n > 0x40000000 || (n & (n - 1)) !== 0) {
        throw new Error('FFT: el tamaño debe ser potencia de 2');
      }
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
  /* nPerOct: 1, 3 o resoluciones finas (6/12/24/48) → devuelve [{fc, lo, hi}] */
  function octaveBands(nPerOct, fMin, fMax) {
    const centers = [];
    const ratio = Math.pow(2, 1 / nPerOct);
    let fc;
    if (nPerOct >= 6) {
      /* resoluciones finas: malla base-2 anclada a 1000 Hz exactos,
         fc(j) = 1000·2^((j − 10·n)/n) → los centros nominales ANSI
         (31.25, 62.5, 125 … 1000 … 16k) caen sobre bandas exactas */
      const J = 10 * nPerOct;
      const jMin = Math.ceil(J + nPerOct * Math.log2(fMin / 1000));
      fc = 1000 * Math.pow(2, (jMin - J) / nPerOct);
    } else {
      // fc inicial para 1/1 y 1/3 (nominal 31.5); 1/3 parte de 20 Hz
      fc = nPerOct === 3 ? 20 : 31.5;
    }
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

  /* Frecuencia mínima con resolución suficiente para n bandas/octava:
     la banda en fc debe contener al menos 1 bin FFT
     (fc·(2^(1/n)−1) ≥ binHz). Por debajo, el RTA muestra la banda vacía. */
  function octFloor(nPerOct, binHz) {
    return binHz / (Math.pow(2, 1 / nPerOct) - 1);
  }

  /* Espectro en dB desde muestras de tiempo (motor FFT extendido).
     samples: Float32/Float64Array de longitud fft.n; win: ventana (misma longitud);
     re/im: Float64Array(fft.n) de trabajo; out: Float64Array(fft.n/2+1) resultado.
     Convención tipo AnalyserNode: 20·log10(|X_k| / (N·CG)) → una senoidal a
     escala completa en el centro de bin ≈ −6 dB (A=1 → |X|/(N·CG)=0.5).
     Un offset constante entre motores se absorbe con el Cal del topbar. */
  function fftSpectrumDb(samples, fft, win, re, im, out) {
    const N = fft.n;
    for (let i = 0; i < N; i++) {
      re[i] = samples[i] * win[i];
      im[i] = 0;
    }
    fft.forward(re, im);
    let s = 0;
    for (let i = 0; i < N; i++) s += win[i];
    const cg = s / N || 1;
    const half = N >> 1;
    for (let k = 0; k <= half; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / (N * cg);
      out[k] = 20 * Math.log10(mag + 1e-300);
    }
    return out;
  }

  /* Potencia RMS por bin, unilateral y corregida por energía de ventana.
     Σ 10^(out[k]/10) = Σ(samples[i]·win[i])² / Σwin[i]² (Parseval).
     Una senoidal A=1 centrada en bin integra −3.0103 dBFS con las ventanas
     rectangulares, Hann y Blackman-Harris periódicas habituales.
     DC y Nyquist no se duplican. El silencio devuelve −Infinity. */
  function powerSpectrumDb(samples, fft, win, re, im, out) {
    const N = fft.n;
    let windowEnergy = 0;
    for (let i = 0; i < N; i++) {
      re[i] = samples[i] * win[i];
      im[i] = 0;
      windowEnergy += win[i] * win[i];
    }
    fft.forward(re, im);
    const half = N >> 1, scale = N * windowEnergy;
    for (let k = 0; k <= half; k++) {
      const factor = k === 0 || k === half ? 1 : 2;
      const power = scale > 0 ? factor * (re[k] * re[k] + im[k] * im[k]) / scale : 0;
      out[k] = dbFromPower(power);
    }
    return out;
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
     devuelve { ir: Float32Array, N: longitud FFT usada }         */
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

  /* ── Estimación RT60 de banda ancha por integración de Schroeder ──
     Regresión de mínimos cuadrados: EDT 0..−10, T20 −5..−25,
     T30 −5..−35 dB. No es una medición/certificación ISO 3382.
     Se exige R²≥0.98 y margen de 10 dB sobre la contribución estimada
     del ruido de cola. Esa comprobación es conservadora: la captura
     necesita cola suficiente y las curvas no exponenciales pueden rechazarse. */
  function schroederRT60(ir, sr, peakIdx) {
    const invalid = () => ({ rt60: null, detail: '--', decayDb: 0, edt: null, t20: null, t30: null, curveDb: null });
    const start = peakIdx == null ? 0 : peakIdx;
    if (!ir.length || !Number.isFinite(sr) || sr <= 0 || !Number.isInteger(start) || start < 0 || start >= ir.length) return invalid();
    const E = new Float64Array(ir.length - start);
    let acc = 0;
    for (let i = E.length - 1; i >= 0; i--) {
      const sample = ir[start + i];
      if (!Number.isFinite(sample)) return invalid();
      acc += sample * sample;
      E[i] = acc;
    }
    if (!(E[0] > 0) || !Number.isFinite(E[0])) return invalid();
    const dB = new Float64Array(E.length);
    let decayDb = 0;
    for (let i = 0; i < E.length; i++) {
      dB[i] = dbFromPower(E[i] / E[0]);
      if (Number.isFinite(dB[i])) decayDb = Math.max(decayDb, -dB[i]);
    }
    const tailStart = Math.floor(0.9 * E.length);
    const noisePower = E[tailStart] / (E.length - tailStart);

    function fitDecay(upperDb, lowerDb) {
      const from = upperDb === 0 ? 0 : findCross(dB, upperDb);
      const to = findCross(dB, lowerDb);
      if (from == null || to == null) return null;
      const first = Math.ceil(from), last = Math.floor(to), count = last - first + 1;
      if (count < 8 || E[last] < 10 * noisePower * (E.length - last)) return null;
      let meanT = 0, meanDb = 0;
      for (let i = first; i <= last; i++) { meanT += i / sr; meanDb += dB[i]; }
      meanT /= count; meanDb /= count;
      let xx = 0, yy = 0, xy = 0;
      for (let i = first; i <= last; i++) {
        const x = i / sr - meanT, y = dB[i] - meanDb;
        xx += x * x; yy += y * y; xy += x * y;
      }
      const slope = xy / xx, r2 = xy * xy / (xx * yy);
      const rt = -60 / slope;
      return Number.isFinite(rt) && rt > 0 && slope < 0 && r2 >= 0.98 ? rt : null;
    }
    const edt = fitDecay(0, -10), t20 = fitDecay(-5, -25), t30 = fitDecay(-5, -35);
    return { rt60: t30 ?? t20, detail: t30 != null ? 'T30' : t20 != null ? 'T20' : '--', decayDb, edt, t20, t30, curveDb: dB };
  }
  /* Claridad C50 / C80: 10·log10(energía temprana / tardía) desde la llegada
     del directo (pico de la IR), usando toda la cola disponible.
     No sustituye una medición por bandas ni una certificación ISO 3382. */
  function clarityC(ir, sr, peakIdx) {
    const t0 = clamp((peakIdx | 0), 0, ir.length - 1);
    const n50 = Math.round(0.05 * sr), n80 = Math.round(0.08 * sr);
    let e50 = 0, e80 = 0, eTot = 0;
    for (let i = t0; i < ir.length; i++) {
      const e = ir[i] * ir[i];
      const rel = i - t0;
      if (rel < n50) e50 += e;
      if (rel < n80) e80 += e;
      eTot += e;
    }
    if (eTot <= 0) return { c50: null, c80: null };
    const c50 = e50 > 0 && eTot > e50 ? 10 * Math.log10(e50 / (eTot - e50)) : null;
    const c80 = e80 > 0 && eTot > e80 ? 10 * Math.log10(e80 / (eTot - e80)) : null;
    return { c50, c80 };
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
    if (!Number.isInteger(sr) || sr < 1 || sr > Math.floor(0xffffffff / 2)) {
      throw new Error('WAV: frecuencia de muestreo no válida');
    }
    if (!Number.isInteger(n) || n < 0 || n > Math.floor((0xffffffff - 36) / 2)) {
      throw new Error('WAV: longitud fuera del límite RIFF PCM');
    }
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const wstr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    wstr(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); wstr(8, 'WAVE');
    wstr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    wstr(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const s = Number.isFinite(samples[i]) ? clamp(samples[i], -1, 1) : 0;
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  /* ── Suavizado por bandas fraccionarias de octava (visual) ──
     nPerOct=6 → ancho total 1/6 octava; 12 → 1/12 octava.
     Frecuencias positivas en orden ascendente (DC se conserva).
     Media triangular sobre el eje log2; no limita la ventana por nº de bins. */
  function fracOctSmooth(freqs, valuesDb, nPerOct) {
    const out = Float64Array.from(valuesDb);
    if (!(nPerOct > 0) || !Number.isFinite(nPerOct)) return out;
    const halfWidth = 1 / (2 * nPerOct);
    const logs = Float64Array.from(freqs, (f) => f > 0 ? Math.log2(f) : -Infinity);
    let lo = 0, hi = 0;
    for (let i = 0; i < valuesDb.length; i++) {
      const center = logs[i];
      if (!Number.isFinite(center)) continue;
      while (lo < logs.length && logs[lo] < center - halfWidth) lo++;
      while (hi < logs.length && logs[hi] <= center + halfWidth) hi++;
      let sum = 0, wsum = 0;
      for (let j = lo; j < hi; j++) {
        if (!Number.isFinite(valuesDb[j])) continue;
        const w = Math.max(0, 1 - Math.abs(logs[j] - center) / halfWidth);
        sum += valuesDb[j] * w; wsum += w;
      }
      out[i] = wsum > 0 ? sum / wsum : valuesDb[i];
    }
    return out;
  }

  /* Fase en grados: media circular para no promediar +179/−179 como 0°. */
  function fracOctSmoothPhase(freqs, phaseDeg, nPerOct) {
    const radians = Math.PI / 180;
    const real = fracOctSmooth(freqs, Float64Array.from(phaseDeg, (v) => Math.cos(v * radians)), nPerOct);
    const imag = fracOctSmooth(freqs, Float64Array.from(phaseDeg, (v) => Math.sin(v * radians)), nPerOct);
    return Float64Array.from(phaseDeg, (v, i) => {
      if (!(freqs[i] > 0) || Math.hypot(real[i], imag[i]) < 1e-12) return v;
      return Math.atan2(imag[i], real[i]) / radians;
    });
  }

  /* ── Correlación cruzada FFT (delay finder / TF) ────────────
     IFFT(conj(A)·B) — el pico en lag=+D indica que b está retrasada
     D muestras respecto a a. Se elimina DC y se busca el máximo absoluto:
     peak y coefficient conservan el signo (polaridad). conf es |coefficient|,
     normalizado por energía, NO una probabilidad ni prueba de delay único.
     Correlación circular: los retardos deben estar dentro de ±N/2. */
  function xcorrPeak(a, b, fft) {
    const N = a.length;
    if (b.length !== N || (fft && fft.n !== N)) throw new Error('correlación: tamaños incompatibles');
    const are = new Float64Array(N), aim = new Float64Array(N);
    const bre = new Float64Array(N), bim = new Float64Array(N);
    const f = fft || new FFT(N);
    const noSignal = () => ({ lag: 0, peak: 0, conf: 0, coefficient: 0, polarity: 0, corr: new Float64Array(N) });
    let meanA = 0, meanB = 0, minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) return noSignal();
      meanA += a[i]; meanB += b[i];
      minA = Math.min(minA, a[i]); maxA = Math.max(maxA, a[i]);
      minB = Math.min(minB, b[i]); maxB = Math.max(maxB, b[i]);
    }
    if (minA === maxA || minB === maxB) return noSignal();
    meanA /= N; meanB /= N;
    let energyA = 0, energyB = 0;
    for (let i = 0; i < N; i++) {
      are[i] = a[i] - meanA; bre[i] = b[i] - meanB;
      energyA += are[i] * are[i]; energyB += bre[i] * bre[i];
    }
    const norm = Math.sqrt(energyA) * Math.sqrt(energyB);
    if (!(norm > 0) || !Number.isFinite(norm)) return noSignal();
    f.forward(are, aim);
    f.forward(bre, bim);
    for (let i = 0; i < N; i++) {
      const rr = are[i] * bre[i] + aim[i] * bim[i];   // Re(conj(A)·B)
      const ii = are[i] * bim[i] - aim[i] * bre[i];   // Im(conj(A)·B)
      bre[i] = rr; bim[i] = ii;
    }
    f.inverse(bre, bim);
    let best = 0, bestV = 0;
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(bre[i])) return noSignal();
      if (Math.abs(bre[i]) > Math.abs(bestV)) { bestV = bre[i]; best = i; }
    }
    const lag = best > N / 2 ? best - N : best;       // lag con signo
    const coefficient = clamp(bestV / norm, -1, 1);
    const conf = Math.abs(coefficient);
    return { lag, peak: bestV, conf, coefficient, polarity: Math.sign(bestV), corr: bre };
  }

  /* ── Calibración de micrófono: parseo e interpolación ────── */
  /* Tokens completos: nunca interpreta el prefijo numérico de texto arbitrario. */
  function parseNumTok(tok, frequency) {
    const m = String(tok || '').match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)([a-z]*)$/i);
    if (!m) return NaN;
    const unit = m[2].toLowerCase();
    if (frequency ? !['', 'hz', 'k', 'khz'].includes(unit) : !['', 'db'].includes(unit)) return NaN;
    return Number(m[1]) * (frequency && unit.charAt(0) === 'k' ? 1000 : 1);
  }

  /* Parsea texto de archivo de calibración (.cal/.csv/.txt/.frd).
     Acepta filas que empiezan con frecuencia [Hz], corrección [dB].
     Ignora cabeceras, comentarios (#, ;, *) y líneas sin números.
     Requiere ≥5 frecuencias únicas; duplicados iguales se unifican,
     duplicados con correcciones contradictorias invalidan el archivo.
     Devuelve { freqs: Float64Array, db: Float64Array } o null.     */
  function parseCalFile(text) {
    if (!text) return null;
    const pts = [];
    const lines = String(text).split(/\r?\n/);
    for (let raw of lines) {
      const ln = raw.trim();
      if (!ln || /^[#;*\/]/.test(ln)) continue;
      const toks = ln.split(/[\s,;\t]+/).map((tok) => tok.replace(/^"(.*)"$/, '$1'));
      let f = parseNumTok(toks[0], true), next = 1;
      if (/^(?:k?hz)$/i.test(toks[next] || '')) {
        if (/^khz$/i.test(toks[next])) f *= 1000;
        next++;
      }
      const db = parseNumTok(toks[next], false);
      if (Number.isFinite(f) && f > 0 && f <= 1e6 && Number.isFinite(db) && Math.abs(db) <= 60) pts.push([f, db]);
    }
    pts.sort((a, b) => a[0] - b[0]);
    const unique = [];
    for (const pt of pts) {
      const previous = unique[unique.length - 1];
      if (previous && previous[0] === pt[0]) {
        if (previous[1] !== pt[1]) return null;
      } else unique.push(pt);
    }
    if (unique.length < 5) return null;
    const freqs = new Float64Array(unique.length);
    const db = new Float64Array(unique.length);
    for (let i = 0; i < unique.length; i++) { freqs[i] = unique[i][0]; db[i] = unique[i][1]; }
    return { freqs, db };
  }

  /* Interpolación de curva de calibración en eje log-frecuencia.
     Fuera de rango: sujeta al extremo más cercano. */
  function interpLogDb(f, freqs, db) {
    const n = freqs.length;
    if (!n) return 0;
    if (f <= freqs[0]) return db[0];
    if (f >= freqs[n - 1]) return db[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (freqs[mid] <= f) lo = mid; else hi = mid;
    }
    const den = Math.log(freqs[hi]) - Math.log(freqs[lo]) || 1;
    const t = (Math.log(f) - Math.log(freqs[lo])) / den;
    return db[lo] + (db[hi] - db[lo]) * t;
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
    aWeightDb, cWeightDb, octaveBands, octFloor, fftSpectrumDb, powerSpectrumDb, bandLabel, bandLevels,
    dbFromPower, dbFromAmp, powerFromDb, ampFromDb, clamp, nextPow2,
    makeWhiteNoise, makePinkNoise, makeSweep,
    deconvolveIR, findPeak, schroederRT60, clarityC, encodeWav, fracOctSmooth, fracOctSmoothPhase, colormap,
    xcorrPeak, parseCalFile, interpLogDb,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = DSP;
  else global.DSP = DSP;
})(typeof window !== 'undefined' ? window : globalThis);
