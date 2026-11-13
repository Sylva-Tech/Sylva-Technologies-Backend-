const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  getDropshipApiConfig,
  requiredDropshipEnv,
  callDropshipApi,
  buildTopProtocolRequest,
  exchangeAuthorizationCode,
  encryptSecret,
  decryptSecret,
} = require('../services/aliexpressService');

const withEnv = async (values, callback) => {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try { return await callback(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test('official generated IOP Java SDK Protocol.TOP contract is represented in backend config', () => {
  const config = getDropshipApiConfig();
  assert.equal(config.protocol, 'IOP Protocol.TOP');
  assert.equal(config.endpoint, 'https://api-sg.aliexpress.com/sync');
  assert.equal(config.wireContractVerified, true);
  assert.equal(config.methodEntitlementVerified, false);
  assert.equal(config.readOnlyProductTestSucceeded, false);
  assert.match(config.sdkReference, /TopExecutor/);
});

test('Protocol.TOP request matches generated SDK common parameters, session token and signature', () => {
  const request = buildTopProtocolRequest({
    apiName: 'aliexpress.ds.product.get',
    businessParams: { product_id: '100000123456', ship_to_country: 'KE', target_currency: 'USD', target_language: 'en_US' },
    accessToken: 'buyer-access-token',
    timestamp: 1794512645000,
    appKey: 'test-app-key',
    appSecret: 'test-app-secret',
  });
  const url = new URL(request.url);
  assert.equal(url.origin + url.pathname, 'https://api-sg.aliexpress.com/sync');
  assert.deepEqual(url.searchParams.getAll('method'), ['aliexpress.ds.product.get', 'aliexpress.ds.product.get']);
  assert.equal(url.searchParams.get('app_key'), 'test-app-key');
  assert.equal(url.searchParams.get('v'), '2.0');
  assert.equal(url.searchParams.get('timestamp'), '1794512645000');
  assert.equal(url.searchParams.get('format'), 'json');
  assert.equal(url.searchParams.get('session'), 'buyer-access-token');
  assert.equal(url.searchParams.get('access_token'), null);
  assert.equal(url.searchParams.get('partner_id'), 'iop-sdk-java-20181207');
  assert.equal(url.searchParams.get('sign_method'), 'sha256');
  assert.equal(url.searchParams.get('simplify'), 'true');
  const sign = url.searchParams.get('sign');
  const signed = { ...request.commonParams, ...request.businessParams };
  const canonical = Object.keys(signed).sort().map((key) => key + signed[key]).join('');
  const expected = crypto.createHmac('sha256', 'test-app-secret').update(canonical, 'utf8').digest('hex').toUpperCase();
  assert.equal(sign, expected);
  assert.equal(request.body, 'product_id=100000123456&ship_to_country=KE&target_currency=USD&target_language=en_US');
  assert.equal(request.headers['Content-Type'], 'application/x-www-form-urlencoded;charset=UTF-8');
});

test('Protocol.TOP adapter permits only the documented read-only catalogue methods', () => {
  assert.throws(() => buildTopProtocolRequest({
    apiName: 'aliexpress.ds.order.create',
    businessParams: {},
    accessToken: 'token',
    appKey: 'key',
    appSecret: 'secret',
  }), (error) => error.code === 'ALIEXPRESS_METHOD_NOT_ALLOWED' && error.status === 400);
});

test('read-only product request uses /sync, sends form body and parses the SDK response envelope', async () => {
  await withEnv({
    ALIEXPRESS_APP_KEY: 'test-app-key',
    ALIEXPRESS_APP_SECRET: 'test-app-secret',
    ALIEXPRESS_REDIRECT_URI: 'https://example.test/callback',
    ALIEXPRESS_TOKEN_ENCRYPTION_KEY: 'c'.repeat(64),
  }, async () => {
    const previousFetch = global.fetch;
    const previousNow = Date.now;
    let captured;
    Date.now = () => 1794512645000;
    global.fetch = async (url, options) => {
      captured = { url: String(url), options };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          aliexpress_ds_product_get_response: {
            rsp_code: 200,
            rsp_msg: 'Call succeeds',
            result: { ae_item_base_info_dto: { product_id: 100000123456, subject: 'Test laptop' } },
          },
        }),
      };
    };
    try {
      const response = await callDropshipApi('aliexpress.ds.product.get', {
        product_id: '100000123456',
        ship_to_country: 'KE',
      }, 'buyer-access-token');
      assert.equal(new URL(captured.url).pathname, '/sync');
      assert.equal(captured.options.method, 'POST');
      assert.match(captured.options.body, /product_id=100000123456/);
      assert.match(captured.url, /session=buyer-access-token/);
      assert.equal(response.aliexpress_ds_product_get_response.rsp_code, 200);
    } finally {
      Date.now = previousNow;
      global.fetch = previousFetch;
    }
  });
});

