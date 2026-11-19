const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const AliExpressConnection = require('../models/AliExpressConnection');
const AliExpressCatalogProduct = require('../models/AliExpressCatalogProduct');
const Product = require('../models/Product');
const Category = require('../models/Category');
const AliExpressCatalogSettings = require('../models/AliExpressCatalogSettings');
const { getUsableBuyerToken } = require('../services/aliexpressTokenManager');
const { generateAliExpressProductContent, hashSource } = require('../services/aiProductContentService');

const { sendSalesNotificationEmail } = require('../services/emailService');
const { generateUniqueProductCode } = require('../services/productIdentityService');
const {
  getDropshipApiConfig,
  requiredDropshipEnv,
  callDropshipApi,
  decryptSecret,
  encryptSecret,
  refreshAccessToken,
} = require('../services/aliexpressService');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many AliExpress catalogue requests. Try again later.' },
});

const isBuyerPlatform = (value) => ['buyerapp', 'buyer_app', 'buyer'].includes(String(value || '').toLowerCase());

// Reveal only the current buyerApp access token to an authenticated administrator.
// The token is never persisted in the browser, returned by status endpoints, or logged.
const tokenRevealLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Token reveal limit reached. Try again later.' },
});

router.post('/token/reveal', protect, adminOnly, tokenRevealLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store, private, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');

  if (req.body?.confirm !== true) {
    return res.status(400).json({ success: false, message: 'Confirm the one-time token reveal request.' });
  }

  try {
    const connection = await AliExpressConnection.findOne({ provider: 'aliexpress' })
      .select('+accessTokenEncrypted +refreshTokenEncrypted');
    if (!connection || connection.status !== 'connected') {
      return res.status(409).json({ success: false, code: 'ALIEXPRESS_NOT_CONNECTED', message: 'The AliExpress account is not connected.' });
    }
    if (!isBuyerPlatform(connection.accountPlatform)) {
      return res.status(409).json({ success: false, code: 'ALIEXPRESS_BUYERAPP_REQUIRED', message: 'The saved authorization is not a buyerApp connection.' });
    }

    const accessToken = await getUsableBuyerToken(connection);
    const expiresAt = connection.accessTokenExpiresAt || null;
    return res.json({
      success: true,
      accessToken,
      expiresAt,
      revealPolicy: 'one-time; not stored in browser storage; refresh token is never exposed',
    });
  } catch (error) {
    return res.status(Number(error.status) || 502).json({
      success: false,
      code: error.code || 'ALIEXPRESS_TOKEN_REVEAL_FAILED',
      message: error.message || 'Unable to retrieve the current AliExpress access token.',
    });
  }
});

const getMethodEnvelope = (payload, method) => payload?.[`${method.split('.').join('_')}_response`] || payload || {};
const countImages = (result) => collectAliExpressImageUrls(result || {}).length;

const CATEGORY_HINTS = [
  { terms: ['laptop', 'notebook', 'desktop', 'computer', 'pc', 'monitor', 'keyboard', 'mouse', 'printer', 'ssd', 'hard drive', 'ram', 'graphics card'], names: ['computer', 'laptop', 'desktop', 'pc'] },
  { terms: ['phone', 'smartphone', 'iphone', 'android', 'tablet', 'ipad', 'mobile', 'screen protector', 'phone case'], names: ['phone', 'mobile', 'tablet', 'smartphone'] },
  { terms: ['headphone', 'earphone', 'earbud', 'speaker', 'microphone', 'soundbar', 'audio', 'bluetooth headset'], names: ['audio', 'headphone', 'earphone', 'speaker', 'sound'] },
  { terms: ['camera', 'webcam', 'cctv', 'surveillance', 'dashcam', 'lens'], names: ['camera', 'security', 'cctv'] },
  { terms: ['router', 'wifi', 'wi-fi', 'network', 'ethernet', 'switch', 'access point'], names: ['network', 'router', 'connectivity'] },
  { terms: ['charger', 'power bank', 'powerbank', 'cable', 'adapter', 'usb hub', 'charging'], names: ['power', 'charger', 'cable'] },
  { terms: ['smart watch', 'smartwatch', 'fitness tracker', 'wearable', 'watch band'], names: ['wearable', 'watch', 'fitness'] },
  { terms: ['gamepad', 'controller', 'playstation', 'xbox', 'nintendo', 'gaming', 'console'], names: ['gaming', 'game', 'console'] },
  { terms: ['television', 'smart tv', 'projector', 'tv box', 'streaming stick'], names: ['tv', 'television', 'projector', 'entertainment'] },
  { terms: ['drone', 'rc car', 'robot', '3d printer'], names: ['drone', 'robot', '3d printing'] },
];

const normalizeCategoryText = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const matchSylvaCategory = (title, categories) => {
  const text = normalizeCategoryText(title);
  if (!text || !Array.isArray(categories) || !categories.length) return null;
  let best = null;
  let bestScore = 0;
  for (const category of categories) {
    const name = normalizeCategoryText(category.name);
    if (!name) continue;
    let score = 0;
    const nameTokens = name.split(' ').filter((token) => token.length > 2);
    for (const token of nameTokens) if (text.includes(token)) score += 2;
    for (const group of CATEGORY_HINTS) {
      const titleHit = group.terms.some((term) => text.includes(normalizeCategoryText(term)));
      const categoryHit = group.names.some((term) => name.includes(term));
      if (titleHit && categoryHit) score += 5;
    }
    if (score > bestScore) { best = category; bestScore = score; }
  }
  return bestScore >= 5 ? { category: best, confidence: bestScore } : null;
};


router.get('/status', protect, adminOnly, async (req, res) => {
  try {
    const connection = await AliExpressConnection.findOne({ provider: 'aliexpress' }).lean();
    const [aiPending, aiProcessing, aiGenerated, aiFailed] = await Promise.all([
      AliExpressCatalogProduct.countDocuments({ status: mongoose.trusted({ $in: ['pending', 'approved'] }), 'aiContentDraft.status': mongoose.trusted({ $in: ['pending', 'not_generated'] }) }),
      AliExpressCatalogProduct.countDocuments({ 'aiContentDraft.status': 'processing' }),
      AliExpressCatalogProduct.countDocuments({ 'aiContentDraft.status': 'generated' }),
      AliExpressCatalogProduct.countDocuments({ 'aiContentDraft.status': 'failed' }),
    ]);
    const configured = Boolean(process.env.ALIEXPRESS_APP_KEY && process.env.ALIEXPRESS_APP_SECRET &&
      process.env.ALIEXPRESS_REDIRECT_URI && /^[a-f0-9]{64}$/i.test(process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY || ''));
    const connected = connection?.status === 'connected';
    const buyerAuthorized = Boolean(connected && isBuyerPlatform(connection?.accountPlatform));
    const dropshipApi = getDropshipApiConfig();
    const methodVerified = Boolean(connection?.catalogMethodEntitlementVerifiedAt);
    const productTestSucceeded = Boolean(connection?.catalogReadOnlyProductTestAt);
    const feedNamesVerified = Boolean(connection?.catalogFeedNamesVerifiedAt);
    const feedItemIdsVerified = Boolean(connection?.catalogFeedItemIdsVerifiedAt);
    const cataloguePipelineVerified = Boolean(productTestSucceeded && feedNamesVerified && feedItemIdsVerified);
    const catalogSyncReason = !configured
      ? 'IOP OAuth configuration is incomplete. Check the existing AliExpress App ID 40465 credentials and callback URL.'
      : !connected
        ? 'The existing AliExpress IOP application is not connected. Complete OAuth using the existing App ID 40465.'
        : !buyerAuthorized
          ? 'The saved OAuth session is not identified as buyerApp. Re-authorize the existing Dropshipping buyer account.'
          : !productTestSucceeded
            ? dropshipApi.reason
            : !feedNamesVerified ? 'The product-detail API is verified. Feed-name discovery has not yet passed.' : !feedItemIdsVerified ? 'Feed-name discovery is verified. Feed-item pagination has not yet passed.' : 'All three read-only catalogue methods have passed. Catalogue sync imports only into the private review queue.';

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
        tokenLastRefreshedAt: connection?.tokenLastRefreshedAt || null,
        tokenRefreshLastError: connection?.tokenRefreshLastError || '',
        automaticTokenRefresh: { enabled: true, checkIntervalMinutes: 5, refreshWindowMinutes: 10 },
        lastError: connection?.lastError || '',
        buyerAuthorized,
        dropshipApiConfigured: dropshipApi.configured,
        legacyDropshipApiDeprecated: true,
        legacyDropshipApiProviderConfirmed: false,
        iopOAuthConnected: Boolean(configured && connected && buyerAuthorized),
        iopCatalogApiVerified: productTestSucceeded,
        catalogSyncEnabled: cataloguePipelineVerified,
        catalogSyncReason,
        catalogVerification: {
          protocol: dropshipApi.protocol,
          endpoint: dropshipApi.endpoint,
          sdkReference: dropshipApi.sdkReference,
          wireContractVerified: dropshipApi.wireContractVerified,
          methodEntitlementVerified: methodVerified,
          readOnlyProductTestSucceeded: productTestSucceeded,
          feedNamesVerified,
          feedNamesVerifiedAt: connection?.catalogFeedNamesVerifiedAt || null,
          feedItemIdsVerified,
          feedItemIdsVerifiedAt: connection?.catalogFeedItemIdsVerifiedAt || null,
          lastFeedName: connection?.catalogLastFeedName || '',
          lastFeedItemCount: connection?.catalogLastFeedItemCount || 0,
          lastSyncAt: connection?.catalogLastSyncAt || null,
          lastSyncCount: connection?.catalogLastSyncCount || 0,
          protocolVerifiedAt: connection?.catalogProtocolVerifiedAt || null,
          methodEntitlementVerifiedAt: connection?.catalogMethodEntitlementVerifiedAt || null,
          readOnlyProductTestAt: connection?.catalogReadOnlyProductTestAt || null,
          lastTestProductId: connection?.catalogLastTestProductId || '',
          lastTestProductTitle: connection?.catalogLastTestProductTitle || '',
          lastTestError: connection?.catalogLastTestError || '',
        },
        supplierOrderingEnabled: false,
      outputFields: ['verifiedBrand', 'modelNumber', 'specifications', 'keyFeatures', 'shortDescription', 'description', 'seoTitle', 'seoMetaDescription', 'marketingTags', 'socialPromoCaption', 'returnPolicyNote'],
        supplierOrderingReason: 'Supplier order placement and payment remain disabled until product sourcing, supplier payment, duplicate-order handling, cancellation and tracking are independently verified.',
        apiGeneration: 'iop-protocol-top-sdk-verified-product-entitlement-pending',
        dropshipGateway: null,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to load AliExpress buyer API status.' });
  }
});

