import { readFile } from 'node:fs/promises';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) {
  console.log('Cloudflare Worker deployment skipped: required credentials are not configured.');
  process.exit(0);
}
const source = await readFile(new URL('../workers/assistant/src/index.mjs', import.meta.url), 'utf8');
const metadata = {
  main_module: 'index.mjs',
  compatibility_date: '2026-11-12',
  bindings: [{ type: 'ai', name: 'AI' }],
  keep_bindings: ['secret_text'],
  observability: { enabled: true, logs: { enabled: true, invocation_logs: true } },
  annotations: { 'workers/message': 'BernAudio AI advisory assistant' }
};
const form = new FormData();
form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
form.append('index.mjs', new Blob([source], { type: 'application/javascript+module' }), 'index.mjs');
const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/bernaudio-ai`, {
  method: 'PUT',
  headers: { authorization: `Bearer ${token}` },
  body: form
});
const result = await response.json();
if (!response.ok || !result.success) {
  throw new Error('Cloudflare Worker deployment failed: ' + JSON.stringify(result.errors || result));
}
console.log('BernAudio AI Worker deployed:', result.result?.id, 'deployment:', result.result?.deployment_id);
