const test = require('node:test');
const assert = require('node:assert/strict');
const { isBuyerPlatform } = require('../routes/aliexpressBuyerApiRoutes');
const { getDropshipApiConfig, requiredDropshipEnv } = require('../services/aliexpressService');

test('AliExpress buyer platform detection accepts buyerApp identifiers only', () => {
  assert.equal(isBuyerPlatform('buyerApp'), true);
  assert.equal(isBuyerPlatform('buyer_app'), true);
  assert.equal(isBuyerPlatform('buyer'), true);
  assert.equal(isBuyerPlatform('seller_center'), false);
  assert.equal(isBuyerPlatform(''), false);
});

test('AliExpress catalogue readiness cannot be inferred from OAuth connection or legacy TOP settings', () => {
  const config = getDropshipApiConfig();
  assert.equal(config.configured, false);
  assert.equal(config.supported, false);
  assert.equal(config.wireContractVerified, false);
  assert.equal(config.methodEntitlementVerified, false);
  assert.equal(config.readOnlyProductTestSucceeded, false);
  assert.throws(requiredDropshipEnv, (error) =>
    error.code === 'ALIEXPRESS_CATALOG_API_NOT_VERIFIED' && error.status === 503);
});
