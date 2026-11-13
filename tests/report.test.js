'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '../js/app/report.js');
const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : '';

function loadReport(openImpl = () => null) {
  const sandbox = { Date, Number, String, Array, Math, JSON, Object, RegExp };
  sandbox.window = sandbox;
  sandbox.open = openImpl;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'report.js' });
  return sandbox;
}

function sample() {
  return {
    product: 'BernAudio',
    schemaVersion: 2,
    createdAt: '2026-11-12T18:00:00.000Z',
    environment: { userAgent: '<script>alert(1)</script>', language: 'es', platform: 'tablet' },
    audio: { sampleRate: 48000, channels: 2, captureBackend: 'WebAudio', fftSize: 4096, state: 'running' },
    level: {
      weighting: 'A', response: 'Fast', durationSeconds: 12,
      leqDb: 74.2, minDb: 55.1, maxDb: 78.4, peakDb: 81.2,
      calibrated: false, offsetDb: 94, history: []
    },
    spectrum: {
      weighting: 'A', resolutionPerOctave: 12, engine: 'RTA',
      bands: [{ centerHz: 1000, levelDb: 60.5 }],
      savedCurves: []
    },
    transferFunction: {
      traces: [{
        name: 'Front', createdAt: '2026-11-12T17:55:00.000Z',
        sampleRate: 48000, fftSize: 2048, reference: 'channel 2',
        delayAdjustmentMs: 1.2, polarityInverted: false,
        magnitudeDb: [-1, -2], phaseDeg: [0, 1], coherence: [0.9, 0.8]
      }]
    },
    correctionCurve: { enabled: true, frequencies: [100, 1000], db: [0, -1] },
    field: {
      schemaVersion: 1, eventName: 'Demo', points: [{
        zone: 'Front', capturedAt: '2026-11-12T17:50:00.000Z',
        level: { leqDb: 70, minDb: 65, maxDb: 74, calibrated: false },
        environment: { conditions: { temperatureC: 22, windKph: 4 }, capturedAt: '2026-11-12T17:50:00.000Z' },
        location: { latitude: -0.2, longitude: -78.5 }
      }]
    },
    limitations: ['No es un instrumento certificado.']
  };
}

test('builds a printable technical report with measurements and explicit limits', () => {
  const h = loadReport();
  assert.ok(h.BA_REPORT, 'report module must expose BA_REPORT');
  const html = h.BA_REPORT.buildHtml(sample());
  assert.match(html, /Informe técnico de medición/);
  assert.match(html, /74\.2/);
  assert.match(html, /1000/);
  assert.match(html, /Front/);
  assert.match(html, /Guardar como PDF/);
  assert.match(html, /No es un instrumento certificado/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /-0\.2|-78\.5/, 'precise GPS coordinates must not be included by default');
  assert.doesNotMatch(html, /audio bruto|rawAudio/i);
});

test('opens a local print view and reports popup blocking', () => {
  let written = '';
  let closed = false;
  const reportWindow = { document: { write(value) { written = value; }, close() { closed = true; } }, opener: {} };
  const h = loadReport(() => reportWindow);
  assert.equal(h.BA_REPORT.open(sample()), true);
  assert.equal(reportWindow.opener, null);
  assert.equal(closed, true);
  assert.match(written, /Informe técnico de medición/);

  const blocked = loadReport(() => null);
  assert.equal(blocked.BA_REPORT.open(sample()), false);
});
