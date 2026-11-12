/* Device profile/preflight contract checks. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('device preflight and profile manager are present, local-only and conservative about calibration', () => {
  const html = read('app.html');
  const source = read('js/app/device-preflight.js');
  const css = read('css/app.css');
  for (const id of ['devicePreflight','deviceProfileName','deviceProfileSave','deviceProfileSelect','deviceProfileApply','deviceProfileDelete','devicePreflightRun','devicePreflightResults','devicePreflightStatus']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /js\/app\/device-preflight\.js/);
  assert.match(source, /bernaudio\.deviceProfiles\.v1/);
  assert.match(source, /state\.calibrated = false/);
  assert.match(source, /No se envía|solo en este dispositivo|solo en este dispositivo/i);
  assert.doesNotMatch(source, /deviceId\s*:/, 'profiles must not persist device identifiers');
  assert.match(source, /12 perfiles/);
  assert.match(source, /Pendiente de verificación/);
  assert.match(css, /\.device-preflight/);
  assert.doesNotThrow(() => new vm.Script(source));
});
