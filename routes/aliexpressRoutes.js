const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const AliExpressConnection = require('../models/AliExpressConnection');
const AliExpressOAuthState = require('../models/AliExpressOAuthState');
const { isAliExpressOAuthStateValid } = require('../services/aliexpressOAuthState');
const AliExpressCatalogProduct = require('../models/AliExpressCatalogProduct');
const {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
  encryptSecret,
} = require('../services/aliexpressService');

const router = express.Router();

const connectLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many AliExpress connection attempts. Try again later.' },
});

router.get('/status', protect, adminOnly, async (req, res) => {
  try {
    const connection = await AliExpressConnection.findOne({ provider: 'aliexpress' }).lean();
    const configured = Boolean(process.env.ALIEXPRESS_APP_KEY && process.env.ALIEXPRESS_APP_SECRET && process.env.ALIEXPRESS_REDIRECT_URI && /^[a-f0-9]{64}$/i.test(process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY || ''));
    return res.json({
      success: true,
      data: {
        configured,
        connected: connection?.status === 'connected',
        status: connection?.status || 'disconnected',
        sellerId: connection?.sellerId || '',
        account: connection?.account || '',
        accountPlatform: connection?.accountPlatform || '',
        lastConnectedAt: connection?.lastConnectedAt || null,
        accessTokenExpiresAt: connection?.accessTokenExpiresAt || null,
        lastError: connection?.lastError || '',
        supplierOrderingEnabled: false,
        catalogSyncEnabled: false,
        catalogSyncReason: 'The saved connection uses Seller Center OAuth. The legacy Dropshipping feed API requires a Dropshipper buyer-account session and Dropshipping Center enrollment. Live sync stays disabled until the app type and correct authorization flow are verified.',
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to load AliExpress connection status.' });
  }
});

router.post('/connect', protect, adminOnly, connectLimiter, async (req, res) => {
  try {
    const state = crypto.randomBytes(32).toString('hex');
    await AliExpressOAuthState.deleteMany({ createdBy: req.user._id });
    await AliExpressOAuthState.create({
      stateHash: crypto.createHash('sha256').update(state).digest('hex'),
      createdBy: req.user._id,
      expiresAt: new Date(Date.now() + 20 * 60 * 1000),
    });
    return res.json({ success: true, authorizationUrl: buildAuthorizationUrl(state) });
  } catch (error) {
    const status = error.code === 'ALIEXPRESS_NOT_CONFIGURED' ? 503 : 500;
    return res.status(status).json({ success: false, message: error.message || 'Unable to start AliExpress authorization.' });
  }
});

// AliExpress redirects to the exact callback URL registered in the developer console.
router.get('/callback', async (req, res) => {
  const code = String(req.query.code || '').trim();
  const state = String(req.query.state || '').trim();
  const returnedError = String(req.query.error || '').trim();
  if (returnedError) return res.status(400).send('AliExpress authorization was not completed. You may close this window.');
  if (!code || !state) return res.status(400).send('Missing AliExpress authorization code or state.');

  try {
    const stateHash = crypto.createHash('sha256').update(state).digest('hex');
    // Atomically consume the state so concurrent/replayed callbacks cannot both
    // exchange the same authorization code. Validate Date values in JS rather
    // than passing a MongoDB operator object through Mongoose Date casting.
    const stateRecord = await AliExpressOAuthState.findOneAndDelete({ stateHash });
    if (!stateRecord || !isAliExpressOAuthStateValid(stateRecord.expiresAt)) {
      return res.status(400).send('This AliExpress authorization session is invalid or expired. Return to Sylva Admin and try again.');
    }

    const token = await exchangeAuthorizationCode(code);
    await AliExpressConnection.findOneAndUpdate(
      { provider: 'aliexpress' },
      {
        $set: {
          status: 'connected',
          sellerId: String(token.seller_id || token.user_id || ''),
          account: String(token.account || ''),
          accountPlatform: String(token.account_platform || ''),
          accessTokenEncrypted: encryptSecret(token.access_token),
          refreshTokenEncrypted: encryptSecret(token.refresh_token),
          accessTokenExpiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000) : null,
          refreshTokenExpiresAt: token.refresh_expires_in ? new Date(Date.now() + Number(token.refresh_expires_in) * 1000) : null,
          lastConnectedAt: new Date(),
          lastError: '',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const frontendBase = new URL(process.env.FRONTEND_URL || 'https://www.sylvatechnologies.co.ke');
    // The apex and www hosts have separate browser localStorage. Always return
    // the OAuth flow to the canonical storefront origin that holds the admin JWT.
    if (frontendBase.hostname.toLowerCase() === 'sylvatechnologies.co.ke') {
      frontendBase.hostname = 'www.sylvatechnologies.co.ke';
    }
    frontendBase.protocol = 'https:';
    frontendBase.pathname = `${frontendBase.pathname.replace(/\/$/, '')}/admin/aliexpress`;
    frontendBase.search = '?connected=1';
    frontendBase.hash = '';
    return res.redirect(frontendBase.toString());
  } catch (error) {
    console.error('AliExpress OAuth callback failed:', error.message);
    await AliExpressConnection.findOneAndUpdate(
      { provider: 'aliexpress' },
      { $set: { status: 'disconnected', lastError: 'Authorization could not be completed. Check AliExpress API permissions and server configuration.' } },
      { upsert: true, setDefaultsOnInsert: true },
    ).catch(() => {});
    return res.status(502).send('Sylva could not complete AliExpress authorization. Return to the admin dashboard and check the connection status.');
  }
});

router.post('/refresh', protect, adminOnly, connectLimiter, async (req, res) => {
  try {
    const connection = await AliExpressConnection.findOne({ provider: 'aliexpress' }).select('+refreshTokenEncrypted');
    if (!connection || connection.status !== 'connected' || !connection.refreshTokenEncrypted) {
      return res.status(409).json({ success: false, message: 'No active AliExpress refresh token is available. Re-authorize the account.' });
    }
    const { decryptSecret } = require('../services/aliexpressService');
    const token = await refreshAccessToken(decryptSecret(connection.refreshTokenEncrypted));
    connection.accessTokenEncrypted = encryptSecret(token.access_token);
    connection.refreshTokenEncrypted = encryptSecret(token.refresh_token || decryptSecret(connection.refreshTokenEncrypted));
    connection.accessTokenExpiresAt = token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000) : null;
    connection.refreshTokenExpiresAt = token.refresh_expires_in ? new Date(Date.now() + Number(token.refresh_expires_in) * 1000) : connection.refreshTokenExpiresAt;
    connection.lastError = '';
    await connection.save();
    return res.json({ success: true, message: 'AliExpress access token refreshed.', data: { accessTokenExpiresAt: connection.accessTokenExpiresAt } });
  } catch (error) {
    console.error('AliExpress token refresh failed:', error.message);
    return res.status(502).json({ success: false, message: 'Token refresh failed. Re-authorize the AliExpress account if the refresh token has expired.' });
  }
});

router.post('/disconnect', protect, adminOnly, async (req, res) => {
  try {
    await AliExpressConnection.findOneAndUpdate(
      { provider: 'aliexpress' },
      { $set: { status: 'disconnected', sellerId: '', account: '', accountPlatform: '', accessTokenEncrypted: '', refreshTokenEncrypted: '', accessTokenExpiresAt: null, refreshTokenExpiresAt: null } },
      { upsert: true, setDefaultsOnInsert: true },
    );
    return res.json({ success: true, message: 'AliExpress connection removed.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to disconnect AliExpress.' });
  }
});


router.get('/catalog/products', protect, adminOnly, async (req, res) => {
  try {
    const allowedStatuses = ['pending', 'imported', 'ignored'];
    const status = allowedStatuses.includes(String(req.query.status || '')) ? String(req.query.status) : null;
    const page = Math.max(1, Math.min(1000, Number.parseInt(req.query.page, 10) || 1));
    const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 30));
    const filter = status ? { status } : {};
    const [products, total] = await Promise.all([
      AliExpressCatalogProduct.find(filter).sort({ syncedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AliExpressCatalogProduct.countDocuments(filter),
    ]);
    return res.json({ success: true, products, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('AliExpress catalogue list failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load the supplier catalogue.' });
  }
});

router.post('/catalog/sync', protect, adminOnly, connectLimiter, async (req, res) => {
  return res.status(503).json({
    success: false,
    code: 'ALIEXPRESS_CATALOG_API_NOT_VERIFIED',
    message: 'This legacy Seller Center catalogue route is disabled. Use the dedicated buyerApp Supplier Centre route after the current IOP Protocol.TOP wire contract and App ID 40465 method entitlement are verified.',
  });
});

module.exports = router;
