'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const DSP = require('../js/app/dsp.js');

function near(actual, expected, tolerance = 1e-10) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected} by more than ${tolerance}`);
}

function seededNoise(n, seed = 0x12345678) {
  const out = new Float64Array(n);
  let state = seed >>> 0;
  for (let i = 0; i < n; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = state / 0x80000000 - 1;
  }
  return out;
}

function directDFT(re, im) {
  const n = re.length;
  const real = new Float64Array(n), imag = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      const phase = -2 * Math.PI * k * j / n;
      real[k] += re[j] * Math.cos(phase) - im[j] * Math.sin(phase);
      imag[k] += re[j] * Math.sin(phase) + im[j] * Math.cos(phase);
    }
  }
  return { real, imag };
}

function spectrumBuffers(n) {
  return [new DSP.FFT(n), new Float64Array(n), new Float64Array(n), new Float64Array(n / 2 + 1)];
}

test('radix-2 FFT agrees with a direct complex DFT and inverse restores the signal', () => {
  for (const n of [2, 4, 8, 32]) {
    const re = seededNoise(n), im = seededNoise(n, 42);
    const originalRe = re.slice(), originalIm = im.slice();
    const expected = directDFT(re, im);
    const fft = new DSP.FFT(n);
    fft.forward(re, im);
    for (let i = 0; i < n; i++) {
      near(re[i], expected.real[i]);
      near(im[i], expected.imag[i]);
    }
    fft.inverse(re, im);
    for (let i = 0; i < n; i++) {
      near(re[i], originalRe[i]);
      near(im[i], originalIm[i]);
    }
  }
});

test('FFT rejects sizes that would be silently truncated to a different power of two', () => {
  for (const n of [0, 1, 3, 16.5, NaN, Infinity, 2 ** 32 + 8]) {
    assert.throws(() => new DSP.FFT(n), /FFT/);
  }
});

test('legacy magnitude spectrum retains its documented -6.02 dB coherent sine convention', () => {
  const n = 1024, k = 37;
  const samples = Float64Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * k * i / n));
  const [fft, re, im, out] = spectrumBuffers(n);
  DSP.fftSpectrumDb(samples, fft, DSP.hannWindow(n), re, im, out);
  near(out[k], 20 * Math.log10(0.5), 1e-10);
});

test('power spectrum integrates a coherent sine to its RMS power for rectangular and Hann windows', () => {
  assert.equal(typeof DSP.powerSpectrumDb, 'function');
  const n = 1024, k = 37, amplitude = 0.7;
  const samples = Float64Array.from({ length: n }, (_, i) => amplitude * Math.sin(2 * Math.PI * k * i / n));
  const [fft, re, im, out] = spectrumBuffers(n);
  for (const win of [new Float64Array(n).fill(1), DSP.hannWindow(n), DSP.blackmanHarris(n)]) {
    assert.equal(DSP.powerSpectrumDb(samples, fft, win, re, im, out), out);
    const power = out.reduce((sum, db) => sum + 10 ** (db / 10), 0);
    near(power, amplitude ** 2 / 2, 1e-12);
  }
});

test('power spectrum obeys one-sided Parseval normalization for seeded noise', () => {
  assert.equal(typeof DSP.powerSpectrumDb, 'function');
  const n = 2048, samples = seededNoise(n);
  const [fft, re, im, out] = spectrumBuffers(n);
  const win = DSP.hannWindow(n);
  DSP.powerSpectrumDb(samples, fft, win, re, im, out);
  const frequencyPower = out.reduce((sum, db) => sum + 10 ** (db / 10), 0);
  const timePower = samples.reduce((sum, x, i) => sum + (x * win[i]) ** 2, 0) /
    win.reduce((sum, x) => sum + x * x, 0);
  near(frequencyPower, timePower, 1e-12);
});

test('power spectrum does not double DC or Nyquist and leaves silence at negative infinity', () => {
  assert.equal(typeof DSP.powerSpectrumDb, 'function');
  const n = 64, win = new Float64Array(n).fill(1);
  const [fft, re, im, out] = spectrumBuffers(n);
  for (const samples of [new Float64Array(n).fill(0.5), Float64Array.from({ length: n }, (_, i) => (i % 2 ? -0.5 : 0.5))]) {
    DSP.powerSpectrumDb(samples, fft, win, re, im, out);
    near(out.reduce((sum, db) => sum + 10 ** (db / 10), 0), 0.25, 1e-12);
  }
  DSP.powerSpectrumDb(new Float64Array(n), fft, win, re, im, out);
  assert.ok(out.every((db) => db === -Infinity));
});

test('regularized deconvolution recovers a known causal delay and reflection', () => {
  const sweep = seededNoise(512), delay = 71, reflection = 103;
  const recorded = new Float32Array(sweep.length + reflection);
  for (let i = 0; i < sweep.length; i++) {
    recorded[i + delay] += 0.6 * sweep[i];
    recorded[i + reflection] -= 0.15 * sweep[i];
  }
  const result = DSP.deconvolveIR(recorded, sweep);
  assert.equal(DSP.findPeak(result.ir).idx, delay);
  near(result.ir[delay], 0.6, 2e-4);
  near(result.ir[reflection], -0.15, 2e-4);
  assert.equal(result.N, result.ir.length);
});

test('cross-correlation reports positive and negative sample delays with gain-independent confidence', () => {
  const n = 1024, a = seededNoise(n);
  for (const delay of [47, -93]) {
    const b = Float64Array.from({ length: n }, (_, i) => 0.03 * a[(i - delay + n) % n]);
    const result = DSP.xcorrPeak(a, b);
    assert.equal(result.lag, delay);
    near(result.coefficient, 1, 1e-12);
    near(result.conf, 1, 1e-12);
    assert.equal(result.polarity, 1);
  }
});

test('cross-correlation finds the same delay for inverted polarity', () => {
  const n = 1024, delay = 137, a = seededNoise(n);
  const b = Float64Array.from({ length: n }, (_, i) => -0.5 * a[(i - delay + n) % n]);
  const result = DSP.xcorrPeak(a, b);
  assert.equal(result.lag, delay);
  assert.ok(result.peak < 0);
  near(result.coefficient, -1, 1e-12);
  near(result.conf, 1, 1e-12);
  assert.equal(result.polarity, -1);
});

test('silence and independent broadband signals cannot claim a confident delay', () => {
  const a = seededNoise(4096), silent = new Float64Array(a.length);
  for (const [first, second] of [[silent, silent], [a, silent], [silent, a]]) {
    const result = DSP.xcorrPeak(first, second);
    assert.equal(result.conf, 0);
    assert.equal(result.coefficient, 0);
    assert.equal(result.polarity, 0);
    assert.equal(result.lag, 0);
  }
  assert.ok(DSP.xcorrPeak(a, seededNoise(a.length, 98765)).conf < 0.1);
});

test('delay correlation removes constant offsets and refuses invalid signal buffers', () => {
  const n = 512, delay = 51, a = seededNoise(n);
  const b = Float64Array.from({ length: n }, (_, i) => -2 * a[(i - delay + n) % n] + 13);
  const shifted = Float64Array.from(a, (sample) => sample + 4);
  const result = DSP.xcorrPeak(shifted, b);
  assert.equal(result.lag, delay);
  near(result.coefficient, -1, 1e-12);
  assert.equal(DSP.xcorrPeak(new Float64Array(n).fill(0.1), new Float64Array(n).fill(0.2)).conf, 0);
  const broken = a.slice();
  broken[10] = NaN;
  assert.equal(DSP.xcorrPeak(a, broken).conf, 0);
  assert.throws(() => DSP.xcorrPeak(a, new Float64Array(n / 2)), /correlación/);
  assert.throws(() => DSP.xcorrPeak(a, a, new DSP.FFT(n / 2)), /correlación/);
});

test('fractional-octave smoothing accepts bands per octave and has the correct frequency support', () => {
  const freqs = new Float64Array([900, 960, 1000, 1040, 1100]);
  const values = new Float64Array([100, 0, 0, 0, 100]);
  near(DSP.fracOctSmooth(freqs, values, 6)[2], 0);
  const impulse = new Float64Array([0, 0, 12, 0, 0]);
  const sixth = DSP.fracOctSmooth(freqs, impulse, 6);
  const twelfth = DSP.fracOctSmooth(freqs, impulse, 12);
  assert.ok(sixth[2] < twelfth[2]);
  near(twelfth[2], 12);
});

test('fractional-octave smoothing includes all bins in its frequency window', () => {
  const freqs = Float64Array.from({ length: 513 }, (_, i) => 900 * 2 ** (i / 512 / 3));
  const values = new Float64Array(freqs.length);
  values[360] = 10;
  assert.ok(DSP.fracOctSmooth(freqs, values, 6)[256] > 0);
});

test('circular phase smoothing keeps a 179/-179 degree wrap near 180 degrees', () => {
  assert.equal(typeof DSP.fracOctSmoothPhase, 'function');
  const freqs = new Float64Array([990, 1000, 1010]);
  const phases = new Float64Array([179, -179, 179]);
  const smoothed = DSP.fracOctSmoothPhase(freqs, phases, 6);
  assert.ok(Math.abs(smoothed[1]) > 178);
});

test('octave smoothing preserves the DC bin and ignores nonfinite neighboring values', () => {
  const freqs = new Float64Array([0, 990, 1000, 1010]);
  const values = new Float64Array([-Infinity, 3, NaN, 3]);
  const smoothed = DSP.fracOctSmooth(freqs, values, 6);
  assert.equal(smoothed[0], -Infinity);
  near(smoothed[1], 3);
  near(smoothed[2], 3);
  near(smoothed[3], 3);
});

function exponentialDecay(rt60, sr, duration, delay = 0) {
  const samples = new Float64Array(delay + Math.round(sr * duration));
  for (let i = delay; i < samples.length; i++) samples[i] = Math.exp(-3 * Math.LN10 * (i - delay) / (sr * rt60));
  return samples;
}

test('Schroeder regression recovers EDT, T20 and T30 of an exponential decay independent of pre-delay', () => {
  const sr = 8000, expected = 1.2;
  for (const delay of [0, 1200]) {
    const result = DSP.schroederRT60(exponentialDecay(expected, sr, 3, delay), sr, delay);
    near(result.rt60, expected, 0.003);
    near(result.edt, expected, 0.003);
    near(result.t20, expected, 0.003);
    near(result.t30, expected, 0.003);
    assert.ok(Number.isFinite(result.decayDb));
    near(result.curveDb[0], 0);
  }
});

test('Schroeder rejects stationary noise, a lone impulse, nonfinite data, and invalid sample rates', () => {
  const sr = 8000, impulse = new Float64Array(sr);
  impulse[0] = 1;
  const broken = exponentialDecay(1, sr, 2);
  broken[500] = NaN;
  for (const [signal, rate] of [
    [seededNoise(2 * sr), sr], [impulse, sr], [new Float64Array(sr), sr],
    [broken, sr], [exponentialDecay(1, sr, 2), 0],
  ]) {
    const result = DSP.schroederRT60(signal, rate, 0);
    assert.equal(result.rt60, null);
    assert.equal(result.edt, null);
    assert.equal(result.t20, null);
    assert.equal(result.t30, null);
  }
});

test('Schroeder uses least-squares decay fitting rather than only threshold crossing times', () => {
  const sr = 4000, ir = exponentialDecay(1.1, sr, 3);
  for (let i = 0; i < ir.length; i++) ir[i] *= 1 + 0.15 * Math.sin(i / 170);
  const result = DSP.schroederRT60(ir, sr, 0);
  const energy = new Float64Array(ir.length);
  let remaining = 0;
  for (let i = ir.length - 1; i >= 0; i--) energy[i] = (remaining += ir[i] * ir[i]);
  const points = [];
  for (let i = 0; i < energy.length; i++) {
    const db = 10 * Math.log10(energy[i] / energy[0]);
    if (db <= -5 && db >= -25) points.push([i / sr, db]);
  }
  const meanT = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const meanDb = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const numerator = points.reduce((sum, p) => sum + (p[0] - meanT) * (p[1] - meanDb), 0);
  const denominator = points.reduce((sum, p) => sum + (p[0] - meanT) ** 2, 0);
  near(result.t20, -60 * denominator / numerator, 1e-10);
});

test('Schroeder rejects incomplete decays and noise-dominated late fit ranges', () => {
  const sr = 8000, truncated = exponentialDecay(1.2, sr, 0.12);
  assert.equal(DSP.schroederRT60(truncated, sr, 0).rt60, null);
  const noisy = exponentialDecay(1.2, sr, 3), noise = seededNoise(noisy.length);
  for (let i = 0; i < noisy.length; i++) noisy[i] += noise[i] * 0.03;
  const result = DSP.schroederRT60(noisy, sr, 0);
  assert.equal(result.t20, null);
  assert.equal(result.t30, null);
});

test('clarity includes late reflected energy beyond one second', () => {
  const sr = 1000, delay = 20, ir = new Float64Array(2020);
  ir[delay] = 1;
  ir[delay + 60] = 1;
  ir[delay + 1500] = 1;
  const result = DSP.clarityC(ir, sr, delay);
  near(result.c50, 10 * Math.log10(1 / 2));
  near(result.c80, 10 * Math.log10(2));
});

test('clarity matches the analytic early-to-late energy ratio of a long exponential decay', () => {
  const sr = 1000, rt60 = 2.4, ir = exponentialDecay(rt60, sr, 6);
  const result = DSP.clarityC(ir, sr, 0);
  const q = Math.exp(-6 * Math.LN10 / (sr * rt60));
  for (const [name, split] of [['c50', 50], ['c80', 80]]) {
    const expected = 10 * Math.log10((1 - q ** split) / (q ** split - q ** ir.length));
    near(result[name], expected, 1e-10);
  }
});

test('calibration parses only data rows, sorts frequencies and interpolates in log frequency', () => {
  const parsed = DSP.parseCalFile([
    'Microphone serial 1234 sensitivity -35.2 dB',
    'Frequency Hz, Correction dB', '# 1200 9',
    '8kHz, 4dB', '500 0', '1k 1 0', '2kHz 2', '4000Hz 3',
  ].join('\n'));
  assert.ok(parsed);
  assert.deepEqual(Array.from(parsed.freqs), [500, 1000, 2000, 4000, 8000]);
  assert.deepEqual(Array.from(parsed.db), [0, 1, 2, 3, 4]);
  near(DSP.interpLogDb(Math.sqrt(1000 * 2000), parsed.freqs, parsed.db), 1.5);
  near(DSP.interpLogDb(10, parsed.freqs, parsed.db), 0);
  near(DSP.interpLogDb(20000, parsed.freqs, parsed.db), 4);
});

test('calibration removes identical duplicates and rejects conflicting duplicates', () => {
  const rows = '100 1\n200 2\n400 3\n800 4\n1600 5';
  const parsed = DSP.parseCalFile(rows + '\n400 3');
  assert.equal(parsed.freqs.length, 5);
  assert.equal(DSP.parseCalFile(rows + '\n400 6'), null);
  assert.equal(DSP.parseCalFile('100 1\n100 1\n100 1\n100 1\n100 1'), null);
});

test('calibration refuses invalid frequency, correction and numeric-token suffix rows', () => {
  const invalidRows = [
    '-100 1', '0 1', '1000001 1', '100 NaN', '200 Infinity',
    '300 61', '400 -61', '500garbage 2', '600Hz 2garbage',
  ];
  const fourValid = '1000 1\n2000 2\n4000 3\n8000 4\n';
  for (const row of invalidRows) assert.equal(DSP.parseCalFile(fourValid + row), null, row);
});

test('WAV writes bounded signed PCM, RIFF sizes and the requested sample rate', () => {
  const samples = new Float64Array([-2, -1, -0.5, 0, 0.5, 1, 2]);
  const bytes = DSP.encodeWav(samples, 48000), view = new DataView(bytes);
  assert.equal(bytes.byteLength, 44 + samples.length * 2);
  assert.equal(view.getUint32(4, true), bytes.byteLength - 8);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(28, true), 96000);
  assert.equal(view.getUint32(40, true), samples.length * 2);
  assert.deepEqual(Array.from(samples, (_, i) => view.getInt16(44 + i * 2, true)),
    [-32768, -32768, -16384, 0, 16383, 32767, 32767]);
});

test('WAV rejects sample rates and lengths that cannot be encoded in its header', () => {
  for (const sr of [0, -1, 48000.5, NaN, Infinity, 2 ** 31]) {
    assert.throws(() => DSP.encodeWav(new Float32Array(0), sr), /WAV/);
  }
  assert.throws(() => DSP.encodeWav({ length: 2 ** 31 }, 48000), /WAV/);
});

test('WAV replaces nonfinite samples with silence', () => {
  const view = new DataView(DSP.encodeWav(new Float64Array([NaN, Infinity, -Infinity]), 48000));
  for (let i = 0; i < 3; i++) assert.equal(view.getInt16(44 + i * 2, true), 0);
});
