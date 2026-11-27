const express = require('express');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const User = require('../models/User');
const MetaPageConnection = require('../models/MetaPageConnection');
const {
  REQUIRED_PERMISSIONS,
  getMetaConfig,
  createOAuthStateSecret,
  buildAuthorizationUrl,
  encryptPageToken,
  exchangeCodeForUserToken,
  getGrantedPermissions,
  getManagedPages,
  chooseSylvaPage,
} = require('../services/metaFacebookService');

const router = express.Router();
const oauthLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });

function frontendResult(result) {
  const base = String(process.env.FRONTEND_URL || 'https://www.sylvatechnologies.co.ke').replace(/\/+$/, '');
  const url = new URL('/admin/marketing-studio', base);
  url.searchParams.set('facebook', result);
  return url.toString();
}

router.get('/status', protect, adminOnly, async (req, res) => {
  try {
    const connection = await MetaPageConnection.findOne({ key: 'sylva-facebook-page' })
      .select('pageId pageName connectedAt lastVerifiedAt grantedPermissions').lean();
    res.set('Cache-Control', 'no-store, private');
    res.json({
      success: true,
      connected: Boolean(connection),
      page: connection ? {
        id: connection.pageId,
        name: connection.pageName,
        connectedAt: connection.connectedAt,
        lastVerifiedAt: connection.lastVerifiedAt,
        permissions: connection.grantedPermissions,
      } : null,
    });
  } catch (error) {
    console.error('Meta Facebook status lookup failed:', error.message);
    res.status(500).json({ success: false, message: 'Unable to check Facebook connection status.' });
  }
});

router.post('/connect-url', protect, adminOnly, oauthLimiter, async (req, res) => {
  try {
    const config = getMetaConfig();
    const state = jwt.sign({
      sub: String(req.user._id),
      nonce: crypto.randomBytes(24).toString('hex'),
      purpose: 'sylva-meta-facebook-connect',
    }, createOAuthStateSecret(), {
      expiresIn: '10m',
      issuer: 'sylva-technologies',
      audience: 'meta-facebook-oauth',
    });
    const authorizationUrl = buildAuthorizationUrl(state);
    res.set('Cache-Control', 'no-store, private');
    res.json({ success: true, authorizationUrl, redirectUri: config.redirectUri, permissions: REQUIRED_PERMISSIONS });
  } catch (error) {
    res.status(503).json({ success: false, message: error.message || 'Facebook connection is not configured.' });
  }
});

router.get('/callback', oauthLimiter, async (req, res) => {
  try {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    if (req.query.error || !code || !state) return res.redirect(frontendResult('cancelled'));

    let statePayload;
    try {
      statePayload = jwt.verify(state, createOAuthStateSecret(), {
        issuer: 'sylva-technologies',
        audience: 'meta-facebook-oauth',
      });
    } catch {
      return res.redirect(frontendResult('invalid_state'));
    }
    if (statePayload.purpose !== 'sylva-meta-facebook-connect' || !statePayload.sub) {
      return res.redirect(frontendResult('invalid_state'));
    }

    const admin = await User.findOne({ _id: statePayload.sub, role: 'admin', accountDeleted: { $ne: true } }).select('_id').lean();
    if (!admin) return res.redirect(frontendResult('admin_required'));

    const userToken = await exchangeCodeForUserToken(code);
    const granted = await getGrantedPermissions(userToken);
    const missing = REQUIRED_PERMISSIONS.filter((permission) => !granted.has(permission));
    if (missing.length) {
      const error = new Error('Meta did not grant all required Page publishing permissions. Reconnect and approve the requested permissions.');
      error.code = 'META_PERMISSIONS_MISSING';
      throw error;
    }
    const pages = await getManagedPages(userToken);
    const page = chooseSylvaPage(pages);
    const encrypted = encryptPageToken(page.access_token);
    const connection = await MetaPageConnection.findOneAndUpdate(
      { key: 'sylva-facebook-page' },
      {
        $set: {
          key: 'sylva-facebook-page',
          pageId: String(page.id),
          pageName: String(page.name),
          ...encrypted,
          grantedPermissions: REQUIRED_PERMISSIONS,
          connectedBy: admin._id,
          connectedAt: new Date(),
          lastVerifiedAt: new Date(),
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).select('pageId pageName');
    if (!connection) throw new Error('Facebook Page connection could not be saved.');
    return res.redirect(frontendResult('connected'));
  } catch (error) {
    console.error('Meta Facebook OAuth callback failed:', error.code || error.message);
    const known = new Set([
      'META_CONFIGURATION_MISSING', 'META_CONFIGURATION_INVALID', 'META_ENCRYPTION_KEY_MISSING',
      'META_PAGE_AMBIGUOUS', 'META_PAGE_NOT_FOUND', 'META_PAGE_TASK_MISSING', 'META_PAGE_TOKEN_MISSING', 'META_PERMISSIONS_MISSING',
    ]);
    return res.redirect(frontendResult(known.has(error.code) ? error.code.toLowerCase() : 'connection_failed'));
  }
});

router.post('/disconnect', protect, adminOnly, async (req, res) => {
  try {
    await MetaPageConnection.deleteOne({ key: 'sylva-facebook-page' });
    res.set('Cache-Control', 'no-store, private');
    res.json({
      success: true,
      message: 'The Facebook Page token stored by Sylva has been deleted. You can also remove Sylva from Facebook Business Integrations to revoke its access at Meta.',
      revokeUrl: 'https://www.facebook.com/settings?tab=business_tools',
    });
  } catch (error) {
    console.error('Meta Facebook disconnect failed:', error.message);
    res.status(500).json({ success: false, message: 'Unable to disconnect Facebook.' });
  }
});

module.exports = router;
