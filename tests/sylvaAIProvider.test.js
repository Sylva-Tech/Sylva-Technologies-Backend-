const test = require('node:test');
const assert = require('node:assert/strict');
const { generateWithSylvaAI, resetPrimaryCircuitForTests } = require('../services/sylvaAIProvider');

const envKeys = [
  'OLLAMA_BASE_URL', 'OLLAMA_MODEL', 'OLLAMA_FALLBACK_MODEL',
  'OLLAMA_ACCESS_CLIENT_ID', 'OLLAMA_ACCESS_CLIENT_SECRET',
  'SYLVA_AI_FALLBACK_ENABLED', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN',
  'SYLVA_AI_FALLBACK_MODEL', 'SYLVA_AI_PRIMARY_COOLDOWN_MS', 'SYLVA_AI_FALLBACK_MAX_TOKENS', 'OLLAMA_TIMEOUT_MS',
];
const snapshot = () => Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const restore = (values) => envKeys.forEach((key) => values[key] === undefined ? delete process.env[key] : process.env[key] = values[key]);
const ollamaResponse = (content, status = 200) => new Response(
  status === 200 ? JSON.stringify({ message: { content } }) : 'Ollama unavailable',
  { status }
);
const cloudflareResponse = (content, status = 200) => new Response(
  JSON.stringify(status === 200
    ? { result: { response: content }, success: true, errors: [] }
    : { success: false, errors: [{ message: 'Workers AI unavailable' }] }),
  { status }
);
const setup = (t) => {
  const previous = snapshot();
  const originalFetch = global.fetch;
  t.after(() => {
    restore(previous);
    global.fetch = originalFetch;
    resetPrimaryCircuitForTests();
  });
  resetPrimaryCircuitForTests();
  process.env.OLLAMA_BASE_URL = 'https://ollama.example.test';
  process.env.OLLAMA_MODEL = 'qwen2.5:3b';
  process.env.OLLAMA_FALLBACK_MODEL = 'qwen2.5:1.5b';
  process.env.OLLAMA_ACCESS_CLIENT_ID = 'test-client.access';
  process.env.OLLAMA_ACCESS_CLIENT_SECRET = 'test-secret';
  process.env.SYLVA_AI_FALLBACK_ENABLED = 'true';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account-test';
  process.env.CLOUDFLARE_API_TOKEN = 'token-test';
  process.env.SYLVA_AI_FALLBACK_MODEL = '@cf/meta/llama-3.1-8b-instruct';
};

test('normalizes trailing slashes and enforces a 120-second minimum Ollama timeout', async (t) => {
  setup(t);
  process.env.OLLAMA_BASE_URL = 'https://ollama.example.test///';
  process.env.OLLAMA_TIMEOUT_MS = '30000';
  const originalTimeout = AbortSignal.timeout;
  let observedTimeout = 0;
  AbortSignal.timeout = (ms) => {
    observedTimeout = ms;
    return originalTimeout(ms);
  };
  t.after(() => { AbortSignal.timeout = originalTimeout; });
  let requestedUrl = '';
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return ollamaResponse('{"ok":true}');
  };
  await generateWithSylvaAI({ messages: [], parse: JSON.parse });
  assert.equal(requestedUrl, 'https://ollama.example.test/api/chat');
  assert.equal(observedTimeout, 120000);
});

test('accepts an OLLAMA_BASE_URL that already ends in /api without duplicating the API path', async (t) => {
  setup(t);
  process.env.OLLAMA_BASE_URL = 'https://ollama.example.test/api/';
  let requestedUrl = '';
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return ollamaResponse('{"ok":true}');
  };
  await generateWithSylvaAI({ messages: [], parse: JSON.parse });
  assert.equal(requestedUrl, 'https://ollama.example.test/api/chat');
});

test('uses primary Qwen 3B first and does not call either fallback when it succeeds', async (t) => {
  setup(t);
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    assert.equal(url, 'https://ollama.example.test/api/chat');
    return ollamaResponse('{"ok":true}');
  };
  const output = await generateWithSylvaAI({
    messages: [{ role: 'user', content: 'test' }],
    parse: JSON.parse,
  });
  assert.deepEqual(output.result, { ok: true });
  assert.equal(output.provider, 'ollama');
  assert.equal(output.model, 'qwen2.5:3b');
  assert.equal(output.fallbackUsed, false);
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].options.body).model, 'qwen2.5:3b');
  assert.equal(calls[0].options.headers['CF-Access-Client-Id'], 'test-client.access');
  assert.equal(calls[0].options.headers['CF-Access-Client-Secret'], 'test-secret');
});

test('uses local Qwen 1.5B through the same protected endpoint before Workers AI', async (t) => {
  setup(t);
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    const body = JSON.parse(options.body);
    if (body.model === 'qwen2.5:3b') return ollamaResponse('', 502);
    assert.equal(body.model, 'qwen2.5:1.5b');
    return ollamaResponse('{"ok":true}');
  };
  const output = await generateWithSylvaAI({
    messages: [{ role: 'user', content: 'test' }],
    parse: JSON.parse,
  });
  assert.deepEqual(output.result, { ok: true });
  assert.equal(output.provider, 'ollama');
  assert.equal(output.model, 'qwen2.5:1.5b');
  assert.equal(output.fallbackUsed, true);
  assert.equal(output.fallbackStage, 'ollama-local');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://ollama.example.test/api/chat');
  assert.equal(calls[1].options.headers['CF-Access-Client-Id'], 'test-client.access');
  assert.equal(calls[1].options.headers['CF-Access-Client-Secret'], 'test-secret');
});

