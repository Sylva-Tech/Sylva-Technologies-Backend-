const { getOllamaRequestHeaders } = require('./ollamaAccess');

let primaryOpenUntil = 0;

const enabled = (value) => String(value || '').trim().toLowerCase() === 'true';
const timeoutMs = () => Math.max(120000, Math.min(300000, Number(process.env.OLLAMA_TIMEOUT_MS) || 120000));
const cooldownMs = () => Math.max(5000, Math.min(300000, Number(process.env.SYLVA_AI_PRIMARY_COOLDOWN_MS) || 30000));

const makeError = (message, code, status = 503, extra = {}) =>
  Object.assign(new Error(message), { code, status, ...extra });

const getFallbackConfig = () => ({
  enabled: enabled(process.env.SYLVA_AI_FALLBACK_ENABLED),
  accountId: String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim(),
  apiToken: String(process.env.CLOUDFLARE_API_TOKEN || '').trim(),
  model: String(process.env.SYLVA_AI_FALLBACK_MODEL || '@cf/meta/llama-3.1-8b-instruct').trim(),
});

const getLocalFallbackModel = () =>
  String(process.env.OLLAMA_FALLBACK_MODEL || 'qwen2.5:1.5b').trim();

const readProviderError = async (response, provider) => {
  let detail = '';
  try {
    const bodyText = await response.text();
    try {
      const body = JSON.parse(bodyText);
      detail = body?.error?.message || body?.message || body?.errors?.[0]?.message || '';
    } catch {
      detail = bodyText.slice(0, 4000);
    }
  } catch {
    // Do not allow an unreadable provider error body to hide the HTTP status.
  }
  return makeError(
    provider === 'ollama'
      ? 'Sylva AI Ollama model request failed with HTTP ' + response.status
      : 'Sylva AI Cloudflare Workers AI request failed with HTTP ' + response.status,
    provider === 'ollama' ? 'SYLVA_AI_PROVIDER_ERROR' : 'SYLVA_AI_FALLBACK_ERROR',
    503,
    {
      providerStatus: response.status,
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      providerDetail: detail,
    }
  );
};

const parseProviderText = (raw, provider) => {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw makeError(
      'Sylva AI returned an empty response.',
      provider === 'ollama' ? 'SYLVA_AI_INVALID_RESPONSE' : 'SYLVA_AI_FALLBACK_INVALID_RESPONSE',
      502
    );
  }
  return raw.trim();
};

function getOllamaEndpoint() {
  const configured = String(process.env.OLLAMA_BASE_URL || '').trim();
  if (!configured) throw makeError('Sylva AI Ollama endpoint is not configured.', 'SYLVA_AI_NOT_CONFIGURED', 503);
  let parsed;
  try { parsed = new URL(configured); } catch {
    throw makeError('OLLAMA_BASE_URL must be a valid absolute HTTP(S) URL.', 'SYLVA_AI_INVALID_ENDPOINT', 503);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw makeError('OLLAMA_BASE_URL must use HTTP or HTTPS.', 'SYLVA_AI_INVALID_ENDPOINT', 503);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw makeError('OLLAMA_BASE_URL must not contain credentials, query parameters, or fragments; use Cloudflare Access service-token environment variables.', 'SYLVA_AI_INVALID_ENDPOINT', 503);
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  if (/\/v1$/i.test(parsed.pathname)) {
    throw makeError('OLLAMA_BASE_URL must point to the Ollama native API root, not an OpenAI-compatible /v1 path.', 'SYLVA_AI_INVALID_ENDPOINT', 503);
  }
  if (/\/api\/chat$/i.test(parsed.pathname)) return parsed.toString().replace(/\/$/, '');
  if (/\/api$/i.test(parsed.pathname)) parsed.pathname += '/chat';
  else parsed.pathname += '/api/chat';
  return parsed.toString().replace(/\/$/, '');
}

function safeOllamaUrlForLog(value) {
  try {
    const parsed = new URL(value);
    parsed.username = parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '[invalid Ollama URL]';
  }
}

async function requestOllama({ messages, format, options, timeout, model }) {
  const url = getOllamaEndpoint();
  const loggedUrl = safeOllamaUrlForLog(url);
  const requestTimeout = Math.max(120000, Number(timeout) || timeoutMs());
  const selectedModel = String(model || process.env.OLLAMA_MODEL || 'qwen2.5:3b').trim();
  const headers = getOllamaRequestHeaders();
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: selectedModel,
        messages,
        stream: false,
        ...(format ? { format } : {}),
        options: options || {},
      }),
      signal: AbortSignal.timeout(requestTimeout),
    });
  } catch (cause) {
    const timedOut = cause?.name === 'TimeoutError' || cause?.name === 'AbortError';
    const message = timedOut
      ? 'Ollama request timed out after ' + requestTimeout + 'ms.'
      : 'Ollama request to ' + loggedUrl + ' failed: ' + (cause?.message || String(cause));
    console.error('[Sylva AI][Ollama] transport failure', {
      url: loggedUrl,
      model: selectedModel,
      timeoutMs: requestTimeout,
      statusCode: null,
      errorName: cause?.name || 'Error',
      errorMessage: cause?.message || String(cause),
      cause: cause?.cause?.message || null,
    });
    throw makeError(
      timedOut ? 'Sylva AI Ollama model request timed out.' : 'Sylva AI could not reach its private Ollama endpoint.',
      timedOut ? 'SYLVA_AI_TIMEOUT' : 'SYLVA_AI_UNAVAILABLE',
      503,
      { retryable: true, providerUrl: loggedUrl, providerTimeoutMs: requestTimeout, providerMessage: message }
    );
  }
  if (!response.ok) {
    const providerError = await readProviderError(response, 'ollama');
    console.error('[Sylva AI][Ollama] HTTP failure', {
      url: loggedUrl,
      model: selectedModel,
      timeoutMs: requestTimeout,
      statusCode: response.status,
      errorMessage: providerError.message,
      providerDetail: providerError.providerDetail || '',
    });
    providerError.providerUrl = loggedUrl;
    providerError.providerTimeoutMs = requestTimeout;
    throw providerError;
  }
  let payload;
  try { payload = await response.json(); } catch {
    throw makeError('Sylva AI Ollama model returned an unreadable response.', 'SYLVA_AI_INVALID_RESPONSE', 502);
  }
  return {
    raw: parseProviderText(payload?.message?.content, 'ollama'),
    provider: 'ollama',
    model: selectedModel,
  };
}

