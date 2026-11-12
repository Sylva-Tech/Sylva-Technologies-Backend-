const crypto = require('crypto');

const API_BASE = 'https://api-sg.aliexpress.com/rest';

const DROPSHIP_API_URL = 'https://api-sg.aliexpress.com/sync';

const formatTopTimestamp = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
}).format(new Date()).replace('T', ' ');

const signTopRequest = (params) => {
  const payload = Object.keys(params).filter((key) => key !== 'sign').sort()
    .map((key) => `${key}${params[key]}`).join('');
  return crypto.createHmac('sha256', process.env.ALIEXPRESS_APP_SECRET)
    .update(payload, 'utf8').digest('hex').toUpperCase();
};

// Read-only Dropshipping API calls. Product search/detail are deliberately
// separate from affiliate APIs and use the authorised DS account session.
const callDropshipApi = async (method, values, accessToken) => {
  requiredEnv();
  if (!accessToken) throw new Error('AliExpress authorization is required before catalogue access.');
  const params = {
    app_key: process.env.ALIEXPRESS_APP_KEY,
    method,
    timestamp: formatTopTimestamp(),
    format: 'json',
    v: '2.0',
    sign_method: 'hmac',
    session: accessToken,
    ...values,
  };
  params.sign = signTopRequest(params);
  const response = await fetch(DROPSHIP_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', Accept: 'application/json' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => ({}));
  const envelope = payload[`${method.replaceAll('.', '_')}_response`] || payload;
  const error = envelope.error_response || envelope;
  const errorCode = error.code || error.error_code || error.errorCode;
  const hasError = !response.ok || Boolean(envelope.error_response) ||
    (errorCode && !['0', '00', '200'].includes(String(errorCode)));
  if (hasError) {
    const message = error.msg || error.message || error.sub_msg || 'AliExpress Dropshipping API request failed.';
    const failure = new Error(String(message).slice(0, 240));
    failure.status = response.status || 502;
    failure.code = String(errorCode || 'ALIEXPRESS_API_ERROR');
    throw failure;
  }
  return envelope;
};


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

module.exports = { buildAuthorizationUrl, exchangeAuthorizationCode, refreshAccessToken, encryptSecret, decryptSecret, callDropshipApi };
