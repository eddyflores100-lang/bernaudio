'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const DSP = require('../js/app/dsp.js');
const { WeightingFilter } = require('../js/app/level-meter.js');

function near(actual, expected, tolerance, message = '') {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${message}: ${actual} differs from ${expected} by more than ${tolerance}`);
}

function energy(samples) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return sum;
}

function sineGainDb(sampleRate, frequency, weighting) {
  // Discard a full second of startup, then measure an integer number of cycles.
  const input = Float64Array.from({ length: sampleRate * 2 }, (_, i) =>
    0.5 * Math.sin(2 * Math.PI * frequency * i / sampleRate));
  const output = new WeightingFilter(sampleRate, weighting).processBlock(input);
  return 10 * Math.log10(energy(output.subarray(sampleRate)) / energy(input.subarray(sampleRate)));
}

test('streaming A/C weighting agrees with analog reference tones through 20 kHz', () => {
  for (const sampleRate of [44100, 48000, 96000]) {
    for (const [weighting, reference] of [['A', DSP.aWeightDb], ['C', DSP.cWeightDb]]) {
      for (const frequency of [100, 1000, 4000, 10000, 20000]) {
        near(sineGainDb(sampleRate, frequency, weighting), reference(frequency),
          frequency === 1000 ? 0.01 : frequency === 20000 ? 0.75 : 0.2,
          `${sampleRate} Hz / ${weighting} / ${frequency} Hz`);
      }
    }
  }
});

test('weighting output is exactly invariant to callback block boundaries', () => {
  const input = Float64Array.from({ length: 27031 }, (_, i) =>
    0.4 + 0.3 * Math.sin(i * 0.019) + 0.17 * Math.cos(i * 1.723) + (i % 997 === 0 ? 0.7 : 0));
  for (const sampleRate of [48000, 96000]) {
    for (const weighting of ['A', 'C', 'Z']) {
      const whole = new WeightingFilter(sampleRate, weighting).processBlock(input);
      const filter = new WeightingFilter(sampleRate, weighting), split = new Float64Array(input.length);
      let start = 0, chunk = 0;
      const sizes = [1, 127, 128, 7, 1024, 4096, 3, 511];
      while (start < input.length) {
        const end = Math.min(input.length, start + sizes[chunk++ % sizes.length]);
        split.set(filter.processBlock(input.subarray(start, end)), start);
        start = end;
      }
      assert.deepEqual(split, whole, `${sampleRate} Hz / ${weighting}`);
    }
  }
});

test('an impulse retains the same weighted energy at and around callback edges', () => {
  for (const weighting of ['A', 'C']) {
    let reference;
    for (const offset of [0, 1, 127, 128, 1023, 1024, 1025, 4095, 4096]) {
      // Each impulse has an identical one-second tail, regardless of its offset.
      const input = new Float64Array(offset + 48000);
      input[offset] = 1;
      const filter = new WeightingFilter(48000, weighting);
      let total = 0;
      for (let start = 0; start < input.length; start += 1024) {
        total += energy(filter.processBlock(input.subarray(start, start + 1024)));
      }
      assert.ok(total > 0, `${weighting} impulse at ${offset} must be captured`);
      if (reference === undefined) reference = total;
      near(total, reference, 1e-14, `${weighting} impulse at ${offset}`);
    }
  }
});

test('A/C weighting rejects steady DC without resetting at callback edges', () => {
  for (const sampleRate of [48000, 96000]) {
    for (const weighting of ['A', 'C']) {
      const filter = new WeightingFilter(sampleRate, weighting);
      const dc = new Float64Array(sampleRate).fill(0.75);
      filter.processBlock(dc);
      const settled = filter.processBlock(dc);
      assert.ok(energy(settled) / settled.length < 1e-24, `${sampleRate} Hz / ${weighting}`);
    }
  }
});

test('reset starts a new capture and optional output supports reuse and in-place processing', () => {
  const input = Float64Array.from({ length: 2048 }, (_, i) => Math.sin(i * 0.11));
  for (const weighting of ['A', 'C', 'Z']) {
    const filter = new WeightingFilter(48000, weighting);
    const first = filter.processBlock(input);
    filter.processBlock(input);
    filter.reset();
    const reused = new Float64Array(input.length);
    assert.equal(filter.processBlock(input, reused), reused);
    assert.deepEqual(reused, first);
    filter.reset();
    const inPlace = input.slice();
    assert.equal(filter.processBlock(inPlace, inPlace), inPlace);
    assert.deepEqual(inPlace, first);
    filter.reset();
    assert.equal(filter.processBlock(new Float64Array()).length, 0);
    if (weighting === 'Z') assert.deepEqual(first, input);
  }
});

test('weighting filter rejects unsupported modes, rates, and undersized output', () => {
  for (const sampleRate of [0, -48000, 2000, NaN, Infinity]) {
    assert.throws(() => new WeightingFilter(sampleRate, 'A'), /sampleRate/);
  }
  assert.throws(() => new WeightingFilter(48000, 'B'), /weighting/);
  assert.throws(() => new WeightingFilter(48000, 'A').processBlock(new Float64Array(2), new Float64Array(1)), /output/);
});
