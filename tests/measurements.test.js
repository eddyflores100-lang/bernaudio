const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The measurement modules are browser scripts. Keep the harness at their public
// boundaries: DOM events, audio blocks, source lifecycle, and deferred work.
function harness({ channels = 2, sampleRate = 48000, suspended = false } = {}) {
  const elements = new Map(), timers = new Map(), blocks = new Set(), pairs = new Set();
  const sources = [], gains = [], statuses = [];
  let clock = 4000, timerId = 0, resumeCount = 0;
  const drawing = new Proxy({}, { get: (target, key) => target[key] || (() => {}), set: (t, k, v) => { t[k] = v; return true; } });
  function element(id) {
    if (!elements.has(id)) {
      const listeners = new Map();
      elements.set(id, {
        id, value: '', checked: false, disabled: false, textContent: '', style: {},
        firstElementChild: { style: {} }, classList: { contains: () => false },
        addEventListener(type, fn) { (listeners.get(type) || (listeners.set(type, []), listeners.get(type))).push(fn); },
        dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); },
        getContext: () => drawing, toDataURL: () => 'data:image/png;base64,', click() {},
      });
    }
    return elements.get(id);
  }
  const node = () => ({ connect() {}, disconnect() { this.disconnected = true; }, start(when) { this.started = when; }, stop() { this.stopped = true; } });
  const ctx = {
    sampleRate, state: suspended ? 'suspended' : 'running', currentTime: 0,
    destination: {},
    async resume() { resumeCount++; this.state = 'running'; },
    createGain() { const n = node(); n.gain = { value: 1 }; gains.push(n); return n; },
    createAnalyser() { const n = node(); n.getFloatTimeDomainData = (out) => out.fill(0); return n; },
    createScriptProcessor() { return node(); },
    createOscillator() { const n = node(); n.frequency = { value: 0 }; sources.push(n); return n; },
    createBuffer(_n, len, sr) { return { length: len, sampleRate: sr, copyToChannel(data) { this.data = Float32Array.from(data); } }; },
    createBufferSource() { const n = node(); sources.push(n); return n; },
  };
  const AE = {
    ctx, analyser: {}, running: true, channels: 2, realChannels: channels, sampleRate,
    sessionId: 1,
    onBlock(fn) { blocks.add(fn); return () => blocks.delete(fn); },
    onBlockCh1(fn) { pairs.add(fn); return () => pairs.delete(fn); },
    onPairBlock(fn) { pairs.add(fn); return () => pairs.delete(fn); },
  };
  const sandbox = {
    console, Float32Array, Float64Array, Math, Set, Promise, Number, Blob,
    Event: class { constructor(type) { this.type = type; } },
    document: { getElementById: element, createElement: element },
    performance: { now: () => clock },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    AE, BAU: { fitCanvas: () => ({ ctx: drawing, w: 800, h: 300 }) },
    UI: { setStatus(message) { statuses.push(message); }, showTab() {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of ['dsp.js', 'modules-tf.js', 'modules-delay.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/app', file), 'utf8'), sandbox, { filename: file });
  }
  const gen = sandbox.MOD_GEN, tf = sandbox.MOD_TF, delay = sandbox.MOD_DELAY, ir = sandbox.MOD_IR;
  Object.entries({ genType: 'pink', genLevel: '-18', genFreq: '1000', genSweepDur: '1', tfRef: 'gen', tfDelayMs: '0', tfSmooth: '6', tfView: 'both', irDur: '0.01', dlMode: 'seq' })
    .forEach(([id, value]) => { element(id).value = value; });
  element('tfAutoDelay').checked = true;
  [gen, tf, delay, ir].forEach((mod) => mod.init());
  return {
    sandbox, AE, ctx, gen, tf, delay, ir, sources, gains, statuses, blocks, pairs, elements,
    resumeCount: () => resumeCount,
    element, advance(ms) { clock += ms; },
    flushTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn()); },
    block(a, startFrame = 0) { const meta = { startFrame, sampleRate, sessionId: AE.sessionId }; for (const fn of [...blocks]) fn(a, meta); },
    pair(a, b, startFrame = 0) { const meta = { startFrame, sampleRate, sessionId: AE.sessionId }; for (const fn of [...pairs]) fn(a, b, meta); },
  };
}

