const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const AliExpressConnection = require('../models/AliExpressConnection');
const AliExpressOAuthState = require('../models/AliExpressOAuthState');
const AliExpressCatalogProduct = require('../models/AliExpressCatalogProduct');
const {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
  encryptSecret,
  decryptSecret,
  fetchRecommendedFeed,
} = require('../services/aliexpressService');

const router = express.Router();

const getAuthorizedConnection = async () => {
  const connection = await AliExpressConnection.findOne({ provider: 'aliexpress' })
    .select('+accessTokenEncrypted +refreshTokenEncrypted');
  if (!connection || connection.status !== 'connected' || !connection.accessTokenEncrypted) {
    const error = new Error('Connect the AliExpress account before synchronising supplier products.');
    error.status = 409;
    throw error;
  }

  let accessToken = decryptSecret(connection.accessTokenEncrypted);
  const expiresSoon = connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt.getTime() <= Date.now() + 5 * 60 * 1000;

  if (expiresSoon) {
    if (!connection.refreshTokenEncrypted) {
      const error = new Error('The AliExpress access token has expired. Re-authorize the account.');
      error.status = 409;
      throw error;
    }
    const refreshToken = decryptSecret(connection.refreshTokenEncrypted);
    const refreshed = await refreshAccessToken(refreshToken);
    accessToken = refreshed.access_token;
    connection.accessTokenEncrypted = encryptSecret(refreshed.access_token);
    if (refreshed.refresh_token) connection.refreshTokenEncrypted = encryptSecret(refreshed.refresh_token);
    if (refreshed.expires_in) connection.accessTokenExpiresAt = new Date(Date.now() + Number(refreshed.expires_in) * 1000);
    if (refreshed.refresh_expires_in) connection.refreshTokenExpiresAt = new Date(Date.now() + Number(refreshed.refresh_expires_in) * 1000);
    await connection.save();
  }

  return { connection, accessToken };
};

const numericValue = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const safeAliExpressUrl = (value, allowedDomains) => {
  try {
    const url = new URL(String(value || '').trim());
    const hostname = url.hostname.toLowerCase();
    const allowed = url.protocol === 'https:' && allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
    return allowed ? url.toString().slice(0, 2000) : '';
  } catch {
    return '';
  }
};