// Admin-only, read-only proof of method access. This endpoint never creates an
// order, purchases a product, imports a listing or publishes storefront data.
router.post('/catalog/test-product', protect, adminOnly, limiter, async (req, res) => {
  let connection;
  try {
    requiredDropshipEnv();
    const productId = String(req.body?.product_id || '').trim();
    const shipToCountry = String(req.body?.ship_to_country || 'KE').trim().toUpperCase();
    const targetCurrency = String(req.body?.target_currency || 'USD').trim().toUpperCase();
    const targetLanguage = String(req.body?.target_language || 'en_US').trim();

    if (!/^\d{1,30}$/.test(productId)) {
      return res.status(400).json({ success: false, code: 'ALIEXPRESS_PRODUCT_ID_INVALID', message: 'Enter a valid numeric AliExpress product ID.' });
    }
    if (!/^[A-Z]{2}$/.test(shipToCountry)) {
      return res.status(400).json({ success: false, code: 'ALIEXPRESS_COUNTRY_INVALID', message: 'Ship-to country must be a two-letter country code such as KE.' });
    }
    if (!/^[A-Z]{3}$/.test(targetCurrency)) {
      return res.status(400).json({ success: false, code: 'ALIEXPRESS_CURRENCY_INVALID', message: 'Target currency must be a three-letter currency code.' });
    }

    connection = await AliExpressConnection.findOne({ provider: 'aliexpress' })
      .select('+accessTokenEncrypted +refreshTokenEncrypted');
    if (!connection || connection.status !== 'connected') {
      return res.status(409).json({ success: false, code: 'ALIEXPRESS_NOT_CONNECTED', message: 'Connect the existing AliExpress account before testing catalogue access.' });
    }
    if (!isBuyerPlatform(connection.accountPlatform)) {
      return res.status(409).json({ success: false, code: 'ALIEXPRESS_BUYERAPP_REQUIRED', message: 'The connected AliExpress authorization is not identified as buyerApp. Re-authorize the existing DropShippers account.' });
    }

    const accessToken = await getUsableBuyerToken(connection);
    const payload = await callDropshipApi('aliexpress.ds.product.get', {
      product_id: productId,
      ship_to_country: shipToCountry,
      target_currency: targetCurrency,
      target_language: targetLanguage,
    }, accessToken);

    const envelope = getMethodEnvelope(payload, 'aliexpress.ds.product.get');
    const result = envelope.result || envelope.resp_result?.result;
    const baseInfo = result?.ae_item_base_info_dto;
    if (!result || !baseInfo || !(baseInfo.product_id || baseInfo.subject)) {
      const error = new Error(String(envelope.rsp_msg || envelope.resp_result?.resp_msg || 'AliExpress accepted the request but did not return the expected product detail structure.'));
      error.code = 'ALIEXPRESS_PRODUCT_RESPONSE_INCOMPLETE';
      error.status = 502;
      throw error;
    }

    const productTitle = String(baseInfo.subject || '').slice(0, 300);
    const skuCount = Array.isArray(result.ae_item_sku_info_dtos) ? result.ae_item_sku_info_dtos.length : 0;
    const now = new Date();
    connection.catalogProtocolVerifiedAt = connection.catalogProtocolVerifiedAt || now;
    connection.catalogMethodEntitlementVerifiedAt = now;
    connection.catalogReadOnlyProductTestAt = now;
    connection.catalogLastTestProductId = productId;
    connection.catalogLastTestProductTitle = productTitle;
    connection.catalogLastTestError = '';
    await connection.save();

    return res.json({
      success: true,
      message: 'AliExpress returned product detail through the official IOP Protocol.TOP /sync request. The read-only API test succeeded.',
      verification: {
        protocol: 'IOP Protocol.TOP',
        endpoint: 'https://api-sg.aliexpress.com/sync',
        method: 'aliexpress.ds.product.get',
        methodEntitlementVerified: true,
        readOnlyProductTestSucceeded: true,
        testedAt: now,
      },
      product: {
        productId: String(baseInfo.product_id || productId),
        title: productTitle,
        currency: String(baseInfo.currency_code || targetCurrency),
        categoryId: baseInfo.category_id == null ? null : String(baseInfo.category_id),
        productStatus: String(baseInfo.product_status_type || ''),
        rating: String(baseInfo.avg_evaluation_rating || ''),
        reviewCount: String(baseInfo.evaluation_count || ''),
        skuCount,
        imageCount: countImages(result),
        sampleImageUrls: collectAliExpressImageUrls(result).slice(0, 3),
        shipToCountry,
      },
      catalogueSyncEnabled: false,
      nextStep: 'The product-detail method is verified. Feed-name discovery and feed-item pagination must be tested separately before catalogue import is enabled.',
    });
  } catch (error) {
    if (connection) {
      connection.catalogLastTestError = String(error.message || 'AliExpress product test failed.').slice(0, 500);
      await connection.save().catch(() => {});
    }
    const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 502;
    return res.status(status).json({
      success: false,
      code: error.code || 'ALIEXPRESS_PRODUCT_TEST_FAILED',
      message: error.message || 'AliExpress read-only product test failed.',
      ...(error.aliexpressCode ? { aliexpressCode: error.aliexpressCode } : {}),
    });
  }
});


router.get('/catalog/settings', protect, adminOnly, async (req, res) => {
  try {
    const settings = await AliExpressCatalogSettings.findOne({ key: 'default' }).lean();
    return res.json({ success: true, exchangeRates: settings?.exchangeRates || [], minimumProfitPercent: 8 });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to load AliExpress catalogue pricing settings.' });
  }
});

router.put('/catalog/settings/exchange-rate', protect, adminOnly, async (req, res) => {
  try {
    const currency = String(req.body?.currency || '').trim().toUpperCase();
    const kesPerUnit = Number(req.body?.kesPerUnit);
    if (!/^[A-Z]{3}$/.test(currency)) return res.status(400).json({ success: false, message: 'Enter a valid three-letter supplier currency code.' });
    if (!Number.isFinite(kesPerUnit) || kesPerUnit <= 0 || kesPerUnit > 1000000) {
      return res.status(400).json({ success: false, message: 'Enter a valid positive KES exchange rate.' });
    }
    const settings = await AliExpressCatalogSettings.findOneAndUpdate(
      { key: 'default' },
      { $setOnInsert: { key: 'default' } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    const existing = settings.exchangeRates.find((item) => item.currency === currency);
    if (existing) {
      existing.kesPerUnit = kesPerUnit;
      existing.updatedAt = new Date();
      existing.updatedBy = req.user._id;
    } else {
      settings.exchangeRates.push({ currency, kesPerUnit, updatedAt: new Date(), updatedBy: req.user._id });
    }
    await settings.save();
    return res.json({ success: true, currency, kesPerUnit, exchangeRates: settings.exchangeRates, minimumProfitPercent: 8 });
  } catch (error) {
    console.error('[AliExpress exchange rate] save failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to save the supplier currency exchange rate.' });
  }
});

const findArray = (value, predicate, depth = 0) => {
  if (!value || typeof value !== 'object' || depth > 8) return null;
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child) && predicate(key, child)) return child;
  }
  for (const child of Object.values(value)) {
    const found = findArray(child, predicate, depth + 1);
    if (found) return found;
  }
  return null;
};