function fillDelay(delay, correlation) {
  delay._chMic = delay._mk(); delay._chRef = delay._mk();
  const data = new Float32Array(16384).fill(0.1);
  delay._push(delay._chMic, data); delay._push(delay._chRef, data);
  delay._measSrc = 'A'; delay.state = 'measA';
  delay._sampleRate = 48000;
  return correlation;
}

test('sequential delay finishes A and allows a second B measurement', async () => {
  const h = harness();
  h.sandbox.DSP.xcorrPeak = () => ({ lag: 48, conf: 0.9, coefficient: 0.9, peak: 1, corr: new Float64Array(8192) });
  fillDelay(h.delay);
  h.delay._finishMeas();
  assert.equal(h.delay.state, 'idle');
  await h.delay.measureSource('B');
  assert.equal(h.delay.state, 'measB');
});

test('sequential delay rejects unrelated or inverted input and clears old recommendation', () => {
  for (const [conf, coefficient] of [[0.01, 0.01], [0.95, -0.95], [0, 0]]) {
    const h = harness();
    h.sandbox.DSP.xcorrPeak = () => ({ lag: 12, conf, coefficient, peak: coefficient, corr: new Float64Array(8192) });
    fillDelay(h.delay); h.delay.dB = 100; h.delay.confB = 0.95;
    h.delay.el.dlRec.textContent = 'alineadas ✓';
    h.delay._finishMeas();
    assert.equal(h.delay.dA, null, 'invalid A must never become a measurement');
    assert.doesNotMatch(h.delay.el.dlRec.textContent, /alineadas|ms →/);
  }
});

test('dual delay and hardware TF require actual stereo channels', async () => {
  const h = harness({ channels: 1 });
  h.delay.setMode('dual');
  assert.equal(h.pairs.size, 0);
  h.tf.refSource = 'ch2'; h.tf.el.tfRef.value = 'ch2';
  await h.tf.start();
  assert.equal(h.tf.measuring, false);
  assert.equal(h.tf.refSource, 'ch2');
  assert.equal(h.gen.playing, false);
});

test('TF first delay acquisition rejects weak confidence', () => {
  const h = harness();
  h.tf.measuring = true;
  h.tf._push(h.tf.micFifo, new Float32Array(16384).fill(0.1), 'mic');
  h.tf._push(h.tf.refFifo, new Float32Array(16384).fill(0.1), 'ref');
  h.sandbox.DSP.xcorrPeak = () => ({ lag: 8, conf: 0.01, coefficient: 0.01, peak: 0.01, corr: new Float64Array(8192) });
  h.tf.searchDelay(true);
  assert.equal(h.tf.delaySamples, null);
});

test('TF start and time/polarity controls discard stale samples and spectral averages', async () => {
  const h = harness();
  h.tf.refSource = 'ch2'; await h.tf.start();
  h.tf._push(h.tf.micFifo, new Float32Array(18000).fill(0.1), 'mic');
  h.tf._push(h.tf.refFifo, new Float32Array(18000).fill(0.1), 'ref');
  h.tf.delaySamples = 0; h.tf.updates = 10; h.tf.Sxx.fill(2);
  h.tf.el.tfPolarity.checked = true;
  h.tf.el.tfPolarity.dispatchEvent(new h.sandbox.Event('change'));
  assert.equal(h.tf.updates, 0); assert.equal(h.tf.Sxx[0], 0);
  assert.equal(h.tf.micW, 0); assert.equal(h.tf.refW, 0);
  h.tf.updates = 3;
  h.tf.el.tfDelayMs.value = '1'; h.tf.el.tfDelayMs.dispatchEvent(new h.sandbox.Event('input'));
  assert.equal(h.tf.updates, 0);
});

