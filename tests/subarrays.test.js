'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const engineCode = fs.readFileSync(path.join(root, 'js/subarray.js'), 'utf8');
const uiCode = fs.readFileSync(path.join(root, 'js/subarray-ui.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'subs.html'), 'utf8');

function engine(settings = {}) {
  const context = vm.createContext({ window: {}, clearTimeout, setTimeout });
  vm.runInContext(engineCode, context);
  const subs = context.window.BernSubs;
  Object.assign(subs.SA, settings);
  subs.recompute();
  return subs;
}

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, received ${actual}`);
}

test('one ideal point source is isotropic and follows inverse distance', () => {
  const bs = engine({ type: 'line', n: 1 });
  for (let angle = 0; angle < 360; angle += 15) {
    const radians = angle * Math.PI / 180;
    close(bs.responseAt(10 * Math.sin(radians), 10 * Math.cos(radians)), 0.1);
  }
  close(bs.responseAt(0, 20), bs.responseAt(0, 10) / 2);
});

test('doubling coincident coherent sources yields 6.0206 dB', () => {
  const single = engine({ type: 'line', n: 1 });
  const pair = engine({ type: 'line', n: 2, spacing: 0 });
  const gain = 20 * Math.log10(pair.responseAt(0, 10) / single.responseAt(0, 10));
  close(gain, 20 * Math.log10(2));
});

test('broadband combines independent frequency powers and includes 31 Hz', () => {
  const bs = engine({ type: 'grad', perRow: 1, rowSep: 1.6, broadband: true });
  const expected = Math.sqrt(bs.FREQS.reduce((sum, f) =>
    sum + bs.responseAt(2, 4, [f]) ** 2, 0) / bs.FREQS.length);
  close(bs.responseAt(2, 4), expected);
  const single = engine({ n: 1, broadband: true });
  close(single.responseAt(0, 10), 0.1);
});

test('gradient quarter wavelength pair sums toward +Y and nulls toward -Y', () => {
  const bs = engine({ type: 'grad', perRow: 1 });
  bs.SA.rowSep = bs.lambda / 4;
  bs.recompute();
  const polar = bs.polarResponse();
  close(polar.magnitude[0], 2);
  assert.ok(polar.magnitude[180] < 1e-12);
  assert.equal(bs.subs[0].pol, 1);
  assert.equal(bs.subs[1].pol, -1);
  close(bs.subs[1].delayMs, 1000 / (4 * bs.FREQS[bs.SA.freqIdx]));
});

test('four endfire sources sum toward +Y with rear null at quarter wavelength', () => {
  const bs = engine({ type: 'endfire', n: 4 });
  bs.SA.spacing = bs.lambda / 4;
  bs.recompute();
  const polar = bs.polarResponse();
  close(polar.magnitude[0], 4);
  assert.ok(polar.magnitude[180] < 1e-12);
  assert.ok(bs.subs[0].y > bs.subs[3].y);
  assert.ok(bs.subs[0].delayMs > bs.subs[3].delayMs);
  assert.equal(bs.subs[3].delayMs, 0);
  assert.ok(bs.subs.every(sub => sub.pol === 1));
});

test('positive steering delay aims the line toward positive X', () => {
  const bs = engine({ type: 'earc', n: 6, spacing: 0.8, angle: 30, freqIdx: 4 });
  const polar = bs.polarResponse();
  close(polar.magnitude[30], 6);
  assert.ok(polar.magnitude[330] < polar.magnitude[30] / 2);
});

test('broadband polar averages the same powers as the map', () => {
  const bs = engine({ type: 'endfire', n: 4, spacing: 1.1 });
  const traces = bs.FREQS.map((frequency, freqIdx) => {
    bs.SA.freqIdx = freqIdx;
    bs.recompute();
    return Array.from(bs.polarResponse().magnitude);
  });
  bs.SA.broadband = true;
  const combined = bs.polarResponse();
  assert.deepEqual(Array.from(combined.frequencies), Array.from(bs.FREQS));
  for (const angle of [0, 30, 90, 135, 180, 270]) {
    close(combined.magnitude[angle], Math.sqrt(traces.reduce((sum, trace) =>
      sum + trace[angle] ** 2, 0) / traces.length));
  }
});

// Minimal DOM fixture: real engine and UI run together; ranges implement the
// browser's finite min/max/step constraint rather than accepting invalid values.
function ui(options = {}) {
  class Element {
    constructor(id, attrs = {}) {
      this.id = id;
      this.attrs = attrs;
      this.dataset = Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5), value]));
      this.events = {};
      this.textContent = '';
      this.hidden = false;
      this.checked = false;
      this.style = {};
      const classes = new Set((attrs.class || '').split(' '));
      this.classList = {
        add: value => classes.add(value),
        remove: value => classes.delete(value),
        contains: value => classes.has(value),
        toggle(value, force = !classes.has(value)) {
          if (force) classes.add(value); else classes.delete(value);
          return force;
        }
      };
      this._value = '';
    }
    set value(value) {
      if (this.attrs.type === 'range') {
        const min = Number(this.attrs.min), max = Number(this.attrs.max);
        const step = Number(this.attrs.step);
        value = Math.min(max, Math.max(min, Number(value)));
        value = Math.min(max, Math.max(min, min + Math.round((value - min) / step) * step));
      }
      this._value = String(value);
    }
    get value() { return this._value; }
    addEventListener(event, fn) { this.events[event] = fn; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    querySelector() { return new Element('tbody'); }
    focus() { this.focused = true; }
    emit(event, values = {}) { this.events[event]({ target: this, currentTarget: this, preventDefault() {}, ...values }); }
  }
  const elements = new Map();
  const all = [];
  for (const tag of html.matchAll(/<[a-z][^>]*>/gi)) {
    const attrs = Object.fromEntries(Array.from(tag[0].matchAll(/([\w-]+)="([^"]*)"/g), match => [match[1], match[2]]));
    const el = new Element(attrs.id, attrs);
    if (attrs.value !== undefined) el.value = attrs.value;
    if (attrs.id) elements.set(attrs.id, el);
    all.push(el);
  }
  const context = vm.createContext({
    window: {
      addEventListener() {}, scrollY: 0,
      matchMedia: () => ({ matches: Boolean(options.reducedMotion) })
    },
    document: {
      getElementById: id => elements.get(id),
      querySelectorAll: selector => all.filter(el => selector.startsWith('.ctrl') ? el.dataset.show : el.classList.contains(selector.slice(1))),
      addEventListener() {}
    },
    clearTimeout, setTimeout
  });
  vm.runInContext(engineCode, context);
  const bs = context.window.BernSubs;
  bs.init = () => options.noCanvas ? false : undefined;
  vm.runInContext(uiCode, context);
  return { bs, elements, all };
}

test('temperature output updates speed of sound on the first input event', () => {
  const { bs, elements } = ui();
  const temperature = elements.get('inTemp');
  temperature.value = '45';
  temperature.emit('input');
  assert.ok(elements.get('outTemp').textContent.includes(bs.speed.toFixed(1) + ' m/s'));
});

test('quarter wavelength preset keeps state equal to native slider and output', () => {
  const { bs, elements } = ui();
  // Exercise the same clamp used if future frequency choices exceed UI limits.
  Object.defineProperty(bs, 'lambda', { get: () => 40 });
  elements.get('btnLambda4').emit('click');
  close(bs.SA.spacing, Number(elements.get('inSpacing').value));
  assert.equal(elements.get('outSpacing').textContent, bs.SA.spacing.toFixed(2) + ' m');
});

test('keyboard choices update array type, selected tab, and focus together', () => {
  const { bs, elements, all } = ui();
  const cards = all.filter(el => el.classList.contains('type-card'));
  cards[0].emit('keydown', { key: 'ArrowRight' });
  assert.equal(bs.SA.type, 'earc');
  assert.equal(cards[1].attrs['aria-checked'], 'true');
  assert.equal(cards[0].tabIndex, -1);
  assert.ok(cards[1].focused);
  elements.get('tabMap').emit('keydown', { key: 'End' });
  assert.equal(bs.SA.view, 'waves');
  assert.equal(elements.get('simulationPanel').attrs['aria-labelledby'], 'tabWaves');
  assert.equal(elements.get('inBroad').disabled, true);
  assert.equal(elements.get('btnPauseWaves').hidden, false);
});

test('reduced motion starts waves paused and explicit control can resume', () => {
  const { bs, elements } = ui({ reducedMotion: true });
  assert.equal(bs.SA.animate, false);
  elements.get('tabWaves').emit('click');
  assert.equal(elements.get('btnPauseWaves').textContent, 'Animar ondas');
  elements.get('btnPauseWaves').emit('click');
  assert.equal(bs.SA.animate, true);
  assert.equal(elements.get('btnPauseWaves').textContent, 'Pausar ondas');
});

test('canvas fallback remains visible while delay table controls keep working', () => {
  const { elements } = ui({ noCanvas: true });
  elements.get('inTemp').value = '30';
  elements.get('inTemp').emit('input');
  assert.equal(elements.get('stageLoading').hidden, false);
  assert.match(elements.get('stageLoading').textContent, /Canvas no disponible/);
  assert.match(elements.get('roC').textContent, /349\.5/);
});

function renderedEngine() {
  const labels = [];
  const images = [];
  const frames = new Map();
  let nextFrame = 0;
  const ctx = new Proxy({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    fillText: (text, x, y) => labels.push({ text, x, y })
  }, { get: (target, key) => target[key] || (() => {}) });
  const canvas = {
    getContext: () => ctx,
    parentElement: { getBoundingClientRect: () => ({ width: 480, height: 320 }) },
    style: {}
  };
  const document = {
    hidden: false,
    addEventListener() {},
    createElement: () => ({ getContext: () => ({ putImageData: image => images.push(image.data.slice()) }) })
  };
  const context = vm.createContext({
    window: { addEventListener() {} }, document,
    requestAnimationFrame: fn => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
    clearTimeout, setTimeout
  });
  vm.runInContext(engineCode, context);
  const bs = context.window.BernSubs;
  bs.init(canvas);
  return { bs, labels, images, frames };
}

test('one source map stays identical when averaging independent frequency powers', () => {
  const { bs, images } = renderedEngine();
  bs.SA.n = 1;
  bs.recompute();
  const singleFrequency = images.at(-1);
  bs.SA.broadband = true;
  bs.recompute();
  assert.deepEqual(images.at(-1), singleFrequency);
});

test('map legend puts 0 dB at the bright top and -30 dB at the dark bottom', () => {
  const { bs, labels } = renderedEngine();
  bs.recompute();
  const zero = labels.find(label => label.text === '0 dB');
  const floor = labels.find(label => label.text === '-30 dB');
  assert.ok(zero && floor);
  assert.ok(zero.y < floor.y);
});

test('pausing or leaving waves cancels the animation frame', () => {
  const { bs, frames } = renderedEngine();
  bs.setView('waves');
  assert.equal(frames.size, 1);
  bs.setAnimation(false);
  assert.equal(frames.size, 0);
  bs.recompute();
  assert.equal(frames.size, 0);
  bs.setAnimation(true);
  assert.equal(frames.size, 1);
  bs.setView('polar');
  assert.equal(frames.size, 0);
});