test('uses Cloudflare Workers AI only after both local Qwen models fail', async (t) => {
  setup(t);
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (String(url).includes('ollama.example.test')) return ollamaResponse('', 502);
    return cloudflareResponse('{"ok":true}');
  };
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
  const output = await generateWithSylvaAI({
    messages: [{ role: 'user', content: 'test' }],
    format: schema,
    parse: JSON.parse,
  });
  assert.deepEqual(output.result, { ok: true });
  assert.equal(output.provider, 'cloudflare-workers-ai');
  assert.equal(output.fallbackUsed, true);
  assert.equal(output.fallbackStage, 'cloudflare-workers-ai');
  assert.equal(calls.length, 3);
  assert.equal(JSON.parse(calls[0].options.body).model, 'qwen2.5:3b');
  assert.equal(JSON.parse(calls[1].options.body).model, 'qwen2.5:1.5b');
  assert.match(calls[2].url, /accounts\/account-test\/ai\/run\/@cf\/meta\/llama-3\.1-8b-instruct$/);
  assert.equal(calls[2].options.headers.Authorization, 'Bearer token-test');
  const body = JSON.parse(calls[2].options.body);
  assert.equal(body.response_format.type, 'json_schema');
  assert.deepEqual(body.response_format.json_schema, schema);
  assert.equal(Object.hasOwn(body, 'model'), false);
});

test('uses JSON object mode for Cloudflare storyboard fallback', async (t) => {
  setup(t);
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return String(url).includes('ollama.example.test')
      ? ollamaResponse('', 503)
      : cloudflareResponse('{"ok":true}');
  };
  await generateWithSylvaAI({ messages: [], format: 'json', parse: JSON.parse });
  const body = JSON.parse(calls[2].options.body);
  assert.deepEqual(body.response_format, { type: 'json_object' });
});

test('during primary cooldown it skips Qwen 3B but still tries Qwen 1.5B before Workers AI', async (t) => {
  setup(t);
  process.env.SYLVA_AI_PRIMARY_COOLDOWN_MS = '30000';
  let primaryCalls = 0;
  let localFallbackCalls = 0;
  global.fetch = async (url, options) => {
    if (String(url).includes('ollama.example.test')) {
      const model = JSON.parse(options.body).model;
      if (model === 'qwen2.5:3b') {
        primaryCalls += 1;
        return ollamaResponse('', 503);
      }
      localFallbackCalls += 1;
      return ollamaResponse('{"ok":true}');
    }
    throw new Error('Cloudflare should not be called when local fallback succeeds');
  };
  await generateWithSylvaAI({ messages: [], parse: JSON.parse });
  const second = await generateWithSylvaAI({ messages: [], parse: JSON.parse });
  assert.equal(second.model, 'qwen2.5:1.5b');
  assert.equal(primaryCalls, 1);
  assert.equal(localFallbackCalls, 2);
});

test('does not call Cloudflare Workers AI unless explicitly enabled and fully configured', async (t) => {
  setup(t);
  delete process.env.SYLVA_AI_FALLBACK_ENABLED;
  let cloudflareCalls = 0;
  global.fetch = async (url) => {
    if (!String(url).includes('ollama.example.test')) cloudflareCalls += 1;
    return ollamaResponse('', 503);
  };
  await assert.rejects(
    generateWithSylvaAI({ messages: [], parse: JSON.parse }),
    (error) => {
      assert.equal(error.code, 'SYLVA_AI_PROVIDER_ERROR');
      assert.equal(error.localFallbackCode, 'SYLVA_AI_PROVIDER_ERROR');
      return true;
    }
  );
  assert.equal(cloudflareCalls, 0);
});

test('reports safe diagnostics when both local Qwen models and Cloudflare fail', async (t) => {
  setup(t);
  global.fetch = async (url) => String(url).includes('ollama.example.test')
    ? ollamaResponse('', 502)
    : cloudflareResponse('', 401);
  await assert.rejects(
    generateWithSylvaAI({ messages: [], parse: JSON.parse }),
    (error) => {
      assert.equal(error.code, 'SYLVA_AI_ALL_PROVIDERS_FAILED');
      assert.equal(error.primaryCode, 'SYLVA_AI_PROVIDER_ERROR');
      assert.equal(error.primaryStatus, 502);
      assert.equal(error.localFallbackCode, 'SYLVA_AI_PROVIDER_ERROR');
      assert.equal(error.localFallbackStatus, 502);
      assert.equal(error.fallbackCode, 'SYLVA_AI_FALLBACK_ERROR');
      assert.equal(error.fallbackStatus, 401);
      assert.equal(JSON.stringify(error).includes('Workers AI unavailable'), false);
      return true;
    }
  );
});

test('does not open the primary circuit for response parsing failures', async (t) => {
  setup(t);
  let primaryCalls = 0;
  global.fetch = async (url, options) => {
    if (String(url).includes('ollama.example.test')) {
      const model = JSON.parse(options.body).model;
      if (model === 'qwen2.5:3b') primaryCalls += 1;
      return ollamaResponse('not-json');
    }
    return cloudflareResponse('not-json');
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      generateWithSylvaAI({ messages: [], parse: JSON.parse }),
      { code: 'SYLVA_AI_ALL_PROVIDERS_FAILED' }
    );
  }
  assert.equal(primaryCalls, 2);
});
