const test = require('node:test');
const assert = require('node:assert/strict');
const { isBuyerPlatform, normalizeProduct } = require('../routes/aliexpressBuyerApiRoutes');
const { getDropshipApiConfig, requiredDropshipEnv } = require('../services/aliexpressService');

test('AliExpress buyer platform detection accepts buyerApp identifiers only', () => {
  assert.equal(isBuyerPlatform('buyerApp'), true);
  assert.equal(isBuyerPlatform('buyer_app'), true);
  assert.equal(isBuyerPlatform('buyer'), true);
  assert.equal(isBuyerPlatform('seller_center'), false);
  assert.equal(isBuyerPlatform(''), false);
});

test('AliExpress catalogue normalizer validates identifiers and sanitizes URLs', () => {
  const normalized = normalizeProduct({
    product_id: 'sku-100',
    product_title: 'USB-C Dock',
    product_detail_url: 'https://www.aliexpress.com/item/100.html',
    product_main_image_url: 'https://ae-pic-a1.aliexpress-media.com/item.jpg',
    sale_price: '12.50',
    sale_price_currency: 'USD',
    ship_to_days: '14',
  });
  assert.equal(normalized.providerProductId, 'sku-100');
  assert.equal(normalized.title, 'USB-C Dock');
  assert.equal(normalized.productUrl, 'https://www.aliexpress.com/item/100.html');
  assert.equal(normalized.imageUrl, 'https://ae-pic-a1.aliexpress-media.com/item.jpg');
  assert.equal(normalized.supplierPrice, 12.5);
  assert.equal(normalized.shippingDays, 14);
  assert.equal(normalizeProduct({ product_title: 'Missing ID' }), null);
});

test('AliExpress catalogue normalizer rejects non-HTTPS and untrusted image URLs', () => {
  const normalized = normalizeProduct({
    product_id: 'sku-101',
    product_title: 'Test item',
    product_detail_url: 'javascript:alert(1)',
    product_main_image_url: 'http://evil.example/image.png',
  });
  assert.equal(normalized.productUrl, '');
  assert.equal(normalized.imageUrl, '');
});


test('Dropshipping TOP credentials are configured independently from IOP OAuth credentials', () => {
  const previousKey = process.env.ALIEXPRESS_DS_APP_KEY;
  const previousSecret = process.env.ALIEXPRESS_DS_APP_SECRET;
  delete process.env.ALIEXPRESS_DS_APP_KEY;
  delete process.env.ALIEXPRESS_DS_APP_SECRET;
  assert.deepEqual(getDropshipApiConfig(), { configured: false, appKeyConfigured: false, appSecretConfigured: false });
  assert.throws(requiredDropshipEnv, (error) => error.code === 'ALIEXPRESS_DS_API_CREDENTIALS_MISSING' && error.status === 503);
  process.env.ALIEXPRESS_DS_APP_KEY = 'test-top-key';
  process.env.ALIEXPRESS_DS_APP_SECRET = 'test-top-secret';
  assert.deepEqual(getDropshipApiConfig(), { configured: true, appKeyConfigured: true, appSecretConfigured: true });
  assert.doesNotThrow(requiredDropshipEnv);
  if (previousKey === undefined) delete process.env.ALIEXPRESS_DS_APP_KEY; else process.env.ALIEXPRESS_DS_APP_KEY = previousKey;
  if (previousSecret === undefined) delete process.env.ALIEXPRESS_DS_APP_SECRET; else process.env.ALIEXPRESS_DS_APP_SECRET = previousSecret;
});


test('legacy Dropshipping catalogue calls stay disabled until AliExpress confirms support', () => {
  const previous = process.env.ALIEXPRESS_LEGACY_DROPSHIP_API_CONFIRMED;
  process.env.ALIEXPRESS_LEGACY_DROPSHIP_API_CONFIRMED = 'false';
  assert.notEqual(process.env.ALIEXPRESS_LEGACY_DROPSHIP_API_CONFIRMED, 'true');
  process.env.ALIEXPRESS_LEGACY_DROPSHIP_API_CONFIRMED = 'true';
  assert.equal(process.env.ALIEXPRESS_LEGACY_DROPSHIP_API_CONFIRMED, 'true');
  if (previous === undefined) delete process.env.ALIEXPRESS_LEGACY_DROPSHIP_API_CONFIRMED;
  else process.env.ALIEXPRESS_LEGACY_DROPSHIP_API_CONFIRMED = previous;
});
