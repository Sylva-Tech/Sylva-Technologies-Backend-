const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const AliExpressConnection = require('../models/AliExpressConnection');
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

const getUsableBuyerToken = async (connection) => {
  const expiresAt = connection.accessTokenExpiresAt ? new Date(connection.accessTokenExpiresAt).getTime() : 0;
  const needsRefresh = !connection.accessTokenEncrypted || !expiresAt || expiresAt <= Date.now() + 60000;
  if (!needsRefresh) return decryptSecret(connection.accessTokenEncrypted);

  if (!connection.refreshTokenEncrypted) {
    const error = new Error('The AliExpress access token is missing or expired. Re-authorize the existing buyerApp account.');
    error.code = 'ALIEXPRESS_TOKEN_EXPIRED';
    error.status = 409;
    throw error;
  }

  const currentRefreshToken = decryptSecret(connection.refreshTokenEncrypted);
  const token = await refreshAccessToken(currentRefreshToken);
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
    const catalogSyncReason = !configured
      ? 'IOP OAuth configuration is incomplete. Check the existing AliExpress App ID 40465 credentials and callback URL.'
      : !connected
        ? 'The existing AliExpress IOP application is not connected. Complete OAuth using the existing App ID 40465.'
        : !buyerAuthorized
          ? 'The saved OAuth session is not identified as buyerApp. Re-authorize the existing Dropshipping buyer account.'
          : !productTestSucceeded
            ? dropshipApi.reason
            : 'The read-only product test succeeded. Feed discovery, feed pagination and product import still require separate verification before catalogue sync can be enabled.';

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
        legacyDropshipApiDeprecated: true,
        legacyDropshipApiProviderConfirmed: false,
        iopOAuthConnected: Boolean(configured && connected && buyerAuthorized),
        iopCatalogApiVerified: productTestSucceeded,
        catalogSyncEnabled: false,
        catalogSyncReason,
        catalogVerification: {
          protocol: dropshipApi.protocol,
          endpoint: dropshipApi.endpoint,
          sdkReference: dropshipApi.sdkReference,
          wireContractVerified: dropshipApi.wireContractVerified,
          methodEntitlementVerified: methodVerified,
          readOnlyProductTestSucceeded: productTestSucceeded,
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

router.post('/catalog/sync', protect, adminOnly, limiter, async (req, res) => {
  return res.status(503).json({
    success: false,
    code: 'ALIEXPRESS_CATALOG_PIPELINE_NOT_VERIFIED',
    message: 'The read-only product-detail method can now be tested using /catalog/test-product. Full catalogue sync remains disabled until feed-name discovery, feed-item pagination, product normalization and private review-queue import are separately tested.',
  });
});

module.exports = router;
module.exports.isBuyerPlatform = isBuyerPlatform;
module.exports.getUsableBuyerToken = getUsableBuyerToken;
