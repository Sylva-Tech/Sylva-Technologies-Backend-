'use strict';

const unwrapMethodResponse = (payload, method) => (
  payload?.[method.split('.').join('_') + '_response'] || payload || {}
);

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

const extractProductArray = (products) => {
  if (Array.isArray(products)) return products;
  if (!products || typeof products !== 'object') return null;

  // AliExpress TOP text-search responses commonly wrap the product list in
  // products.selection_search_product instead of returning products as an array.
  if (Array.isArray(products.selection_search_product)) return products.selection_search_product;
  if (Array.isArray(products.product)) return products.product;
  if (Array.isArray(products.product_list)) return products.product_list;
  return null;
};

const extractTextSearchResult = (payload) => {
  const response = unwrapMethodResponse(payload, 'aliexpress.ds.text.search');
  const candidates = [
    response.data,
    response.result?.data,
    response.resp_result?.result?.data,
    response.resp_result?.data,
    response.resp_result?.result,
    response.result,
  ].filter((value) => value && typeof value === 'object');

  for (const data of candidates) {
    const products = extractProductArray(data.products);
    if (!products) continue;
    return {
      products,
      totalCount: Number(firstDefined(data.totalCount, data.total_count, data.total_record_count, data.totalRecordCount, 0)) || 0,
      pageIndex: Number(firstDefined(data.pageIndex, data.page_index, 0)) || 0,
      pageSize: Number(firstDefined(data.pageSize, data.page_size, 0)) || 0,
    };
  }

  return null;
};

const normalizeProduct = (item = {}) => ({
  productId: String(firstDefined(item.product_id, item.itemId, item.item_id, '')),
  title: String(firstDefined(item.title, item.product_title, item.item_title, '')),
  imageUrl: String(firstDefined(item.image_url, item.itemMainPic, item.product_main_image_url, item.product_main_pic, '')),
  productUrl: String(firstDefined(item.product_detail_url, item.itemUrl, item.item_url, '')),
  salePrice: String(firstDefined(item.price?.sale?.value, item.target_sale_price, item.targetSalePrice, item.sale_price, item.salePrice, '')),
  saleCurrency: String(firstDefined(item.price?.sale?.currency, item.target_sale_price_currency, item.targetSalePriceCurrency, item.sale_price_currency, item.salePriceCurrency, '')),
  originalPrice: String(firstDefined(item.price?.original?.value, item.target_original_price, item.targetOriginalPrice, item.original_price, item.originalPrice, '')),
  originalCurrency: String(firstDefined(item.price?.original?.currency, item.target_original_price_currency, item.targetOriginalPriceCurrency, item.original_price_currency, item.originalPriceCurrency, '')),
  discount: String(firstDefined(item.discount, '')),
  orders: String(firstDefined(item.volume, item.latest_volume, item.lastest_volume, item.orders, item.order_count, '')),
  rating: String(firstDefined(item.evaluate_rate, item.evaluateRate, item.score, '')),
  similarityScore: String(firstDefined(item.similarity_score, '')),
  categoryId: String(firstDefined(item.category?.first_level?.id, item.cateId, item.first_level_category_id, '')),
  shopId: String(firstDefined(item.shop_id, item.shopId, '')),
  shipFrom: String(firstDefined(item.ship_from, item.shipFrom, '')),
});

module.exports = { extractTextSearchResult, normalizeProduct };
