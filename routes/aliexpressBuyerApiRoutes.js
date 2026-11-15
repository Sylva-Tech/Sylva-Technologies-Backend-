const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const AliExpressConnection = require('../models/AliExpressConnection');
const AliExpressCatalogProduct = require('../models/AliExpressCatalogProduct');
const Product = require('../models/Product');
const Category = require('../models/Category');
const { getUsableBuyerToken } = require('../services/aliexpressTokenManager');
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
const countImages = (result) => {
  const multimedia = result?.ae_multimedia_info_dto || {};
  const images = multimedia.image_urls || multimedia.image_url_list || multimedia.image_urls_list;
  return Array.isArray(images) ? images.length : 0;
};

router.get('/status', protect, adminOnly, async (req, res) => {
  try {
    const connection = await AliExpressConnection.findOne({ provider: 'aliexpress' }).lean();
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
  const result = envelope.result || envelope.resp_result?.result || {};
  // Live API Explorer response shape:
  // aliexpress_ds_feed_itemids_get_response.result.products.number[]
  // The array key is "number", not "product_ids" or "item_ids".
  const documentedIds = result.products?.number;
  const fallbackIds = findArray(envelope, (key, value) =>
    /item.?ids?|product.?ids?/i.test(key) && value.length > 0);
  const ids = Array.isArray(documentedIds) ? documentedIds : (fallbackIds || []);
  const normalized = ids.map((item) => {
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    return String(item?.product_id || item?.item_id || item?.productId || item?.itemId || '');
  }).filter((id) => /^\d{1,30}$/.test(id));
  const cursor = envelope.search_id || result.search_id || '';
  return { ids: [...new Set(normalized)], cursor: String(cursor || '') };
};

const normalizeAliExpressProduct = (payload, productId, currency) => {
  const envelope = getMethodEnvelope(payload, 'aliexpress.ds.product.get');
  const result = envelope.result || envelope.resp_result?.result;
  const base = result?.ae_item_base_info_dto;
  if (!base || !(base.product_id || base.subject)) return null;
  const multimedia = result.ae_multimedia_info_dto || {};
  const rawImages = multimedia.image_urls || multimedia.image_url_list || multimedia.image_urls_list || [];
  const imageUrls = (Array.isArray(rawImages) ? rawImages : String(rawImages || '').split(','))
    .map((item) => typeof item === 'string' ? item.trim() : String(item?.url || item?.image_url || '').trim())
    .filter((url) => /^https?:\/\//i.test(url)).slice(0, 12);
  const skuRows = Array.isArray(result.ae_item_sku_info_dtos) ? result.ae_item_sku_info_dtos : [];
  const candidatePrices = skuRows.map((sku) => Number(sku.sku_price || sku.offer_sale_price || sku.price))
    .filter((price) => Number.isFinite(price) && price > 0);
  const basePrice = Number(base.discount_price || base.sale_price || base.min_price || base.original_price);
  const supplierPrice = candidatePrices.length ? Math.min(...candidatePrices) : (Number.isFinite(basePrice) && basePrice > 0 ? basePrice : null);
  const id = String(base.product_id || productId);
  return {
    providerProductId: id,
    title: String(base.subject || '').trim().slice(0, 500),
    productUrl: 'https://www.aliexpress.com/item/' + encodeURIComponent(id) + '.html',
    imageUrl: imageUrls[0] || '',
    imageUrls,
    supplierPrice,
    supplierCurrency: String(base.currency_code || currency || 'USD').toUpperCase().slice(0, 3),
    targetCurrency: String(currency || 'USD').toUpperCase().slice(0, 3),
    categoryId: String(base.category_id || ''),
    sellerId: String(result.ae_store_info?.store_id || ''),
    sourcePayload: { productId: id, skuCount: skuRows.length, categoryId: String(base.category_id || '') },
  };
};

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
router.get('/catalog/review-queue', protect, adminOnly, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 50));
    const [products, counts] = await Promise.all([
      AliExpressCatalogProduct.find({ status: 'pending' }).sort({ syncedAt: -1 }).limit(limit).lean(),
      AliExpressCatalogProduct.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);
    return res.json({ success: true, products, counts: Object.fromEntries(counts.map((row) => [row._id, row.count])) });
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

    const price = Number(req.body?.price ?? record.targetSalePrice ?? record.supplierPrice);
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ success: false, message: 'Set a valid Sylva selling price greater than zero before approval.' });
    const title = String(req.body?.title || record.title || '').trim().slice(0, 500);
    if (title.length < 3) return res.status(400).json({ success: false, message: 'A product title is required.' });
    const description = String(req.body?.description || title).trim().slice(0, 12000);
    const brand = String(req.body?.brand || 'AliExpress').trim().slice(0, 120);
    let category = null;
    if (req.body?.categoryId && mongoose.isValidObjectId(req.body.categoryId)) {
      category = await Category.findById(req.body.categoryId);
    }
    if (!category) {
      category = await Category.findOne({ slug: 'aliexpress-imported-products' });
      if (!category) {
        category = await Category.create({ name: 'Imported Products', slug: 'aliexpress-imported-products', description: 'Admin-approved products sourced through AliExpress.' });
      }
    }

    const sku = ('AE-' + record.providerProductId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
    const slugBase = (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 110) || 'aliexpress-product');
    const slug = slugBase + '-' + record.providerProductId.slice(-12);
    const existingSku = await Product.findOne({ sku });
    if (existingSku) return res.status(409).json({ success: false, message: 'A product with this supplier SKU already exists. Review the existing product before proceeding.' });

    const images = [...new Set([record.imageUrl, ...(record.imageUrls || [])].filter((url) => /^https?:\/\//i.test(url)))].slice(0, 4);
    const published = await Product.create({
      name: title, slug, sku, source: 'aliexpress', brand, category: category._id,
      description, shortDescription: String(req.body?.shortDescription || title).trim().slice(0, 300),
      price, oldPrice: Number(req.body?.oldPrice) > price ? Number(req.body.oldPrice) : 0,
      images, stock: Math.max(0, Number.parseInt(req.body?.stock, 10) || 0), condition: 'New',
      isActive: true, approvalStatus: 'approved', approvedAt: new Date(), approvedBy: req.user._id,
      seller: null, featured: false, flashSale: false, offer: false,
      specifications: { supplier: 'AliExpress', supplierProductId: record.providerProductId, supplierUrl: record.productUrl, supplierPrice: record.supplierPrice, supplierCurrency: record.supplierCurrency },
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
    return res.status(500).json({ success: false, message: error.message || 'Unable to approve this AliExpress product.' });
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
        operations.push({
          updateOne: {
            filter: { providerProductId: normalized.providerProductId },
            update: {
              $set: { ...normalized, syncedAt: new Date() },
              $setOnInsert: { status: 'pending' },
            },
            upsert: true,
          },
        });
      } catch (error) {
        failures.push({ productId, reason: String(error.message || 'Product detail lookup failed.').slice(0, 180) });
      }
    }
    if (!operations.length) {
      const error = new Error('Feed discovery and item-ID retrieval succeeded, but no product detail could be normalized. Catalogue sync is not marked successful.');
      error.code = 'ALIEXPRESS_PRODUCT_DETAILS_NOT_VERIFIED';
      throw error;
    }
    stage = 'save_private_queue';
    await AliExpressCatalogProduct.bulkWrite(operations, { ordered: false });
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
module.exports.getUsableBuyerToken = getUsableBuyerToken;
