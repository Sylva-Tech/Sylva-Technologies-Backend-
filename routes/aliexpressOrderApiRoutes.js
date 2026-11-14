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
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many AliExpress order queries. Try again later.' },
});

const isBuyerPlatform = (value) => ['buyerapp', 'buyer_app', 'buyer'].includes(String(value || '').toLowerCase());

const getBuyerConnection = async () => {
  requiredDropshipEnv();
  const connection = await AliExpressConnection.findOne({ provider: 'aliexpress' })
    .select('+accessTokenEncrypted +refreshTokenEncrypted');
  if (!connection || connection.status !== 'connected' || !isBuyerPlatform(connection.accountPlatform)) {
    const error = new Error('Connect the existing AliExpress Dropshipping buyerApp account before querying supplier orders.');
    error.status = 409;
    error.code = 'ALIEXPRESS_BUYERAPP_REQUIRED';
    throw error;
  }
  const expiry = connection.accessTokenExpiresAt ? new Date(connection.accessTokenExpiresAt).getTime() : 0;
  if (connection.accessTokenEncrypted && expiry > Date.now() + 60000) {
    return { connection, accessToken: decryptSecret(connection.accessTokenEncrypted) };
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
  connection.accessTokenExpiresAt = token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000) : null;
  if (token.refresh_expires_in) connection.refreshTokenExpiresAt = new Date(Date.now() + Number(token.refresh_expires_in) * 1000);
  await connection.save();
  return { connection, accessToken: token.access_token };
};

const validOrderId = (value) => /^\d{1,30}$/.test(String(value || '').trim());
const unwrap = (payload, method) => payload?.[method.split('.').join('_') + '_response'] || payload || {};

router.use(protect, adminOnly, limiter);
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Read-only AliExpress order status and item/amount details.
router.get('/:orderId', async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    if (!validOrderId(orderId)) return res.status(400).json({ success: false, code: 'ALIEXPRESS_ORDER_ID_INVALID', message: 'A numeric AliExpress order ID is required.' });
    const { accessToken } = await getBuyerConnection();
    const payload = await callDropshipApi('aliexpress.trade.ds.order.get', {
      single_order_query: JSON.stringify({ order_id: orderId }),
    }, accessToken);
    const response = unwrap(payload, 'aliexpress.trade.ds.order.get');
    const result = response.result || response;
    if (response.error_response || !result || (!result.order_status && !result.logistics_status && !result.child_order_list)) {
      return res.status(502).json({ success: false, code: 'ALIEXPRESS_ORDER_RESPONSE_INCOMPLETE', message: 'AliExpress did not return a recognizable order record.' });
    }
    return res.json({ success: true, order: result });
  } catch (error) {
    return res.status(error.status || 502).json({
      success: false,
      code: error.code || 'ALIEXPRESS_ORDER_QUERY_FAILED',
      message: error.message || 'Unable to query the AliExpress order.',
      ...(error.aliexpressCode ? { aliexpressCode: error.aliexpressCode } : {}),
    });
  }
});

// Read-only tracking history. This is not customer delivery confirmation.
router.get('/:orderId/tracking', async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    const language = String(req.query.language || 'en_US').trim();
    if (!validOrderId(orderId)) return res.status(400).json({ success: false, code: 'ALIEXPRESS_ORDER_ID_INVALID', message: 'A numeric AliExpress order ID is required.' });
    if (!/^[a-z]{2}_[A-Z]{2}$/.test(language)) return res.status(400).json({ success: false, code: 'ALIEXPRESS_LANGUAGE_INVALID', message: 'Language must use a locale such as en_US.' });
    const { accessToken } = await getBuyerConnection();
    const payload = await callDropshipApi('aliexpress.ds.order.tracking.get', {
      ae_order_id: orderId,
      language,
    }, accessToken);
    const response = unwrap(payload, 'aliexpress.ds.order.tracking.get');
    const result = response.result || response;
    if (response.error_response || result.ret === false) {
      const error = new Error(String(result.msg || 'AliExpress tracking lookup failed.'));
      error.code = 'ALIEXPRESS_TRACKING_LOOKUP_FAILED';
      error.aliexpressCode = String(result.code || '');
      throw error;
    }
    return res.json({ success: true, tracking: result.data || result });
  } catch (error) {
    return res.status(error.status || 502).json({
      success: false,
      code: error.code || 'ALIEXPRESS_TRACKING_QUERY_FAILED',
      message: error.message || 'Unable to query AliExpress tracking.',
      ...(error.aliexpressCode ? { aliexpressCode: error.aliexpressCode } : {}),
    });
  }
});

module.exports = router;