const getFeedNames = (payload) => {
  const envelope = getMethodEnvelope(payload, 'aliexpress.ds.feedname.get');
  const result = envelope.result || envelope.resp_result?.result || envelope;
  const names = new Set();
  const visited = new Set();

  const addRow = (item) => {
    if (typeof item === 'string' || typeof item === 'number') {
      const value = String(item).trim();
      if (value) names.add(value);
      return;
    }
    if (!item || typeof item !== 'object') return;
    const value = item.promo_name || item.feed_name || item.feedName ||
      item.promoName || item.name;
    if (typeof value === 'string' && value.trim()) names.add(value.trim());
  };

  // AliExpress may serialize a single promo as an object instead of an array.
  // Walk the response for promo containers and accept both representations.
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 10 || visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (/^promo(s)?$/i.test(key)) {
        if (Array.isArray(child)) child.forEach(addRow);
        else if (child && typeof child === 'object') {
          if (Array.isArray(child.promo)) child.promo.forEach(addRow);
          else addRow(child);
        }
      }
      if (/feed.*name|name.*feed/i.test(key) && Array.isArray(child)) {
        child.forEach(addRow);
      }
      visit(child, depth + 1);
    }
  };

  visit(result);
  if (!names.size) visit(envelope);
  return [...names];
};

const getFeedItemIds = (payload) => {
  const envelope = getMethodEnvelope(payload, 'aliexpress.ds.feed.itemids.get');
  const result = envelope.result || envelope.resp_result?.result || envelope;
  const ids = new Set();
  const seen = new Set();
  let cursor = '';

  const addId = (value) => {
    if (typeof value === 'number' || typeof value === 'string') {
      const candidate = String(value).trim();
      if (/^\d{1,30}$/.test(candidate)) ids.add(candidate);
      else if ((candidate.startsWith('[') && candidate.endsWith(']')) ||
               (candidate.startsWith('{') && candidate.endsWith('}'))) {
        try { const parsed = JSON.parse(candidate); if (parsed !== value) visit(parsed); } catch (_) {}
      }
      return;
    }
    if (!value || typeof value !== 'object') return;
    const candidate = value.product_id ?? value.item_id ?? value.productId ?? value.itemId ??
      value.productIdStr ?? value.itemIdStr ?? value.productIdLong ?? value.itemIdLong ??
      value.product_id_str ?? value.item_id_str ?? value.id;
    if (candidate !== undefined && candidate !== null) addId(candidate);
    else if (Array.isArray(value.string)) value.string.forEach(addId);
    else if (Array.isArray(value.number)) value.number.forEach(addId);
  };

  // IOP has returned feed IDs as products.number[], as well as wrapped
  // response objects. Walk the response to tolerate both object/array and
  // stringified-list serializations without treating totals as product IDs.
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 12 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(addId);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (/^search_id$/i.test(key) && (typeof value === 'string' || typeof value === 'number')) {
        cursor = String(value);
      }
      if (/^(number|product_ids|productIds|item_ids|itemIds|product_id_list|item_id_list)$/i.test(key)) {
        if (Array.isArray(value)) value.forEach(addId);
        else if (typeof value === 'string' && value.includes(',')) value.split(',').forEach(addId);
        else if (value && typeof value === 'object') {
          if (Array.isArray(value.number)) value.number.forEach(addId);
          else addId(value);
        } else addId(value);
      }
      if (value && typeof value === 'object') visit(value, depth + 1);
    }
  };
  visit(result);
  if (!ids.size) visit(envelope);
  return { ids: [...ids], cursor };
};

