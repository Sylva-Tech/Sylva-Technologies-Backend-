const test = require('node:test');
const assert = require('node:assert/strict');
const { isBuyerPlatform, getFeedItemIds, normalizeAliExpressProduct } = require('../routes/aliexpressBuyerApiRoutes');
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


test('Protocol.TOP adapter permits the documented read-only member-benefit lookup', () => {
  const request = buildTopProtocolRequest({
    apiName: 'aliexpress.ds.member.benefit.get',
    businessParams: {},
    accessToken: 'buyer-token',
    timestamp: 1730000000000,
    appKey: 'app-key',
    appSecret: 'app-secret',
  });
  assert.match(request.url, /aliexpress\.ds\.member\.benefit\.get/);
  assert.equal(request.body, '');
});

test('Protocol.TOP adapter continues to reject supplier order creation after enabling benefit lookup', () => {
  assert.throws(() => buildTopProtocolRequest({
    apiName: 'aliexpress.ds.order.create',
    businessParams: { ds_extend_request: JSON.stringify({ payment: { try_to_pay: true } }) },
    accessToken: 'buyer-token',
    appKey: 'app-key',
    appSecret: 'app-secret',
  }), (error) => error.code === 'ALIEXPRESS_METHOD_NOT_ALLOWED');
});


test('Protocol.TOP adapter permits documented read-only AliExpress text search', () => {
  const request = buildTopProtocolRequest({
    apiName: 'aliexpress.ds.text.search',
    businessParams: { keyWord: 'laptop', local: 'en_US', countryCode: 'KE', currency: 'USD', pageSize: 20, pageIndex: 1 },
    accessToken: 'buyer-token',
    timestamp: 1730000000000,
    appKey: 'app-key',
    appSecret: 'app-secret',
  });
  assert.match(request.body, /keyWord=laptop/);
  assert.match(request.body, /countryCode=KE/);
});

test('Protocol.TOP adapter permits documented read-only image search with param0 JSON', () => {
  const request = buildTopProtocolRequest({
    apiName: 'aliexpress.ds.image.searchV2',
    businessParams: { param0: JSON.stringify({ search_type: 'similar', image_base64: 'aGVsbG8=', currency: 'USD', lang: 'en', sort_type: 'best', sort_order: 'desc', ship_to: 'KE' }) },
    accessToken: 'buyer-token',
    timestamp: 1730000000000,
    appKey: 'app-key',
    appSecret: 'app-secret',
  });
  assert.match(request.body, /param0=/);
  assert.match(request.body, /search_type/);
});

test('Protocol.TOP adapter continues to reject supplier order creation after enabling catalogue search', () => {
  assert.throws(() => buildTopProtocolRequest({
    apiName: 'aliexpress.ds.order.create',
    businessParams: { product_id: '1001' },
    accessToken: 'buyer-token',
    appKey: 'app-key',
    appSecret: 'app-secret',
  }), (error) => error.code === 'ALIEXPRESS_METHOD_NOT_ALLOWED');
});


test('AliExpress feed item parser reads the live products.number response and search cursor', () => {
  const response = {
    aliexpress_ds_feed_itemids_get_response: {
      result: {
        total: 18457,
        products: { number: [1005013078612320, 1005007093064705, 1005006634143550, 1005011843719653, 1005011687865988] },
        search_id: 'opaque-next-page-cursor',
      },
      ret: true,
      rsp_msg: '',
      request_id: 'test-request',
    },
  };
  assert.deepEqual(getFeedItemIds(response), {
    ids: ['1005013078612320', '1005007093064705', '1005006634143550', '1005011843719653', '1005011687865988'],
    cursor: 'opaque-next-page-cursor',
  });
});

test('AliExpress feed item parser retains compatibility with older item_ids payloads', () => {
  const response = {
    aliexpress_ds_feed_itemids_get_response: {
      result: { item_ids: ['1001', '1002'], search_id: 'next' },
    },
  };
  assert.deepEqual(getFeedItemIds(response), { ids: ['1001', '1002'], cursor: 'next' });
});


test('AliExpress product normalization retains supplier store name and brand when provided', () => {
  const normalized = normalizeAliExpressProduct({
    aliexpress_ds_product_get_response: {
      result: {
        ae_item_base_info_dto: { product_id: '1005001234567890', subject: 'Osee GoStream Deck', currency_code: 'USD', product_brand: 'Osee' },
        ae_item_sku_info_dtos: [{ offer_sale_price: '100.00', currency_code: 'USD' }],
        ae_multimedia_info_dto: { image_urls: 'https://example.com/image.png' },
        ae_store_info: { store_id: 'store-123', store_name: 'Osee Official Store', store_url: 'https://www.aliexpress.com/store/123' },
      },
    }}, '1005001234567890', 'USD');
  assert.equal(normalized.supplierStoreName, 'Osee Official Store');
  assert.equal(normalized.supplierStoreUrl, 'https://www.aliexpress.com/store/123');
  assert.equal(normalized.supplierBrand, 'Osee');
  assert.equal(normalized.sellerId, 'store-123');
});


test('AliExpress product normalization tolerates missing optional store metadata', () => {
  const normalized = normalizeAliExpressProduct({
    aliexpress_ds_product_get_response: {
      result: {
        ae_item_base_info_dto: { product_id: '1005009876543210', subject: 'Generic USB Hub', currency_code: 'USD' },
        ae_item_sku_info_dtos: [{ offer_sale_price: '12.00', currency_code: 'USD' }],
        ae_multimedia_info_dto: { image_urls: 'https://example.com/hub.png' },
      },
    },
  }, '1005009876543210', 'USD');
  assert.equal(normalized.supplierStoreName, '');
  assert.equal(normalized.supplierBrand, '');
});