/**
 * Cloudflare Workers AI native Run API is deliberately used instead of the
 * OpenAI-compatible route. It accepts Workers AI account tokens and returns
 * { result: { response } }.
 */
async function requestCloudflareWorkersAI({ messages, format, options, timeout, config }) {
  const modelPath = config.model.split('/').map((part) => encodeURIComponent(part).replace(/%40/gi, '@')).join('/');
  const url = 'https://api.cloudflare.com/client/v4/accounts/' +
    encodeURIComponent(config.accountId) + '/ai/run/' + modelPath;

  let responseFormat;
  if (format === 'json' || format === 'json_object') {
    responseFormat = { type: 'json_object' };
  } else if (format && typeof format === 'object') {
    responseFormat = { type: 'json_schema', json_schema: format };
  } else if (format === 'json_schema') {
    responseFormat = { type: 'json_schema' };
  }

  const body = {
    messages,
    stream: false,
    temperature: Number.isFinite(Number(options?.temperature)) ? Number(options.temperature) : 0.2,
    max_tokens: Math.max(256, Math.min(4096, Number(process.env.SYLVA_AI_FALLBACK_MAX_TOKENS) || 2048)),
    ...(responseFormat ? { response_format: responseFormat } : {}),
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + config.apiToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (cause) {
    throw makeError(
      cause?.name === 'TimeoutError' ? 'Sylva AI Cloudflare Workers AI request timed out.' : 'Sylva AI could not reach Cloudflare Workers AI.',
      'SYLVA_AI_FALLBACK_UNAVAILABLE',
      503,
      { retryable: true }
    );
  }

  if (!response.ok) throw await readProviderError(response, 'cloudflare-workers-ai');

  let payload;
  try { payload = await response.json(); } catch {
    throw makeError('Sylva AI Cloudflare Workers AI returned an unreadable response.', 'SYLVA_AI_FALLBACK_INVALID_RESPONSE', 502);
  }

  if (payload?.success === false || (Array.isArray(payload?.errors) && payload.errors.length)) {
    const providerMessage = (Array.isArray(payload?.errors) ? payload.errors : []).map((item) => item?.message).filter(Boolean).join('; ').slice(0, 300);
    throw makeError(
      'Sylva AI Cloudflare Workers AI rejected the inference request.',
      'SYLVA_AI_FALLBACK_ERROR',
      503,
      { providerStatus: response.status, providerDetail: providerMessage, retryable: false }
    );
  }

  const raw = payload?.result?.response;
  return {
    raw: parseProviderText(raw, 'cloudflare-workers-ai'),
    provider: 'cloudflare-workers-ai',
    model: config.model,
  };
}

/**
 * Provider order:
 * 1. Private Qwen primary model (OLLAMA_MODEL, normally qwen2.5:3b).
 * 2. Private Qwen local fallback (OLLAMA_FALLBACK_MODEL, normally qwen2.5:1.5b).
 * 3. Cloudflare Workers AI (only when explicitly enabled and configured).
 *
 * The same prompt and caller-supplied parser/validator are used at every stage.
 */
async function generateWithSylvaAI({ messages, format, options = {}, parse, timeout = timeoutMs() }) {
  if (typeof parse !== 'function') throw new TypeError('A response parser is required.');

  const config = getFallbackConfig();
  const cloudflareReady = config.enabled && Boolean(config.accountId && config.apiToken);
  const primaryBase = String(process.env.OLLAMA_BASE_URL || '').trim();
  const primaryModel = String(process.env.OLLAMA_MODEL || 'qwen2.5:3b').trim();
  const localFallbackModel = getLocalFallbackModel();
  let primaryError = null;
  let localFallbackError = null;

  const primaryAvailableForAttempt = Boolean(primaryBase) && Date.now() >= primaryOpenUntil;
  if (primaryAvailableForAttempt) {
    try {
      const response = await requestOllama({ messages, format, options, timeout, model: primaryModel });
      const result = await parse(response.raw, { provider: response.provider, model: response.model });
      primaryOpenUntil = 0;
      return { result, provider: response.provider, model: response.model, fallbackUsed: false };
    } catch (error) {
      primaryError = error;
      // Only transient transport/provider failures open the primary circuit.
      // Parser/validation errors can still be recovered by the secondary model.
      if (error?.retryable === true) primaryOpenUntil = Date.now() + cooldownMs();
    }
  } else if (!primaryBase) {
    primaryError = makeError('Sylva AI private Ollama endpoint is not configured.', 'SYLVA_AI_NOT_CONFIGURED', 503);
  } else {
    primaryError = makeError(
      'Sylva AI primary Qwen model is cooling down after a connection failure.',
      'SYLVA_AI_PRIMARY_COOLDOWN',
      503,
      { retryable: true }
    );
  }

  // The local fallback shares the same private endpoint and Cloudflare Access
  // service-token headers as the primary model. It does not require a second URL.
  if (primaryBase && localFallbackModel && localFallbackModel !== primaryModel) {
    try {
      const response = await requestOllama({
        messages, format, options, timeout, model: localFallbackModel,
      });
      const result = await parse(response.raw, { provider: response.provider, model: response.model });
      return { result, provider: response.provider, model: response.model, fallbackUsed: true, fallbackStage: 'ollama-local' };
    } catch (error) {
      localFallbackError = error;
    }
  } else {
    localFallbackError = makeError(
      !primaryBase
        ? 'Sylva AI local fallback was skipped because the private Ollama endpoint is not configured.'
        : 'Sylva AI local fallback model is not configured or duplicates the primary model.',
      'SYLVA_AI_LOCAL_FALLBACK_NOT_CONFIGURED',
      503
    );
  }

  if (!cloudflareReady) {
    if (config.enabled && (!config.accountId || !config.apiToken)) {
      primaryError.fallbackConfiguration = 'Workers AI fallback is enabled but CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN is missing.';
    }
    primaryError.localFallbackCode = localFallbackError?.code || 'SYLVA_AI_LOCAL_FALLBACK_FAILED';
    primaryError.localFallbackStatus = localFallbackError?.providerStatus || localFallbackError?.status || 503;
    throw primaryError;
  }

  try {
    const response = await requestCloudflareWorkersAI({ messages, format, options, timeout, config });
    const result = await parse(response.raw, { provider: response.provider, model: response.model });
    return { result, provider: response.provider, model: response.model, fallbackUsed: true, fallbackStage: 'cloudflare-workers-ai' };
  } catch (cloudflareError) {
    throw makeError(
      'Sylva AI could not complete the request using either private Qwen model or Cloudflare Workers AI. Please try again shortly.',
      'SYLVA_AI_ALL_PROVIDERS_FAILED',
      503,
      {
        primaryCode: primaryError?.code || 'SYLVA_AI_PRIMARY_FAILED',
        primaryStatus: primaryError?.providerStatus || primaryError?.status || 503,
        primaryRetryable: primaryError?.retryable === true,
        localFallbackCode: localFallbackError?.code || 'SYLVA_AI_LOCAL_FALLBACK_FAILED',
        localFallbackStatus: localFallbackError?.providerStatus || localFallbackError?.status || 503,
        localFallbackRetryable: localFallbackError?.retryable === true,
        fallbackCode: cloudflareError?.code || 'SYLVA_AI_FALLBACK_FAILED',
        fallbackStatus: cloudflareError?.providerStatus || cloudflareError?.status || 503,
        fallbackRetryable: cloudflareError?.retryable === true,
      }
    );
  }
}

function resetPrimaryCircuitForTests() {
  primaryOpenUntil = 0;
}

module.exports = { generateWithSylvaAI, resetPrimaryCircuitForTests };
