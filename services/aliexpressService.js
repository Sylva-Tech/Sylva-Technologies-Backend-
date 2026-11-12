const crypto = require('crypto');

const API_BASE = 'https://api-sg.aliexpress.com/rest';
const AUTH_BASE = 'https://api-sg.aliexpress.com/oauth/authorize';

const requiredEnv = () => {
  const missing = ['ALIEXPRESS_APP_KEY', 'ALIEXPRESS_APP_SECRET', 'ALIEXPRESS_REDIRECT_URI']
    .filter((key) => !process.env[key]);
  if (!/^[a-f0-9]{64}$/i.test(process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY || '')) missing.push('ALIEXPRESS_TOKEN_ENCRYPTION_KEY (64-character hex)');
  if (missing.length) {
    const error = new Error(`AliExpress configuration is incomplete: ${missing.join(', ')}`);
    error.code = 'ALIEXPRESS_NOT_CONFIGURED';
    throw error;
  }
};

const signRequest = (apiPath, params) => {
  const secret = process.env.ALIEXPRESS_APP_SECRET;
  const payload = Object.keys(params).sort().map((key) => `${key}${params[key]}`).join('');
  return crypto.createHmac('sha256', secret).update(`${apiPath}${payload}`, 'utf8').digest('hex').toUpperCase();
};

const buildAuthorizationUrl = (state) => {
  requiredEnv();
  const url = new URL(AUTH_BASE);
  url.search = new URLSearchParams({
    response_type: 'code',
    force_auth: 'true',
    redirect_uri: process.env.ALIEXPRESS_REDIRECT_URI,
    client_id: process.env.ALIEXPRESS_APP_KEY,
    state,
  }).toString();
  return url.toString();
};

const callTokenApi = async (apiPath, values) => {
  requiredEnv();
  const params = {
    app_key: process.env.ALIEXPRESS_APP_KEY,
    timestamp: new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14),
    sign_method: 'sha256',
    ...values,
  };
  params.sign = signRequest(apiPath, params);
  const response = await fetch(`${API_BASE}${apiPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (payload.code && String(payload.code) !== '0') || payload.error_response) {
    const error = new Error(payload.message || payload.error_message || 'AliExpress token request failed.');
    error.status = response.status || 502;
    throw error;
  }
  const data = payload.data || payload;
  if (!data.access_token) throw new Error('AliExpress did not return an access token. Check the app API permissions and token API response.');
  return data;
};

const exchangeAuthorizationCode = (code) => callTokenApi('/auth/token/create', { code });
const refreshAccessToken = (refreshToken) => callTokenApi('/auth/token/refresh', { refresh_token: refreshToken });

const encryptSecret = (value) => {
  if (!value) return '';
  const rawKey = process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(rawKey)) {
    const error = new Error('ALIEXPRESS_TOKEN_ENCRYPTION_KEY must be a 64-character hexadecimal key.');
    error.code = 'ALIEXPRESS_ENCRYPTION_KEY_MISSING';
    throw error;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(rawKey, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(':');
};

const decryptSecret = (value) => {
  if (!value) return '';
  const [ivHex, tagHex, dataHex] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY, 'hex'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
};


const formatAliExpressTimestamp = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}:${value.second}`;
};

// The Dropshipper product APIs use the TOP-compatible router documented by
// AliExpress. The OAuth exchange above remains on the api-sg /rest endpoint.
const DROPSHIP_API_BASE = 'https://eco.taobao.com/router/rest';

const extractRecommendedProducts = (payload) => {
  const wrapper = payload?.aliexpress_ds_recommend_feed_get_response || payload;
  const result = wrapper?.result || wrapper?.resp_result?.result || wrapper?.data?.result;
  const collection = result?.products;
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection?.integer)) return collection.integer;
  if (Array.isArray(collection?.product)) return collection.product;
  if (collection && typeof collection === 'object') {
    return Object.values(collection).flatMap((value) => Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []);
  }
  return [];
};

const callDropshipApi = async (method, values, accessToken) => {
  requiredEnv();
  if (!/^aliexpress\\.ds\\.[a-z.]+$/.test(String(method || ''))) {
    throw new Error('Unsupported AliExpress Dropshipping API method.');
  }
  if (!accessToken) {
    const error = new Error('AliExpress authorization is missing. Re-authorize the connected account.');
    error.code = 'ALIEXPRESS_TOKEN_MISSING';
    throw error;
  }

  const params = {
    app_key: process.env.ALIEXPRESS_APP_KEY,
    method,
    timestamp: formatAliExpressTimestamp(),
    sign_method: 'sha256',
    format: 'json',
    v: '2.0',
    session: accessToken,
    ...values,
  };
  params.sign = signRequest(method, params);

  const response = await fetch(DROPSHIP_API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', Accept: 'application/json' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => ({}));
  const wrapperKey = `${method.replace(/\\./g, '_')}_response`;
  const wrapper = payload?.[wrapperKey] || payload;
  const result = wrapper?.result || wrapper?.resp_result?.result || wrapper?.data?.result;

  if (!response.ok || payload?.error_response || wrapper?.error_response || !result) {
    const providerError = payload?.error_response || wrapper?.error_response;
    const reason = providerError?.sub_msg || providerError?.msg || wrapper?.rsp_msg || payload?.message;
    const error = new Error(reason || 'AliExpress rejected the product catalogue request. Check the Dropshipping API permissions and account eligibility.');
    error.code = providerError?.sub_code || 'ALIEXPRESS_CATALOG_API_ERROR';
    error.status = response.status || 502;
    throw error;
  }

  return { result, raw: payload };
};

const fetchRecommendedFeed = async (values, accessToken) => {
  const response = await callDropshipApi('aliexpress.ds.recommend.feed.get', values, accessToken);
  return { ...response, products: extractRecommendedProducts(response.raw) };
};

module.exports = { buildAuthorizationUrl, exchangeAuthorizationCode, refreshAccessToken, encryptSecret, decryptSecret, formatAliExpressTimestamp, extractRecommendedProducts, callDropshipApi, fetchRecommendedFeed };
