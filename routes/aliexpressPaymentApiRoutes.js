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
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many AliExpress payment capability queries. Try again later.' },
});

const isBuyerPlatform = (value) => ['buyerapp', 'buyer_app', 'buyer'].includes(String(value || '').toLowerCase());

const getBuyerConnection = async () => {
  requiredDropshipEnv();
  const connection = await AliExpressConnection.findOne({ provider: 'aliexpress' })
    .select('+accessTokenEncrypted +refreshTokenEncrypted');
  if (!connection || connection.status !== 'connected' || !isBuyerPlatform(connection.accountPlatform)) {
    const error = new Error('Connect the existing AliExpress Dropshipping buyerApp account before querying member benefits.');
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

const unwrap = (payload) => payload?.aliexpress_ds_member_benefit_get_response || payload || {};

router.use(protect, adminOnly, limiter);
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Read-only capability lookup. This does not initiate or authorize any payment.
router.get('/benefits', async (req, res) => {
  try {
    const accessToken = await getBuyerConnection();
    const payload = await callDropshipApi('aliexpress.ds.member.benefit.get', {}, accessToken);
    const response = unwrap(payload);
    const result = response.result || response.resp_result?.result;
    if (response.error_response || !Array.isArray(result)) {
      return res.status(502).json({
        success: false,
        code: 'ALIEXPRESS_BENEFIT_RESPONSE_INCOMPLETE',
        message: 'AliExpress did not return a recognizable member-benefit list.',
      });
    }

    const benefits = result.map((item) => ({
      code: String(item?.code || ''),
      title: String(item?.title || ''),
      canApply: String(item?.canApply ?? '').toLowerCase() === 'true',
      canBenefit: String(item?.canBenefit ?? '').toLowerCase() === 'true',
    })).filter((item) => item.code || item.title);

    return res.json({
      success: true,
      readOnly: true,
      paymentExecutionEnabled: false,
      supplierAutoPaymentEnabled: false,
      benefits,
      checkedAt: new Date().toISOString(),
      message: 'Member benefits retrieved. This endpoint does not process payments or place supplier orders.',
    });
  } catch (error) {
    return res.status(error.status || 502).json({
      success: false,
      code: error.code || 'ALIEXPRESS_BENEFIT_LOOKUP_FAILED',
      message: error.message || 'Unable to query AliExpress member benefits.',
      ...(error.aliexpressCode ? { aliexpressCode: error.aliexpressCode } : {}),
    });
  }
});

module.exports = router;
