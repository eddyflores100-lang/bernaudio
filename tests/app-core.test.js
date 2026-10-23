'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const DSP = require('../js/app/dsp.js');
const LevelMeter = require('../js/app/level-meter.js');

function element(value = '') {
  const listeners = {};
  return { value, checked: false, textContent: '', innerHTML: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    parentElement: { querySelector() { return { textContent: '' }; } },
    addEventListener(type, fn) { listeners[type] = fn; },
    fire(type) { return listeners[type]?.({ target: this }); }, appendChild() {} };
}
function load(file, extra = {}) {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const env = { console, Float32Array, Float64Array, Uint8Array, performance: { now: () => 0 },
    setTimeout, clearTimeout, requestAnimationFrame() {},
    document: { getElementById: get, addEventListener() {}, querySelectorAll: () => [],
      visibilityState: 'visible', createElement: () => element() },
    navigator: {}, localStorage: { getItem: () => null, setItem() {} }, DSP, LevelMeter,
    BA_STATE: { cal: 0, calibrated: false, micCalDb: () => 0 }, ...extra };
  env.window = env;
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '..', file), 'utf8'), env);
  return { env, get };
}
function sine(n, amplitude = 1) {
  return Float32Array.from({ length: n }, (_, i) => amplitude * Math.sin(2 * Math.PI * 1000 * i / 48000));
}

test('SPL Leq follows captured duration, independent of animation timing', () => {
  const { env, get } = load('js/app/modules-spl.js', { AE: { sampleRate: 48000 } });
  get('splWeight').value = 'Z'; get('splSpeed').value = 'fast';
  env.MOD_SPL.init();
  assert.equal(typeof env.MOD_SPL.ingest, 'function', 'audio blocks must drive SPL statistics');
  env.MOD_SPL.ingest(sine(4800, 0.1), { sampleRate: 48000, startFrame: 0 });
  env.MOD_SPL.ingest(sine(14400, 1), { sampleRate: 48000, startFrame: 4800 });
  const s = env.MOD_SPL.snapshot();
  assert.ok(Math.abs(s.durationSeconds - 0.4) < 1e-9);
  assert.ok(Math.abs(s.leqDb - 10 * Math.log10((0.005 * 0.1 + 0.5 * 0.3) / 0.4)) < 0.01);
  assert.ok(Math.abs(s.peakDb) < 0.001);
});

test('SPL changing frequency weighting resets mixed statistics', () => {
  const { env, get } = load('js/app/modules-spl.js', { AE: { sampleRate: 48000 } });
  get('splWeight').value = 'Z'; get('splSpeed').value = 'fast'; env.MOD_SPL.init();
  assert.equal(typeof env.MOD_SPL.ingest, 'function');
  env.MOD_SPL.ingest(sine(4800), { sampleRate: 48000, startFrame: 0 });
  get('splWeight').value = 'A'; get('splWeight').fire('change');
  assert.equal(env.MOD_SPL.snapshot().durationSeconds, 0);
});

test('saved preferences cannot crash startup or use an out-of-range level offset', () => {
  let env;
  assert.doesNotThrow(() => { ({ env } = load('js/app/ui.js', {
    localStorage: { getItem() { throw new Error('Storage blocked'); } }
  })); });
  assert.equal(env.BA_STATE.cal, 94);
  assert.equal(env.BA_STATE.calibrated, false);
  const corrupt = load('js/app/ui.js', {
    localStorage: { getItem(key) { return key === 'ba_cal' ? 'Infinity' : null; } }
  });
  assert.equal(corrupt.env.BA_STATE.cal, 94);
});

test('hardware mono is reported as one real channel even when stereo was requested', async () => {
  let stopped = false;
  const settings = { channelCount: 1 };
  const track = { getSettings: () => settings, stop() { stopped = true; }, addEventListener() {} };
  const node = () => ({ connect() {}, disconnect() {}, gain: { value: 0 },
    getFloatFrequencyData() {}, getFloatTimeDomainData() {} });
  class Context {
    sampleRate = 48000; state = 'running'; destination = {};
    createMediaStreamSource() { return node(); }
    createAnalyser() { return { ...node(), fftSize: 8192, frequencyBinCount: 4096 }; }
    createScriptProcessor() { return node(); }
    createChannelSplitter() { return node(); }
    createGain() { return node(); }
    async resume() {}
    async close() {}
  }
  const { env } = load('js/app/audio-engine.js', { AudioContext: Context,
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } }
  });
  await env.AE.start(null, 2);
  env.AE._tap.onaudioprocess({ playbackTime: 1,
    inputBuffer: { numberOfChannels: 2, getChannelData: () => new Float32Array(4096) } });
  assert.equal(env.AE.realChannels, 1);
  await env.AE.stop(); assert.equal(stopped, true);
});

test('failed AudioContext initialization releases the captured microphone', async () => {
  let stopped = false;
  const track = { stop() { stopped = true; }, getSettings: () => ({ channelCount: 1 }) };
  const { env } = load('js/app/audio-engine.js', {
    AudioContext: class { constructor() { throw new Error('context unavailable'); } },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } }
  });
  await assert.rejects(() => env.AE.start(), /context unavailable/);
  assert.equal(stopped, true);
  assert.equal(env.AE.running, false);
});

test('RTA leaves unresolved bands empty instead of inventing finite bars', () => {
  const ae = { sampleRate: 48000, fftSize: 2048, freqDb: new Float32Array(1024).fill(-60),
    poll: () => true, _blockSubs: [], running: true };
  const { env, get } = load('js/app/modules-spl.js', { AE: ae });
  get('rtaRes').value = '48'; get('rtaMotor').value = 'analyser';
  get('rtaWeight').value = 'Z'; get('rtaAvg').value = '1';
  env.MOD_RTA.init(); env.MOD_RTA.draw = () => {};
  env.MOD_RTA.tick(50);
  assert.ok(env.MOD_RTA.bands.some((b, i) => b.fc < env.MOD_RTA._floor && !Number.isFinite(env.MOD_RTA.disp[i])));
  assert.ok(env.MOD_RTA.bands.every((b, i) => b.fc >= env.MOD_RTA._floor || !Number.isFinite(env.MOD_RTA.disp[i])));
});

