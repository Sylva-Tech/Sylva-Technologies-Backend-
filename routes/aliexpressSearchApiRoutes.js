const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const AliExpressConnection = require('../models/AliExpressConnection');
const {
  callDropshipApi,
  decryptSecret,
  encryptSecret,
  refreshAccessToken,
  requiredDropshipEnv,
} = require('../services/aliexpressService');

const router = express.Router();
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many AliExpress search requests. Try again later.' },
});

const isBuyerPlatform = (value) => ['buyerapp', 'buyer_app', 'buyer'].includes(String(value || '').toLowerCase());

const getBuyerToken = async () => {
  requiredDropshipEnv();
  const connection = await AliExpressConnection.findOne({ provider: 'aliexpress' })
    .select('+accessTokenEncrypted +refreshTokenEncrypted');
  if (!connection || connection.status !== 'connected' || !isBuyerPlatform(connection.accountPlatform)) {
    const error = new Error('Connect the existing AliExpress Dropshipping buyerApp account before searching the supplier catalogue.');
    error.status = 409;
    error.code = 'ALIEXPRESS_BUYERAPP_REQUIRED';
    throw error;
  }

  const expiry = connection.accessTokenExpiresAt ? new Date(connection.accessTokenExpiresAt).getTime() : 0;
  if (connection.accessTokenEncrypted && expiry > Date.now() + 60000) {
    return decryptSecret(connection.accessTokenEncrypted);
  }
  if (!connection.refreshTokenEncrypted) {
    const error = new Error('AliExpress access token is expired. Re-authorize the existing buyerApp account.');
    error.status = 409;
    error.code = 'ALIEXPRESS_TOKEN_EXPIRED';
    throw error;
  }

  const token = await refreshAccessToken(decryptSecret(connection.refreshTokenEncrypted));
  connection.accessTokenEncrypted = encryptSecret(token.access_token);
  if (token.refresh_token) connection.refreshTokenEncrypted = encryptSecret(token.refresh_token);
  connection.accessTokenExpiresAt = token.expires_in
    ? new Date(Date.now() + Number(token.expires_in) * 1000) : null;
  if (token.refresh_expires_in) {
    connection.refreshTokenExpiresAt = new Date(Date.now() + Number(token.refresh_expires_in) * 1000);
  }
  await connection.save();
  return token.access_token;
};

const unwrap = (payload, method) => payload?.[method.split('.').join('_') + '_response'] || payload || {};
const validCountry = (value) => /^[A-Z]{2}$/.test(value);
const validCurrency = (value) => /^[A-Z]{3}$/.test(value);
const validLocale = (value) => /^[a-z]{2}_[A-Z]{2}$/.test(value);

const normalizeProduct = (item = {}) => ({
  productId: String(item.product_id || item.itemId || ''),
  title: String(item.title || item.product_title || ''),
  imageUrl: String(item.image_url || item.itemMainPic || item.product_main_image_url || ''),
  productUrl: String(item.product_detail_url || item.itemUrl || ''),
  salePrice: String(item.price?.sale?.value ?? item.target_sale_price ?? item.targetSalePrice ?? item.salePrice ?? ''),
  saleCurrency: String(item.price?.sale?.currency || item.target_sale_price_currency || item.targetSalePriceCurrency || item.salePriceCurrency || ''),
  originalPrice: String(item.price?.original?.value ?? item.target_original_price ?? item.targetOriginalPrice ?? item.originalPrice ?? ''),
  originalCurrency: String(item.price?.original?.currency || item.target_original_price_currency || item.targetOriginalPriceCurrency || item.originalPriceCurrency || ''),
  discount: String(item.discount || ''),
  orders: String(item.volume || item.latest_volume || item.orders || ''),
  rating: String(item.evaluate_rate || item.evaluateRate || item.score || ''),
  similarityScore: String(item.similarity_score || ''),
  categoryId: String(item.category?.first_level?.id || item.cateId || item.first_level_category_id || ''),
  shopId: String(item.shop_id || ''),
  shipFrom: String(item.ship_from || ''),
});

const fail = (res, error, fallbackCode, fallbackMessage) => res.status(error.status || 502).json({
  success: false,
  code: error.code || fallbackCode,
  message: error.message || fallbackMessage,
  ...(error.aliexpressCode ? { aliexpressCode: error.aliexpressCode } : {}),
});