test('TF uses paired hardware blocks and does not average one block twice', async () => {
  const h = harness();
  h.tf.refSource = 'ch2'; await h.tf.start();
  assert.equal(h.pairs.size, 1); assert.equal(h.blocks.size, 0);
  const data = new Float32Array(20000);
  for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * 1.153) * 0.1;
  h.pair(data, data, 0);
  h.tf.delaySamples = 0; h.tf.autoDelay = false;
  h.tf.update(); const updates = h.tf.updates;
  assert.equal(updates, 1);
  h.tf.update(); assert.equal(h.tf.updates, updates);
});

test('trace names remain unique and carry their original frequency scale', () => {
  const h = harness(); h.tf.updates = 2;
  for (let i = 0; i < 7; i++) h.tf.saveTrace();
  assert.equal(new Set(h.tf.traces.map((trace) => trace.name)).size, 3);
  assert.ok(h.tf.traces.every((trace) => trace.sampleRate === 48000));
  h.AE.sampleRate = 44100; h.tf.onAudioStart();
  assert.equal(h.tf.updates, 0);
  assert.ok(h.tf.traces.every((trace) => trace.sampleRate === 48000));
});

test('generator silence does not claim to play and resumes a suspended context', async () => {
  const h = harness({ suspended: true });
  h.gen.el.genType.value = 'silence';
  await h.gen.play();
  assert.equal(h.gen.playing, false);
  h.gen.el.genType.value = 'pink'; await h.gen.play();
  assert.equal(h.resumeCount(), 1);
  assert.equal(h.gen.playing, true);
});

test('manual generator stop clears the playing status and stops the source', async () => {
  const h = harness(); h.gen.el.genType.value = 'sine';
  await h.gen.play(); const source = h.gen.osc;
  h.gen.el.genStopBtn.dispatchEvent(new h.sandbox.Event('click'));
  assert.equal(h.gen.playing, false); assert.equal(source.stopped, true);
  assert.match(h.statuses.at(-1), /detenido.*silencio/i);
});

test('an old generator source onended cannot stop a replacement source', async () => {
  const h = harness();
  h.gen.el.genType.value = 'sweep'; await h.gen.play();
  const old = h.sources.at(-1), oldEnded = old.onended;
  h.gen.stop(); h.gen.el.genType.value = 'pink'; await h.gen.play();
  if (oldEnded) oldEnded();
  assert.equal(h.gen.playing, true);
  assert.notEqual(h.gen.src, old);
});

test('internal generator reference follows source scheduling and stops with its owner', async () => {
  const h = harness();
  await h.tf.start();
  assert.equal(h.gen.playing, true);
  assert.equal(typeof h.gen.referenceBlock, 'function');
  const startFrame = h.gen._startFrame;
  assert.ok(startFrame > 0);
  const before = h.gen.referenceBlock(0, startFrame);
  assert.ok(before.every((value) => value === 0));
  assert.ok(h.gen.referenceBlock(startFrame, 8192).some((value) => value !== 0));
  h.tf.stop(); assert.equal(h.gen.playing, false);
});

test('IR honors an explicit 0 dB level and subscribes before scheduled playback', async () => {
  const h = harness(); h.gen.el.genLevel.value = '0';
  await h.ir.measure();
  assert.equal(h.gains.at(-1).gain.value, 1);
  assert.equal(h.blocks.size, 1);
  assert.ok(h.sources.at(-1).started > h.ctx.currentTime);
});

