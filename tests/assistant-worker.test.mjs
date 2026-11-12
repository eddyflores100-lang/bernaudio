import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/assistant/src/index.mjs';

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
    return { choices: [{ message: { content: 'El nivel es estimado porque no está calibrado.', reasoning: 'texto interno separado' } }] };
  } } });
  assert.equal(response.status, 200);
  assert.match((await response.json()).answer, /no está calibrado/);
  assert.equal(invocation.model, '@cf/qwen/qwen3.8-27b');
  assert.equal(invocation.input.reasoning_effort, 'low');
  assert.equal(invocation.input.store, false);
  assert.equal(invocation.input.max_tokens, 1200);
  assert.equal(invocation.input.messages[1].role, 'user');
  assert.match(invocation.input.messages[0].content, /calibrated/);
});


test('assistant never returns internal reasoning when the model omits final content', async () => {
  const response = await worker.fetch(new Request('https://worker.example/api/assistant', {
    method: 'POST', headers: { origin: 'https://bernaudio.utalabs.tech', 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hola' }] })
  }), { AI: { run: async () => ({
    choices: [{ finish_reason: 'length', message: { content: null, reasoning: 'private internal reasoning' } }]
  }) } });
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /private internal reasoning/);
});


test('environment endpoint reports a clear missing-provider-key state without leaking anything', async () => {
  const response = await worker.fetch(new Request('https://worker.example/api/environment', {
    method: 'POST', headers: { origin: 'https://bernaudio.utalabs.tech', 'content-type': 'application/json' },
    body: JSON.stringify({ latitude: -0.18, longitude: -78.47 })
  }), {});
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.code, 'weather_not_configured');
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://bernaudio.utalabs.tech');
});

test('environment endpoint rejects invalid coordinates before calling the provider', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('should not be called'); };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/environment', {
      method: 'POST', headers: { origin: 'https://bernaudio.utalabs.tech', 'content-type': 'application/json' },
      body: JSON.stringify({ latitude: 91, longitude: 0 })
    }), { WEATHERAPI_KEY: 'test-secret' });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('environment endpoint returns a sanitized weather snapshot and keeps provider key server-side', async () => {
  const originalFetch = globalThis.fetch;
  let requested;
  globalThis.fetch = async url => {
    requested = new URL(url);
    return new Response(JSON.stringify({
      location: { name: 'Quito', region: 'Pichincha', country: 'Ecuador', localtime: '2026-11-12 13:00' },
      current: {
        temp_c: 19.5, humidity: 62, pressure_mb: 1015.8,
        wind_kph: 8.4, wind_degree: 210, wind_dir: 'SSW',
        gust_kph: 12.3, cloud: 42, precip_mm: 0, vis_km: 10,
        condition: { text: 'Parcialmente nublado' }
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/environment?lat=-0.18&lon=-78.47', {
      headers: { origin: 'https://bernaudio.utalabs.tech' }
    }), { WEATHERAPI_KEY: 'test-secret' });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.source, 'WeatherAPI.com');
    assert.equal(payload.location.name, 'Quito');
    assert.equal(payload.conditions.pressureHpa, 1015.8);
    assert.equal(payload.conditions.temperatureC, 19.5);
    assert.equal(payload.conditions.windKph, 8.4);
    assert.equal(requested.searchParams.get('key'), 'test-secret');
    assert.doesNotMatch(JSON.stringify(payload), /test-secret/);
  } finally { globalThis.fetch = originalFetch; }
});