router.use(protect, adminOnly, limiter);
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Read-only keyword search. Results are not imported or published automatically.
router.post('/text', async (req, res) => {
  try {
    const keyWord = String(req.body?.keyWord || '').trim();
    const local = String(req.body?.local || 'en_US').trim();
    const countryCode = String(req.body?.countryCode || 'KE').trim().toUpperCase();
    const currency = String(req.body?.currency || 'USD').trim().toUpperCase();
    const categoryId = req.body?.categoryId == null ? '' : String(req.body.categoryId).trim();
    const sortBy = String(req.body?.sortBy || 'orders,desc').trim();
    const pageSize = Number.parseInt(req.body?.pageSize, 10) || 20;
    const pageIndex = Number.parseInt(req.body?.pageIndex, 10) || 1;
    const selectionName = String(req.body?.selectionName || '').trim();

    if (!keyWord || keyWord.length > 120) return res.status(400).json({ success: false, code: 'ALIEXPRESS_KEYWORD_INVALID', message: 'Enter a keyword between 1 and 120 characters.' });
    if (!validLocale(local)) return res.status(400).json({ success: false, code: 'ALIEXPRESS_LOCALE_INVALID', message: 'Locale must use a value such as en_US.' });
    if (!validCountry(countryCode)) return res.status(400).json({ success: false, code: 'ALIEXPRESS_COUNTRY_INVALID', message: 'Country code must contain two letters, such as KE.' });
    if (!validCurrency(currency)) return res.status(400).json({ success: false, code: 'ALIEXPRESS_CURRENCY_INVALID', message: 'Currency must contain three letters, such as USD.' });
    if (!/^(min_price|orders|comments),(asc|desc)$/.test(sortBy)) return res.status(400).json({ success: false, code: 'ALIEXPRESS_SORT_INVALID', message: 'sortBy must be min_price, orders or comments followed by asc or desc.' });
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50 || !Number.isInteger(pageIndex) || pageIndex < 1 || pageIndex > 1000) {
      return res.status(400).json({ success: false, code: 'ALIEXPRESS_PAGINATION_INVALID', message: 'pageSize must be 1–50 and pageIndex must be 1–1000.' });
    }
    if (categoryId && !/^\d{1,20}$/.test(categoryId)) return res.status(400).json({ success: false, code: 'ALIEXPRESS_CATEGORY_INVALID', message: 'categoryId must be numeric.' });
    if (selectionName.length > 120) return res.status(400).json({ success: false, code: 'ALIEXPRESS_SELECTION_INVALID', message: 'selectionName is too long.' });

    const params = { keyWord, local, countryCode, currency, sortBy, pageSize, pageIndex };
    if (categoryId) params.categoryId = categoryId;
    if (selectionName) params.selectionName = selectionName;

    if (req.body?.searchExtend !== undefined) {
      if (!Array.isArray(req.body.searchExtend) || req.body.searchExtend.length > 10) {
        return res.status(400).json({ success: false, code: 'ALIEXPRESS_SEARCH_FILTER_INVALID', message: 'searchExtend must be an array containing no more than 10 filters.' });
      }
      const supportedKeys = new Set(['free_ship_to', 'item_tag', 'seller_level', 'ship_from', 'seller_online', 'hot_area']);
      const filters = [];
      for (const filter of req.body.searchExtend) {
        const searchKey = String(filter?.searchKey || '');
        const searchValue = String(filter?.searchValue || '');
        if (!supportedKeys.has(searchKey) || searchValue.length > 80) {
          return res.status(400).json({ success: false, code: 'ALIEXPRESS_SEARCH_FILTER_INVALID', message: 'A searchExtend filter uses an unsupported key or invalid value.' });
        }
        filters.push({ searchKey, searchValue, min: String(filter?.min || ''), max: String(filter?.max || '') });
      }
      params.searchExtend = JSON.stringify(filters);
    }

    const accessToken = await getBuyerToken();
    const payload = await callDropshipApi('aliexpress.ds.text.search', params, accessToken);
    const response = unwrap(payload, 'aliexpress.ds.text.search');
    const data = response.data || response.result?.data;
    const products = Array.isArray(data?.products) ? data.products : [];
    if (response.error_response || !data || !Array.isArray(data.products)) {
      return res.status(502).json({ success: false, code: 'ALIEXPRESS_TEXT_SEARCH_RESPONSE_INCOMPLETE', message: 'AliExpress did not return a recognizable text-search result.' });
    }

    return res.json({
      success: true,
      readOnly: true,
      products: products.map(normalizeProduct),
      pagination: {
        totalCount: Number(data.totalCount || 0),
        pageIndex: Number(data.pageIndex || pageIndex),
        pageSize: Number(data.pageSize || pageSize),
      },
      query: { keyWord, countryCode, currency, local, sortBy },
      imported: false,
      storefrontPublished: false,
      supplierOrderingEnabled: false,
    });
  } catch (error) {
    return fail(res, error, 'ALIEXPRESS_TEXT_SEARCH_FAILED', 'Unable to search the AliExpress catalogue.');
  }
});

