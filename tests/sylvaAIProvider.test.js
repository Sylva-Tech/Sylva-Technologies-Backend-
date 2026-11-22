const test = require('node:test');
const assert = require('node:assert/strict');
const { generateWithSylvaAI, resetPrimaryCircuitForTests } = require('../services/sylvaAIProvider');

const envKeys = [
  'OLLAMA_BASE_URL', 'OLLAMA_MODEL', 'OLLAMA_ACCESS_CLIENT_ID', 'OLLAMA_ACCESS_CLIENT_SECRET',
  'SYLVA_AI_FALLBACK_ENABLED', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN',
  'SYLVA_AI_FALLBACK_MODEL', 'SYLVA_AI_PRIMARY_COOLDOWN_MS',
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

test('falls back to Workers AI after Ollama fails and keeps the same parser', async (t) => {
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
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
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
  assert.match(calls[1].url, /accounts\/account-test\/ai\/v1\/chat\/completions$/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer token-test');
  const requestBody = JSON.parse(calls[1].options.body);
  assert.equal(requestBody.model, '@cf/meta/llama-3.1-8b-instruct');
  assert.equal(requestBody.response_format.type, 'json_schema');
  assert.ok(requestBody.response_format.json_schema);
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
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
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
