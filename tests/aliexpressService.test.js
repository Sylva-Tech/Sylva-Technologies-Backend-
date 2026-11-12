const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
