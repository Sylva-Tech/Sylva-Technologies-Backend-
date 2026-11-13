const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const AliExpressConnection = require('../models/AliExpressConnection');
const { getDropshipApiConfig, requiredDropshipEnv } = require('../services/aliexpressService');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many AliExpress catalogue requests. Try again later.' },
});

const isBuyerPlatform = (value) => ['buyerapp', 'buyer_app', 'buyer'].includes(String(value || '').toLowerCase());

router.get('/status', protect, adminOnly, async (req, res) => {
  try {
    const connection = await AliExpressConnection.findOne({ provider: 'aliexpress' }).lean();
    const configured = Boolean(process.env.ALIEXPRESS_APP_KEY && process.env.ALIEXPRESS_APP_SECRET &&
      process.env.ALIEXPRESS_REDIRECT_URI && /^[a-f0-9]{64}$/i.test(process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY || ''));
    const connected = connection?.status === 'connected';
    const buyerAuthorized = Boolean(connected && isBuyerPlatform(connection?.accountPlatform));
    const dropshipApi = getDropshipApiConfig();

    const catalogSyncReason = !configured
      ? 'IOP OAuth configuration is incomplete. Check the existing AliExpress App ID 40465 credentials and callback URL.'
      : !connected
        ? 'The existing AliExpress IOP application is not connected. Complete OAuth using the existing App ID 40465.'
        : !buyerAuthorized
          ? 'The saved OAuth session is not identified as buyerApp. Re-authorize the existing Dropshipping buyer account.'
          : dropshipApi.reason;

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
        dropshipApiConfigured: false,
        legacyDropshipApiDeprecated: true,
        legacyDropshipApiProviderConfirmed: false,
        iopOAuthConnected: Boolean(configured && connected && buyerAuthorized),
        iopCatalogApiVerified: false,
        catalogSyncEnabled: false,
        catalogSyncReason,
        catalogVerification: {
          protocol: dropshipApi.protocol,
          endpoint: dropshipApi.endpoint,
          wireContractVerified: dropshipApi.wireContractVerified,
          methodEntitlementVerified: dropshipApi.methodEntitlementVerified,
          readOnlyProductTestSucceeded: dropshipApi.readOnlyProductTestSucceeded,
        },
        supplierOrderingEnabled: false,
        supplierOrderingReason: 'Supplier order placement and payment remain disabled until AliExpress production methods, permissions, payment, duplicate-order handling, cancellation and tracking are independently verified.',
        apiGeneration: 'iop-oauth-connected-protocol-top-unverified',
        dropshipGateway: null,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to load AliExpress buyer API status.' });
  }
});

router.post('/catalog/sync', protect, adminOnly, limiter, async (req, res) => {
  try {
    requiredDropshipEnv();
    return res.status(503).json({
      success: false,
      code: 'ALIEXPRESS_CATALOG_API_NOT_VERIFIED',
      message: 'Catalogue sync is paused. Sylva has documented the current IOP Protocol.TOP product method and /sync example, but the exact wire-level common parameters/signing and App ID 40465 method entitlement have not been verified. The old eco.taobao.com/router/rest transport is deprecated and is not used. Run one read-only product test after the current SDK contract is confirmed. Do not create another AppKey.',
    });
  } catch (error) {
    const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 503;
    return res.status(status).json({
      success: false,
      code: error.code || 'ALIEXPRESS_CATALOG_API_NOT_VERIFIED',
      message: error.message || 'AliExpress catalogue access is not verified.',
    });
  }
});

module.exports = router;
module.exports.isBuyerPlatform = isBuyerPlatform;