test('RTA changing peak mode keeps the analyzer usable', () => {
  const ae = { sampleRate: 48000, fftSize: 8192, freqDb: new Float32Array(4097).fill(-60), poll: () => true, running: true };
  const { env, get } = load('js/app/modules-spl.js', { AE: ae });
  get('rtaRes').value = '3'; get('rtaMotor').value = 'analyser'; get('rtaWeight').value = 'Z';
  env.MOD_RTA.init(); env.MOD_RTA.draw = () => {};
  for (const mode of ['off', 'hold', 'decay']) {
    get('rtaPeak').value = mode; get('rtaPeak').fire('change');
    assert.doesNotThrow(() => env.MOD_RTA.tick(50));
    assert.ok(env.MOD_RTA.disp.some(Number.isFinite));
  }
});

test('AudioWorklet emits sample-aligned channels and exact context timestamps', () => {
  let Capture; const messages = [];
  const env = { Float32Array, currentFrame: 1000,
    AudioWorkletProcessor: class { port = { postMessage(data) { messages.push(structuredClone(data)); } }; },
    registerProcessor(name, type) { Capture = type; } };
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../js/app/capture-worklet.js'), 'utf8'), env);
  const processor = new Capture({ processorOptions: { blockSize: 2048 } });
  for (let i = 0; i < 32; i++) {
    processor.process([[new Float32Array(128).fill(i), new Float32Array(128).fill(-i)]]);
    env.currentFrame += 128;
  }
  assert.equal(messages.length, 2); assert.equal(messages[0].startFrame, 1000); assert.equal(messages[1].startFrame, 3048);
  assert.equal(messages[0].channels[0][128], 1); assert.equal(messages[0].channels[1][128], -1);
  assert.equal(messages[1].channels[0][0], 16);
});

test('stopping a pending microphone request cannot reactivate capture', async () => {
  let resolve, stopped = false;
  const permission = new Promise(r => resolve = r);
  const track = { stop() { stopped = true; }, getSettings: () => ({ channelCount: 1 }) };
  const { env } = load('js/app/audio-engine.js', {
    navigator: { mediaDevices: { getUserMedia: () => permission } },
    AudioContext: class { constructor() { throw new Error('A cancelled start must not create a context'); } }
  });
  const pending = env.AE.start();
  await new Promise(r => setImmediate(r));
  await env.AE.stop();
  resolve({ getTracks: () => [track], getAudioTracks: () => [track] });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(stopped, true); assert.equal(env.AE.running, false); assert.equal(env.AE.ctx, null);
});

test('settled DC offset is rejected with frequency weighting and a zero correction curve', () => {
  for (const weighting of ['C', 'Z']) {
    const { env, get } = load('js/app/modules-spl.js', { AE: { sampleRate: 48000 } });
    get('splWeight').value = weighting; get('splSpeed').value = 'fast'; env.MOD_SPL.init();
    env.BA_STATE.micCalOn = weighting === 'Z';
    const dc = new Float32Array(2048).fill(.1);
    for (let i = 0; i < 96; i++) env.MOD_SPL.ingest(dc, { sampleRate: 48000, startFrame: i * 2048 });
    env.MOD_SPL.reset(); // Reset statistics while continuous filters retain their settled state.
    env.MOD_SPL.ingest(dc, { sampleRate: 48000, startFrame: 96 * 2048 });
    assert.ok(env.MOD_SPL.snapshot().leqDb < -120, weighting + ': ' + env.MOD_SPL.snapshot().leqDb);
  }
});

test('SPL transient energy is preserved at audio callback boundaries', () => {
  for (const weighting of ['A', 'C', 'Z']) {
    const levels = [];
    for (const position of [0, 512, 1024, 2047]) {
      const { env, get } = load('js/app/modules-spl.js', { AE: { sampleRate: 48000 } });
      get('splWeight').value = weighting; get('splSpeed').value = 'fast'; env.MOD_SPL.init();
      const block = new Float32Array(2048); block[position] = 0.5;
      env.MOD_SPL.ingest(block, { sampleRate: 48000, startFrame: 0 });
      for (let i = 1; i <= 12; i++) env.MOD_SPL.ingest(new Float32Array(2048), { sampleRate: 48000, startFrame: i * 2048 });
      levels.push(env.MOD_SPL.snapshot().leqDb);
    }
    assert.ok(Math.max(...levels) - Math.min(...levels) < .15, weighting + ': ' + levels);
  }
});

test('low-frequency A-weighted Leq does not depend on callback length', () => {
  const levels = [];
  for (const size of [2048, 4096]) {
    const { env, get } = load('js/app/modules-spl.js', { AE: { sampleRate: 48000 } });
    get('splWeight').value = 'A'; get('splSpeed').value = 'fast'; env.MOD_SPL.init();
    const n = 98304;
    const signal = Float32Array.from({ length: n }, (_, i) => .1 * Math.sin(2 * Math.PI * 31.5 * i / 48000));
    for (let i = 0; i < n; i += size) env.MOD_SPL.ingest(signal.subarray(i, i + size), { sampleRate: 48000, startFrame: i });
    levels.push(env.MOD_SPL.snapshot().leqDb);
  }
  assert.ok(Math.abs(levels[0] - levels[1]) < 1e-8, levels.join(', '));
});
