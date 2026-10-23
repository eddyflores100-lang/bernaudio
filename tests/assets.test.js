'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12);

test('published HTML identifies each local stylesheet and script by its actual content', () => {
  let references = 0;
  for (const name of fs.readdirSync(root).filter(x => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(root, name), 'utf8');
    for (const [, value] of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
      if (/^(https?:|data:)/.test(value)) continue;
      const url = new URL(value, 'https://bernaudio.example/' + name);
      if (!/\.(?:js|css)$/.test(url.pathname)) continue;
      assert.equal(url.searchParams.get('v'), digest(path.join(root, url.pathname)), name + ': stale cached asset ' + value);
      references++;
    }
  }
  assert.ok(references > 15);
});

test('audio workers and their DSP dependency receive independent content versions', () => {
  for (const [owner, expression, dependency] of [
    ['js/app/audio-engine.js', /addModule\('([^']+)'\)/, 'js/app/capture-worklet.js'],
    ['js/app/modules-tf.js', /new URL\('([^']+analysis-worker\.js[^']*)'/, 'js/app/analysis-worker.js'],
    ['js/app/analysis-worker.js', /importScripts\('([^']+)'\)/, 'js/app/dsp.js'],
  ]) {
    const source = fs.readFileSync(path.join(root, owner), 'utf8');
    const match = source.match(expression); assert.ok(match, owner);
    const url = new URL(match[1], 'https://bernaudio.example/');
    assert.equal(url.searchParams.get('v'), digest(path.join(root, dependency)), owner + ': stale audio dependency');
  }
});
