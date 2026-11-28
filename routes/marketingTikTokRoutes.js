const express = require('express');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const User = require('../models/User');
const TikTokConnection = require('../models/TikTokConnection');
const {
  getConfig,
  stateSecret,
  buildAuthorizationUrl,
  encryptTokens,
  exchangeCode,
  getUserProfile,
  refreshTokens,
} = require('../services/tiktokMarketingService');

const router = express.Router();
const oauthLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });

function frontendResult(result) {
  const base = String(process.env.FRONTEND_URL || 'https://www.sylvatechnologies.co.ke').replace(/\/+$/, '');
  const url = new URL('/admin/marketing-studio', base);
  url.searchParams.set('tiktok', result);
  return url.toString();
}

// Public OAuth callback: the signed, short-lived state identifies the admin who initiated it.
router.get('/callback', oauthLimiter, async (req, res) => {
  try {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    if (req.query.error || !code || !state) return res.redirect(frontendResult('cancelled'));

    let payload;
    try {
      payload = jwt.verify(state, stateSecret(), {
        issuer: 'sylva-technologies',
        audience: 'tiktok-marketing-oauth',
      });
    } catch {
      return res.redirect(frontendResult('invalid_state'));
    }
    if (payload.purpose !== 'sylva-tiktok-connect' || !payload.sub) {
      return res.redirect(frontendResult('invalid_state'));
    }
    const admin = await User.findOne({ _id: payload.sub, role: 'admin', accountDeleted: false }).select('_id').lean();
    if (!admin) return res.redirect(frontendResult('admin_required'));

    const tokens = await exchangeCode(code);
    const profile = await getUserProfile(tokens.access_token);
    if (String(profile.open_id) !== String(tokens.open_id)) {
      return res.redirect(frontendResult('profile_mismatch'));
    }
    const encrypted = encryptTokens(tokens);
    const scopes = String(tokens.scope || '').split(',').map((scope) => scope.trim()).filter(Boolean);
    await TikTokConnection.findOneAndUpdate(
      { key: 'sylva-tiktok-account' },
      {
        $set: {
          key: 'sylva-tiktok-account',
          openId: String(tokens.open_id),
          displayName: String(profile.display_name || 'TikTok creator').slice(0, 200),
          avatarUrl: String(profile.avatar_url || '').slice(0, 1000),
          grantedScopes: scopes,
          accessTokenCiphertext: encrypted.accessToken.Ciphertext,
          accessTokenIv: encrypted.accessToken.Iv,
          accessTokenAuthTag: encrypted.accessToken.AuthTag,
          refreshTokenCiphertext: encrypted.refreshToken.Ciphertext,
          refreshTokenIv: encrypted.refreshToken.Iv,
          refreshTokenAuthTag: encrypted.refreshToken.AuthTag,
          accessTokenExpiresAt: new Date(Date.now() + Math.max(0, Number(tokens.expires_in) || 0) * 1000),
          refreshTokenExpiresAt: new Date(Date.now() + Math.max(0, Number(tokens.refresh_expires_in) || 0) * 1000),
          connectedBy: admin._id,
          connectedAt: new Date(),
          lastRefreshedAt: null,
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    return res.redirect(frontendResult('connected'));
  } catch (error) {
    console.error('TikTok OAuth callback failed:', error.code || error.message);
    return res.redirect(frontendResult('connection_failed'));
  }
});

router.use(protect, adminOnly);

router.get('/connect-url', oauthLimiter, async (req, res) => {
  try {
    getConfig();
    const state = jwt.sign({
      sub: String(req.user._id),
      nonce: crypto.randomBytes(24).toString('hex'),
      purpose: 'sylva-tiktok-connect',
    }, stateSecret(), {
      expiresIn: '10m',
      issuer: 'sylva-technologies',
      audience: 'tiktok-marketing-oauth',
    });
    res.set('Cache-Control', 'no-store, private');
    res.json({ success: true, authorizationUrl: buildAuthorizationUrl(state) });
  } catch (error) {
    res.status(503).json({ success: false, code: error.code || 'TIKTOK_CONFIGURATION_MISSING', message: error.message || 'TikTok connection is not configured.' });
  }
});

router.get('/status', async (req, res) => {
  try {
    let connection = await TikTokConnection.findOne({ key: 'sylva-tiktok-account' })
      .select('+accessTokenCiphertext +accessTokenIv +accessTokenAuthTag +refreshTokenCiphertext +refreshTokenIv +refreshTokenAuthTag');
    if (connection && connection.accessTokenExpiresAt <= new Date(Date.now() + 5 * 60 * 1000) &&
        connection.refreshTokenExpiresAt > new Date()) {
      try {
        const refreshed = await refreshTokens(connection);
        const encrypted = encryptTokens(refreshed);
        connection.accessTokenCiphertext = encrypted.accessToken.Ciphertext;
        connection.accessTokenIv = encrypted.accessToken.Iv;
        connection.accessTokenAuthTag = encrypted.accessToken.AuthTag;
        connection.refreshTokenCiphertext = encrypted.refreshToken.Ciphertext;
        connection.refreshTokenIv = encrypted.refreshToken.Iv;
        connection.refreshTokenAuthTag = encrypted.refreshToken.AuthTag;
        connection.accessTokenExpiresAt = new Date(Date.now() + Math.max(0, Number(refreshed.expires_in) || 0) * 1000);
        connection.refreshTokenExpiresAt = new Date(Date.now() + Math.max(0, Number(refreshed.refresh_expires_in) || 0) * 1000);
        connection.lastRefreshedAt = new Date();
        if (refreshed.scope) connection.grantedScopes = String(refreshed.scope).split(',').map((scope) => scope.trim()).filter(Boolean);
        await connection.save();
      } catch (refreshError) {
        console.warn('TikTok access-token refresh failed:', refreshError.code || refreshError.message);
      }
    }
    const connected = Boolean(connection);
    const publishScopeGranted = Boolean(connection?.grantedScopes?.includes('video.publish'));
    const accessTokenValid = Boolean(connection?.accessTokenExpiresAt && new Date(connection.accessTokenExpiresAt) > new Date());
    res.set('Cache-Control', 'no-store, private');
    res.json({
      success: true,
      connected,
      account: connected ? {
        displayName: connection.displayName,
        avatarUrl: connection.avatarUrl,
        connectedAt: connection.connectedAt,
        accessTokenExpiresAt: connection.accessTokenExpiresAt,
        refreshTokenExpiresAt: connection.refreshTokenExpiresAt,
      } : null,
      capabilities: {
        videoPublishScopeGranted: publishScopeGranted,
        accessTokenValid,
        directPublishingEnabled: false,
        reason: 'TikTok Content Posting API direct publishing remains disabled until creator consent, upload/status workflows and TikTok app audit are completed.',
      },
    });
  } catch (error) {
    console.error('TikTok status lookup failed:', error.message);
    res.status(500).json({ success: false, message: 'Unable to check TikTok connection status.' });
  }
});

router.post('/disconnect', async (req, res) => {
  try {
    await TikTokConnection.deleteOne({ key: 'sylva-tiktok-account' });
    res.set('Cache-Control', 'no-store, private');
    res.json({ success: true, message: 'The stored TikTok account connection and encrypted tokens have been deleted from Sylva.' });
  } catch (error) {
    console.error('TikTok disconnect failed:', error.message);
    res.status(500).json({ success: false, message: 'Unable to disconnect TikTok.' });
  }
});

module.exports = router;