// Read-only image similarity search. Accepts raw base64 or a data URL.
router.post('/image', async (req, res) => {
  try {
    const rawImage = String(req.body?.image_base64 || '').trim();
    const imageBase64 = rawImage.replace(/^data:image\/(?:png|jpe?g|webp);base64,/i, '').replace(/\s/g, '');
    const searchType = String(req.body?.search_type || 'similar').trim().toLowerCase();
    const currency = String(req.body?.currency || 'USD').trim().toUpperCase();
    const lang = String(req.body?.lang || 'en').trim();
    const sortType = String(req.body?.sort_type || 'best').trim().toLowerCase();
    const sortOrder = String(req.body?.sort_order || 'desc').trim().toLowerCase();
    const shipTo = String(req.body?.ship_to || 'KE').trim().toUpperCase();

    if (!imageBase64 || imageBase64.length > 7 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64) || imageBase64.length % 4 !== 0) {
      return res.status(400).json({ success: false, code: 'ALIEXPRESS_IMAGE_INVALID', message: 'Provide a valid base64 PNG, JPEG or WebP image no larger than 5 MB.' });
    }
    if (!['same', 'similar'].includes(searchType)) return res.status(400).json({ success: false, code: 'ALIEXPRESS_IMAGE_SEARCH_TYPE_INVALID', message: 'search_type must be same or similar.' });
    if (!validCurrency(currency) || !validCountry(shipTo)) return res.status(400).json({ success: false, code: 'ALIEXPRESS_IMAGE_SEARCH_REGION_INVALID', message: 'Provide a valid three-letter currency and two-letter ship-to country.' });
    if (!/^[a-z]{2}$/.test(lang)) return res.status(400).json({ success: false, code: 'ALIEXPRESS_IMAGE_LANGUAGE_INVALID', message: 'lang must be a two-letter language code such as en.' });
    if (!['price', 'orders', 'best'].includes(sortType) || !['asc', 'desc'].includes(sortOrder)) {
      return res.status(400).json({ success: false, code: 'ALIEXPRESS_IMAGE_SORT_INVALID', message: 'sort_type must be price, orders or best; sort_order must be asc or desc.' });
    }

    const accessToken = await getBuyerToken();
    const param0 = {
      search_type: searchType,
      image_base64: imageBase64,
      currency,
      lang,
      sort_type: sortType,
      sort_order: sortOrder,
      ship_to: shipTo,
    };
    const payload = await callDropshipApi('aliexpress.ds.image.searchV2', { param0: JSON.stringify(param0) }, accessToken);
    const response = unwrap(payload, 'aliexpress.ds.image.searchV2');
    const result = response.result || response;
    const data = result.data || {};
    const products = Array.isArray(data.products) ? data.products : [];
    if (response.error_response || result.ret === false || !Array.isArray(data.products)) {
      return res.status(502).json({ success: false, code: 'ALIEXPRESS_IMAGE_SEARCH_RESPONSE_INCOMPLETE', message: 'AliExpress did not return a recognizable image-search result.' });
    }

    return res.json({
      success: true,
      readOnly: true,
      products: products.map(normalizeProduct),
      pagination: {
        totalCount: Number(result.total_count || 0),
        pageNo: Number(result.pagination?.page_no || 1),
        pageCount: Number(result.pagination?.page_count || 1),
        pageSize: Number(result.pagination?.page_size || products.length),
        hasNext: Boolean(result.pagination?.has_next),
        nextStartRowKey: result.next_start_row_key || null,
      },
      query: { searchType, currency, lang, sortType, sortOrder, shipTo },
      imported: false,
      storefrontPublished: false,
      supplierOrderingEnabled: false,
    });
  } catch (error) {
    return fail(res, error, 'ALIEXPRESS_IMAGE_SEARCH_FAILED', 'Unable to search the AliExpress catalogue by image.');
  }
});

module.exports = router;