const collectAliExpressImageUrls = (payload) => {
  const urls = new Set();
  const visited = new Set();
  const imageKey = /(image|picture|photo|main_pic|product_pic|img)/i;

  const addUrl = (candidate) => {
    if (candidate == null) return;
    if (typeof candidate === 'object') {
      if (Array.isArray(candidate)) {
        candidate.forEach(addUrl);
        return;
      }
      for (const key of ['url', 'image_url', 'imageUrl', 'src', 'value', 'string', 'image_urls']) {
        if (candidate[key] != null) addUrl(candidate[key]);
      }
      return;
    }
    if (typeof candidate !== 'string') return;
    let value = candidate.trim().replace(/&amp;/gi, '&').replace(/\\\//g, '/');
    if (!value) return;

    // AliExpress documents ae_multimedia_info_dto.image_urls as one
    // semicolon-delimited string. Split that list BEFORE URL validation;
    // otherwise the entire list is incorrectly stored as one broken URL.
    if (value.includes(';') || value.includes('|') || /[\r\n]/.test(value)) {
      value.split(/[;|\r\n]+/).forEach(addUrl);
      return;
    }
    if ((value.startsWith('[') && value.endsWith(']')) ||
        (value.startsWith('{') && value.endsWith('}'))) {
      try { addUrl(JSON.parse(value)); return; } catch (_) {}
    }
    value = value.replace(/^["']|["']$/g, '').trim();
    if (value.startsWith('//')) value = 'https:' + value;
    // AliExpress product payload examples still contain http image hosts.
    // Sylva storefront is HTTPS, so normalize image URLs to HTTPS to avoid
    // mixed-content blocking in browsers.
    value = value.replace(/^http:\/\//i, 'https://');
    if (/^https:\/\//i.test(value) && value.length <= 2000) urls.add(value);
  };

  const visit = (node, parentKey = '', depth = 0) => {
    if (node == null || depth > 14) return;
    if (typeof node === 'string') {
      if (imageKey.test(parentKey)) addUrl(node);
      return;
    }
    if (typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) {
      node.forEach((item) => {
        if (typeof item === 'string') addUrl(item);
        else visit(item, parentKey, depth + 1);
      });
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (imageKey.test(key)) addUrl(value);
      else if (value && typeof value === 'object') visit(value, key, depth + 1);
    }
  };

  visit(payload);
  return [...urls].slice(0, 20);
};

const getAliExpressProductResult = (payload) => {
  const envelope = getMethodEnvelope(payload, 'aliexpress.ds.product.get');
  const direct = envelope.result || envelope.resp_result?.result;
  if (direct?.ae_item_base_info_dto) return direct;
  const visited = new Set();
  const find = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 12 || visited.has(node)) return null;
    visited.add(node);
    if (node.ae_item_base_info_dto) return node;
    for (const child of Object.values(node)) {
      const found = find(child, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return find(envelope) || find(payload);
};

const getAliExpressSkuRows = (value) => {
  if (Array.isArray(value)) return value.filter((row) => row && typeof row === 'object');
  if (value && typeof value === 'object') {
    const nested = value.ae_item_sku_info_d_t_o || value.ae_item_sku_info_dto || value.sku_info;
    if (Array.isArray(nested)) return nested.filter(Boolean);
    return [nested && typeof nested === 'object' ? nested : value];
  }
  return [];
};


const extractAliExpressProductAttributes = (productResult) => {
  const containers = [];
  const visited = new Set();
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 8 || visited.has(node)) return;
    visited.add(node);
    for (const [key, value] of Object.entries(node)) {
      if (/propert(?:y|ies)|attribute|specification|item_specific/i.test(key)) containers.push(value);
      if (value && typeof value === 'object') walk(value, depth + 1);
    }
  };
  walk(productResult);

  const ignored = /supplier|aliexpress|seller|store|shipping|freight|delivery|price|cost|currency|stock|sku|product.?id|category|image|url|commission|profit|markup|source|provider|properties|attributes|specifications|^items?$/i;
  const clean = (value) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
  const valueText = (value, depth = 0) => {
    if (depth > 3 || value == null) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return clean(value);
    if (Array.isArray(value)) return value.map((item) => valueText(item, depth + 1)).filter(Boolean).join(', ').slice(0, 240);
    if (typeof value === 'object') {
      for (const key of ['display_value', 'value_name', 'attr_value', 'property_value', 'value', 'name', 'label']) {
        if (value[key] != null) {
          const text = valueText(value[key], depth + 1);
          if (text) return text;
        }
      }
    }
    return '';
  };
  const attributes = new Map();
  const add = (labelValue, rawValue) => {
    const label = clean(labelValue).replace(/[_-]+/g, ' ');
    const value = valueText(rawValue);
    if (!label || !value || label.length > 80 || ignored.test(label)) return;
    const normalized = label.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!normalized || attributes.has(normalized)) return;
    attributes.set(normalized, { name: label, value });
  };
  const parse = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) {
      node.forEach((item) => parse(item, depth + 1));
      return;
    }
    const label = node.attr_name || node.attribute_name || node.property_name || node.propertyName ||
      node.attributeName || node.name || node.label || node.key;
    const value = node.attr_value || node.attribute_value || node.property_value || node.propertyValue ||
      node.attributeValue || node.display_value || node.value_name || node.value;
    if (label && value != null) add(label, value);
    for (const [key, child] of Object.entries(node)) {
      if (typeof child !== 'object' || child == null) continue;
      if (!label && !ignored.test(key) && !/^(id|code|type|sort|order)$/i.test(key)) {
        const scalar = valueText(child);
        if (scalar) add(key, scalar);
      }
      parse(child, depth + 1);
    }
  };
  containers.forEach((container) => parse(container));
  return [...attributes.values()].slice(0, 40);
};

const normalizeAliExpressProduct = (payload, productId, currency) => {
  const result = getAliExpressProductResult(payload);
  const base = result?.ae_item_base_info_dto;
  if (!base || !(base.product_id || base.subject)) return null;

  const multimedia = result.ae_multimedia_info_dto || {};
  const skuRows = getAliExpressSkuRows(result.ae_item_sku_info_dtos);
  const imageUrls = collectAliExpressImageUrls({
    ae_multimedia_info_dto: multimedia,
    ae_item_base_info_dto: base,
    ae_item_sku_info_dtos: result.ae_item_sku_info_dtos,
    product_images: result.product_images,
    image_urls: result.image_urls,
    image_url_list: result.image_url_list,
    main_image: result.main_image,
    product_main_pic: result.product_main_pic,
    itemMainPic: result.itemMainPic,
    product_main_image_url: result.product_main_image_url,
    image_url: result.image_url,
    image_list: result.image_list,
  });

  const numericPrice = (value) => {
    const parsed = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const salePrices = skuRows.map((sku) => numericPrice(sku.offer_sale_price) || numericPrice(sku.discount_price) || numericPrice(sku.sku_price) || numericPrice(sku.price)).filter(Boolean);
  const regularPrices = skuRows.map((sku) => numericPrice(sku.sku_price) || numericPrice(sku.price)).filter(Boolean);
  const baseSale = numericPrice(base.discount_price) || numericPrice(base.sale_price) || numericPrice(base.min_price);
  const supplierPrice = salePrices.length ? Math.min(...salePrices) : baseSale;
  const originalPrice = regularPrices.length ? Math.min(...regularPrices) : (numericPrice(base.original_price) || supplierPrice);
  const currencyCode = skuRows.find((sku) => sku.currency_code)?.currency_code || base.currency_code || currency || 'USD';
  const id = String(base.product_id || productId);
  const storeInfo = result.ae_store_info || result.ae_store_info_dto || result.ae_store_info_d_t_o || {};
  const firstText = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
  const supplierStoreName = firstText(storeInfo.store_name, storeInfo.store_title, storeInfo.storeName, storeInfo.shop_name, storeInfo.shop_title, storeInfo.seller_name, storeInfo.name, result.store_name, base.store_name).slice(0, 200);
  const supplierStoreUrl = firstText(storeInfo.store_url, storeInfo.store_home_url, storeInfo.storeUrl, storeInfo.shop_url, storeInfo.url, result.store_url).slice(0, 2000);
  const supplierBrand = firstText(base.product_brand, base.brand, base.brand_name, base.product_brand_name, result.product_brand).slice(0, 120);
  const rawDescription = firstText(base.product_description, base.description, base.detail, base.product_detail, result.product_description, result.description, result.detail, result.detail_description, result.ae_item_detail?.description, result.ae_item_detail?.detail).slice(0, 5000);
  const targetSalePrice = supplierPrice == null ? null : Number((supplierPrice * 1.08).toFixed(2));
  const productAttributes = extractAliExpressProductAttributes(result);

  return {
    providerProductId: id,
    title: String(base.subject || '').trim().slice(0, 500),
    productUrl: 'https://www.aliexpress.com/item/' + encodeURIComponent(id) + '.html',
    imageUrl: imageUrls[0] || '',
    imageUrls,
    supplierPrice,
    supplierOriginalPrice: originalPrice,
    minimumProfitPercent: 8,
    targetSalePrice,
    supplierCurrency: String(currencyCode).toUpperCase().slice(0, 3),
    targetCurrency: String(currency || 'USD').toUpperCase().slice(0, 3),
    categoryId: String(base.category_id || ''),
    sellerId: String(storeInfo.store_id || storeInfo.seller_id || ''),
    supplierStoreName,
    supplierStoreUrl,
    supplierBrand,
    productAttributes,
    sourcePayload: {
      productId: id,
      rawDescription,
      skuCount: skuRows.length,
      categoryId: String(base.category_id || ''),
      imageCount: imageUrls.length,
      imageFieldPresent: Boolean(multimedia.image_urls || base.image_url || base.image_urls),
      imageListDelimited: typeof multimedia.image_urls === 'string' && multimedia.image_urls.includes(';'),
      priceSource: salePrices.length ? 'sku_offer_sale_price_or_sku_price' : 'base_product_price',
    },
  };
};

/*
 * Stage one explicitly selected AliExpress product by ID.
 * This bypasses feed pagination for review-workflow testing, but still fetches
 * the canonical supplier detail server-side and saves it privately only.
 */
router.post('/catalog/stage-product', protect, adminOnly, limiter, async (req, res) => {
  let connection;
  try {
    requiredDropshipEnv();
    const productId = String(req.body?.productId || '').trim();
    if (!/^\d{1,30}$/.test(productId)) {
      return res.status(400).json({ success: false, code: 'ALIEXPRESS_PRODUCT_ID_INVALID', message: 'Enter a valid numeric AliExpress product ID.' });
    }
    connection = await AliExpressConnection.findOne({ provider: 'aliexpress' })
      .select('+accessTokenEncrypted +refreshTokenEncrypted');
    if (!connection || connection.status !== 'connected' || !isBuyerPlatform(connection.accountPlatform)) {
      return res.status(409).json({ success: false, code: 'ALIEXPRESS_BUYERAPP_REQUIRED', message: 'Connect the existing buyerApp account first.' });
    }
    const existing = await AliExpressCatalogProduct.findOne({ providerProductId: productId });
    if (existing?.importedProduct || ['approved', 'imported'].includes(existing?.status)) {
      return res.status(409).json({ success: false, code: 'ALIEXPRESS_PRODUCT_ALREADY_PUBLISHED', message: 'This supplier product has already been approved or imported.' });
    }
    if (existing?.status === 'rejected') {
      return res.status(409).json({ success: false, code: 'ALIEXPRESS_PRODUCT_PREVIOUSLY_REJECTED', message: 'This product was previously rejected. It cannot be re-queued through manual staging.' });
    }

    const accessToken = await getUsableBuyerToken(connection);
    const detail = await callDropshipApi('aliexpress.ds.product.get', {
      product_id: productId,
      ship_to_country: String(req.body?.country || 'KE').toUpperCase().slice(0, 2),
      target_currency: String(req.body?.targetCurrency || 'USD').toUpperCase().slice(0, 3),
      target_language: String(req.body?.targetLanguage || 'en_US').slice(0, 10),
    }, accessToken);
    const normalized = normalizeAliExpressProduct(detail, productId, req.body?.targetCurrency || 'USD');
    if (!normalized || normalized.title.length < 3) {
      return res.status(502).json({ success: false, code: 'ALIEXPRESS_PRODUCT_DETAILS_INVALID', message: 'AliExpress did not return a usable product title and detail record. Nothing was added to the review queue.' });
    }

    const categories = await Category.find({ isActive: true }).select('_id name slug').lean();
    const categoryMatch = matchSylvaCategory(normalized.title, categories);
    normalized.sylvaCategoryId = categoryMatch ? String(categoryMatch.category._id) : '';
    normalized.categoryName = categoryMatch?.category?.name || '';
    normalized.categoryMatchStatus = categoryMatch ? 'matched' : 'needs_review';
    normalized.aiContentDraft = { status: 'pending', attempts: 0 };
    const staged = await AliExpressCatalogProduct.findOneAndUpdate(
      { providerProductId: normalized.providerProductId },
      { $set: { ...normalized, syncedAt: new Date() }, $setOnInsert: { status: 'pending' } },
      { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true }
    );
    return res.status(201).json({
      success: true,
      message: 'Product details verified and added to Sylva’s private admin review queue. It is not published.',
      product: {
        _id: staged._id, providerProductId: staged.providerProductId, title: staged.title,
        imageUrl: staged.imageUrl, imageUrls: staged.imageUrls, imageCount: staged.imageUrls?.length || 0, supplierPrice: staged.supplierPrice,
        supplierCurrency: staged.supplierCurrency, targetCurrency: staged.targetCurrency,
        productUrl: staged.productUrl, status: staged.status,
      },
      reviewQueueOnly: true, storefrontPublished: false, supplierOrderingEnabled: false,
    });
  } catch (error) {
    const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 502;
    console.error('[AliExpress private staging] failed:', {
      code: error.code || 'ALIEXPRESS_PRODUCT_STAGING_FAILED',
      aliexpressCode: error.aliexpressCode || '',
      message: String(error.message || 'Unknown error').slice(0, 220),
    });
    return res.status(status).json({
      success: false, code: error.code || 'ALIEXPRESS_PRODUCT_STAGING_FAILED',
      message: error.message || 'Unable to stage this AliExpress product for admin review.',
      ...(error.aliexpressCode ? { aliexpressCode: error.aliexpressCode } : {}),
    });
  }
});

// Isolated read-only feed-name verification. This separates feed discovery
// from feed-item pagination and product detail lookups so each stage can be
// diagnosed without importing or publishing anything.
router.post('/catalog/verify-feeds', protect, adminOnly, limiter, async (req, res) => {
  let connection;
  try {
    requiredDropshipEnv();
    connection = await AliExpressConnection.findOne({ provider: 'aliexpress' })
      .select('+accessTokenEncrypted +refreshTokenEncrypted');
    if (!connection || connection.status !== 'connected' || !isBuyerPlatform(connection.accountPlatform)) {
      return res.status(409).json({ success: false, code: 'ALIEXPRESS_BUYERAPP_REQUIRED', stage: 'connection', message: 'Connect the existing buyerApp AliExpress account before verifying supplier feeds.' });
    }

    const accessToken = await getUsableBuyerToken(connection);
    const payload = await callDropshipApi('aliexpress.ds.feedname.get', {}, accessToken);
    const feedNames = getFeedNames(payload);
    if (!feedNames.length) {
      const error = new Error('AliExpress responded, but the feed-name response did not contain a recognizable promos.promo list.');
      error.code = 'ALIEXPRESS_FEED_NAMES_EMPTY';
      error.status = 502;
      throw error;
    }

    const now = new Date();
    connection.catalogFeedNamesVerifiedAt = now;
    connection.catalogLastFeedName = feedNames[0];
    connection.catalogLastTestError = '';
    await connection.save();

    return res.json({
      success: true,
      message: 'AliExpress feed-name discovery passed. No products were imported or published.',
      stage: 'feed_names',
      verification: { feedNameMethod: 'passed', feedCount: feedNames.length, verifiedAt: now },
      availableFeeds: feedNames.slice(0, 150),
      reviewQueueOnly: true,
      storefrontPublished: false,
      supplierOrderingEnabled: false,
    });
  } catch (error) {
    if (connection) {
      connection.catalogLastTestError = String(error.message || 'AliExpress feed-name verification failed.').slice(0, 500);
      await connection.save().catch(() => {});
    }
    const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 502;
    console.error('[AliExpress feed-name verification] failed:', {
      code: error.code || 'ALIEXPRESS_FEED_NAMES_FAILED',
      aliexpressCode: error.aliexpressCode || '',
      message: String(error.message || 'Unknown error').slice(0, 240),
    });
    return res.status(status).json({
      success: false,
      code: error.code || 'ALIEXPRESS_FEED_NAMES_FAILED',
      message: error.message || 'AliExpress feed-name verification failed.',
      stage: 'feed_names',
      ...(error.aliexpressCode ? { aliexpressCode: error.aliexpressCode } : {}),
    });
  }
});


/*
 * AliExpress listings stay in this private staging collection until an
 * authenticated Sylva administrator explicitly approves them.
 */
router.get('/catalog/ai/status', protect, adminOnly, async (req, res) => {
  const [aiPending, aiProcessing, aiGenerated, aiFailed] = await Promise.all([
    AliExpressCatalogProduct.countDocuments({ status: mongoose.trusted({ $in: ['pending', 'approved'] }), 'aiContentDraft.status': mongoose.trusted({ $in: ['pending', 'not_generated'] }) }),
    AliExpressCatalogProduct.countDocuments({ 'aiContentDraft.status': 'processing' }),
    AliExpressCatalogProduct.countDocuments({ 'aiContentDraft.status': 'generated' }),
    AliExpressCatalogProduct.countDocuments({ 'aiContentDraft.status': 'failed' }),
  ]);
  const configured = Boolean(process.env.OLLAMA_BASE_URL);
  return res.set('Cache-Control', 'no-store, private').json({
    success: true,
    data: {
      configured, providerStatus: configured ? 'available' : 'not_configured',
      provider: 'sylva', model: String(process.env.OLLAMA_MODEL || 'qwen2.5:7b'),
      scope: 'product_content_only', automaticEnrichmentAfterSync: true,
      workerIntervalSeconds: Math.max(10, Math.min(60, Math.round((Number.parseInt(process.env.SYLVA_AI_WORKER_INTERVAL_MS, 10) || 15000) / 1000))),
      queue: { pending: aiPending, processing: aiProcessing, generated: aiGenerated, failed: aiFailed },
      maxAutomaticAttempts: 5, webResearchEnabled: false,
      researchMode: 'supplied_product_data_only',
      draftsRequireAdminApproval: true, mayPublishProducts: false,
      mayChangePricingOrStock: false, mayAccessCustomerOrFinancialData: false,
      supplierOrderingEnabled: false,
    },
  });
});

router.post('/catalog/ai/resume', protect, adminOnly, async (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ success: false, message: 'Confirm that you want Sylva AI to resume processing pending product drafts.' });
  try {
    const released = await AliExpressCatalogProduct.collection.updateMany(
      { 'aiContentDraft.status': 'pending', 'aiContentDraft.lastError': 'AI_CONTENT_NOT_CONFIGURED' },
      { $set: { 'aiContentDraft.nextAttemptAt': null, 'aiContentDraft.lastError': '' } },
    );
    return res.json({ success: true, message: 'Sylva AI queue has been released. Pending product drafts are eligible for processing.', releasedPendingProducts: released.modifiedCount || 0 });
  } catch (error) {
    console.error('[Sylva AI] admin queue release failed:', error.message);
    return res.status(503).json({ success: false, code: 'SYLVA_AI_QUEUE_RELEASE_FAILED', message: 'Unable to release the Sylva AI queue.' });
  }
});

