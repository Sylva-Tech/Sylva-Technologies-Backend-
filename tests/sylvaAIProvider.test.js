const test = require('node:test');
const assert = require('node:assert/strict');
const { generateWithSylvaAI, resetPrimaryCircuitForTests } = require('../services/sylvaAIProvider');

const envKeys = [
  'OLLAMA_BASE_URL', 'OLLAMA_MODEL', 'OLLAMA_ACCESS_CLIENT_ID', 'OLLAMA_ACCESS_CLIENT_SECRET',
  'SYLVA_AI_FALLBACK_ENABLED', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN',
  'SYLVA_AI_FALLBACK_MODEL', 'SYLVA_AI_PRIMARY_COOLDOWN_MS', 'SYLVA_AI_FALLBACK_MAX_TOKENS',
];
const snapshot = () => Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const restore = (values) => envKeys.forEach((key) => values[key] === undefined ? delete process.env[key] : process.env[key] = values[key]);

test('uses Ollama first and does not call Workers AI when primary succeeds', async (t) => {
  const previous = snapshot(), originalFetch = global.fetch;
  t.after(() => { restore(previous); global.fetch = originalFetch; resetPrimaryCircuitForTests(); });
  resetPrimaryCircuitForTests();
  process.env.OLLAMA_BASE_URL = 'https://ollama.example.test';
  process.env.OLLAMA_MODEL = 'qwen2.5:3b';
  process.env.OLLAMA_ACCESS_CLIENT_ID = 'test-client.access';
  process.env.OLLAMA_ACCESS_CLIENT_SECRET = 'test-secret';
  process.env.SYLVA_AI_FALLBACK_ENABLED = 'true';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account-test';
  process.env.CLOUDFLARE_API_TOKEN = 'token-test';
  let calls = 0;
  global.fetch = async (url) => {
    calls += 1;
    assert.equal(url, 'https://ollama.example.test/api/chat');
    return new Response(JSON.stringify({ message: { content: '{"ok":true}' } }), { status: 200 });
  };
  const output = await generateWithSylvaAI({ messages: [{ role: 'user', content: 'test' }], parse: JSON.parse });
  assert.deepEqual(output.result, { ok: true });
  assert.equal(output.provider, 'ollama');
  assert.equal(output.model, 'qwen2.5:3b');
  assert.equal(calls, 1);
});

test('falls back through native Workers AI Run API after Ollama fails and preserves JSON schema', async (t) => {
  const previous = snapshot(), originalFetch = global.fetch;
  t.after(() => { restore(previous); global.fetch = originalFetch; resetPrimaryCircuitForTests(); });
  resetPrimaryCircuitForTests();
  process.env.OLLAMA_BASE_URL = 'https://ollama.example.test';
  process.env.OLLAMA_ACCESS_CLIENT_ID = 'test-client.access';
  process.env.OLLAMA_ACCESS_CLIENT_SECRET = 'test-secret';
  process.env.SYLVA_AI_FALLBACK_ENABLED = 'true';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account-test';
  process.env.CLOUDFLARE_API_TOKEN = 'token-test';
  process.env.SYLVA_AI_FALLBACK_MODEL = '@cf/meta/llama-3.1-8b-instruct';
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (String(url).includes('ollama.example.test')) return new Response('offline', { status: 502 });
    return new Response(JSON.stringify({ result: { response: '{"ok":true}' }, success: true, errors: [] }), { status: 200 });
  };
  const output = await generateWithSylvaAI({
    messages: [{ role: 'user', content: 'test' }],
    format: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    parse: JSON.parse,
  });
  assert.deepEqual(output.result, { ok: true });
  assert.equal(output.provider, 'cloudflare-workers-ai');
  assert.equal(output.fallbackUsed, true);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /accounts\/account-test\/ai\/run\/@cf\/meta\/llama-3\.1-8b-instruct$/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer token-test');
  const requestBody = JSON.parse(calls[1].options.body);
  assert.equal(requestBody.messages[0].content, 'test');
  assert.equal(requestBody.response_format.type, 'json_schema');
  assert.deepEqual(requestBody.response_format.json_schema, { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] });
  assert.equal(Object.hasOwn(requestBody, 'model'), false);
});

test('uses JSON object mode for storyboard callers that request format=json', async (t) => {
  const previous = snapshot(), originalFetch = global.fetch;
  t.after(() => { restore(previous); global.fetch = originalFetch; resetPrimaryCircuitForTests(); });
  resetPrimaryCircuitForTests();
  process.env.OLLAMA_BASE_URL = 'https://ollama.example.test';
  process.env.SYLVA_AI_FALLBACK_ENABLED = 'true';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account-test';
  process.env.CLOUDFLARE_API_TOKEN = 'token-test';
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (String(url).includes('ollama.example.test')) return new Response('offline', { status: 503 });
    return new Response(JSON.stringify({ result: { response: '{"ok":true}' }, success: true, errors: [] }), { status: 200 });
  };
  await generateWithSylvaAI({ messages: [], format: 'json', parse: JSON.parse });
  const requestBody = JSON.parse(calls[1].options.body);
  assert.deepEqual(requestBody.response_format, { type: 'json_object' });
});