const normalizeFeedProduct = (item) => {
  const providerProductId = String(item?.product_id || '').trim();
  const title = String(item?.product_title || '').trim().slice(0, 500);
  if (!providerProductId || !title) return null;
  const imageUrls = [
    item.product_main_image_url,
    ...(Array.isArray(item.product_small_image_urls) ? item.product_small_image_urls : []),
  ].map((value) => safeAliExpressUrl(value, ['alicdn.com', 'aliexpress.com', 'aliexpress-media.com'])).filter(Boolean).slice(0, 12);
  return {
    providerProductId,
    title,
    productUrl: safeAliExpressUrl(item.product_detail_url, ['aliexpress.com']),
    imageUrl: imageUrls[0] || '',
    imageUrls,
    supplierPrice: numericValue(item.sale_price || item.original_price),
    supplierCurrency: String(item.sale_price_currency || item.original_price_currency || 'USD').toUpperCase().slice(0, 3),
    targetSalePrice: numericValue(item.target_sale_price),
    targetCurrency: String(item.target_sale_price_currency || 'USD').toUpperCase().slice(0, 3),
    originalPrice: numericValue(item.original_price),
    discount: String(item.discount || '').slice(0, 40),
    categoryId: String(item.second_level_category_id || item.first_level_category_id || '').slice(0, 80),
    categoryName: String(item.second_level_category_name || item.first_level_category_name || '').slice(0, 200),
    sellerId: String(item.seller_id || '').slice(0, 100),
    latestVolume: numericValue(item.lastest_volume),
    shippingDays: numericValue(item.ship_to_days),
    sourcePayload: item,
    syncedAt: new Date(),
  };
};

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
    const stateRecord = await AliExpressOAuthState.findOne({ stateHash, expiresAt: { $gt: new Date() } });
    if (!stateRecord) return res.status(400).send('This AliExpress authorization session is invalid or expired. Return to Sylva Admin and try again.');
    await AliExpressOAuthState.deleteOne({ _id: stateRecord._id });

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
    return res.redirect(`${(process.env.FRONTEND_URL || 'https://www.sylvatechnologies.co.ke').replace(/\/$/, '')}/admin/aliexpress?connected=1`);
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
  try {
    return res.status(409).json({
      success: false,
      code: 'ALIEXPRESS_DS_AUTH_FLOW_NOT_VERIFIED',
      message: 'Supplier feed sync is intentionally disabled. This connection is Seller Center OAuth, while the legacy Dropshipping feed API requires a Dropshipper buyer-account session and Dropshipping Center enrollment. Confirm the AliExpress app type and active DS permissions before enabling a separate authorization flow.',
    });
    const feedName = String(req.body?.feedName || 'DS bestseller').trim().slice(0, 100);
    const country = String(req.body?.country || 'KE').trim().toUpperCase();
    const targetCurrency = String(req.body?.targetCurrency || 'USD').trim().toUpperCase();
    const targetLanguage = String(req.body?.targetLanguage || 'EN').trim().toUpperCase();
    const pageSize = Math.max(1, Math.min(50, Number.parseInt(req.body?.pageSize, 10) || 20));
    const pageNo = Math.max(1, Math.min(1000, Number.parseInt(req.body?.pageNo, 10) || 1));
    const sort = String(req.body?.sort || 'volumeDesc').trim();

    if (!feedName || !/^[A-Z]{2}$/.test(country)) {
      return res.status(400).json({ success: false, message: 'Enter a feed name and a two-letter ship-to country code.' });
    }
    const currencies = new Set(['USD', 'GBP', 'CAD', 'EUR', 'UAH', 'MXN', 'TRY', 'RUB', 'BRL', 'AUD', 'INR', 'JPY', 'IDR', 'SEK', 'KRW']);
    if (!currencies.has(targetCurrency)) return res.status(400).json({ success: false, message: 'Choose a currency supported by the AliExpress Dropshipping feed API.' });
    if (!['EN', 'RU', 'PT', 'ES', 'FR', 'ID', 'IT', 'TH', 'JA', 'AR', 'VI', 'TR', 'DE', 'HE', 'KO', 'NL', 'PL', 'MX', 'CL', 'IN'].includes(targetLanguage)) {
      return res.status(400).json({ success: false, message: 'Choose a supported AliExpress catalogue language.' });
    }
    if (!['priceAsc', 'priceDesc', 'volumeAsc', 'volumeDesc', 'discountAsc', 'discountDesc', 'DSRratingAsc', 'DSRratingDesc'].includes(sort)) {
      return res.status(400).json({ success: false, message: 'Choose a supported supplier sorting method.' });
    }

    const { connection, accessToken } = await getAuthorizedConnection();
    const values = { country, target_currency: targetCurrency, target_language: targetLanguage, page_size: pageSize, page_no: pageNo, sort, feed_name: feedName };
    if (req.body?.categoryId) values.category_id = String(req.body.categoryId).trim().slice(0, 80);

    const response = await fetchRecommendedFeed(values, accessToken);
    const normalized = response.products.map(normalizeFeedProduct).filter(Boolean);
    if (!normalized.length) {
      return res.json({ success: true, message: 'AliExpress returned no products for this feed and page.', syncedCount: 0, products: [] });
    }

    await AliExpressCatalogProduct.bulkWrite(normalized.map((product) => ({
      updateOne: {
        filter: { providerProductId: product.providerProductId },
        update: { $set: product, $setOnInsert: { status: 'pending' } },
        upsert: true,
      },
    })), { ordered: false });

    connection.lastError = '';
    await connection.save();
    const products = await AliExpressCatalogProduct.find({ providerProductId: { $in: normalized.map((item) => item.providerProductId) } })
      .sort({ syncedAt: -1 }).lean();

    return res.json({
      success: true,
      message: 'AliExpress supplier feed synchronised into the review catalogue. Products are not published to the Sylva storefront.',
      syncedCount: normalized.length,
      products,
      feed: { feedName, country, targetCurrency, targetLanguage, pageNo, pageSize },
    });
  } catch (error) {
    console.error('AliExpress catalogue sync failed:', error.code || '', error.message);
    const status = error.status === 409 ? 409 : error.code === 'ALIEXPRESS_NOT_CONFIGURED' ? 503 : 502;
    return res.status(status).json({
      success: false,
      code: error.code || 'ALIEXPRESS_CATALOG_SYNC_FAILED',
      message: error.message || 'AliExpress product synchronisation failed. Verify the Dropshipping API permission group and account eligibility.',
    });
  }
});

module.exports = router;