router.post('/catalog/review/:id/generate-content', protect, adminOnly, async (req, res) => {
  try {
    const record = await AliExpressCatalogProduct.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'AliExpress catalogue item not found.' });
    if (record.status !== 'pending') return res.status(409).json({ success: false, message: 'Only products awaiting admin review can receive a content draft.' });
    const generated = await generateAliExpressProductContent({
      title: record.title, supplierBrand: record.supplierBrand,
      categoryName: record.categoryName, productAttributes: record.productAttributes,
      rawDescription: record.sourcePayload?.rawDescription || '', productUrl: record.productUrl || '', targetField: 'all',
    });
    record.aiContentDraft = {
      ...generated, attempts: Number(record.aiContentDraft?.attempts || 0),
      lastError: '', nextAttemptAt: null, processingAt: null,
    };
    await record.save();
    return res.json({ success: true, draft: record.aiContentDraft });
  } catch (error) {
    console.warn('[Sylva AI content] generation failed:', JSON.stringify({
      code: error.code || 'AI_CONTENT_FAILED', providerStatus: error.providerStatus || null,
      providerCode: error.providerCode || '',
    }));
    return res.status(Number(error.status) || (error.code === 'AI_CONTENT_NOT_CONFIGURED' ? 503 : 502)).json({
      success: false, code: error.code || 'AI_CONTENT_FAILED',
      message: error.code === 'AI_CONTENT_NOT_CONFIGURED'
        ? 'Sylva AI is not configured. Set OLLAMA_BASE_URL to the private model endpoint.'
        : error.code === 'AI_CONTENT_QUOTA_EXHAUSTED' || error.code === 'AI_CONTENT_PROVIDER_PAUSED'
          ? 'Sylva AI product enrichment is temporarily unavailable. Pending products remain queued for retry.'
          : error.code === 'AI_CONTENT_RATE_LIMITED'
            ? 'Sylva AI is temporarily unavailable. Please retry shortly.'
            : 'Sylva AI could not generate product content. Check the private model endpoint and backend logs.',
    });
  }
});

router.get('/catalog/review-queue', protect, adminOnly, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 50));
    const [products, counts] = await Promise.all([
      AliExpressCatalogProduct.find({ status: 'pending' }).sort({ syncedAt: -1 }).limit(limit).lean(),
      AliExpressCatalogProduct.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);
    const categories = await Category.find({ isActive: true }).select('_id name slug').sort({ name: 1 }).lean();
    // Backfill category suggestions in one native bulk write instead of
    // serial per-product writes. This keeps queue loading responsive at scale.
    const categoryUpdates = [];
    for (const product of products) {
      if (!product.sylvaCategoryId || product.categoryMatchStatus !== 'matched') {
        const match = matchSylvaCategory(product.title, categories);
        if (match) {
          product.sylvaCategoryId = String(match.category._id);
          product.categoryName = match.category.name;
          product.categoryMatchStatus = 'matched';
          categoryUpdates.push({
            updateOne: {
              filter: { _id: product._id, status: 'pending' },
              update: { $set: { sylvaCategoryId: product.sylvaCategoryId, categoryName: product.categoryName, categoryMatchStatus: 'matched' } },
            },
          });
        }
      }
    }
    if (categoryUpdates.length) {
      await AliExpressCatalogProduct.collection.bulkWrite(categoryUpdates, { ordered: false });
    }
    return res.json({ success: true, products, categories, counts: Object.fromEntries(counts.map((row) => [row._id, row.count])) });
  } catch (error) {
    console.error('[AliExpress review queue] load failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load the AliExpress admin review queue.' });
  }
});

