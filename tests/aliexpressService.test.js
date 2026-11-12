const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatIopTimestamp,
  formatAliExpressTimestamp,
  extractRecommendedProducts,
} = require('../services/aliexpressService');

test('AliExpress timestamps use the documented GMT+8 format', () => {
  const timestamp = formatAliExpressTimestamp(new Date('2026-01-02T03:04:05.000Z'));
  assert.match(timestamp, /^2026-01-02 11:04:05$/);
});

test('AliExpress recommended feed parser handles the documented integer product collection', () => {
  const products = [{ product_id: '1001', product_title: 'USB-C hub' }, { product_id: '1002', product_title: 'SSD enclosure' }];
  const result = extractRecommendedProducts({
    aliexpress_ds_recommend_feed_get_response: {
      result: { products: { integer: products } },
    },
  });
  assert.deepEqual(result, products);
});

test('AliExpress recommended feed parser safely handles an empty response', () => {
  assert.deepEqual(extractRecommendedProducts({}), []);
});

test('AliExpress feed request is signed and uses the connected account token', async () => {
  const crypto = require('node:crypto');
  const previous = {
    key: process.env.ALIEXPRESS_APP_KEY,
    secret: process.env.ALIEXPRESS_APP_SECRET,
    redirect: process.env.ALIEXPRESS_REDIRECT_URI,
    encryption: process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY,
    fetch: global.fetch,
  };
  const appSecret = 'unit-test-app-secret';
  let captured;
  process.env.ALIEXPRESS_APP_KEY = 'unit-test-app-key';
  process.env.ALIEXPRESS_APP_SECRET = appSecret;
  process.env.ALIEXPRESS_REDIRECT_URI = 'https://example.test/callback';
  process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY = 'c'.repeat(64);
  global.fetch = async (url, options) => {
    captured = { url: String(url), body: String(options.body) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        aliexpress_ds_recommend_feed_get_response: {
          result: { products: { integer: [{ product_id: 'feed-1', product_title: 'Test item' }] } },
        },
      }),
    };
  };

  try {
    const { fetchRecommendedFeed } = require('../services/aliexpressService');
    const result = await fetchRecommendedFeed({
      country: 'KE',
      target_currency: 'USD',
      target_language: 'EN',
      page_size: 20,
      page_no: 1,
      sort: 'volumeDesc',
      feed_name: 'DS bestseller',
    }, 'unit-test-access-token');

    assert.equal(captured.url, 'https://eco.taobao.com/router/rest');
    const params = Object.fromEntries(new URLSearchParams(captured.body));
    assert.equal(params.method, 'aliexpress.ds.recommend.feed.get');
    assert.equal(params.sign_method, 'hmac');
    assert.equal(params.session, 'unit-test-access-token');
    assert.match(params.timestamp, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const suppliedSign = params.sign;
    delete params.sign;
    const payload = Object.keys(params).sort().map((key) => key + params[key]).join('');
    const expectedSign = crypto.createHmac('md5', appSecret)
      .update(payload, 'utf8')
      .digest('hex')
      .toUpperCase();
    assert.equal(suppliedSign, expectedSign);
    assert.equal(result.products[0].product_id, 'feed-1');
  } finally {
    if (previous.key === undefined) delete process.env.ALIEXPRESS_APP_KEY; else process.env.ALIEXPRESS_APP_KEY = previous.key;
    if (previous.secret === undefined) delete process.env.ALIEXPRESS_APP_SECRET; else process.env.ALIEXPRESS_APP_SECRET = previous.secret;
    if (previous.redirect === undefined) delete process.env.ALIEXPRESS_REDIRECT_URI; else process.env.ALIEXPRESS_REDIRECT_URI = previous.redirect;
    if (previous.encryption === undefined) delete process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY; else process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY = previous.encryption;
    global.fetch = previous.fetch;
  }
});

test('AliExpress IOP OAuth timestamps use epoch milliseconds', () => {
  const timestamp = formatIopTimestamp(new Date('2026-11-12T18:03:59.123Z'));
  assert.equal(timestamp, '1794506639123');
  assert.match(timestamp, /^\\d{13}$/);
});
