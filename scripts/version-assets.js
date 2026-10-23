'use strict';
// Content versions prevent a deployed HTML page from reusing stale audio code.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const hash = relative => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex').slice(0, 12);
function update(relative, transform) {
  const file = path.join(root, relative), previous = fs.readFileSync(file, 'utf8');
  const next = transform(previous);
  if (next !== previous) fs.writeFileSync(file, next);
}
// Update dependency URLs before hashing their importing scripts.
for (const [owner, url, dependency] of [
  ['js/app/analysis-worker.js', 'dsp.js', 'js/app/dsp.js'],
  ['js/app/modules-tf.js', 'js/app/analysis-worker.js', 'js/app/analysis-worker.js'],
  ['js/app/audio-engine.js', 'js/app/capture-worklet.js', 'js/app/capture-worklet.js'],
]) {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  update(owner, source => source.replace(new RegExp("'" + escaped + "(?:\\?v=[a-f0-9]+)?'", 'g'), "'" + url + '?v=' + hash(dependency) + "'"));
}
for (const name of fs.readdirSync(root).filter(file => file.endsWith('.html'))) {
  update(name, html => html.replace(/\b(src|href)="([^"]+)"/g, (attribute, key, value) => {
    if (/^(https?:|data:|mailto:|tel:)/.test(value)) return attribute;
    const [url, fragment] = value.split('#'), local = url.split('?')[0];
    if (!/\.(?:js|css)$/.test(local)) return attribute;
    const relative = local.replace(/^\//, '');
    return key + '="' + local + '?v=' + hash(relative) + (fragment ? '#' + fragment : '') + '"';
  }));
}
console.log('Local CSS, JavaScript and audio dependencies are content-versioned.');