router.post('/catalog/review/:id/approve', protect, adminOnly, async (req, res) => {
  try {
    const record = await AliExpressCatalogProduct.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'AliExpress catalogue item not found.' });
    if (record.status === 'rejected') return res.status(409).json({ success: false, message: 'Rejected items must be re-synced before approval.' });
    if (record.importedProduct) {
      const existing = await Product.findById(record.importedProduct);
      if (existing) return res.status(409).json({ success: false, message: 'This AliExpress item has already been approved and published.', product: existing });
    }

    const price = Number(req.body?.price);
    const supplierPrice = Number(record.supplierPrice);
    const currency = String(record.supplierCurrency || 'USD').toUpperCase();
    const settings = await AliExpressCatalogSettings.findOne({ key: 'default' }).lean();
    const savedRate = (settings?.exchangeRates || []).find((item) => item.currency === currency);
    const exchangeRate = Number(savedRate?.kesPerUnit);
    const profitPercent = 8;
    if (!Number.isFinite(supplierPrice) || supplierPrice <= 0) {
      return res.status(409).json({ success: false, code: 'ALIEXPRESS_SOURCE_PRICE_MISSING', message: 'AliExpress did not return a valid supplier item price. Re-sync this product before approval.' });
    }
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      return res.status(400).json({ success: false, code: 'ALIEXPRESS_EXCHANGE_RATE_REQUIRED', message: 'Save the KES exchange rate once for ' + currency + ' in Catalogue pricing settings before approval.' });
    }
    const supplierPriceKes = Number((supplierPrice * exchangeRate).toFixed(2));
    const minimumSellingPrice = Math.ceil(supplierPriceKes * (1 + profitPercent / 100));
    if (!Number.isFinite(price) || price < minimumSellingPrice) {
      return res.status(400).json({
        success: false, code: 'ALIEXPRESS_SELLING_PRICE_BELOW_MINIMUM',
        minimumSellingPrice, message: 'Sylva selling price must include at least ' + profitPercent + '% profit on the AliExpress item price, excluding shipping. Minimum KES price: ' + minimumSellingPrice.toLocaleString('en-KE') + '.',
      });
    }
    const title = String(req.body?.title || record.title || '').trim().slice(0, 500);
    if (title.length < 3) return res.status(400).json({ success: false, message: 'A product title is required.' });
    const aiDraft = record.aiContentDraft?.status === 'generated' ? record.aiContentDraft : null;
    const description = String(req.body?.description || aiDraft?.description || title).trim().slice(0, 12000);
    const requestedBrand = String(req.body?.brand || '').trim();
    const titleBrand = title.match(/^(HP|Lenovo|Dell|Samsung|Apple|Xiaomi|JBL|Sony|Anker|Baseus|Ugreen|Logitech|Asus|Acer|Huawei|Microsoft|Canon|Epson|D-Link|TP-Link|Netgear|Tenda|Mercusys|KZ|AOC|MSI|Gigabyte|Razer|Hikvision|Dahua)\b/i)?.[1] || '';
    const validBrand = (value) => { const candidate = String(value || '').trim(); return candidate && !/^(aliexpress|sylva technologies|unknown|generic)$/i.test(candidate) ? candidate : ''; };
    const brand = String(titleBrand || validBrand(aiDraft?.verifiedBrand) || validBrand(record.supplierBrand) || validBrand(requestedBrand) || '').trim().slice(0, 120);
    if (!brand) {
      return res.status(409).json({
        success: false,
        code: 'ALIEXPRESS_MANUFACTURER_BRAND_UNVERIFIED',
        message: 'The manufacturer brand could not be verified from the supplier product data. Enter the actual manufacturer brand before approval; AliExpress and Sylva Technologies are not product brands.',
      });
    }
    let category = null;
    const chosenCategoryId = String(req.body?.categoryId || record.sylvaCategoryId || '');
    if (chosenCategoryId && mongoose.isValidObjectId(chosenCategoryId)) {
      category = await Category.findOne({ _id: chosenCategoryId, isActive: true });
    }
    if (!category) {
      return res.status(400).json({ success: false, code: 'ALIEXPRESS_CATEGORY_REQUIRED', message: 'Choose an active Sylva category. No generic or incorrect category will be assigned automatically.' });
    }

    const sku = ('AE-' + record.providerProductId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
    const productCode = await generateUniqueProductCode('ALI');
    const slugBase = (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 110) || 'aliexpress-product');
    const slug = slugBase + '-' + record.providerProductId.slice(-12);
    const existingSku = await Product.findOne({ sku });
    if (existingSku) return res.status(409).json({ success: false, message: 'A product with this supplier SKU already exists. Review the existing product before proceeding.' });

    const images = [...new Set([record.imageUrl, ...(record.imageUrls || [])].filter((url) => /^https?:\/\//i.test(url)))].slice(0, 4);
    if (!images.length) return res.status(409).json({ success: false, code: 'ALIEXPRESS_IMAGES_REQUIRED', message: 'No usable AliExpress product photos were synced. Refresh supplier details and confirm images before approval.' });
    const requestedStock = Number.parseInt(req.body?.stock, 10);
    const approvedStock = Number.isInteger(requestedStock) && requestedStock >= 0 ? requestedStock : 10;

    const publicSpecifications = Object.fromEntries([
      ...(Array.isArray(record.productAttributes) ? record.productAttributes : []),
      ...(Array.isArray(aiDraft?.specifications) ? aiDraft.specifications : []),
    ]
      .filter((attribute) => attribute?.name && attribute?.value)
      .map((attribute) => [String(attribute.name).slice(0, 80), String(attribute.value).slice(0, 240)]));
    const keyFeatures = (Array.isArray(record.productAttributes) ? record.productAttributes : [])
      .filter((attribute) => attribute?.name && attribute?.value)
      .slice(0, 8)
      .map((attribute) => String(attribute.name) + ': ' + String(attribute.value));
    const featureSummary = keyFeatures.join(' • ').slice(0, 300);
    const approvedKeyFeatures = Array.isArray(req.body?.keyFeatures) && req.body.keyFeatures.length
      ? req.body.keyFeatures.map((item) => String(item).trim()).filter(Boolean).slice(0, 8)
      : (aiDraft?.keyFeatures?.length ? aiDraft.keyFeatures : keyFeatures);
    const approvedShortDescription = String(req.body?.shortDescription || aiDraft?.shortDescription || featureSummary || title).trim().slice(0, 500);
    const seoTitle = String(req.body?.seoTitle ?? aiDraft?.seoTitle ?? title).trim().slice(0, 60);
    const seoMetaDescription = String(req.body?.seoMetaDescription ?? aiDraft?.seoMetaDescription ?? approvedShortDescription).trim().slice(0, 155);
    const marketingTags = (Array.isArray(req.body?.marketingTags) ? req.body.marketingTags : aiDraft?.marketingTags || []).map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12);
    const socialPromoCaption = String(req.body?.socialPromoCaption ?? aiDraft?.socialPromoCaption ?? '').trim().slice(0, 1000);
    const published = await Product.create({
      name: title, slug, sku, code: productCode, source: 'aliexpress', origin: 'aliexpress', brand, category: category._id,
      description, shortDescription: approvedShortDescription,
      keyFeatures: approvedKeyFeatures,
      seoTitle, seoMetaDescription, marketingTags, socialPromoCaption,
      returnPolicy: String(aiDraft?.returnPolicyNote || 'Returns and refunds are governed by the Sylva Technologies store Returns & Refunds policy. Confirm eligibility and conditions under the published store policy before purchase.').slice(0, 500),
      contentGeneration: aiDraft ? {
        provider: 'google_gemini', model: aiDraft.model || '', sourceHash: aiDraft.sourceHash || '',
        generatedAt: aiDraft.generatedAt || null,
        generatedFields: ['brand', 'specifications', 'keyFeatures', 'shortDescription', 'description', 'seoTitle', 'seoMetaDescription', 'marketingTags', 'socialPromoCaption', 'returnPolicy'],
        warnings: aiDraft.warnings || [], researchSources: aiDraft.researchSources || [],
      } : undefined,
      price, oldPrice: Number(req.body?.oldPrice) > price ? Number(req.body.oldPrice) : 0,
      images, stock: approvedStock, condition: 'New',
      isActive: true, approvalStatus: 'approved', approvedAt: new Date(), approvedBy: req.user._id,
      seller: null, featured: false, flashSale: false, offer: false,
      specifications: { ...publicSpecifications },
    });

    record.status = 'approved';
    record.importedProduct = published._id;
    record.reviewedAt = new Date();
    record.reviewedBy = req.user._id;
    record.rejectionReason = '';
    await record.save();
    return res.status(201).json({ success: true, message: 'AliExpress product approved and published to the Sylva storefront.', product: published });
  } catch (error) {
    console.error('[AliExpress review approval] failed:', error.message);
    if (error.name === 'ValidationError' && error.errors?.brand) {
      return res.status(409).json({
        success: false,
        code: 'ALIEXPRESS_MANUFACTURER_BRAND_UNVERIFIED',
        message: 'The manufacturer brand is missing or invalid. Enter and verify the actual product manufacturer before approving this listing.',
      });
    }
    return res.status(500).json({ success: false, message: error.message || 'Unable to approve this AliExpress product.' });
  }
});


/* Refresh supplier identity on an already-published AliExpress product.
 * This updates source metadata only; price, stock, visibility and orders are untouched.
 */