test('uses fallback directly during primary circuit cooldown', async (t) => {
  const previous = snapshot(), originalFetch = global.fetch;
  t.after(() => { restore(previous); global.fetch = originalFetch; resetPrimaryCircuitForTests(); });
  resetPrimaryCircuitForTests();
  process.env.OLLAMA_BASE_URL = 'https://ollama.example.test';
  process.env.SYLVA_AI_FALLBACK_ENABLED = 'true';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account-test';
  process.env.CLOUDFLARE_API_TOKEN = 'token-test';
  process.env.SYLVA_AI_PRIMARY_COOLDOWN_MS = '30000';
  let primaryCalls = 0, fallbackCalls = 0;
  global.fetch = async (url) => {
    if (String(url).includes('ollama.example.test')) {
      primaryCalls += 1;
      return new Response('offline', { status: 503 });
    }
    fallbackCalls += 1;
    return new Response(JSON.stringify({ result: { response: '{"ok":true}' }, success: true, errors: [] }), { status: 200 });
  };
  await generateWithSylvaAI({ messages: [], parse: JSON.parse });
  await generateWithSylvaAI({ messages: [], parse: JSON.parse });
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 2);
});

test('does not call fallback unless explicitly enabled and fully configured', async (t) => {
  const previous = snapshot(), originalFetch = global.fetch;
  t.after(() => { restore(previous); global.fetch = originalFetch; resetPrimaryCircuitForTests(); });
  resetPrimaryCircuitForTests();
  process.env.OLLAMA_BASE_URL = 'https://ollama.example.test';
  delete process.env.SYLVA_AI_FALLBACK_ENABLED;
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account-test';
  process.env.CLOUDFLARE_API_TOKEN = 'token-test';
  let calls = 0;
  global.fetch = async () => { calls += 1; return new Response('offline', { status: 503 }); };
  await assert.rejects(generateWithSylvaAI({ messages: [], parse: JSON.parse }), { code: 'SYLVA_AI_PROVIDER_ERROR' });
  assert.equal(calls, 1);
});


test('preserves safe primary and fallback diagnostics when both providers fail', async (t) => {
  const previous = snapshot(), originalFetch = global.fetch;
  t.after(() => { restore(previous); global.fetch = originalFetch; resetPrimaryCircuitForTests(); });
  resetPrimaryCircuitForTests();
  process.env.OLLAMA_BASE_URL = 'https://ollama.example.test';
  process.env.SYLVA_AI_FALLBACK_ENABLED = 'true';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account-test';
  process.env.CLOUDFLARE_API_TOKEN = 'token-test';
  global.fetch = async (url) => String(url).includes('ollama.example.test')
    ? new Response('primary unavailable', { status: 502 })
    : new Response(JSON.stringify({ success: false, errors: [{ message: 'fallback denied' }] }), { status: 401 });
  await assert.rejects(
    generateWithSylvaAI({ messages: [], parse: JSON.parse }),
    (error) => {
      assert.equal(error.code, 'SYLVA_AI_ALL_PROVIDERS_FAILED');
      assert.equal(error.primaryCode, 'SYLVA_AI_PROVIDER_ERROR');
      assert.equal(error.primaryStatus, 502);
      assert.equal(error.primaryRetryable, true);
      assert.equal(error.fallbackCode, 'SYLVA_AI_FALLBACK_ERROR');
      assert.equal(error.fallbackStatus, 401);
      assert.equal(error.fallbackRetryable, false);
      assert.equal(JSON.stringify(error).includes('fallback denied'), false);
      return true;
    }
  );
});

test('does not open the primary circuit for response parsing failures', async (t) => {
  const previous = snapshot(), originalFetch = global.fetch;
  t.after(() => { restore(previous); global.fetch = originalFetch; resetPrimaryCircuitForTests(); });
  resetPrimaryCircuitForTests();
  process.env.OLLAMA_BASE_URL = 'https://ollama.example.test';
  process.env.SYLVA_AI_FALLBACK_ENABLED = 'true';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account-test';
  process.env.CLOUDFLARE_API_TOKEN = 'token-test';
  let primaryCalls = 0;
  global.fetch = async (url) => {
    if (String(url).includes('ollama.example.test')) {
      primaryCalls += 1;
      return new Response(JSON.stringify({ message: { content: 'not-json' } }), { status: 200 });
    }
    return new Response('fallback unavailable', { status: 503 });
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      generateWithSylvaAI({ messages: [], parse: JSON.parse }),
      { code: 'SYLVA_AI_ALL_PROVIDERS_FAILED' }
    );
  }
  assert.equal(primaryCalls, 2);
});
