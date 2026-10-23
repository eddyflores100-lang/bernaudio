'use strict';
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  if (['.git', 'node_modules'].includes(entry.name)) return [];
  const file = path.join(dir, entry.name); return entry.isDirectory() ? walk(file) : [file];
});
const files = walk(root); let checked = 0; const failures = [];
for (const file of files.filter(f => f.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status) failures.push(result.stderr); checked++;
}
for (const file of files.filter(f => f.endsWith('.html'))) {
  const html = fs.readFileSync(file, 'utf8'), ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  if (new Set(ids).size !== ids.length) failures.push(file + ': duplicate IDs');
  for (const [, attr, value] of html.matchAll(/\b(href|src|for|aria-controls|aria-labelledby)="([^"]+)"/g)) {
    if (['for','aria-controls','aria-labelledby'].includes(attr)) {
      for (const id of value.split(' ')) if (!ids.includes(id)) failures.push(file + ': missing control ' + id);
      continue;
    }
    if (/^(https?:|mailto:|data:|tel:)/.test(value)) continue;
    const [local, fragment] = value.split('#');
    const target = local.startsWith('/') ? path.join(root, local) : path.resolve(path.dirname(file), local || path.basename(file));
    if (!fs.existsSync(target)) failures.push(file + ': broken local path ' + value);
    else if (fragment && target.endsWith('.html') && !new RegExp('\\bid="' + fragment + '"').test(fs.readFileSync(target, 'utf8')))
      failures.push(file + ': missing fragment ' + value);
    checked++;
  }
}
// The DSP worker and capture worklet are deployed alongside their importing modules.
for (const file of ['js/app/capture-worklet.js','js/app/analysis-worker.js','js/app/dsp.js'])
  if (!fs.existsSync(path.join(root, file))) failures.push('Missing audio dependency: ' + file);
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log('Site checks passed: ' + checked + ' syntax/link checks.');
