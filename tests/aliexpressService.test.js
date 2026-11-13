const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  getDropshipApiConfig,
  requiredDropshipEnv,
  callDropshipApi,
  exchangeAuthorizationCode,
  encryptSecret,
  decryptSecret,
} = require('../services/aliexpressService');

test('current DropShippers Protocol.TOP evidence remains explicitly unverified', () => {
  const config = getDropshipApiConfig();
  assert.equal(config.configured, false);
  assert.equal(config.supported, false);
  assert.equal(config.protocol, 'IOP Protocol.TOP');
  assert.equal(config.endpoint, 'https://api-sg.aliexpress.com/sync');
  assert.equal(config.wireContractVerified, false);
  assert.equal(config.methodEntitlementVerified, false);
  assert.equal(config.readOnlyProductTestSucceeded, false);
});

test('catalogue calls fail closed and never fall back to the deprecated TOP gateway', async () => {
  const previousFetch = global.fetch;
  const previous = {
    legacyKey: process.env.ALIEXPRESS_DS_APP_KEY,
    legacySecret: process.env.ALIEXPRESS_DS_APP_SECRET,
    legacyFlag: process.env.ALIEXPRESS_LEGACY_DROPSHIP_API_CONFIRMED,
  };
  let requestCount = 0;
  global.fetch = async () => {
    requestCount += 1;
    throw new Error('Unexpected AliExpress catalogue network request');
  };
  process.env.ALIEXPRESS_DS_APP_KEY = 'legacy-test-key';
  process.env.ALIEXPRESS_DS_APP_SECRET = 'legacy-test-secret';
  process.env.ALIEXPRESS_LEGACY_DROPSHIP_API_CONFIRMED = 'true';

  try {
    await assert.rejects(
      callDropshipApi('aliexpress.ds.product.get', { product_id: '1001', ship_to_country: 'KE' }, 'test-buyer-token'),
      (error) => error.code === 'ALIEXPRESS_CATALOG_API_NOT_VERIFIED' &&
        error.status === 503 && /Protocol.TOP/.test(error.message),
    );
    assert.equal(requestCount, 0);
    assert.throws(requiredDropshipEnv, (error) =>
      error.code === 'ALIEXPRESS_CATALOG_API_NOT_VERIFIED' && error.status === 503);
  } finally {
    global.fetch = previousFetch;
    if (previous.legacyKey === undefined) delete process.env.ALIEXPRESS_DS_APP_KEY;
    else process.env.ALIEXPRESS_DS_APP_KEY = previous.legacyKey;
    if (previous.legacySecret === undefined) delete process.env.ALIEXPRESS_DS_APP_SECRET;
    else process.env.ALIEXPRESS_DS_APP_SECRET = previous.legacySecret;
    if (previous.legacyFlag === undefined) delete process.env.ALIEXPRESS_LEGACY_DROPSHIP_API_CONFIRMED;
    else process.env.ALIEXPRESS_LEGACY_DROPSHIP_API_CONFIRMED = previous.legacyFlag;
  }
});

test('AliExpress IOP token exchange retains its existing REST endpoint and path-prefixed HMAC-SHA256 signature', async () => {
  const previous = {
    key: process.env.ALIEXPRESS_APP_KEY,
    secret: process.env.ALIEXPRESS_APP_SECRET,
    redirect: process.env.ALIEXPRESS_REDIRECT_URI,
    encryption: process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY,
    fetch: global.fetch,
  };
  const appSecret = 'unit-test-app-secret';
  const originalNow = Date.now;
  let captured;
  process.env.ALIEXPRESS_APP_KEY = 'unit-test-app-key';
  process.env.ALIEXPRESS_APP_SECRET = appSecret;
  process.env.ALIEXPRESS_REDIRECT_URI = 'https://example.test/callback';
  process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY = 'c'.repeat(64);
  Date.now = () => 1794512645000;
  global.fetch = async (url, options) => {
    captured = { url: String(url), body: String(options.body) };
    return { ok: true, status: 200, json: async () => ({ access_token: 'test-access-token' }) };
  };

  try {
    const result = await exchangeAuthorizationCode('test-authorization-code');
    assert.equal(captured.url, 'https://api-sg.aliexpress.com/rest/auth/token/create');
    const params = Object.fromEntries(new URLSearchParams(captured.body));
    assert.equal(params.timestamp, '1794512645000');
    assert.equal(params.sign_method, 'sha256');
    assert.equal(params.code, 'test-authorization-code');
    const suppliedSign = params.sign;
    delete params.sign;
    const payload = '/auth/token/create' + Object.keys(params).sort().map((key) => key + params[key]).join('');
    const expectedSign = crypto.createHmac('sha256', appSecret).update(payload, 'utf8').digest('hex').toUpperCase();
    assert.equal(suppliedSign, expectedSign);
    assert.equal(result.access_token, 'test-access-token');
  } finally {
    Date.now = originalNow;
    if (previous.key === undefined) delete process.env.ALIEXPRESS_APP_KEY; else process.env.ALIEXPRESS_APP_KEY = previous.key;
    if (previous.secret === undefined) delete process.env.ALIEXPRESS_APP_SECRET; else process.env.ALIEXPRESS_APP_SECRET = previous.secret;
    if (previous.redirect === undefined) delete process.env.ALIEXPRESS_REDIRECT_URI; else process.env.ALIEXPRESS_REDIRECT_URI = previous.redirect;
    if (previous.encryption === undefined) delete process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY; else process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY = previous.encryption;
    global.fetch = previous.fetch;
  }
});

test('AliExpress OAuth tokens remain encrypted with authenticated AES-256-GCM storage', () => {
  const previous = process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY;
  process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY = 'd'.repeat(64);
  try {
    const encrypted = encryptSecret('buyer-access-token');
    assert.notEqual(encrypted, 'buyer-access-token');
    assert.equal(decryptSecret(encrypted), 'buyer-access-token');
  } finally {
    if (previous === undefined) delete process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY;
    else process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY = previous;
  }
});
