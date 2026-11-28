const express = require('express');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const User = require('../models/User');
const MetaPageConnection = require('../models/MetaPageConnection');
const MarketingCampaign = require('../models/MarketingCampaign');
const MetaDataDeletionRequest = require('../models/MetaDataDeletionRequest');
const {
  REQUIRED_PERMISSIONS,
  getMetaConfig,
  createOAuthStateSecret,
  buildAuthorizationUrl,
  encryptPageToken,
  exchangeCodeForUserToken,
  getMetaUserIdentity,
  verifyMetaSignedRequest,
  getGrantedPermissions,
  getManagedPages,
  chooseSylvaPage,
  deleteScheduledPagePost,
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

    const admin = await User.findOne({ _id: statePayload.sub, role: 'admin', accountDeleted: false }).select('_id').lean();
    if (!admin) return res.redirect(frontendResult('admin_required'));

    const userToken = await exchangeCodeForUserToken(code);
    const metaUser = await getMetaUserIdentity(userToken);
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
          metaUserId: metaUser.id,
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

router.post('/data-deletion', oauthLimiter, async (req, res) => {
  try {
    const payload = verifyMetaSignedRequest(req.body?.signed_request);
    const metaUserId = String(payload.user_id);
    const connection = await MetaPageConnection.findOne({ metaUserId })
      .select('+pageTokenCiphertext +pageTokenIv +pageTokenAuthTag');

    if (connection) {
      const pending = await MarketingCampaign.find({
        status: 'scheduled',
        facebookScheduled: true,
      });
      for (const campaign of pending) {
        const result = campaign.publishingResults.find((item) =>
          item.platform === 'facebook' && item.status === 'pending' && item.externalId
        );
        if (result) {
          try {
            await deleteScheduledPagePost(connection, result.externalId);
            result.status = 'skipped';
            result.message = 'Scheduled Facebook post cancelled following a Meta data deletion request.';
          } catch (error) {
            console.warn('Meta data deletion could not cancel a scheduled Page post:', error.code || error.metaCode || 'META_CANCEL_FAILED');
            result.status = 'failed';
            result.message = 'Meta data deletion was processed; verify this scheduled Page post directly in Meta Business Suite.';
          }
          campaign.status = 'cancelled';
          campaign.facebookScheduled = false;
          campaign.activity.push({
            action: 'meta_data_deletion',
            note: 'Facebook connection removed following a Meta data deletion request.',
            at: new Date(),
          });
          await campaign.save();
        }
      }
      await MetaPageConnection.deleteOne({ _id: connection._id });
    }

    const confirmationCode = crypto.randomBytes(24).toString('hex');
    await MetaDataDeletionRequest.create({
      confirmationCode,
      metaUserIdHash: crypto.createHmac('sha256', process.env.META_APP_SECRET).update(metaUserId).digest('hex'),
      status: 'completed',
      completedAt: new Date(),
    });
    const statusBase = String(
      process.env.META_DATA_DELETION_STATUS_URL ||
      'https://api.sylvatechnologies.co.ke/api/meta/facebook/data-deletion'
    ).replace(/\/+$/, '');
    res.set('Cache-Control', 'no-store');
    return res.json({
      url: statusBase + '/' + confirmationCode,
      confirmation_code: confirmationCode,
    });
  } catch (error) {
    console.error('Meta data deletion callback failed:', error.code || error.message);
    return res.status(error.code === 'META_SIGNED_REQUEST_INVALID' ? 400 : 500)
      .json({ success: false, message: 'Unable to verify or process this Meta data deletion request.' });
  }
});

router.get('/data-deletion/:confirmationCode', async (req, res) => {
  try {
    const code = String(req.params.confirmationCode || '');
    if (!/^[a-f0-9]{48}$/i.test(code)) return res.status(404).json({ success: false, message: 'Deletion request not found.' });
    const record = await MetaDataDeletionRequest.findOne({ confirmationCode: code })
      .select('confirmationCode status completedAt').lean();
    if (!record) return res.status(404).json({ success: false, message: 'Deletion request not found.' });
    res.set('Cache-Control', 'no-store');
    return res.json({
      confirmation_code: record.confirmationCode,
      status: record.status,
      completed_at: record.completedAt,
      message: 'The Sylva Facebook connection data associated with this request has been deleted from Sylva systems.',
    });
  } catch (error) {
    console.error('Meta data deletion status lookup failed:', error.message);
    res.status(500).json({ success: false, message: 'Unable to check deletion request status.' });
  }
});

router.post('/disconnect', protect, adminOnly, async (req, res) => {
  try {
    const connection = await MetaPageConnection.findOne({ key: 'sylva-facebook-page' })
      .select('+pageTokenCiphertext +pageTokenIv +pageTokenAuthTag');
    if (connection) {
      const pending = await MarketingCampaign.find({
        status: 'scheduled',
        facebookScheduled: true,
      });
      for (const campaign of pending) {
        const result = campaign.publishingResults.find((item) =>
          item.platform === 'facebook' && item.status === 'pending' && item.externalId
        );
        if (!result) continue;
        try {
          await deleteScheduledPagePost(connection, result.externalId);
        } catch (error) {
          console.error('Facebook disconnect could not cancel a scheduled post:', error.code || error.metaCode || 'META_CANCEL_FAILED');
          return res.status(409).json({
            success: false,
            message: 'Facebook could not confirm cancellation of every scheduled post. The connection was kept active; review the scheduled posts and cancel them before disconnecting.',
          });
        }
        result.status = 'skipped';
        result.message = 'Scheduled Facebook post cancelled during Page disconnect.';
        campaign.status = 'cancelled';
        campaign.facebookScheduled = false;
        campaign.activity.push({
          action: 'facebook_schedule_cancelled',
          note: 'The scheduled Facebook post was cancelled before disconnecting the Page.',
          actor: req.user._id,
          at: new Date(),
        });
        await campaign.save();
      }
    }
    await MetaPageConnection.deleteOne({ key: 'sylva-facebook-page' });
    res.set('Cache-Control', 'no-store, private');
    res.json({
      success: true,
      message: 'The Sylva Facebook Page connection and locally stored Page token have been deleted. Remove Sylva from Facebook Business Integrations as well if you want to revoke the app permission at Meta.',
      revokeUrl: 'https://www.facebook.com/settings?tab=business_tools',
    });
  } catch (error) {
    console.error('Meta Facebook disconnect failed:', error.code || error.message);
    res.status(500).json({ success: false, message: 'Unable to disconnect Facebook.' });
  }
});

module.exports = router;
