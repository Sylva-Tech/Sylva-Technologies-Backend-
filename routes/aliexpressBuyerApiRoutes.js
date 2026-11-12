const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const AliExpressConnection = require('../models/AliExpressConnection');
const AliExpressCatalogProduct = require('../models/AliExpressCatalogProduct');
const {
  decryptSecret,
  encryptSecret,
  refreshAccessToken,
  fetchRecommendedFeed,
  getDropshipApiConfig,
} = require('../services/aliexpressService');

const router = express.Router();
router.use(protect, adminOnly);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many AliExpress catalogue requests. Try again later.' },
});

const isBuyerPlatform = (value) => ['buyerapp', 'buyer_app', 'buyer'].includes(String(value || '').toLowerCase());

async function getBuyerConnection() {
  const connection = await AliExpressConnection.findOne({ provider: 'aliexpress' })
    .select('+accessTokenEncrypted +refreshTokenEncrypted');
  if (!connection || connection.status !== 'connected' || !connection.accessTokenEncrypted) {
    const error = new Error('Connect the AliExpress buyer account before using Dropshipping APIs.');
    error.status = 409;
    error.code = 'ALIEXPRESS_BUYER_NOT_CONNECTED';
    throw error;
  }
  if (!isBuyerPlatform(connection.accountPlatform)) {
    const error = new Error('The saved OAuth session is not identified as an AliExpress buyerApp session. Re-authorize the Dropshipping buyer account; Seller Center credentials must not be reused for buyer APIs.');
    error.status = 409;
    error.code = 'ALIEXPRESS_BUYER_AUTH_REQUIRED';
    throw error;
  }

  let accessToken = decryptSecret(connection.accessTokenEncrypted);
  if (connection.accessTokenExpiresAt && connection.accessTokenExpiresAt.getTime() <= Date.now() + 5 * 60 * 1000) {
    if (!connection.refreshTokenEncrypted) {
      const error = new Error('The buyer access token is expired. Re-authorize the AliExpress buyer account.');
      error.status = 409;
      error.code = 'ALIEXPRESS_BUYER_TOKEN_EXPIRED';
      throw error;
    }
    const refreshed = await refreshAccessToken(decryptSecret(connection.refreshTokenEncrypted));
    accessToken = refreshed.access_token;
    connection.accessTokenEncrypted = encryptSecret(refreshed.access_token);
    if (refreshed.refresh_token) connection.refreshTokenEncrypted = encryptSecret(refreshed.refresh_token);
    if (refreshed.expires_in) connection.accessTokenExpiresAt = new Date(Date.now() + Number(refreshed.expires_in) * 1000);
    if (refreshed.refresh_expires_in) connection.refreshTokenExpiresAt = new Date(Date.now() + Number(refreshed.refresh_expires_in) * 1000);
    await connection.save();
  }
  return { connection, accessToken };
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function safeUrl(value, domains) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !domains.some((domain) => url.hostname === domain || url.hostname.endsWith('.' + domain))) return '';
    return url.toString().slice(0, 2000);
  } catch { return ''; }
}

function normalizeProduct(item) {
  const providerProductId = String(item?.product_id || '').trim();
  const title = String(item?.product_title || '').trim().slice(0, 500);
  if (!providerProductId || !title) return null;
  const imageUrls = [item.product_main_image_url, ...(Array.isArray(item.product_small_image_urls) ? item.product_small_image_urls : [])]
    .map((url) => safeUrl(url, ['alicdn.com', 'aliexpress.com', 'aliexpress-media.com']))
    .filter(Boolean).slice(0, 12);
  return {
    providerProductId,
    title,
    productUrl: safeUrl(item.product_detail_url, ['aliexpress.com']),
    imageUrl: imageUrls[0] || '',
    imageUrls,
    supplierPrice: numberOrNull(item.sale_price || item.original_price),
    supplierCurrency: String(item.sale_price_currency || item.original_price_currency || 'USD').toUpperCase().slice(0, 3),
    targetSalePrice: numberOrNull(item.target_sale_price),
    targetCurrency: String(item.target_sale_price_currency || 'USD').toUpperCase().slice(0, 3),
    originalPrice: numberOrNull(item.original_price),
    discount: String(item.discount || '').slice(0, 40),
    categoryId: String(item.second_level_category_id || item.first_level_category_id || '').slice(0, 80),
    categoryName: String(item.second_level_category_name || item.first_level_category_name || '').slice(0, 200),
    sellerId: String(item.seller_id || '').slice(0, 100),
    latestVolume: numberOrNull(item.lastest_volume),
    shippingDays: numberOrNull(item.ship_to_days),
    sourcePayload: item,
    syncedAt: new Date(),
  };
}