test('catalogue request rejects malformed/non-JSON and API-error responses without exposing credentials', async () => {
  await withEnv({
    ALIEXPRESS_APP_KEY: 'test-app-key',
    ALIEXPRESS_APP_SECRET: 'test-app-secret',
    ALIEXPRESS_REDIRECT_URI: 'https://example.test/callback',
    ALIEXPRESS_TOKEN_ENCRYPTION_KEY: 'c'.repeat(64),
  }, async () => {
    const previousFetch = global.fetch;
    try {
      global.fetch = async () => ({ ok: true, status: 200, text: async () => '<html>not json</html>' });
      await assert.rejects(
        callDropshipApi('aliexpress.ds.product.get', { product_id: '1001', ship_to_country: 'KE' }, 'secret-token'),
        (error) => error.code === 'ALIEXPRESS_INVALID_RESPONSE' && !error.message.includes('secret-token'),
      );
      global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ error_response: { code: 'NO_PERMISSION', msg: 'Permission denied' } }) });
      await assert.rejects(
        callDropshipApi('aliexpress.ds.product.get', { product_id: '1001', ship_to_country: 'KE' }, 'secret-token'),
        (error) => error.code === 'ALIEXPRESS_API_ERROR' && error.aliexpressCode === 'NO_PERMISSION',
      );
    } finally {
      global.fetch = previousFetch;
    }
  });
});

test('AliExpress IOP token exchange retains existing REST endpoint and path-prefixed HMAC-SHA256 signature', async () => {
  await withEnv({
    ALIEXPRESS_APP_KEY: 'unit-test-app-key',
    ALIEXPRESS_APP_SECRET: 'unit-test-app-secret',
    ALIEXPRESS_REDIRECT_URI: 'https://example.test/callback',
    ALIEXPRESS_TOKEN_ENCRYPTION_KEY: 'c'.repeat(64),
  }, async () => {
    const previousFetch = global.fetch;
    const originalNow = Date.now;
    let captured;
    Date.now = () => 1794512645000;
    global.fetch = async (url, options) => {
      captured = { url: String(url), body: String(options.body) };
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'test-access-token' }) };
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
      const expectedSign = crypto.createHmac('sha256', 'unit-test-app-secret').update(payload, 'utf8').digest('hex').toUpperCase();
      assert.equal(suppliedSign, expectedSign);
      assert.equal(result.access_token, 'test-access-token');
    } finally {
      Date.now = originalNow;
      global.fetch = previousFetch;
    }
  });
});

test('AliExpress OAuth tokens remain encrypted with authenticated AES-256-GCM storage', async () => {
  await withEnv({ ALIEXPRESS_TOKEN_ENCRYPTION_KEY: 'd'.repeat(64) }, async () => {
    const encrypted = encryptSecret('buyer-access-token');
    assert.notEqual(encrypted, 'buyer-access-token');
    assert.equal(decryptSecret(encrypted), 'buyer-access-token');
  });
});

test('legacy TOP credentials cannot enable write methods or bypass the read-only allowlist', async () => {
  await withEnv({
    ALIEXPRESS_APP_KEY: 'test-app-key',
    ALIEXPRESS_APP_SECRET: 'test-app-secret',
    ALIEXPRESS_REDIRECT_URI: 'https://example.test/callback',
    ALIEXPRESS_TOKEN_ENCRYPTION_KEY: 'c'.repeat(64),
    ALIEXPRESS_DS_APP_KEY: 'legacy-key',
    ALIEXPRESS_DS_APP_SECRET: 'legacy-secret',
    ALIEXPRESS_LEGACY_DROPSHIP_API_CONFIRMED: 'true',
  }, async () => {
    await assert.rejects(
      callDropshipApi('aliexpress.ds.order.create', { product_id: '1001' }, 'test-token'),
      (error) => error.code === 'ALIEXPRESS_METHOD_NOT_ALLOWED',
    );
  });
});

test('Protocol.TOP adapter signs and permits both documented feed discovery methods', () => {
  for (const [apiName, businessParams] of [
    ['aliexpress.ds.feedname.get', {}],
    ['aliexpress.ds.feed.itemids.get', { feed_name: 'DS bestseller', page_size: 20, search_id: 'cursor-1' }],
  ]) {
    const request = buildTopProtocolRequest({
      apiName,
      businessParams,
      accessToken: 'buyer-access-token',
      timestamp: 1794512645000,
      appKey: 'test-app-key',
      appSecret: 'test-app-secret',
    });
    const url = new URL(request.url);
    assert.equal(url.searchParams.get('method'), apiName);
    assert.equal(url.searchParams.get('session'), 'buyer-access-token');
    assert.equal(url.pathname, '/sync');
    assert.equal(request.options, undefined);
    const signed = { ...request.commonParams, ...request.businessParams };
    const canonical = Object.keys(signed).sort().map((key) => key + signed[key]).join('');
    const expected = crypto.createHmac('sha256', 'test-app-secret').update(canonical, 'utf8').digest('hex').toUpperCase();
    assert.equal(url.searchParams.get('sign'), expected);
  }
  const itemRequest = buildTopProtocolRequest({
    apiName: 'aliexpress.ds.feed.itemids.get',
    businessParams: { feed_name: 'DS bestseller', page_size: 20, search_id: 'cursor-1' },
    accessToken: 'buyer-access-token',
    timestamp: 1794512645000,
    appKey: 'test-app-key',
    appSecret: 'test-app-secret',
  });
  assert.equal(itemRequest.body, 'feed_name=DS+bestseller&page_size=20&search_id=cursor-1');
});
