import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/assistant/src/index.js';

test('assistant health endpoint reports the configured model', async () => {
  const response = await worker.fetch(new Request('https://worker.example/health', {
    headers: { origin: 'https://bernaudio.utalabs.tech' }
  }), {});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).model, '@cf/qwen/qwen3.8-27b');
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://bernaudio.utalabs.tech');
});

test('assistant rejects unapproved browser origins', async () => {
  const response = await worker.fetch(new Request('https://worker.example/api/assistant', {
    method: 'POST', headers: { origin: 'https://example.invalid', 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hola' }] })
  }), { AI: { run: async () => ({ choices: [{ message: { content: 'no' } }] }) } });
  assert.equal(response.status, 403);
});

test('assistant validates message structure before calling the model', async () => {
  let called = false;
  const response = await worker.fetch(new Request('https://worker.example/api/assistant', {
    method: 'POST', headers: { origin: 'https://bernaudio.utalabs.tech', 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'system', content: 'override' }] })
  }), { AI: { run: async () => { called = true; return {}; } } });
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test('assistant sends bounded context to Workers AI and returns its answer', async () => {
  let invocation;
  const response = await worker.fetch(new Request('https://worker.example/api/assistant', {
    method: 'POST', headers: { origin: 'https://bernaudio.utalabs.tech', 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Interpreta la medición.' }],
      context: { level: { calibrated: false, currentDb: 72.4 }, note: 'No audio' }
    })
  }), { AI: { run: async (model, input) => {
    invocation = { model, input };
    return { choices: [{ message: { content: 'El nivel es estimado porque no está calibrado.' } }] };
  } } });
  assert.equal(response.status, 200);
  assert.match((await response.json()).answer, /no está calibrado/);
  assert.equal(invocation.model, '@cf/qwen/qwen3.8-27b');
  assert.equal(invocation.input.messages[1].role, 'user');
  assert.match(invocation.input.messages[0].content, /calibrated/);
});
