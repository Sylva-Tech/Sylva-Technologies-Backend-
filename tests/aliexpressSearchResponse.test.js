const test = require('node:test');
const assert = require('node:assert/strict');
const { extractTextSearchResult, normalizeProduct } = require('../utils/aliexpressSearchResponse');

test('extracts AliExpress text search products from selection_search_product wrapper', () => {
  const payload = {
    aliexpress_ds_text_search_response: {
      code: '00',
      data: {
        pageIndex: 1,
        pageSize: 20,
        totalCount: 1,
        products: {
          selection_search_product: [{
            itemId: '1005001234567890',
            title: 'Wireless Mouse',
            itemMainPic: 'https://example.test/mouse.jpg',
            itemUrl: 'https://www.aliexpress.com/item/1005001234567890.html',
            targetSalePrice: '4.25',
            targetSalePriceCurrency: 'USD',
            targetOriginalPrice: '8.50',
            targetOriginalPriceCurrency: 'USD',
            lastest_volume: '120',
            evaluateRate: '97.5%',
          }],
        },
      },
    },
  };

  const result = extractTextSearchResult(payload);
  assert.ok(result);
  assert.equal(result.products.length, 1);
  assert.equal(result.totalCount, 1);

  const [product] = result.products.map(normalizeProduct);
  assert.equal(product.productId, '1005001234567890');
  assert.equal(product.title, 'Wireless Mouse');
  assert.equal(product.imageUrl, 'https://example.test/mouse.jpg');
  assert.equal(product.productUrl, 'https://www.aliexpress.com/item/1005001234567890.html');
  assert.equal(product.salePrice, '4.25');
  assert.equal(product.saleCurrency, 'USD');
  assert.equal(product.originalPrice, '8.50');
  assert.equal(product.orders, '120');
  assert.equal(product.rating, '97.5%');
});

test('continues to accept a direct products array', () => {
  const result = extractTextSearchResult({
    aliexpress_ds_text_search_response: {
      data: { products: [{ product_id: '123', product_title: 'USB Hub' }] },
    },
  });
  assert.deepEqual(result.products, [{ product_id: '123', product_title: 'USB Hub' }]);
});

test('accepts nested resp_result result data and snake-case pagination', () => {
  const result = extractTextSearchResult({
    aliexpress_ds_text_search_response: {
      resp_result: {
        result: {
          data: { products: { selection_search_product: [] }, total_count: 42, page_index: 2, page_size: 10 },
        },
      },
    },
  });
  assert.deepEqual(result, { products: [], totalCount: 42, pageIndex: 2, pageSize: 10 });
});

test('returns null for an unrecognized product-list response instead of inventing results', () => {
  assert.equal(extractTextSearchResult({ aliexpress_ds_text_search_response: { data: { products: {} } } }), null);
});