router.post('/catalog/refresh-published-metadata/:productId', protect, adminOnly, limiter, async (req, res) => {
  try {
    const product = await Product.findOne({ _id: req.params.productId, source: 'aliexpress' });
    if (!product) return res.status(404).json({ success: false, code: 'ALIEXPRESS_PUBLISHED_PRODUCT_NOT_FOUND', message: 'Published AliExpress product not found.' });

    const productId = String(product.specifications?.supplierProductId || product.sku || '').replace(/^AE-/i, '').trim();
    if (!/^\\d{1,30}$/.test(productId)) {
      return res.status(409).json({ success: false, code: 'ALIEXPRESS_PRODUCT_ID_MISSING', message: 'This product does not contain a valid AliExpress supplier product ID.' });
    }

    const connection = await AliExpressConnection.findOne({ provider: 'aliexpress' })
      .select('+accessTokenEncrypted +refreshTokenEncrypted');
    if (!connection || connection.status !== 'connected' || !isBuyerPlatform(connection.accountPlatform)) {
      return res.status(409).json({ success: false, code: 'ALIEXPRESS_BUYERAPP_REQUIRED', message: 'Connect the existing AliExpress buyerApp account before refreshing supplier details.' });
    }

    const accessToken = await getUsableBuyerToken(connection);
    const supplierCurrency = String(product.specifications?.supplierCurrency || 'USD').toUpperCase();
    const payload = await callDropshipApi('aliexpress.ds.product.get', {
      product_id: productId,
      ship_to_country: 'KE',
      target_currency: /^[A-Z]{3}$/.test(supplierCurrency) ? supplierCurrency : 'USD',
      target_language: 'en_US',
    }, accessToken);
    const normalized = normalizeAliExpressProduct(payload, productId, supplierCurrency);
    if (!normalized) return res.status(502).json({ success: false, code: 'ALIEXPRESS_PRODUCT_DETAILS_INVALID', message: 'AliExpress did not return usable supplier details.' });

    const storeName = normalized.supplierStoreName || '';
    const storeUrl = normalized.supplierStoreUrl || '';
    const currentSpecifications = product.specifications?.toObject?.() || product.specifications || {};
    const refreshedPublicSpecifications = Object.fromEntries(
      (Array.isArray(normalized.productAttributes) ? normalized.productAttributes : [])
        .filter((attribute) => attribute?.name && attribute?.value)
        .map((attribute) => [String(attribute.name).slice(0, 80), String(attribute.value).slice(0, 240)])
    );
    product.specifications = {
      ...currentSpecifications,
      ...refreshedPublicSpecifications,
      supplier: 'AliExpress',
      supplierProductId: productId,
      supplierStoreName: storeName,
      supplierStoreUrl: storeUrl,
      shippingHandledBy: 'AliExpress',
    };
    if (!Array.isArray(product.keyFeatures) || !product.keyFeatures.length) {
      product.keyFeatures = (normalized.productAttributes || []).slice(0, 8)
        .map((attribute) => String(attribute.name) + ': ' + String(attribute.value));
    }
    if ((!product.shortDescription || product.shortDescription === product.name) && product.keyFeatures.length) {
      product.shortDescription = product.keyFeatures.join(' • ').slice(0, 300);
    }
    const refreshedManufacturerBrand = String(normalized.supplierBrand || '').trim();
    if (refreshedManufacturerBrand && !/^(aliexpress|sylva technologies|unknown|generic)$/i.test(refreshedManufacturerBrand) &&
        (!product.brand || /^(aliexpress|sylva technologies|unknown|generic)$/i.test(product.brand))) {
      product.brand = refreshedManufacturerBrand.slice(0, 120);
    }
    await product.save();

    await AliExpressCatalogProduct.updateOne(
      { providerProductId: productId },
      { $set: { supplierStoreName: storeName, supplierStoreUrl: storeUrl, supplierBrand: normalized.supplierBrand || '', sellerId: normalized.sellerId || '' } }
    );

    return res.json({
      success: true,
      message: storeName
        ? 'Supplier store details and available product specifications refreshed. Price, stock and publication status were not changed.'
        : 'Supplier store or product specifications may be unavailable. Existing product pricing and stock were not changed.',
      product: { _id: product._id, brand: product.brand, supplierStoreName: storeName, supplierStoreUrl: storeUrl, shippingHandledBy: 'AliExpress' },
      updated: { price: false, stock: false, visibility: false, orders: false },
    });
  } catch (error) {
    console.error('[AliExpress published metadata refresh] failed:', error.message);
    const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 502;
    return res.status(status).json({ success: false, code: error.code || 'ALIEXPRESS_METADATA_REFRESH_FAILED', message: error.message || 'Unable to refresh AliExpress supplier details.' });
  }
});

router.post('/catalog/review/:id/reject', protect, adminOnly, async (req, res) => {
  try {
    const reason = String(req.body?.reason || '').trim().slice(0, 1000);
    if (!reason) return res.status(400).json({ success: false, message: 'Provide a rejection reason.' });
    const record = await AliExpressCatalogProduct.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'AliExpress catalogue item not found.' });
    if (record.importedProduct) return res.status(409).json({ success: false, message: 'This item has already been published. Deactivate its storefront product instead.' });
    record.status = 'rejected';
    record.rejectionReason = reason;
    record.reviewedAt = new Date();
    record.reviewedBy = req.user._id;
    await record.save();
    return res.json({ success: true, message: 'AliExpress product rejected and kept unpublished.' });
  } catch (error) {
    console.error('[AliExpress review rejection] failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to reject this AliExpress product.' });
  }
});


/* Read-only feed-item verification; does not fetch product details or import listings. */
router.post('/catalog/verify-feed-items', protect, adminOnly, limiter, async (req, res) => {
  let connection;
  try {
    requiredDropshipEnv();
    connection = await AliExpressConnection.findOne({ provider: 'aliexpress' })
      .select('+accessTokenEncrypted +refreshTokenEncrypted');
    if (!connection || connection.status !== 'connected' || !isBuyerPlatform(connection.accountPlatform)) {
      return res.status(409).json({ success: false, code: 'ALIEXPRESS_BUYERAPP_REQUIRED', stage: 'connection', message: 'Connect the existing buyerApp account first.' });
    }
    const accessToken = await getUsableBuyerToken(connection);
    const feedNameResponse = await callDropshipApi('aliexpress.ds.feedname.get', {}, accessToken);
    const feedNames = getFeedNames(feedNameResponse);
    const feedName = String(req.body?.feedName || connection.catalogLastFeedName || feedNames[0] || '').trim();
    if (!feedName || !feedNames.includes(feedName)) {
      return res.status(400).json({ success: false, code: 'ALIEXPRESS_FEED_NAME_INVALID', stage: 'feed_names', message: 'Select a feed returned by AliExpress.' });
    }
    const pageSize = Math.max(1, Math.min(50, Number.parseInt(req.body?.pageSize, 10) || 5));
    const params = { feed_name: feedName, page_size: pageSize };
    if (req.body?.searchId) params.search_id = String(req.body.searchId).slice(0, 300);
    const payload = await callDropshipApi('aliexpress.ds.feed.itemids.get', params, accessToken);
    const parsed = getFeedItemIds(payload);
    if (!parsed.ids.length) {
      const error = new Error('AliExpress responded, but no product IDs could be extracted from the feed-item response. No products were imported.');
      error.code = 'ALIEXPRESS_FEED_ITEMS_EMPTY';
      error.status = 502;
      throw error;
    }
    const now = new Date();
    connection.catalogFeedItemIdsVerifiedAt = now;
    connection.catalogLastFeedName = feedName;
    connection.catalogLastFeedItemCount = parsed.ids.length;
    connection.catalogLastFeedCursor = parsed.cursor;
    connection.catalogLastTestError = '';
    await connection.save();
    return res.json({
      success: true,
      message: 'AliExpress feed-item retrieval passed. Product IDs were verified only; no product details were fetched and nothing was imported or published.',
      stage: 'feed_item_ids',
      verification: { feedName, feedItemIdsMethod: 'passed', productIdsReturned: parsed.ids.length, verifiedAt: now, hasNextPage: Boolean(parsed.cursor) },
      sampleProductIds: parsed.ids.slice(0, 5),
      nextSearchId: parsed.cursor || null,
      imported: 0,
      reviewQueueOnly: true,
      storefrontPublished: false,
      supplierOrderingEnabled: false,
    });
  } catch (error) {
    console.error('[AliExpress feed-item verification] failed:', {
      code: error.code || 'ALIEXPRESS_FEED_ITEMS_FAILED',
      aliexpressCode: error.aliexpressCode || '',
      message: String(error.message || 'Unknown error').slice(0, 240),
    });
    const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 502;
    return res.status(status).json({
      success: false, code: error.code || 'ALIEXPRESS_FEED_ITEMS_FAILED',
      message: error.message || 'AliExpress feed-item verification failed.',
      stage: 'feed_item_ids',
      ...(error.aliexpressCode ? { aliexpressCode: error.aliexpressCode } : {}),
    });
  }
});

