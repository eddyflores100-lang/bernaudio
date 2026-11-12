'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('PWA manifest meets install identity and icon requirements for phone and tablet', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.id, './app.html');
  assert.equal(manifest.start_url, './app.html?source=installed');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.prefer_related_applications, false);

  const icons = manifest.icons;
  assert.ok(icons.some(icon => icon.type === 'image/png' && icon.sizes === '192x192' && icon.purpose === 'any'));
  assert.ok(icons.some(icon => icon.type === 'image/png' && icon.sizes === '512x512' && icon.purpose === 'any'));
  assert.ok(icons.some(icon => icon.type === 'image/png' && icon.sizes === '512x512' && icon.purpose === 'maskable'));
  assert.ok(icons.some(icon => icon.type === 'image/svg+xml' && icon.sizes === 'any'));

  for (const asset of ['assets/pwa-icon-192.png', 'assets/pwa-icon-512.png', 'assets/apple-touch-icon.png', 'assets/pwa-icon.svg']) {
    assert.ok(fs.existsSync(path.join(root, asset)), 'missing PWA icon: ' + asset);
  }
  assert.equal(fs.readFileSync(path.join(root, 'assets/pwa-icon-192.png')).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(fs.readFileSync(path.join(root, 'assets/pwa-icon-512.png')).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('app exposes native install guidance, offline status and user-controlled updates', () => {
  const html = read('app.html');
  assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon"[^>]+assets\/apple-touch-icon\.png/);
  assert.match(html, /id="btnInstallAppStart"/);
  assert.match(html, /id="btnInstallAppTop"/);
  assert.match(html, /id="pwaInstallGuide"/);
  assert.match(html, /Añadir a pantalla de inicio/);
  assert.match(html, /id="pwaNetworkStatus"/);
  assert.match(html, /id="pwaUpdateBanner"/);
  assert.match(html, /id="fieldRestoreDraft"/);
  assert.match(html, /id="fieldDeleteDraft"/);
});

test('PWA client handles install prompt, iOS fallback, connectivity and safe update notice', () => {
  const source = read('js/app/pwa.js');
  assert.match(source, /beforeinstallprompt/);
  assert.match(source, /appinstalled/);
  assert.match(source, /iPhone o iPad/);
  assert.match(source, /showGuide/);
  assert.match(source, /navigator\.onLine/);
  assert.match(source, /controllerchange/);
  assert.match(source, /btnApplyPwaUpdate/);
  assert.match(source, /register\('\.\/sw\.js'/);
  assert.doesNotMatch(source, /setInterval\(/);
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'js/app/pwa.js' }));
});

test('service worker versions the shell, precaches dynamic audio modules and excludes non-GET and foreign requests', () => {
  const source = read('sw.js');
  assert.match(source, /bernaudio-field-shell-v2/);
  assert.match(source, /precacheApplication/);
  assert.match(source, /addModule/);
  assert.match(source, /importScripts/);
  assert.match(source, /request\.method !== 'GET'/);
  assert.match(source, /url\.origin !== self\.location\.origin/);
  assert.match(source, /STATIC_ASSET/);
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'sw.js' }));
});

test('field draft storage is local-only and bounded by the field session schema', () => {
  const source = read('js/app/field-mode.js');
  assert.match(source, /bernaudio\.fieldDraft\.v1/);
  assert.match(source, /persistDraft\(\)/);
  assert.match(source, /loadDraft\(\)/);
  assert.match(source, /restoreDraft\(\)/);
  assert.match(source, /deleteDraft\(\)/);
  assert.match(source, /points\.length > 80/);
  assert.doesNotMatch(source, /fetch\([^\n]*fieldDraft/);
});
