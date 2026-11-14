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

test('Protocol.TOP adapter allows only the documented read-only AliExpress order methods', () => {
  const orderLookup = buildTopProtocolRequest({
    apiName: 'aliexpress.trade.ds.order.get',
    businessParams: { single_order_query: JSON.stringify({ order_id: '10000001' }) },
    accessToken: 'buyer-token',
    timestamp: 1730000000000,
    appKey: 'app-key',
    appSecret: 'app-secret',
  });
  assert.match(orderLookup.body, /single_order_query=/);

  const trackingLookup = buildTopProtocolRequest({
    apiName: 'aliexpress.ds.order.tracking.get',
    businessParams: { ae_order_id: '10000001', language: 'en_US' },
    accessToken: 'buyer-token',
    timestamp: 1730000000000,
    appKey: 'app-key',
    appSecret: 'app-secret',
  });
  assert.match(trackingLookup.body, /ae_order_id=10000001/);
  assert.match(trackingLookup.body, /language=en_US/);
});

test('Protocol.TOP adapter continues to block supplier order creation and automatic payment', () => {
  for (const params of [
    { product_id: '1001' },
    { param_place_order_request4_open_api_d_t_o: JSON.stringify({ product_items: [] }), ds_extend_request: JSON.stringify({ payment: { try_to_pay: true } }) },
  ]) {
    assert.throws(() => buildTopProtocolRequest({
      apiName: 'aliexpress.ds.order.create',
      businessParams: params,
      accessToken: 'buyer-token',
      appKey: 'app-key',
      appSecret: 'app-secret',
    }), (error) => error.code === 'ALIEXPRESS_METHOD_NOT_ALLOWED');
  }
});