test('IR cancellation stops source, unsubscribes, and invalidates deferred deconvolution', async () => {
  const h = harness(); let deconvolutions = 0;
  h.sandbox.DSP.deconvolveIR = () => { deconvolutions++; return { ir: new Float32Array(32) }; };
  await h.ir.measure();
  const source = h.sources.at(-1);
  h.ir.finish();
  h.ir.onAudioStop();
  h.flushTimers();
  assert.equal(h.ir.state, 'idle');
  assert.equal(h.blocks.size, 0);
  assert.equal(source.stopped, true);
  assert.equal(deconvolutions, 0);
});

test('IR ignores repeated measurement requests and clears capture state on restart', async () => {
  const h = harness();
  await h.ir.measure(); const count = h.sources.length;
  await h.ir.measure(); assert.equal(h.sources.length, count);
  h.ir.onAudioStop(); h.ir.onAudioStart();
  assert.equal(h.ir.state, 'idle');
  assert.equal(h.ir.recLen, 0); assert.equal(h.blocks.size, 0);
});

function noise(length, seed = 982451653) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    out[i] = ((seed >>> 0) / 4294967296 * 2 - 1) * 0.25;
  }
  return out;
}

test('real DSP recovers positive and negative hardware delay with a flat 0.5 transfer', async () => {
  for (const delaySamples of [73, -73]) {
    const h = harness(); h.tf.refSource = 'ch2'; await h.tf.start();
    const source = noise(24000), mic = new Float32Array(20000), ref = new Float32Array(20000);
    for (let i = 0; i < mic.length; i++) {
      ref[i] = source[i + 1000]; mic[i] = source[i + 1000 - delaySamples] * 0.5;
    }
    h.pair(mic, ref, 500000);
    assert.equal(h.tf.searchDelay(true), true);
    assert.equal(h.tf.delaySamples, delaySamples);
    h.tf.autoDelay = false; h.tf.update();
    assert.equal(h.tf.updates, 1);
    for (const bin of [32, 100, 700, 1500]) {
      assert.ok(Math.abs(h.tf.magDb[bin] - 20 * Math.log10(0.5)) < 1e-5);
      assert.ok(Math.abs(h.tf.phaseDeg[bin]) < 1e-5);
      assert.ok(h.tf.coher[bin] > 0.99999);
    }
  }
});

test('real sequential generator reference recovers both arrivals across new source schedules', async () => {
  const h = harness();
  for (const [source, arrival] of [['A', 48], ['B', 144]]) {
    await h.delay.measureSource(source);
    const frame = Math.round(h.ctx.currentTime * h.AE.sampleRate);
    const mic = h.gen.referenceBlock(frame - arrival, 24000);
    h.block(mic, frame); h.advance(3000); h.delay.tick(3000);
    assert.equal(h.delay.state, 'idle');
    assert.equal(h.gen.playing, false, 'owned generator stops after each measurement');
    h.ctx.currentTime += 3;
  }
  assert.equal(h.delay.dA, 48); assert.equal(h.delay.dB, 144);
  assert.equal(h.delay.el.dlDelta.textContent, '+2.0');
  assert.equal(h.delay.el.dlRec.textContent, '+2.0 ms → A');
});

test('live paired delay clears its previous recommendation after polarity inversion', () => {
  const h = harness(); h.delay.setMode('dual');
  const source = noise(41000), a = source.subarray(1000, 21000), b = source.subarray(904, 20904);
  h.pair(a, b, 0); h.delay.tick(250);
  assert.equal(h.delay.el.dlDelta.textContent, '+2.0');
  const nextA = source.subarray(21000, 41000), nextB = Float32Array.from(source.subarray(20904, 40904), (value) => -value);
  h.pair(nextA, nextB, 20000); h.delay.tick(250);
  assert.equal(h.delay.el.dlDelta.textContent, '--');
  assert.equal(h.delay.el.dlRec.textContent, 'revisa la polaridad');
});

