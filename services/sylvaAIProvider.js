const { getOllamaRequestHeaders } = require('./ollamaAccess');

let primaryOpenUntil = 0;

const enabled = (value) => String(value || '').trim().toLowerCase() === 'true';
const timeoutMs = () => Math.max(5000, Math.min(180000, Number(process.env.OLLAMA_TIMEOUT_MS) || 90000));
const cooldownMs = () => Math.max(5000, Math.min(300000, Number(process.env.SYLVA_AI_PRIMARY_COOLDOWN_MS) || 30000));

const makeError = (message, code, status = 503, extra = {}) =>
  Object.assign(new Error(message), { code, status, ...extra });

const getFallbackConfig = () => ({
  enabled: enabled(process.env.SYLVA_AI_FALLBACK_ENABLED),
  accountId: String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim(),
  apiToken: String(process.env.CLOUDFLARE_API_TOKEN || '').trim(),
  model: String(process.env.SYLVA_AI_FALLBACK_MODEL || '@cf/meta/llama-3.1-8b-instruct').trim(),
});

const readProviderError = async (response, provider) => {
  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error?.message || body?.message || body?.errors?.[0]?.message || '';
  } catch {
    try { detail = (await response.text()).slice(0, 300); } catch { /* ignore body parsing errors */ }
  }
  return makeError(
    provider === 'ollama'
      ? 'Sylva AI primary model request failed with HTTP ' + response.status
      : 'Sylva AI fallback provider request failed with HTTP ' + response.status,
    provider === 'ollama' ? 'SYLVA_AI_PROVIDER_ERROR' : 'SYLVA_AI_FALLBACK_ERROR',
    503,
    { providerStatus: response.status, retryable: response.status === 408 || response.status === 429 || response.status >= 500, providerDetail: detail }
  );
};

const parseProviderText = (raw, provider) => {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw makeError('Sylva AI returned an empty response.', provider === 'ollama' ? 'SYLVA_AI_INVALID_RESPONSE' : 'SYLVA_AI_FALLBACK_INVALID_RESPONSE', 502);
  }
  return raw.trim();
};

async function requestOllama({ messages, format, options, timeout }) {
  const base = String(process.env.OLLAMA_BASE_URL || '').trim().replace(/\/$/, '');
  if (!base) throw makeError('Sylva AI primary model endpoint is not configured.', 'SYLVA_AI_NOT_CONFIGURED', 503);
  const model = String(process.env.OLLAMA_MODEL || 'qwen2.5:3b').trim();
  let response;
  try {
    response = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: getOllamaRequestHeaders(),
      body: JSON.stringify({ model, messages, stream: false, ...(format ? { format } : {}), options: options || {} }),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (cause) {
    throw makeError(
      cause?.name === 'TimeoutError' ? 'Sylva AI primary model request timed out.' : 'Sylva AI could not reach its primary model endpoint.',
      cause?.name === 'TimeoutError' ? 'SYLVA_AI_TIMEOUT' : 'SYLVA_AI_UNAVAILABLE',
      503,
      { retryable: true }
    );
  }
  if (!response.ok) throw await readProviderError(response, 'ollama');
  let payload;
  try { payload = await response.json(); } catch {
    throw makeError('Sylva AI primary model returned an unreadable response.', 'SYLVA_AI_INVALID_RESPONSE', 502);
  }
  return { raw: parseProviderText(payload?.message?.content, 'ollama'), provider: 'ollama', model };
}

async function requestCloudflareWorkersAI({ messages, format, options, timeout, config }) {
  const url = 'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(config.accountId) + '/ai/v1/chat/completions';
  const responseFormat = format && typeof format === 'object'
    ? { type: 'json_schema', schema: format }
    : { type: 'json_object' };
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + config.apiToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: false,
        temperature: Number.isFinite(Number(options?.temperature)) ? Number(options.temperature) : 0.2,
        max_tokens: Math.max(256, Math.min(4096, Number(process.env.SYLVA_AI_FALLBACK_MAX_TOKENS) || 2048)),
        response_format: responseFormat,
      }),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (cause) {
    throw makeError(
      cause?.name === 'TimeoutError' ? 'Sylva AI fallback request timed out.' : 'Sylva AI could not reach Cloudflare Workers AI.',
      'SYLVA_AI_FALLBACK_UNAVAILABLE',
      503,
      { retryable: true }
    );
  }
  if (!response.ok) throw await readProviderError(response, 'cloudflare-workers-ai');
  let payload;
  try { payload = await response.json(); } catch {
    throw makeError('Sylva AI fallback provider returned an unreadable response.', 'SYLVA_AI_FALLBACK_INVALID_RESPONSE', 502);
  }
  const raw = payload?.choices?.[0]?.message?.content || payload?.result?.response;
  return { raw: parseProviderText(raw, 'cloudflare-workers-ai'), provider: 'cloudflare-workers-ai', model: config.model };
}

/**
 * Execute the same prompt and validation against the primary Ollama model first,
 * then Cloudflare Workers AI when enabled. The parser/validator is deliberately
 * shared so fallback output passes exactly the same safety checks.
 */
async function generateWithSylvaAI({ messages, format, options = {}, parse, timeout = timeoutMs() }) {
  if (typeof parse !== 'function') throw new TypeError('A response parser is required.');
  const config = getFallbackConfig();
  const fallbackReady = config.enabled && Boolean(config.accountId && config.apiToken);
  const primaryBase = String(process.env.OLLAMA_BASE_URL || '').trim();
  const primaryAvailableForAttempt = Boolean(primaryBase) && Date.now() >= primaryOpenUntil;
  let primaryError = null;

  if (primaryAvailableForAttempt) {
    try {
      const response = await requestOllama({ messages, format, options, timeout });
      const result = await parse(response.raw, { provider: response.provider, model: response.model });
      primaryOpenUntil = 0;
      return { result, provider: response.provider, model: response.model };
    } catch (error) {
      primaryError = error;
      primaryOpenUntil = Date.now() + cooldownMs();
    }
  } else if (!primaryBase) {
    primaryError = makeError('Sylva AI primary model endpoint is not configured.', 'SYLVA_AI_NOT_CONFIGURED', 503);
  } else {
    primaryError = makeError('Sylva AI primary model is temporarily cooling down after a connection failure.', 'SYLVA_AI_PRIMARY_COOLDOWN', 503);
  }

  if (!fallbackReady) {
    if (config.enabled && (!config.accountId || !config.apiToken)) {
      primaryError.fallbackConfiguration = 'Workers AI fallback is enabled but CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN is missing.';
    }
    throw primaryError;
  }

  try {
    const response = await requestCloudflareWorkersAI({ messages, format, options, timeout, config });
    const result = await parse(response.raw, { provider: response.provider, model: response.model });
    return { result, provider: response.provider, model: response.model, fallbackUsed: true };
  } catch (fallbackError) {
    throw makeError(
      'Sylva AI could not complete the request using either the private Qwen model or its configured fallback. Please try again shortly.',
      'SYLVA_AI_ALL_PROVIDERS_FAILED',
      503,
      {
        primaryCode: primaryError?.code || 'SYLVA_AI_PRIMARY_FAILED',
        fallbackCode: fallbackError?.code || 'SYLVA_AI_FALLBACK_FAILED',
        primaryStatus: primaryError?.providerStatus || primaryError?.status || 503,
        fallbackStatus: fallbackError?.providerStatus || fallbackError?.status || 503,
      }
    );
  }
}

function resetPrimaryCircuitForTests() {
  primaryOpenUntil = 0;
}

module.exports = { generateWithSylvaAI, resetPrimaryCircuitForTests };
