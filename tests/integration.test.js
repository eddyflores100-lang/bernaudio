'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');

// This harness provides browser and audio-device boundaries only. Application
// scripts, controls, subscriptions, source ownership, and DSP all run unchanged.
class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== fn));
  }
  async fire(type, extra = {}) {
    const event = { type, target: this, currentTarget: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...extra };
    await Promise.all((this.listeners.get(type) || []).slice().map((fn) => fn(event)));
    return event;
  }
  dispatchEvent(event) { return this.fire(event.type, event); }
}

function decode(text) {
  return text.replace(/&(?:amp|lt|gt|quot|nbsp);|&#(?:x[\da-f]+|\d+);/gi, (entity) => {
    const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&nbsp;': ' ' };
    if (named[entity]) return named[entity];
    return String.fromCodePoint(entity[2].toLowerCase() === 'x'
      ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10));
  });
}

function canvasContext() {
  return new Proxy({
    measureText: (text) => ({ width: String(text).length * 6 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    getImageData: (_x, _y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  }, {
    get: (target, key) => key in target ? target[key] : () => {},
    set: (target, key, value) => { target[key] = value; return true; },
  });
}

function browserDOM(downloads, blobs) {
  const document = new Events();
  document.ids = new Map(); document.missingIds = new Set(); document.activeElement = null;
  document.visibilityState = 'visible';
  class Element extends Events {
    constructor(tag, attributes = {}) {
      super(); this.tagName = tag.toUpperCase(); this.attributes = { ...attributes };
      this.id = attributes.id || ''; this.children = []; this.parentElement = null;
      this.style = {}; this.dataset = {}; this._text = ''; this._value = null;
      this.checked = 'checked' in attributes; this.selected = 'selected' in attributes;
      this.disabled = 'disabled' in attributes; this.inert = 'inert' in attributes;
      this.width = 800; this.height = 300; this.clientWidth = 800; this.clientHeight = 300;
      this.classes = new Set((attributes.class || '').split(/\s+/).filter(Boolean));
      this.classList = {
        add: (...names) => names.forEach((name) => this.classes.add(name)),
        remove: (...names) => names.forEach((name) => this.classes.delete(name)),
        contains: (name) => this.classes.has(name),
        toggle: (name, force) => {
          const on = force === undefined ? !this.classes.has(name) : !!force;
          if (on) this.classes.add(name); else this.classes.delete(name);
          return on;
        },
      };
      for (const [name, value] of Object.entries(attributes)) {
        if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      }
      if (this.id) {
        assert.ok(!document.ids.has(this.id), `duplicate HTML id: ${this.id}`);
        document.ids.set(this.id, this);
      }
    }
    get value() {
      if (this.tagName === 'SELECT') {
        const selected = this.children.find((child) => child.selected) || this.children[0];
        return selected ? selected.value : '';
      }
      return this._value == null ? this.attributes.value || '' : this._value;
    }
    set value(value) {
      if (this.tagName === 'SELECT') {
        for (const child of this.children) child.selected = child.value === String(value);
      } else this._value = String(value);
    }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
    set textContent(value) { this.children = []; this._text = String(value); }
    get firstElementChild() { return this.children[0] || null; }
    set innerHTML(value) { this.children = []; this._text = ''; parseMarkup(String(value), this); }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    focus() { document.activeElement = this; }
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
    getContext(type) { assert.equal(type, '2d'); return this._canvas || (this._canvas = canvasContext()); }
    toDataURL() { return 'data:image/png;base64,'; }
    click() {
      if (this.disabled) return Promise.resolve();
      if (this.tagName === 'A' && this.download) downloads.push({ name: this.download, blob: blobs.get(this.href), href: this.href });
      return this.fire('click');
    }
    querySelectorAll(selector) {
      const matches = [];
      const visit = (parent) => {
        for (const child of parent.children) {
          const found = selector.startsWith('.')
            ? selector.slice(1).split('.').every((name) => child.classList.contains(name))
            : selector.startsWith('#') ? child.id === selector.slice(1) : child.tagName.toLowerCase() === selector;
          if (found) matches.push(child);
          visit(child);
        }
      };
      visit(this); return matches;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  function parseMarkup(markup, parent) {
    const stack = [parent];
    const tokens = markup.replace(/<!--[\s\S]*?-->/g, '').match(/<\/?[\w:-]+(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/g) || [];
    for (const token of tokens) {
      if (!token.startsWith('<')) { stack.at(-1)._text += decode(token); continue; }
      const tag = token.match(/^<\/?([\w:-]+)/)[1].toLowerCase();
      if (token.startsWith('</')) {
        if (stack.at(-1).tagName.toLowerCase() === tag && stack.length > 1) stack.pop();
        continue;
      }
      const attrs = {};
      const source = token.slice(tag.length + 1, token.endsWith('/>') ? -2 : -1);
      for (const match of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g)) {
        attrs[match[1]] = decode(match[2] ?? match[3] ?? match[4] ?? '');
      }
      const child = new Element(tag, attrs); stack.at(-1).appendChild(child);
      if (!voidTags.has(tag) && !token.endsWith('/>')) stack.push(child);
    }
  }
  document.documentElement = new Element('document');
  parseMarkup(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), document.documentElement);
  document.getElementById = (id) => {
    if (!document.ids.has(id)) document.missingIds.add(id);
    return document.ids.get(id) || null;
  };
  document.createElement = (tag) => new Element(tag);
  document.querySelectorAll = (selector) => document.documentElement.querySelectorAll(selector);
  document.querySelector = (selector) => document.documentElement.querySelector(selector);
  return document;
}

async function harness({ denyMicrophone = false, deferMicrophone = false } = {}) {
  const downloads = [], blobs = new Map(), errors = [], contexts = [], streams = [], requests = [];
  const document = browserDOM(downloads, blobs), windowEvents = new Events();
  const frames = new Map(), timers = new Map(); let id = 0, clock = 0, randomState = 12345;
  let resolveMicrophone;
  const permission = deferMicrophone ? new Promise((resolve) => { resolveMicrophone = resolve; }) : null;
  class AudioNode {
    constructor(kind) { this.kind = kind; this.connections = []; this.stopped = false; }
    connect(node) { this.connections.push(node); return node; }
    disconnect() { this.connections = []; this.disconnected = true; }
    start(when = 0) { this.startedAt = when; }
    stop() { this.stopped = true; }
  }
  class AudioContext {
    constructor() {
      this.sampleRate = 48000; this.state = 'suspended'; this.createdAt = clock;
      this.destination = new AudioNode('destination'); this.sources = []; this.captureFrame = 0;
      this.history = new Float32Array(32768); this.historyLength = 0;
      contexts.push(this);
    }
    get currentTime() { return (clock - this.createdAt) / 1000; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createMediaStreamSource(stream) { const node = new AudioNode('microphone'); node.stream = stream; return node; }
    createChannelSplitter() { return new AudioNode('splitter'); }
    createScriptProcessor() { return new AudioNode('capture'); }
    createGain() { const node = new AudioNode('gain'); node.gain = { value: 1 }; return node; }
    createAnalyser() {
      const node = new AudioNode('analyser'); node.fftSize = 2048;
      Object.defineProperty(node, 'frequencyBinCount', { get: () => node.fftSize / 2 });
      node.getFloatTimeDomainData = (out) => {
        for (let i = 0; i < out.length; i++) {
          const sample = this.historyLength - out.length + i;
          out[i] = sample < 0 ? 0 : this.history[sample % this.history.length];
        }
      };
      return node;
    }
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { length, sampleRate, numberOfChannels: channels,
        copyToChannel: (samples, channel) => data[channel].set(samples), getChannelData: (channel) => data[channel] };
    }
    createBufferSource() { const node = new AudioNode('buffer'); this.sources.push(node); return node; }
    createOscillator() { const node = new AudioNode('oscillator'); node.frequency = { value: 440 }; this.sources.push(node); return node; }
    // Model the scheduled source buffers at the output boundary so sequential
    // Delay tests compare the app's reference with independently rendered audio.
    output(startFrame, length) {
      return Float32Array.from({ length }, (_, i) => {
        let value = 0;
        for (const source of this.sources) {
          if (source.stopped || source.startedAt == null) continue;
          const offset = startFrame + i - Math.round(source.startedAt * this.sampleRate);
          if (offset < 0) continue;
          const gain = source.connections.find((node) => node.kind === 'gain')?.gain.value ?? 1;
          if (source.buffer) {
            const samples = source.buffer.getChannelData(0);
            if (source.loop || offset < samples.length) value += samples[offset % samples.length] * gain;
          } else value += Math.sin(2 * Math.PI * source.frequency.value * offset / this.sampleRate) * gain;
        }
        return value;
      });
    }
  }
  const storage = new Map();
  const math = Object.create(Math);
  math.random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 2 ** 32; };
  const sandbox = {
    document, Math: math, AudioContext, Float32Array, Float64Array, Uint8Array, Uint8ClampedArray, Blob,
    console: { log() {}, warn() {}, error: (...items) => errors.push(items.map((item) => item?.stack || String(item)).join(' ')) },
    navigator: { mediaDevices: {
      async getUserMedia(constraints) {
        requests.push(constraints);
        if (denyMicrophone) { const error = new Error('Microphone denied'); error.name = 'NotAllowedError'; throw error; }
        if (permission) await permission;
        const track = new Events(); track.stopped = false; track.stop = () => { track.stopped = true; };
        track.getSettings = () => ({ channelCount: 2, echoCancellation: false, noiseSuppression: false, autoGainControl: false });
        const stream = { getTracks: () => [track], getAudioTracks: () => [track] }; streams.push(stream); return stream;
      },
      async enumerateDevices() { return ['input-a', 'input-b'].map((deviceId) => ({ kind: 'audioinput', deviceId, label: deviceId })); },
      addEventListener() {},
    } },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    performance: { now: () => clock }, devicePixelRatio: 1,
    requestAnimationFrame(fn) { frames.set(++id, fn); return id; }, cancelAnimationFrame(key) { frames.delete(key); },
    setTimeout(fn, ms = 0) { timers.set(++id, { fn, due: clock + ms }); return id; }, clearTimeout(key) { timers.delete(key); },
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    Event: class { constructor(type) { this.type = type; } },
    FileReader: class { readAsText(file) { this.result = file.text; this.onload(); } },
    URL: { createObjectURL(blob) { const url = `blob:integration-${++id}`; blobs.set(url, blob); return url; }, revokeObjectURL: (url) => blobs.delete(url) },
  };
  sandbox.window = sandbox; vm.createContext(sandbox);
  const scriptFiles = [];
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src = script[1].match(/\bsrc=["']([^"']+)["']/i)?.[1]?.split('?')[0];
    const filename = src || 'app.html:inline';
    if (src) scriptFiles.push(src);
    vm.runInContext(src ? fs.readFileSync(path.join(root, src), 'utf8') : script[2], sandbox, { filename });
  }
  await document.fire('DOMContentLoaded');
  await Promise.resolve();
  function animate() {
    const batch = [...frames.values()]; frames.clear(); batch.forEach((fn) => fn(clock));
    for (const [key, timer] of [...timers]) if (timer.due <= clock) { timers.delete(key); timer.fn(); }
  }
  return {
    env: sandbox, document, downloads, contexts, streams, requests, errors, scriptFiles, resolveMicrophone,
    get: (key) => document.getElementById(key),
    async click(key) { await document.getElementById(key).click(); await Promise.resolve(); },
    async change(key, value, type = 'change') { const element = document.getElementById(key); element.value = value; await element.fire(type); },
    async pagehide() { await windowEvents.fire('pagehide'); },
    advance(ms) { clock += ms; animate(); },
    capture(length, mic, reference) {
      const ctx = sandbox.AE.ctx;
      assert.ok(ctx && sandbox.AE.running, 'capture requires an active real engine');
      for (let remaining = length; remaining > 0;) {
        const count = Math.min(4096, remaining), start = ctx.captureFrame;
        const first = mic(start, count, ctx), second = reference ? reference(start, count, ctx) : null;
        assert.equal(first.length, count);
        for (const value of first) ctx.history[ctx.historyLength++ % ctx.history.length] = value;
        ctx.captureFrame += count; clock = ctx.createdAt + ctx.captureFrame / ctx.sampleRate * 1000;
        sandbox.AE._dispatch(first, second, start); animate(); remaining -= count;
      }
    },
    assertHealthy() {
      assert.deepEqual([...document.missingIds], [], 'all script ID lookups must resolve to real app.html elements');
      assert.deepEqual(errors, [], 'no swallowed application or audio callback errors');
    },
  };
}

const sine = (amplitude = 0.1) => (start, length) => Float32Array.from({ length }, (_, i) => amplitude * Math.sin(2 * Math.PI * 1500 * (start + i) / 48000));
function noiseSignal() {
  let state = 41;
  return Float32Array.from({ length: 65536 }, () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state / 2 ** 31 - 1) * 0.2; });
}
function near(actual, expected, tolerance = 1e-6) { assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`); }

test('actual HTML scripts initialize their controls and accessible tab navigation', async () => {
  const h = await harness();
  for (const name of ['DSP', 'AE', 'UI', 'BAU', 'MOD_SPL', 'MOD_RTA', 'MOD_SPECTRO', 'MOD_TF', 'MOD_DELAY', 'MOD_IR', 'MOD_GEN', 'MOD_CAL']) {
    assert.ok(h.env[name], `${name} must load in app.html script order`);
  }
  assert.ok(h.scriptFiles.indexOf('js/app/dsp.js') < h.scriptFiles.indexOf('js/app/modules-tf.js'));
  assert.equal(h.get('selChannels').value, '1'); assert.equal(h.get('selFft').value, '8192');
  assert.equal(h.get('rtaRes').value, '3'); assert.equal(h.get('tfSmooth').value, '6');
  assert.equal(h.get('tfAutoDelay').checked, true); assert.equal(h.get('genLevel').value, '-30');
  assert.equal(h.get('workspace').inert, true);
  await h.get('tab-spl').fire('keydown', { key: 'ArrowRight' });
  assert.equal(h.env.UI.active, 'rta'); assert.equal(h.document.activeElement.id, 'tab-rta');
  assert.equal(h.get('tab-rta').getAttribute('aria-selected'), 'true');
  assert.equal(h.get('mod-rta').classList.contains('active'), true);
  for (const name of ['spectro', 'cal', 'ir', 'gen', 'help', 'spl']) await h.click(`tab-${name}`);
  h.assertHealthy();
});

test('capture keeps SPL live in RTA, calibrates and exports, then reboots the selected input and channels', async () => {
  const h = await harness(), { AE, MOD_SPL: spl, MOD_RTA: rta, BA_STATE: state } = h.env;
  await h.click('btnStart'); await h.change('splWeight', 'Z'); await h.change('rtaAvg', '1'); await h.click('tab-rta');
  assert.equal(AE.running, true); assert.equal(AE.realChannels, 1);
  assert.equal(h.get('overlay').classList.contains('hidden'), true); assert.equal(h.get('workspace').inert, false);
  assert.equal(h.contexts[0].sources.length, 0, 'passive capture must not produce output');
  h.capture(16384, sine());
  const measured = spl.snapshot(), expected = 94 + 10 * Math.log10(0.1 ** 2 / 2);
  near(measured.durationSeconds, 16384 / 48000); near(measured.leqDb, expected, 1e-5);
  assert.equal(measured.calibrated, false);
  const strongest = Math.max(...Array.from(rta.disp).filter(Number.isFinite));
  near(strongest, expected, 0.2);
  await h.click('rtaExport');
  assert.match(await h.downloads.at(-1).blob.text(), /frecuencia_hz,nivel_dbZ/);
  await h.click('rtaPng'); assert.match(h.downloads.at(-1).name, /\.png$/);
  await h.click('tab-cal'); await h.click('calSetReference');
  assert.equal(state.calibrated, true); assert.equal(spl.snapshot().durationSeconds, 0);
  h.capture(4096, sine()); near(spl.snapshot().leqDb, 94, 0.06);
  await h.click('btnSession');
  const report = JSON.parse(await h.downloads.at(-1).blob.text());
  assert.equal(report.sampleRate, 48000); assert.equal(report.channels, 1); assert.equal(report.level.calibrated, true);
  const firstContext = AE.ctx, firstTrack = h.streams[0].getTracks()[0];
  await h.change('selChannels', '2');
  assert.equal(firstContext.state, 'closed'); assert.equal(firstTrack.stopped, true);
  assert.equal(AE.realChannels, 2); assert.equal(state.calibrated, false); assert.equal(spl.snapshot().durationSeconds, 0);
  const secondContext = AE.ctx;
  await h.change('selInput', 'input-b');
  assert.equal(secondContext.state, 'closed'); assert.equal(AE.deviceId, 'input-b');
  assert.equal(h.requests.at(-1).audio.deviceId.exact, 'input-b');
  h.capture(4096, sine()); near(spl.snapshot().durationSeconds, 4096 / 48000);
  await h.click('btnStop');
  assert.equal(AE.running, false); assert.equal(AE.ctx, null); assert.equal(h.get('workspace').inert, true);
  assert.ok(h.streams.every((stream) => stream.getTracks().every((track) => track.stopped)));
  assert.equal(AE._blockSubs.length, 0); assert.equal(AE._pairSubs.length, 0);
  h.assertHealthy();
});

test('real TF and sequential A/B delay analyze captured signals and all output stops across lifecycles', async () => {
  const h = await harness(), { AE, MOD_TF: tf, MOD_DELAY: delay, MOD_GEN: gen, MOD_IR: ir } = h.env;
  await h.change('selChannels', '2'); await h.click('btnStart'); await h.change('splWeight', 'Z');
  await h.click('tab-tf'); await h.change('tfRef', 'ch2'); await h.change('tfSmooth', '0'); await h.click('tfStart');
  assert.equal(tf.measuring, true); assert.equal(gen.playing, false);
  const signal = noiseSignal(), delayFrames = 96;
  const ref = (start, length) => Float32Array.from({ length }, (_, i) => signal[(start + i) % signal.length]);
  const mic = (start, length) => Float32Array.from({ length }, (_, i) => start + i < delayFrames ? 0 : 0.5 * signal[(start + i - delayFrames) % signal.length]);
  h.capture(12288, mic, ref); await h.click('tfFindDelay'); h.capture(12288, mic, ref);
  assert.equal(tf.delaySamples, delayFrames); assert.ok(tf.updates >= 2);
  const bin = Math.round(1000 * tf.W / 48000);
  near(tf.magDb[bin], 20 * Math.log10(0.5), 1e-5); near(tf.phaseDeg[bin], 0, 1e-5); assert.ok(tf.coher[bin] > 0.999);
  await h.click('tfSaveTrace'); assert.equal(tf.traces.length, 1);
  await h.click('tfExportCsv'); assert.match(await h.downloads.at(-1).blob.text(), /1000|frecuencia|frequency|freq/i);
  await h.click('tfStop'); assert.equal(tf.measuring, false);

  await h.click('tab-delay'); await h.change('genLevel', '-12', 'input');
  for (const [source, lag] of [['A', 48], ['B', 144]]) {
    await h.click(`dlMeasure${source}`); assert.equal(delay.state, `meas${source}`);
    const delayedOutput = (start, length, ctx) => Float32Array.from(ctx.output(start - lag, length), (value) => value * 0.7);
    h.capture(36 * 4096, delayedOutput);
    assert.equal(delay.state, 'idle'); assert.equal(source === 'A' ? delay.dA : delay.dB, lag);
  }
  assert.equal(h.get('dlDelta').textContent, '+2.0'); assert.match(h.get('dlRec').textContent, /2\.0 ms → A/);
  assert.equal(gen.playing, false, 'measurement-owned output is released after each source');

  await h.click('tab-ir'); await h.click('irMeasure');
  assert.equal(ir.state, 'rec'); const sweep = h.contexts.at(-1).sources.at(-1);
  await h.click('irCancel'); assert.equal(ir.state, 'idle'); assert.equal(sweep.stopped, true);
  await h.click('btnStop');
  assert.equal(AE.ctx, null); assert.equal(gen.playing, false); assert.equal(tf.measuring, false); assert.equal(delay.state, 'idle');
  assert.ok(h.contexts.every((ctx) => ctx.sources.every((source) => source.stopped)));
  const microphoneRequests = h.requests.length;
  await h.click('btnGenOnly');
  assert.equal(h.requests.length, microphoneRequests); assert.equal(AE.noMic, true); assert.equal(AE.running, false);
  assert.equal(gen.playing, false, 'generator-only mode starts quietly');
  await h.change('genType', 'sine'); await h.click('genPlay'); assert.equal(gen.playing, true);
  const oscillator = h.contexts.at(-1).sources.at(-1); assert.equal(oscillator.frequency.value, 1000);
  AE.ctx.state = 'suspended'; await h.click('btnResume'); assert.equal(AE.ctx.state, 'running');
  await h.pagehide(); assert.equal(oscillator.stopped, true); assert.equal(AE.ctx, null);
  h.assertHealthy();
});

test('microphone denial leaves an actionable overlay and generator-only mode still works', async () => {
  const h = await harness({ denyMicrophone: true });
  await h.click('btnStart');
  assert.equal(h.env.UI.started, false); assert.equal(h.env.AE.running, false);
  assert.equal(h.get('overlay').classList.contains('hidden'), false);
  assert.match(h.get('startError').textContent, /permiso.*denegado/i); assert.equal(h.get('btnStart').disabled, false);
  await h.click('btnGenOnly'); await h.change('genType', 'sine'); await h.click('genPlay');
  assert.equal(h.env.MOD_GEN.playing, true); assert.equal(h.requests.length, 1);
  await h.click('btnStop'); h.assertHealthy();
});

test('page shutdown during pending microphone permission cannot resurrect capture', async () => {
  const h = await harness({ deferMicrophone: true });
  const boot = h.click('btnStart');
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(h.requests.length, 1);
  await h.pagehide(); h.resolveMicrophone(); await boot;
  assert.equal(h.env.UI.started, false); assert.equal(h.env.AE.running, false); assert.equal(h.env.AE.ctx, null);
  assert.equal(h.get('overlay').classList.contains('hidden'), false); assert.equal(h.get('workspace').inert, true);
  assert.equal(h.streams.length, 1, 'the late browser permission result must actually return a stream');
  assert.ok(h.streams.every((stream) => stream.getTracks().every((track) => track.stopped)));
  h.assertHealthy();
});

test('loading and toggling a real calibration file resets measurement history and invalidates level confirmation', async () => {
  const h = await harness(), { MOD_SPL: spl, BA_STATE: state } = h.env;
  await h.click('btnStart'); await h.change('splWeight', 'Z'); h.capture(8192, sine());
  await h.click('calConfirm'); assert.equal(state.calibrated, true);
  const file = h.get('calFile'); file.files = [{ text: '20 6\n100 6\n1000 6\n10000 6\n20000 6' }];
  await file.fire('change');
  assert.equal(state.micCalOn, true); assert.equal(state.calibrated, false); assert.equal(spl.snapshot().durationSeconds, 0);
  h.capture(8192, sine()); near(spl.lastRawDb, 10 * Math.log10(0.1 ** 2 / 2) + 6, 1e-4);
  h.get('calApply').checked = false; await h.get('calApply').fire('change');
  assert.equal(spl.snapshot().durationSeconds, 0);
  h.capture(4096, sine()); await h.click('calRemove');
  assert.equal(state.micCal, null); assert.equal(spl.snapshot().durationSeconds, 0);
  await h.click('btnStop'); h.assertHealthy();
});