test('correlated pure tones are refused as ambiguous arrival estimates', () => {
  const h = harness(); h.delay.setMode('dual');
  const a = new Float32Array(20000), b = new Float32Array(20000);
  for (let i = 0; i < a.length; i++) { a[i] = Math.sin(i * Math.PI / 24) * 0.2; b[i] = Math.sin((i - 7) * Math.PI / 24) * 0.2; }
  h.pair(a, b, 0); h.delay.tick(250);
  assert.equal(h.delay.el.dlDelta.textContent, '--');
  assert.doesNotMatch(h.delay.el.dlRec.textContent, /alineadas|ms →/);
});

test('multiple generator owners release safely and manual playback remains user owned', async () => {
  const h = harness();
  await h.gen.acquire('tf'); await h.gen.acquire('delay');
  h.gen.release('tf'); assert.equal(h.gen.playing, true);
  h.gen.release('delay'); assert.equal(h.gen.playing, false);
  await h.gen.play(); await h.gen.acquire('tf'); h.gen.release('tf');
  assert.equal(h.gen.playing, true);
  const reference = h.gen.referenceBlock(h.gen._startFrame, 20000);
  assert.ok(reference.every((value) => Math.abs(value) <= 0.95));
});

test('stopping TF while context resume is pending cannot start an orphan generator', async () => {
  const h = harness({ suspended: true }); let resume;
  h.ctx.resume = () => new Promise((resolve) => { resume = () => { h.ctx.state = 'running'; resolve(); }; });
  const pending = h.tf.start(); h.tf.stop(); resume(); await pending;
  assert.equal(h.tf.measuring, false); assert.equal(h.gen.playing, false);
  assert.equal(h.blocks.size, 0);
});

test('TF frequency smoothing calls the circular phase helper with the selected denominator', () => {
  const h = harness(), calls = [];
  h.element('mod-tf').classList.contains = () => true;
  h.sandbox.DSP.fracOctSmooth = (_f, values, bands) => { calls.push(['magnitude', bands]); return values; };
  h.sandbox.DSP.fracOctSmoothPhase = (_f, values, bands) => { calls.push(['phase', bands]); return values; };
  h.tf.el.tfSmooth.value = '12'; h.tf.draw();
  assert.deepEqual(calls, [['magnitude', 12], ['phase', 12]]);
});

test('IR aligns capture to the scheduled output frame and rejects missing audio blocks', async () => {
  const h = harness(); await h.ir.measure();
  h.block(noise(4096), 0);
  assert.equal(h.ir.recLen, 4096 - h.ir._recStartFrame);
  h.block(noise(4096), 8192);
  assert.equal(h.ir.state, 'idle'); assert.equal(h.blocks.size, 0);
  assert.match(h.ir.el.irStatusChip.textContent, /faltan bloques/);
});

test('IR refuses captures above its compute budget before emitting any output', async () => {
  const h = harness({ sampleRate: 192000 }); h.ir.el.irDur.value = '20';
  await h.ir.measure();
  assert.equal(h.ir.state, 'idle'); assert.equal(h.sources.length, 0);
  assert.match(h.ir.el.irStatusChip.textContent, /demasiado grande/);
});

test('IR worker is local, transfers capture buffers, and terminates on cancellation', async () => {
  const h = harness(), workers = [];
  h.sandbox.document.baseURI = 'https://bernaudio.example/app.html'; h.sandbox.URL = URL;
  h.sandbox.Worker = class {
    constructor(url) { this.url = url; workers.push(this); }
    postMessage(data, transfer) { this.data = data; this.transfer = transfer; }
    terminate() { this.terminated = true; }
  };
  await h.ir.measure(); h.ir.finish(); h.flushTimers();
  assert.equal(workers.length, 1);
  assert.equal(new URL(workers[0].url).origin, 'https://bernaudio.example');
  assert.equal(new URL(workers[0].url).pathname, '/js/app/analysis-worker.js');
  assert.equal(workers[0].transfer.length, 2);
  h.ir.cancel(); assert.equal(workers[0].terminated, true);
  workers[0].onmessage({ data: { error: 'late response' } });
  assert.equal(h.ir.state, 'idle');
});