// This router is mounted before the older Seller Center routes so the
// buyer-account Dropshipping API has its own explicit authorization boundary.
router.get('/status', async (req, res) => {
  try {
    const connection = await AliExpressConnection.findOne({ provider: 'aliexpress' }).lean();
    const configured = Boolean(process.env.ALIEXPRESS_APP_KEY && process.env.ALIEXPRESS_APP_SECRET &&
      process.env.ALIEXPRESS_REDIRECT_URI && /^[a-f0-9]{64}$/i.test(process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY || ''));
    const connected = connection?.status === 'connected';
    const buyerAuthorized = connected && isBuyerPlatform(connection?.accountPlatform);
    const dropshipApi = getDropshipApiConfig();
    return res.json({
      success: true,
      data: {
        configured,
        connected,
        status: connection?.status || 'disconnected',
        sellerId: connection?.sellerId || '',
        account: connection?.account || '',
        accountPlatform: connection?.accountPlatform || '',
        lastConnectedAt: connection?.lastConnectedAt || null,
        accessTokenExpiresAt: connection?.accessTokenExpiresAt || null,
        lastError: connection?.lastError || '',
        buyerAuthorized,
        dropshipApiConfigured: dropshipApi.configured,
        catalogSyncEnabled: Boolean(configured && buyerAuthorized && dropshipApi.configured),
        catalogSyncReason: !configured
          ? 'IOP OAuth configuration is incomplete. Check the AliExpress OAuth environment variables.'
          : !buyerAuthorized
            ? 'A connected buyerApp session is required. Seller Center OAuth cannot be used for Dropshipping buyer APIs.'
            : !dropshipApi.configured
              ? 'The Dropshipping TOP gateway requires its own ALIEXPRESS_DS_APP_KEY and ALIEXPRESS_DS_APP_SECRET settings. The IOP OAuth key/secret are deliberately not reused.'
              : 'Buyer authorization and separate Dropshipping gateway credentials are configured. Live provider acceptance still needs to be verified by a successful catalogue request.',
        supplierOrderingEnabled: false,
        supplierOrderingReason: 'Supplier order placement and payment remain disabled until current production API support, supplier payment flow, and duplicate-order safeguards are verified.',
        apiGeneration: 'legacy-top-dropshipping-deprecated',
        dropshipGateway: 'https://eco.taobao.com/router/rest',
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to load AliExpress buyer API status.' });
  }
});

router.post('/catalog/sync', limiter, async (req, res) => {
  try {
    if (!getDropshipApiConfig().configured) {
      return res.status(503).json({
        success: false,
        code: 'ALIEXPRESS_DS_API_CREDENTIALS_MISSING',
        message: 'Configure ALIEXPRESS_DS_APP_KEY and ALIEXPRESS_DS_APP_SECRET on the backend. These must be the credentials provisioned for the Dropshipping/TOP API; do not paste secrets into the frontend or chat.',
      });
    }
    const { accessToken } = await getBuyerConnection();
    const feedName = String(req.body?.feedName || 'DS bestseller').trim().slice(0, 100);
    const country = String(req.body?.country || 'KE').trim().toUpperCase();
    const currency = String(req.body?.targetCurrency || 'USD').trim().toUpperCase();
    const language = String(req.body?.targetLanguage || 'EN').trim().toUpperCase();
    const pageSize = Math.max(1, Math.min(50, Number.parseInt(req.body?.pageSize, 10) || 20));
    const pageNo = Math.max(1, Math.min(1000, Number.parseInt(req.body?.pageNo, 10) || 1));
    const sort = String(req.body?.sort || 'volumeDesc').trim();
    const currencies = new Set(['USD', 'GBP', 'CAD', 'EUR', 'UAH', 'MXN', 'TRY', 'RUB', 'BRL', 'AUD', 'INR', 'JPY', 'IDR', 'SEK', 'KRW']);
    const languages = new Set(['EN', 'RU', 'PT', 'ES', 'FR', 'ID', 'IT', 'TH', 'JA', 'AR', 'VI', 'TR', 'DE', 'HE', 'KO', 'NL', 'PL', 'MX', 'CL', 'IN']);
    const sorts = new Set(['priceAsc', 'priceDesc', 'volumeAsc', 'volumeDesc', 'discountAsc', 'discountDesc', 'DSRratingAsc', 'DSRratingDesc']);
    if (!feedName || !/^[A-Z]{2}$/.test(country) || !currencies.has(currency) || !languages.has(language) || !sorts.has(sort)) {
      return res.status(400).json({ success: false, message: 'Invalid feed parameters. Check country, currency, language and sort.' });
    }
    const values = { feed_name: feedName, country, target_currency: currency, target_language: language, page_size: pageSize, page_no: pageNo, sort };
    if (req.body?.categoryId) values.category_id = String(req.body.categoryId).trim().slice(0, 80);
    const response = await fetchRecommendedFeed(values, accessToken);
    const products = response.products.map(normalizeProduct).filter(Boolean);
    if (products.length) {
      await AliExpressCatalogProduct.bulkWrite(products.map((product) => ({
        updateOne: {
          filter: { providerProductId: product.providerProductId },
          update: { $set: product, $setOnInsert: { status: 'pending' } },
          upsert: true,
        },
      })), { ordered: false });
    }
    return res.json({
      success: true,
      message: products.length
        ? 'AliExpress returned products. They are saved in the private review queue and have not been published.'
        : 'AliExpress accepted the request but returned no products for this feed/page.',
      syncedCount: products.length,
      products,
      provider: 'AliExpress',
      apiMethod: 'aliexpress.ds.recommend.feed.get',
      apiGeneration: 'legacy-top-dropshipping-deprecated',
      warning: 'This legacy API is documented as deprecated. Confirm current production support with AliExpress before relying on it for ongoing operations.',
    });
  } catch (error) {
    const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 502;
    console.error('[AliExpress live catalogue sync]', error.code || 'API_ERROR', error.message);
    return res.status(status).json({
      success: false,
      code: error.code || 'ALIEXPRESS_LIVE_SYNC_FAILED',
      message: error.message || 'AliExpress catalogue synchronization failed.',
      providerCode: error.providerCode || null,
      providerRequestId: error.requestId || error.request_id || null,
    });
  }
});

module.exports = router;
module.exports.isBuyerPlatform = isBuyerPlatform;
module.exports.normalizeProduct = normalizeProduct;