router.post('/catalog/sync', protect, adminOnly, limiter, async (req, res) => {
  let connection;
  let stage = 'configuration';
  try {
    requiredDropshipEnv();
    connection = await AliExpressConnection.findOne({ provider: 'aliexpress' })
      .select('+accessTokenEncrypted +refreshTokenEncrypted');
    if (!connection || connection.status !== 'connected' || !isBuyerPlatform(connection.accountPlatform)) {
      return res.status(409).json({ success: false, code: 'ALIEXPRESS_BUYERAPP_REQUIRED', message: 'Connect the existing buyerApp AliExpress account before catalogue synchronisation.' });
    }
    stage = 'token';
    const accessToken = await getUsableBuyerToken(connection);
    stage = 'feed_names';
    const feedNameResponse = await callDropshipApi('aliexpress.ds.feedname.get', {}, accessToken);
    const feedNames = getFeedNames(feedNameResponse);
    if (!feedNames.length) {
      const error = new Error('AliExpress feed-name method returned no recognizable feed names. No catalogue records were imported.');
      error.code = 'ALIEXPRESS_FEED_NAMES_EMPTY';
      throw error;
    }
    const selectedFeed = String(req.body?.feedName || feedNames[0]).trim();
    if (!feedNames.includes(selectedFeed)) {
      return res.status(400).json({ success: false, code: 'ALIEXPRESS_FEED_NAME_INVALID', message: 'Select a feed name returned by AliExpress.', availableFeeds: feedNames.slice(0, 30) });
    }
    connection.catalogFeedNamesVerifiedAt = new Date();
    connection.catalogLastFeedName = selectedFeed;
    await connection.save();

    const pageSize = Math.max(1, Math.min(50, Number.parseInt(req.body?.pageSize, 10) || 20));
    const itemParams = { feed_name: selectedFeed, page_size: pageSize };
    if (req.body?.searchId) itemParams.search_id = String(req.body.searchId).slice(0, 300);
    stage = 'feed_item_ids';
    const itemResponse = await callDropshipApi('aliexpress.ds.feed.itemids.get', itemParams, accessToken);
    const { ids, cursor } = getFeedItemIds(itemResponse);
    if (!ids.length) {
      const error = new Error('AliExpress feed-item method returned no recognizable product IDs. No catalogue records were imported.');
      error.code = 'ALIEXPRESS_FEED_ITEMS_EMPTY';
      throw error;
    }
    connection.catalogFeedItemIdsVerifiedAt = new Date();
    connection.catalogLastFeedItemCount = ids.length;
    connection.catalogLastFeedCursor = cursor;
    await connection.save();

    const operations = [];
    const failures = [];
    const activeCategories = await Category.find({ isActive: true }).select('_id name slug').lean();
    stage = 'product_details';
    for (const productId of ids) {
      try {
        const detail = await callDropshipApi('aliexpress.ds.product.get', {
          product_id: productId,
          ship_to_country: String(req.body?.country || 'KE').toUpperCase(),
          target_currency: String(req.body?.targetCurrency || 'USD').toUpperCase(),
          target_language: String(req.body?.targetLanguage || 'en_US'),
        }, accessToken);
        const normalized = normalizeAliExpressProduct(detail, productId, req.body?.targetCurrency || 'USD');
        if (!normalized) {
          failures.push({ productId, reason: 'Product detail response did not contain the expected product structure.' });
          continue;
        }
        const categoryMatch = matchSylvaCategory(normalized.title, activeCategories);
        normalized.sylvaCategoryId = categoryMatch ? String(categoryMatch.category._id) : '';
        normalized.categoryName = categoryMatch?.category?.name || '';
        normalized.categoryMatchStatus = categoryMatch ? 'matched' : 'needs_review';

        const nextContentHash = hashSource({
          title: normalized.title,
          supplierBrand: normalized.supplierBrand,
          rawDescription: normalized.sourcePayload?.rawDescription || '',
          productUrl: normalized.productUrl || '',
          productAttributes: normalized.productAttributes,
        });
        operations.push({
          updateOne: {
            filter: { providerProductId: normalized.providerProductId },
            update: [
              { $set: { ...normalized, syncedAt: new Date() } },
              { $set: {
                status: { $ifNull: ['$status', 'pending'] },
                'aiContentDraft.status': {
                  $cond: [
                    { $ne: [{ $ifNull: ['$aiContentDraft.sourceHash', ''] }, nextContentHash] },
                    'pending',
                    { $ifNull: ['$aiContentDraft.status', 'pending'] },
                  ],
                },
                'aiContentDraft.attempts': {
                  $cond: [
                    { $ne: [{ $ifNull: ['$aiContentDraft.sourceHash', ''] }, nextContentHash] },
                    0,
                    { $ifNull: ['$aiContentDraft.attempts', 0] },
                  ],
                },
                'aiContentDraft.lastError': {
                  $cond: [
                    { $ne: [{ $ifNull: ['$aiContentDraft.sourceHash', ''] }, nextContentHash] },
                    '',
                    { $ifNull: ['$aiContentDraft.lastError', ''] },
                  ],
                },
                'aiContentDraft.nextAttemptAt': {
                  $cond: [
                    { $ne: [{ $ifNull: ['$aiContentDraft.sourceHash', ''] }, nextContentHash] },
                    null,
                    '$aiContentDraft.nextAttemptAt',
                  ],
                },
              } },
            ],
            upsert: true,
          },
        });
      } catch (error) {
    try {
      await sendSalesNotificationEmail({
        subject: 'AliExpress catalogue sync failed',
        text: [
          'An administrator-triggered AliExpress catalogue sync failed.',
          'Stage: ' + String(stage || 'unknown').slice(0, 60),
          'Error code: ' + String(error.code || 'ALIEXPRESS_CATALOG_SYNC_FAILED').slice(0, 100),
          'Time: ' + new Date().toISOString(),
          'The private review queue was not published by this failed sync.',
        ].join('\n'),
      });
    } catch (notificationError) {
      console.error('[AliExpress sync alert] could not send admin alert:', notificationError.message);
    }
        failures.push({ productId, reason: String(error.message || 'Product detail lookup failed.').slice(0, 180) });
      }
    }
    if (!operations.length) {
      const error = new Error('Feed discovery and item-ID retrieval succeeded, but no product detail could be normalized. Catalogue sync is not marked successful.');
      error.code = 'ALIEXPRESS_PRODUCT_DETAILS_NOT_VERIFIED';
      throw error;
    }
    stage = 'save_private_queue';
    await AliExpressCatalogProduct.collection.bulkWrite(operations, { ordered: false });
    // Native collection avoids Mongoose miscasting the bounded $in filter
    // on providerProductId. Values originate from normalized supplier IDs.
    await AliExpressCatalogProduct.collection.updateMany(
      {
        providerProductId: { $in: operations.map((operation) => String(operation.updateOne.filter.providerProductId)) },
        $or: [
          { 'aiContentDraft.status': { $in: ['not_generated', 'failed'] } },
          { aiContentDraft: { $exists: false } },
        ],
      },
      { $set: { 'aiContentDraft.status': 'pending', 'aiContentDraft.attempts': 0, 'aiContentDraft.lastError': '', 'aiContentDraft.nextAttemptAt': null } }
    );
    const now = new Date();
    connection.catalogProtocolVerifiedAt = connection.catalogProtocolVerifiedAt || now;
    connection.catalogMethodEntitlementVerifiedAt = now;
    connection.catalogReadOnlyProductTestAt = now;
    connection.catalogLastTestProductId = ids[0];
    connection.catalogLastTestError = '';
    connection.catalogLastSyncAt = now;
    connection.catalogLastSyncCount = operations.length;
    await connection.save();

    return res.json({
      success: true,
      message: 'AliExpress feed discovery, feed-item pagination and product-detail methods responded. Products were saved to the private review queue only.',
      verification: {
        feedNameMethod: 'passed',
        feedItemIdsMethod: 'passed',
        productDetailMethod: 'passed',
        feedName: selectedFeed,
        productIdsReturned: ids.length,
        productDetailsSaved: operations.length,
        failedProductDetails: failures.length,
      },
      imported: operations.length,
      productsWithImages: operations.length - failures.filter((item) => item.reason === 'Product detail response did not contain usable product images.').length,
      failed: failures.slice(0, 10),
      nextSearchId: cursor || null,
      reviewQueueOnly: true,
      storefrontPublished: false,
      supplierOrderingEnabled: false,
    });
  } catch (error) {
    if (connection) {
      connection.catalogLastTestError = String(error.message || 'AliExpress catalogue sync failed.').slice(0, 500);
      await connection.save().catch(() => {});
    }
    const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 502;
    console.error('[AliExpress catalogue sync] failed:', {
      stage,
      code: error.code || 'ALIEXPRESS_CATALOG_SYNC_FAILED',
      aliexpressCode: error.aliexpressCode || '',
      message: String(error.message || 'Unknown error').slice(0, 240),
    });
    return res.status(status).json({
      success: false,
      code: error.code || 'ALIEXPRESS_CATALOG_SYNC_FAILED',
      message: error.message || 'AliExpress catalogue sync failed. No products were published.',
      stage,
      reviewQueueOnly: true,
    });
  }
});

module.exports = router;
module.exports.isBuyerPlatform = isBuyerPlatform;
module.exports.getFeedItemIds = getFeedItemIds;
module.exports.normalizeAliExpressProduct = normalizeAliExpressProduct;
module.exports.extractAliExpressProductAttributes = extractAliExpressProductAttributes;
module.exports.getUsableBuyerToken = getUsableBuyerToken;