test('local analysis worker computes an impulse without DOM or cloud dependencies', () => {
  const posted = [], worker = { Float32Array, Float64Array, Math, Number, console };
  worker.self = worker;
  worker.postMessage = (value, transfers) => posted.push({ value, transfers });
  vm.createContext(worker);
  worker.importScripts = (file) => {
    assert.equal(file.split('?')[0], 'dsp.js');
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/app/dsp.js'), 'utf8'), worker);
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/app/analysis-worker.js'), 'utf8'), worker);
  const sweep = noise(2048), rec = new Float32Array(4096); rec.set(sweep, 123);
  worker.onmessage({ data: { sweep, rec, sr: 48000 } });
  assert.equal(posted.length, 1); assert.equal(posted[0].value.pk.idx, 123);
  assert.equal(posted[0].transfers.length, 1);
  assert.ok(posted[0].value.referenceCorrelation > 0.99);
});

test('IR rejects independent ambient noise rather than reporting arbitrary acoustic metrics', async () => {
  const h = harness({ sampleRate: 8000 }); h.ir.el.irDur.value = '0.5';
  await h.ir.measure();
  h.ir.rec.set(noise(h.ir.recTotal, 6271)); h.ir.recLen = h.ir.recTotal;
  h.ir.finish(); h.flushTimers();
  assert.equal(h.ir.state, 'idle'); assert.equal(h.ir.ir, null);
  assert.equal(h.ir.el.irDelay.textContent, '--');
  assert.match(h.ir.el.irStatusChip.textContent, /fiable|señal|ruido|sin correlación/);
});

test('IR retains a causal sweep response with a clear direct arrival and reflection', async () => {
  const h = harness({ sampleRate: 8000 }); h.ir.el.irDur.value = '0.5';
  await h.ir.measure();
  const sweep = h.ir.sweep;
  for (let i = 0; i < sweep.length; i++) { h.ir.rec[i + 80] += sweep[i] * 0.5; h.ir.rec[i + 800] += sweep[i] * 0.1; }
  h.ir.recLen = h.ir.recTotal; h.ir.finish(); h.flushTimers();
  assert.equal(h.ir.state, 'done'); assert.equal(h.ir.peakIdx, 80);
  assert.equal(h.ir.el.irDelay.textContent, '10.0');
});

test('sequential measurement stops its owned generator if correlation fails', async () => {
  const h = harness(); await h.delay.measureSource('A');
  h.block(h.gen.referenceBlock(0, 20000), 0);
  h.sandbox.DSP.xcorrPeak = () => { throw new Error('FFT calculation failed'); };
  assert.doesNotThrow(() => h.delay._finishMeas());
  assert.equal(h.gen.playing, false); assert.equal(h.delay.state, 'idle');
  assert.doesNotMatch(h.delay.el.dlRec.textContent, /alineadas|ms →/);
});

test('TF ignores a delayed block from an earlier audio session', async () => {
  const h = harness(); h.tf.refSource = 'ch2'; await h.tf.start();
  const data = noise(8192);
  h.tf._receivePair(data, data, { startFrame: 0, sampleRate: 48000, sessionId: 0 });
  assert.equal(h.tf.micW, 0); assert.equal(h.tf.refW, 0);
});

test('IR rejects an ambient click even when its deconvolution has a prominent causal peak', async () => {
  const h = harness({ sampleRate: 8000 }); h.ir.el.irDur.value = '0.5';
  await h.ir.measure(); h.ir.rec[8000] = 0.8; h.ir.recLen = h.ir.recTotal;
  h.ir.finish(); h.flushTimers();
  assert.equal(h.ir.state, 'idle'); assert.equal(h.ir.ir, null);
  assert.match(h.ir.el.irStatusChip.textContent, /referencia|barrido|fiable/);
});
