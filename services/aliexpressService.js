const crypto = require('crypto');

const API_BASE = 'https://api-sg.aliexpress.com/rest';
const TOP_API_BASE = 'https://api-sg.aliexpress.com';
const TOP_SYNC_ENDPOINT = 'https://api-sg.aliexpress.com/sync';
const AUTH_BASE = 'https://api-sg.aliexpress.com/oauth/authorize';
const TOP_PARTNER_ID = 'iop-sdk-java-20181207';
const TOP_SIGN_METHOD = 'sha256';
const READ_ONLY_METHODS = new Set([
  'aliexpress.ds.product.get',
  'aliexpress.ds.feedname.get',
  'aliexpress.ds.feed.itemids.get',
  'aliexpress.trade.ds.order.get',
  'aliexpress.ds.order.tracking.get',
]);

const getDropshipApiConfig = () => ({
  configured: Boolean(process.env.ALIEXPRESS_APP_KEY && process.env.ALIEXPRESS_APP_SECRET),
  appKeyConfigured: Boolean(process.env.ALIEXPRESS_APP_KEY),
  appSecretConfigured: Boolean(process.env.ALIEXPRESS_APP_SECRET),
  supported: true,
  protocol: 'IOP Protocol.TOP',
  endpoint: TOP_SYNC_ENDPOINT,
  wireContractVerified: true,
  methodEntitlementVerified: false,
  readOnlyProductTestSucceeded: false,
  sdkReference: 'Official generated IOP Java SDK: TopExecutor, BaseExecutor, IopUtils and AliexpressDsProductGetRequest',
  reason: 'The generated official AliExpress IOP Java SDK confirms the Protocol.TOP /sync request contract. App ID method entitlement still requires a successful read-only product lookup.',
});

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

const requiredDropshipEnv = () => {
  requiredEnv();
  return true;
};

const signRequest = (params, secret) => {
  const payload = Object.keys(params).sort().map((key) => {
    const value = params[key];
    return value === undefined || value === null || value === '' ? '' : `${key}${value}`;
  }).join('');
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex').toUpperCase();
};

// Mirrors the generated Java SDK's TopExecutor.getRequestContext() exactly:
// - TOP common parameters (including session, not access_token)
// - millisecond epoch timestamp
// - partner_id iop-sdk-java-20181207, v=2.0, format=json, simplify=true
// - signature over the sorted common + business parameters, with no API-name prefix
// - method in the URL and in the signed common-parameter set
// Business parameters are sent in the form-encoded POST body.
const buildTopProtocolRequest = ({ apiName, businessParams, accessToken, timestamp = Date.now(), appKey, appSecret }) => {
  if (!READ_ONLY_METHODS.has(apiName)) {
    const error = new Error('Only approved read-only AliExpress catalogue and order-query methods are enabled.');
    error.code = 'ALIEXPRESS_METHOD_NOT_ALLOWED';
    error.status = 400;
    throw error;
  }
  if (!accessToken) {
    const error = new Error('An active AliExpress buyerApp access token is required.');
    error.code = 'ALIEXPRESS_TOKEN_REQUIRED';
    error.status = 409;
    throw error;
  }
  const commonParams = {
    app_key: String(appKey),
    v: '2.0',
    timestamp: String(timestamp),
    method: apiName,
    format: 'json',
    session: String(accessToken),
    partner_id: TOP_PARTNER_ID,
    sign_method: TOP_SIGN_METHOD,
    simplify: 'true',
  };
  const business = {};
  for (const [key, value] of Object.entries(businessParams || {})) {
    if (value !== undefined && value !== null && !['app_key', 'v', 'timestamp', 'method', 'format', 'session', 'partner_id', 'sign_method', 'simplify', 'sign'].includes(key)) {
      business[key] = String(value);
    }
  }
  const signParams = { ...commonParams, ...business };
  const sign = signRequest(signParams, appSecret);
  const queryParams = new URLSearchParams({ ...commonParams, sign });
  const url = `${TOP_SYNC_ENDPOINT}?method=${encodeURIComponent(apiName)}&${queryParams.toString()}`;
  return {
    url,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Accept: 'text/xml,text/javascript',
    },
    body: new URLSearchParams(business).toString(),
    sign,
    commonParams,
    businessParams: business,
  };
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

const signRestRequest = (apiPath, params) => {
  const payload = Object.keys(params).sort().map((key) => `${key}${params[key]}`).join('');
  return crypto.createHmac('sha256', process.env.ALIEXPRESS_APP_SECRET)
    .update(`${apiPath}${payload}`, 'utf8').digest('hex').toUpperCase();
};

const callTokenApi = async (apiPath, values) => {
  requiredEnv();
  const params = {
    app_key: process.env.ALIEXPRESS_APP_KEY,
    timestamp: String(Date.now()),
    sign_method: 'sha256',
    ...values,
  };
  params.sign = signRestRequest(apiPath, params);
  const response = await fetch(`${API_BASE}${apiPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = {}; }
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

const callDropshipApi = async (apiName, businessParams, accessToken) => {
  requiredDropshipEnv();
  if (!READ_ONLY_METHODS.has(apiName)) {
    const error = new Error('Only documented read-only AliExpress catalogue methods are enabled.');
    error.code = 'ALIEXPRESS_METHOD_NOT_ALLOWED';
    error.status = 400;
    throw error;
  }
  const request = buildTopProtocolRequest({
    apiName,
    businessParams,
    accessToken,
    appKey: process.env.ALIEXPRESS_APP_KEY,
    appSecret: process.env.ALIEXPRESS_APP_SECRET,
  });
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(20000),
  });
  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    const error = new Error('AliExpress returned a non-JSON response to the read-only catalogue request.');
    error.code = 'ALIEXPRESS_INVALID_RESPONSE';
    error.status = 502;
    throw error;
  }
  if (!response.ok || payload.error_response || payload.code && String(payload.code) !== '0') {
    const detail = payload.error_response || payload;
    const error = new Error(String(detail.msg || detail.message || detail.sub_msg || 'AliExpress rejected the catalogue request.'));
    error.code = 'ALIEXPRESS_API_ERROR';
    error.status = 502;
    error.aliexpressCode = String(detail.code || detail.error_code || '');
    throw error;
  }
  const envelope = payload[`${apiName.split('.').join('_')}_response`] || payload;
  const methodCode = envelope.rsp_code ?? envelope.resp_result?.resp_code;
  const methodRet = envelope.ret;
  if (methodRet === false || (methodCode !== undefined && ![200, '200', 0, '0'].includes(methodCode))) {
    const error = new Error(String(envelope.rsp_msg || envelope.resp_result?.resp_msg || 'AliExpress catalogue method returned an unsuccessful result.'));
    error.code = 'ALIEXPRESS_API_ERROR';
    error.status = 502;
    error.aliexpressCode = String(methodCode ?? '');
    throw error;
  }
  return payload;
};

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

module.exports = {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
  encryptSecret,
  decryptSecret,
  getDropshipApiConfig,
  requiredDropshipEnv,
  callDropshipApi,
  buildTopProtocolRequest,
};
