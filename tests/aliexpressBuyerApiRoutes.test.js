const test = require('node:test');
const assert = require('node:assert/strict');
const { isBuyerPlatform } = require('../routes/aliexpressBuyerApiRoutes');
const { getDropshipApiConfig, buildTopProtocolRequest } = require('../services/aliexpressService');

test('AliExpress buyer platform detection accepts buyerApp identifiers only', () => {
  assert.equal(isBuyerPlatform('buyerApp'), true);
  assert.equal(isBuyerPlatform('buyer_app'), true);
  assert.equal(isBuyerPlatform('buyer'), true);
  assert.equal(isBuyerPlatform('seller_center'), false);
  assert.equal(isBuyerPlatform(''), false);
});

test('AliExpress status separates SDK wire verification from live App ID method entitlement', () => {
  const config = getDropshipApiConfig();
  assert.equal(config.protocol, 'IOP Protocol.TOP');
  assert.equal(config.endpoint, 'https://api-sg.aliexpress.com/sync');
  assert.equal(config.wireContractVerified, true);
  assert.equal(config.methodEntitlementVerified, false);
  assert.equal(config.readOnlyProductTestSucceeded, false);
});

test('Protocol.TOP adapter rejects any supplier write method', () => {
  assert.throws(() => buildTopProtocolRequest({
    apiName: 'aliexpress.ds.order.create',
    businessParams: { product_id: '1001' },
    accessToken: 'buyer-token',
    appKey: 'app-key',
    appSecret: 'app-secret',
  }), (error) => error.code === 'ALIEXPRESS_METHOD_NOT_ALLOWED');
});
