const express = require('express');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const multer = require('multer');
const cloudinary = require('../config/cloudinary');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const MarketingCampaign = require('../models/MarketingCampaign');
const Product = require('../models/Product');
const MetaPageConnection = require('../models/MetaPageConnection');
const TikTokConnection = require('../models/TikTokConnection');
const { generateMarketingVideoScript } = require('../services/marketingVideoAI');
const { schedulePagePost, publishInstagramMedia, getPagePostStatus, deleteScheduledPagePost } = require('../services/metaFacebookService');

const router = express.Router();
const campaignLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many marketing studio requests. Please try again later.' },
});

const PLATFORMS = ['facebook', 'instagram', 'tiktok', 'whatsapp'];
const marketingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']);
    if (!allowed.has(file.mimetype)) return callback(new Error('Upload a JPG, PNG, WEBP, GIF, MP4, WEBM or MOV file.'));
    callback(null, true);
  },
});
const uploadMarketingAsset = (buffer, resourceType) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream({
    folder: 'sylva/marketing-studio', resource_type: resourceType, type: 'upload',
    use_filename: false, unique_filename: true,
  }, (error, result) => error ? reject(error) : resolve(result));
  stream.end(buffer);
});
const videoScriptLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false, message: { success: false, message: 'Too many video script requests. Please try again later.' } });
const safeText = (value, max = 5000) => String(value || '').trim().slice(0, max);
const activity = (action, note, actor) => ({ action, note: safeText(note, 500), actor, at: new Date() });

async function syncDueFacebookPosts() {
  const now = new Date();
  const connection = await MetaPageConnection.findOne({ key: 'sylva-facebook-page' })
    .select('+pageTokenCiphertext +pageTokenIv +pageTokenAuthTag');
  if (!connection) return;

  const due = await MarketingCampaign.find({
    status: 'scheduled',
    scheduledAt: mongoose.trusted({ $lte: now }),
  }).sort({ scheduledAt: 1 }).limit(50);

  for (const campaign of due) {
    const result = campaign.publishingResults.find((item) =>
      item.platform === 'facebook' && item.status === 'pending' && item.externalId
    );
    if (!result) continue;
    try {
      const remote = await getPagePostStatus(connection, result.externalId);
      if (remote?.is_published === true) {
        result.status = 'published';
        result.externalUrl = safeText(remote.permalink_url, 2000);
        result.publishedAt = new Date();
        result.message = 'Published on the official Sylva Technologies Facebook Page.';
        campaign.status = 'published';
        campaign.publishedAt = result.publishedAt;
        campaign.activity.push(activity('facebook_published', 'Facebook confirmed that the scheduled Page post is live.', null));
        await campaign.save();
      }
    } catch (error) {
      console.warn('Facebook scheduled post status check failed:', error.code || error.metaCode || 'META_STATUS_CHECK_FAILED');
    }
  }
}

router.use(protect, adminOnly, campaignLimiter);
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, private');
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
});

router.get('/overview', async (req, res) => {
  try {
    const [counts, upcoming, recent] = await Promise.all([
      MarketingCampaign.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      MarketingCampaign.find({ status: 'scheduled', scheduledAt: mongoose.trusted({ $gte: new Date() }) }).sort({ scheduledAt: 1 }).limit(5).lean(),
      MarketingCampaign.find({}).sort({ updatedAt: -1 }).limit(8).lean(),
    ]);
    const totals = Object.fromEntries(counts.map((item) => [item._id, item.count]));
    res.json({ success: true, data: { totals, upcoming, recent, timezone: 'Africa/Nairobi', publishingEnabled: false } });
  } catch (error) {
    console.error('Marketing Studio overview failed:', error.message);
    res.status(500).json({ success: false, message: 'Unable to load Marketing Studio overview.' });
  }
});

router.get('/channels', async (req, res) => {
  try {
    const [facebook, tiktok] = await Promise.all([
      MetaPageConnection.findOne({ key: 'sylva-facebook-page' }).select('pageId pageName updatedAt instagramBusinessAccountId instagramUsername grantedPermissions').lean(),
      TikTokConnection.findOne({ key: 'sylva-tiktok-account' }).select('displayName grantedScopes accessTokenExpiresAt refreshTokenExpiresAt').lean(),
    ]);
    const configured = (keys) => keys.every((key) => String(process.env[key] || '').trim().length > 0);
    const channels = {
      facebook: { status: facebook ? 'connected' : 'not_connected', accountName: facebook?.pageName || 'Sylva Technologies', detail: facebook ? 'Official Page connection is saved.' : 'Connect the existing Meta Page integration.' },
      instagram: { status: facebook?.instagramBusinessAccountId && facebook.grantedPermissions?.includes('instagram_basic') && facebook.grantedPermissions?.includes('instagram_content_publish') ? 'publishing_ready' : (facebook?.instagramBusinessAccountId ? 'account_linked' : (facebook ? 'permission_required' : 'not_connected')), accountName: facebook?.instagramUsername ? '@' + facebook.instagramUsername : '', detail: facebook?.instagramBusinessAccountId ? 'Instagram Professional account detected on the connected Sylva Page. Publishing and messaging still require approved Meta permissions.' : 'Connect or refresh the official Meta Page and grant optional Instagram permissions for account discovery.' },
      whatsapp: {
        status: configured(['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_VERIFY_TOKEN']) ? 'api_connected' : (String(process.env.WHATSAPP_NUMBER || '').trim() ? 'optional_contact' : 'optional'),
        accountName: String(process.env.WHATSAPP_NUMBER || '').trim() ? 'Existing Sylva order contact' : 'Optional channel',
        detail: configured(['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_VERIFY_TOKEN'])
          ? 'WhatsApp Cloud API is configured for the shared customer inbox.'
          : 'Optional: keep using the existing WhatsApp order contact. No second account or Marketing Studio connection is required.',
      },
      tiktok: { status: tiktok ? (tiktok.grantedScopes?.includes('video.publish') && tiktok.accessTokenExpiresAt > new Date() ? 'account_connected' : 'permission_or_token_check') : (configured(['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI', 'TIKTOK_TOKEN_ENCRYPTION_KEY']) ? 'ready_to_connect' : 'not_configured'), accountName: tiktok?.displayName || '', detail: tiktok ? 'TikTok account connected. Direct publishing remains disabled until the creator-consent workflow and app audit are completed.' : 'Connect Sylva TikTok using the registered Login Kit app. Direct publishing still requires Content Posting API approval and audit.' },
    };
    res.json({ success: true, channels, capabilities: { inboundMessaging: configured(['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_VERIFY_TOKEN']), automatedReplies: false, publishing: { facebook: Boolean(facebook), instagram: Boolean(facebook?.instagramBusinessAccountId && facebook.grantedPermissions?.includes('instagram_content_publish')), whatsapp: false, tiktok: false } } });
  } catch (error) {
    console.error('Marketing Studio channel status failed:', error.message);
    res.status(500).json({ success: false, message: 'Unable to load channel connection status.' });
  }
});

router.get('/products', async (req, res) => {
  try {
    const search = safeText(req.query.search, 80);
    const filter = { isActive: true, approvalStatus: 'approved', stock: mongoose.trusted({ $gt: 0 }) };
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ name: new RegExp(escaped, 'i') }, { sku: new RegExp(escaped, 'i') }, { brand: new RegExp(escaped, 'i') }];
    }
    const products = await Product.find(filter)
      .select('_id name sku brand price oldPrice stock images slug')
      .sort({ updatedAt: -1 }).limit(50).lean();
    res.json({ success: true, products });
  } catch (error) {
    console.error('Marketing Studio products failed:', error.message);
    res.status(500).json({ success: false, message: 'Unable to load eligible products.' });
  }
});

router.get('/campaigns', async (req, res) => {
  try {
    await syncDueFacebookPosts();
    const filter = {};
    const status = safeText(req.query.status, 40);
    if (status) filter.status = status;
    const campaigns = await MarketingCampaign.find(filter)
      .populate('product.productId', 'name sku price stock images slug isActive approvalStatus')
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .sort({ updatedAt: -1 }).limit(100).lean();
    res.json({ success: true, campaigns });
  } catch (error) {
    console.error('Marketing Studio campaigns failed:', error.message);
    res.status(500).json({ success: false, message: 'Unable to load campaigns.' });
  }
});

router.post('/campaigns', async (req, res) => {
  try {
    const name = safeText(req.body?.name, 120);
    const platforms = Array.isArray(req.body?.platforms) ? [...new Set(req.body.platforms.map((p) => String(p).toLowerCase()))] : [];
    if (!name) return res.status(400).json({ success: false, message: 'Campaign name is required.' });
    if (!platforms.length || platforms.some((p) => !PLATFORMS.includes(p))) {
      return res.status(400).json({ success: false, message: 'Choose at least one supported platform.' });
    }

    let productSnapshot = {};
    const productId = req.body?.productId;
    if (!productId) return res.status(400).json({ success: false, message: 'Select a catalogue product for this campaign.' });
    if (productId) {
      if (!mongoose.isValidObjectId(productId)) return res.status(400).json({ success: false, message: 'Invalid product selected.' });
      const product = await Product.findOne({ _id: productId, isActive: true, approvalStatus: 'approved', stock: mongoose.trusted({ $gt: 0 }) })
        .select('name sku price stock images slug').lean();
      if (!product) return res.status(422).json({ success: false, message: 'Select an active, approved product that is in stock.' });
      productSnapshot = {
        productId: product._id, name: product.name, sku: product.sku,
        price: product.price, stockAtDraft: product.stock,
        image: Array.isArray(product.images) ? product.images[0] || '' : '',
        productUrl: product.slug ? 'https://www.sylvatechnologies.co.ke/product/' + encodeURIComponent(product.slug) : 'https://www.sylvatechnologies.co.ke/shop',
      };
    }

    const content = {
      headline: safeText(req.body?.content?.headline, 180),
      body: safeText(req.body?.content?.body, 5000),
    };
    for (const platform of PLATFORMS) {
      const value = req.body?.content?.[platform] || {};
      content[platform] = {
        caption: safeText(value.caption, 5000),
        hashtags: Array.isArray(value.hashtags) ? value.hashtags.slice(0, 20).map((tag) => safeText(tag, 60)).filter(Boolean) : [],
        callToAction: safeText(value.callToAction, 180),
      };
    }

    const campaign = await MarketingCampaign.create({
      name,
      objective: ['product_awareness', 'sales', 'promotion', 'engagement'].includes(req.body?.objective) ? req.body.objective : 'sales',
      product: productSnapshot,
      platforms,
      content,
      status: 'draft',
      timezone: 'Africa/Nairobi',
      createdBy: req.user._id,
      activity: [activity('created', 'Campaign draft created.', req.user._id)],
    });
    res.status(201).json({ success: true, campaign });
  } catch (error) {
    console.error('Marketing Studio create failed:', error.message);
    res.status(500).json({ success: false, message: 'Unable to create campaign draft.' });
  }
});

router.patch('/campaigns/:id', async (req, res) => {
  try {
    const campaign = await MarketingCampaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });
    if (!['draft', 'rejected'].includes(campaign.status)) return res.status(409).json({ success: false, message: 'Only draft or rejected campaigns can be edited.' });

    if (req.body?.name !== undefined) campaign.name = safeText(req.body.name, 120);
    if (req.body?.content) {
      campaign.content.headline = safeText(req.body.content.headline, 180);
      campaign.content.body = safeText(req.body.content.body, 5000);
      for (const platform of PLATFORMS) {
        if (req.body.content[platform]) {
          campaign.content[platform].caption = safeText(req.body.content[platform].caption, 5000);
          campaign.content[platform].hashtags = Array.isArray(req.body.content[platform].hashtags) ? req.body.content[platform].hashtags.slice(0, 20).map((tag) => safeText(tag, 60)) : [];
          campaign.content[platform].callToAction = safeText(req.body.content[platform].callToAction, 180);
        }
      }
    }
    campaign.activity.push(activity('updated', 'Campaign draft updated.', req.user._id));
    await campaign.save();
    res.json({ success: true, campaign });
  } catch (error) {
    console.error('Marketing Studio update failed:', error.message);
    res.status(500).json({ success: false, message: 'Unable to update campaign.' });
  }
});

router.post('/campaigns/:id/submit', async (req, res) => {
  try {
    const campaign = await MarketingCampaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });
    if (!['draft', 'rejected'].includes(campaign.status)) return res.status(409).json({ success: false, message: 'This campaign cannot be submitted from its current status.' });
    if (!campaign.platforms.length) return res.status(422).json({ success: false, message: 'Select at least one platform.' });
    campaign.status = 'pending_approval';
    campaign.activity.push(activity('submitted_for_approval', 'Campaign submitted for administrator approval.', req.user._id));
    await campaign.save();
    res.json({ success: true, campaign });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unable to submit campaign for approval.' });
  }
});

router.post('/campaigns/:id/approve', async (req, res) => {
  try {
    const campaign = await MarketingCampaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });
    if (campaign.status !== 'pending_approval') return res.status(409).json({ success: false, message: 'Only submitted campaigns can be approved.' });
    campaign.status = 'approved';
    campaign.approvedAt = new Date();
    campaign.approvedBy = req.user._id;
    campaign.assets.forEach((asset) => { asset.status = 'approved'; });
    campaign.activity.push(activity('approved', 'Campaign approved by an administrator.', req.user._id));
    await campaign.save();
    res.json({ success: true, campaign });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unable to approve campaign.' });
  }
});

router.post('/campaigns/:id/reject', async (req, res) => {
  try {
    const campaign = await MarketingCampaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });
    if (campaign.status !== 'pending_approval') return res.status(409).json({ success: false, message: 'Only submitted campaigns can be returned for changes.' });
    const reason = safeText(req.body?.reason, 500);
    if (!reason) return res.status(400).json({ success: false, message: 'Add a short reason so the campaign owner knows what to revise.' });
    campaign.status = 'rejected';
    campaign.activity.push(activity('changes_requested', reason, req.user._id));
    await campaign.save();
    res.json({ success: true, campaign, message: 'Campaign returned for changes.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unable to return campaign for changes.' });
  }
});


router.post('/campaigns/:id/publish/instagram', async (req, res) => {
  try {
    const campaign = await MarketingCampaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });
    if (!['approved', 'scheduled'].includes(campaign.status)) {
      return res.status(409).json({ success: false, message: 'Approve this campaign before publishing it to Instagram.' });
    }
    if (!campaign.platforms.includes('instagram')) {
      return res.status(422).json({ success: false, message: 'Instagram is not selected for this campaign.' });
    }
    const previous = campaign.publishingResults.find((item) => item.platform === 'instagram');
    if (previous?.status === 'published') {
      return res.status(409).json({ success: false, message: 'This campaign is already published to Instagram.', publishingResult: previous });
    }
    const connection = await MetaPageConnection.findOne({ key: 'sylva-facebook-page' })
      .select('+pageTokenCiphertext +pageTokenIv +pageTokenAuthTag');
    if (!connection) return res.status(409).json({ success: false, code: 'META_PAGE_NOT_CONNECTED', message: 'Connect the official Sylva Facebook Page through Meta first.' });

    const result = await publishInstagramMedia(connection, campaign);
    campaign.publishingResults = campaign.publishingResults.filter((item) => item.platform !== 'instagram');
    campaign.publishingResults.push({
      platform: 'instagram',
      status: 'published',
      externalId: result.externalId,
      externalUrl: result.externalUrl,
      publishedAt: new Date(),
      message: 'Published to the linked Instagram Professional account.',
    });
    campaign.activity.push(activity('instagram_published', 'Product campaign published to Instagram to extend Sylva customer reach.', req.user._id));
    if (campaign.platforms.length === 1) {
      campaign.status = 'published';
      campaign.publishedAt = new Date();
    }
    await campaign.save();
    res.json({ success: true, campaign, publishingResult: result, message: 'Campaign published to Instagram.' });
  } catch (error) {
    console.error('Instagram campaign publishing failed:', error.code || error.metaCode || 'INSTAGRAM_PUBLISH_FAILED');
    const known = new Set(['INSTAGRAM_ACCOUNT_NOT_LINKED', 'INSTAGRAM_PERMISSION_MISSING', 'INSTAGRAM_MEDIA_REQUIRED']);
    res.status(error.code === 'INSTAGRAM_PERMISSION_MISSING' || error.code === 'INSTAGRAM_ACCOUNT_NOT_LINKED' ? 409 : 502).json({
      success: false,
      code: error.code || 'INSTAGRAM_PUBLISH_FAILED',
      message: known.has(error.code) ? error.message : 'Instagram could not confirm publication. Check the Instagram account before retrying.',
    });
  }
});

router.post('/campaigns/:id/schedule', async (req, res) => {
  try {
    const campaign = await MarketingCampaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });
    if (campaign.status !== 'approved') return res.status(409).json({ success: false, message: 'Approve the campaign before scheduling it.' });
    if (!campaign.platforms.includes('facebook')) {
      return res.status(409).json({ success: false, code: 'CHANNEL_SCHEDULING_UNAVAILABLE', message: 'Automatic scheduling is currently available for Facebook. Publish approved Instagram posts or Reels directly; other platform scheduling is still being completed.' });
    }
    const scheduledAt = new Date(req.body?.scheduledAt);
    if (!req.body?.scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) {
      return res.status(400).json({ success: false, message: 'Choose a valid future publishing date and time.' });
    }
    campaign.scheduledAt = scheduledAt;
    campaign.timezone = 'Africa/Nairobi';
    let scheduledFacebookPostId = '';

    if (campaign.platforms.includes('facebook')) {
      const connection = await MetaPageConnection.findOne({ key: 'sylva-facebook-page' })
        .select('+pageTokenCiphertext +pageTokenIv +pageTokenAuthTag');
      if (!connection) {
        return res.status(409).json({ success: false, code: 'FACEBOOK_NOT_CONNECTED', message: 'Connect the official Sylva Technologies Facebook Page before scheduling this campaign.' });
      }
      let scheduledPost;
      try {
        scheduledPost = await schedulePagePost(connection, campaign);
      } catch (error) {
        console.error('Facebook Page scheduling failed:', error.code || error.metaCode || 'META_SCHEDULE_FAILED');
        return res.status(502).json({
          success: false,
          code: error.code || 'META_SCHEDULE_FAILED',
          message: error.message || 'Facebook could not schedule this post. No campaign schedule was saved.',
        });
      }
      campaign.publishingResults = campaign.publishingResults.filter((item) => item.platform !== 'facebook');
      scheduledFacebookPostId = scheduledPost.externalId;
      campaign.publishingResults.push({
        platform: 'facebook',
        status: 'pending',
        externalId: scheduledPost.externalId,
        externalUrl: '',
        message: 'Scheduled natively by Meta for the official Sylva Technologies Page.',
      });
      for (const platform of campaign.platforms.filter((item) => item !== 'facebook')) {
        const existingResult = campaign.publishingResults.find((item) => item.platform === platform);
        if (existingResult?.status === 'published') continue;
        campaign.publishingResults = campaign.publishingResults.filter((item) => item.platform !== platform);
        campaign.publishingResults.push({
          platform,
          status: 'skipped',
          message: platform === 'instagram'
            ? 'Instagram publishing is available separately after approval and account permission checks.'
            : 'This platform is not connected for direct publishing yet.',
        });
      }
    }

    campaign.facebookScheduled = campaign.platforms.includes('facebook');
    campaign.status = 'scheduled';
    campaign.activity.push(activity(
      'scheduled',
      campaign.platforms.includes('facebook')
        ? 'Meta accepted the Facebook Page post schedule for ' + scheduledAt.toISOString() + ' (Africa/Nairobi).'
        : 'Scheduled for ' + scheduledAt.toISOString() + ' (Africa/Nairobi).',
      req.user._id
    ));
    try {
      await campaign.save();
    } catch (saveError) {
      if (scheduledFacebookPostId) {
        try {
          const connection = await MetaPageConnection.findOne({ key: 'sylva-facebook-page' })
            .select('+pageTokenCiphertext +pageTokenIv +pageTokenAuthTag');
          if (connection) await deleteScheduledPagePost(connection, scheduledFacebookPostId);
        } catch (rollbackError) {
          console.error('Facebook schedule rollback failed after campaign save error:', rollbackError.code || rollbackError.metaCode || 'META_ROLLBACK_FAILED');
        }
      }
      throw saveError;
    }
    res.json({ success: true, campaign });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unable to schedule campaign.' });
  }
});

router.post('/campaigns/:id/action', async (req, res) => {
  try {
    const campaign = await MarketingCampaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });
    const action = safeText(req.body?.action, 30);
    const pendingFacebookPost = campaign.publishingResults.find((item) =>
      item.platform === 'facebook' && item.status === 'pending' && item.externalId
    );
    if (action === 'pause' && pendingFacebookPost) {
      return res.status(409).json({ success: false, message: 'This Facebook post is scheduled directly with Meta and cannot be paused here. Cancel it, then create a new schedule when ready.' });
    }
    if (action === 'cancel' && pendingFacebookPost) {
      const connection = await MetaPageConnection.findOne({ key: 'sylva-facebook-page' })
        .select('+pageTokenCiphertext +pageTokenIv +pageTokenAuthTag');
      if (!connection) return res.status(409).json({ success: false, message: 'Reconnect Facebook before cancelling its scheduled post.' });
      try {
        await deleteScheduledPagePost(connection, pendingFacebookPost.externalId);
        pendingFacebookPost.status = 'skipped';
        pendingFacebookPost.message = 'Scheduled Facebook post cancelled in Meta.';
      } catch (error) {
        console.error('Facebook scheduled post cancellation failed:', error.code || error.metaCode || 'META_CANCEL_FAILED');
        return res.status(502).json({ success: false, message: 'Meta could not confirm cancellation. The campaign was not cancelled; check the Page scheduled posts before retrying.' });
      }
    }
    if (action === 'pause' && campaign.status === 'scheduled') {
      campaign.status = 'paused';
      campaign.activity.push(activity('paused', 'Scheduled campaign paused.', req.user._id));
    } else if (action === 'resume' && campaign.status === 'paused' && campaign.scheduledAt > new Date()) {
      campaign.status = 'scheduled';
      campaign.activity.push(activity('resumed', 'Scheduled campaign resumed.', req.user._id));
    } else if (action === 'cancel' && ['draft', 'pending_approval', 'approved', 'scheduled', 'ready_to_publish', 'paused', 'rejected'].includes(campaign.status)) {
      campaign.status = 'cancelled';
      campaign.activity.push(activity('cancelled', 'Campaign cancelled.', req.user._id));
    } else {
      return res.status(409).json({ success: false, message: 'That action is not available for this campaign.' });
    }
    await campaign.save();
    res.json({ success: true, campaign });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unable to update campaign status.' });
  }
});



router.post('/campaigns/:id/duplicate', async (req, res) => {
  try {
    const source = await MarketingCampaign.findById(req.params.id);
    if (!source) return res.status(404).json({ success: false, message: 'Campaign not found.' });
    const purpose = safeText(req.body?.purpose, 20);
    if (purpose && !['campaign', 'paid_ad'].includes(purpose)) {
      return res.status(400).json({ success: false, message: 'Choose a valid campaign copy type.' });
    }

    const duplicate = await MarketingCampaign.create({
      name: ('Copy of ' + source.name).slice(0, 120),
      objective: source.objective,
      product: source.product?.toObject ? source.product.toObject() : source.product,
      platforms: [...source.platforms],
      content: source.content?.toObject ? source.content.toObject() : source.content,
      assets: source.assets.map((asset) => ({
        kind: asset.kind,
        url: asset.url,
        publicId: asset.publicId,
        alt: asset.alt,
        status: 'draft',
      })),
      status: 'draft',
      createdBy: req.user._id,
      activity: [activity(
        purpose === 'paid_ad' ? 'ad_draft_prepared' : 'campaign_duplicated',
        purpose === 'paid_ad'
          ? 'Prepared as a draft for paid-ad planning. No paid advertisement has been created or launched.'
          : 'Copied from campaign ' + String(source._id) + ' for editing as a new campaign.',
        req.user._id
      )],
    });
    res.status(201).json({
      success: true,
      campaign: duplicate,
      paidAdCreated: false,
      message: purpose === 'paid_ad'
        ? 'Ad planning draft created. Complete paid-ad setup separately in Meta Ads Manager; no ad has been launched.'
        : 'Campaign copy created as a new draft.',
    });
  } catch (error) {
    console.error('Marketing Studio campaign duplication failed:', error.message);
    res.status(500).json({ success: false, message: 'Unable to create a campaign copy.' });
  }
});

router.delete('/campaigns/drafts', async (req, res) => {
  try {
    const result = await MarketingCampaign.deleteMany({ status: 'draft' });
    res.json({ success: true, deletedCount: result.deletedCount || 0, message: 'Draft campaigns deleted.' });
  } catch (error) {
    console.error('Marketing Studio draft cleanup failed:', error.message);
    res.status(500).json({ success: false, message: 'Unable to delete draft campaigns.' });
  }
});

router.delete('/campaigns/:id', async (req, res) => {
  try {
    const campaign = await MarketingCampaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });

    const externalFacebookPost = campaign.publishingResults.find((item) =>
      item.platform === 'facebook' && item.externalId && ['pending', 'published'].includes(item.status)
    );
    const nonFacebookLiveResult = campaign.publishingResults.find((item) =>
      item.platform !== 'facebook' && ['pending', 'published'].includes(item.status)
    );
    if (campaign.status === 'published' && !externalFacebookPost) {
      return res.status(409).json({
        success: false,
        message: 'This campaign is marked as published but has no removable Facebook Page post ID. The record was kept so live posts on other platforms are not accidentally orphaned.',
      });
    }
    if (nonFacebookLiveResult) {
      return res.status(409).json({
        success: false,
        message: 'A non-Facebook platform still has a live or pending result. Remove it from that platform before deleting this campaign.',
      });
    }

    if (externalFacebookPost) {
      const connection = await MetaPageConnection.findOne({ key: 'sylva-facebook-page' })
        .select('+pageTokenCiphertext +pageTokenIv +pageTokenAuthTag');
      if (!connection) {
        return res.status(409).json({ success: false, message: 'Reconnect the Sylva Technologies Facebook Page before deleting its scheduled or published post.' });
      }
      try {
        await deleteScheduledPagePost(connection, externalFacebookPost.externalId);
      } catch (error) {
        console.error('Marketing Studio Facebook post deletion failed:', error.code || error.metaCode || 'META_POST_DELETE_FAILED');
        return res.status(502).json({
          success: false,
          message: 'Facebook could not confirm removal of the Page post. The campaign was kept in Sylva; check the Page post in Meta before retrying.',
        });
      }
    }

    await MarketingCampaign.deleteOne({ _id: campaign._id });
    res.json({
      success: true,
      message: externalFacebookPost
        ? 'Facebook Page post removed and campaign deleted.'
        : 'Campaign deleted.',
    });
  } catch (error) {
    console.error('Marketing Studio campaign deletion failed:', error.message);
    res.status(500).json({ success: false, message: 'Unable to delete this campaign.' });
  }
});

router.post('/campaigns/:id/assets', marketingUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Choose an image or video to upload.' });
    const campaign = await MarketingCampaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });
    if (!['draft', 'rejected'].includes(campaign.status)) return res.status(409).json({ success: false, message: 'Media can only be added to a draft or a campaign returned for changes.' });
    if (campaign.assets.length >= 10) return res.status(409).json({ success: false, message: 'A campaign can contain at most 10 media assets.' });
    const isVideo = req.file.mimetype.startsWith('video/');
    const uploaded = await uploadMarketingAsset(req.file.buffer, isVideo ? 'video' : 'image');
    const asset = { kind: isVideo ? 'video' : 'image', url: uploaded.secure_url, publicId: uploaded.public_id, alt: safeText(req.body?.alt || req.file.originalname, 240), status: 'draft' };
    campaign.assets.push(asset);
    campaign.activity.push(activity('asset_uploaded', 'A campaign ' + asset.kind + ' was uploaded.', req.user._id));
    await campaign.save();
    res.status(201).json({ success: true, asset: campaign.assets[campaign.assets.length - 1], message: 'Media uploaded to campaign.' });
  } catch (error) {
    console.error('Marketing Studio media upload failed:', error.message);
    res.status(500).json({ success: false, message: 'Unable to upload campaign media.' });
  }
});

router.post('/videos/script', videoScriptLimiter, async (req, res) => {
  try {
    const productId = String(req.body?.productId || '');
    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).json({ success: false, message: 'Choose a valid catalogue product.' });
    }
    const product = await Product.findOne({
      _id: productId,
      isActive: true,
      approvalStatus: 'approved',
      stock: mongoose.trusted({ $gt: 0 }),
    }).select('_id name brand sku price description shortDescription keyFeatures specifications stock images slug').lean();
    if (!product) {
      return res.status(422).json({ success: false, message: 'Choose an active, approved product that is in stock.' });
    }
    const storyboard = await generateMarketingVideoScript(product, {
      platform: req.body?.platform,
      style: req.body?.style,
      durationSeconds: req.body?.durationSeconds,
    });
    res.set('Cache-Control', 'no-store, private');
    res.json({ success: true, storyboard });
  } catch (error) {
    const status = error.status || (error.code === 'SYLVA_AI_QUALITY_FAILED' ? 422 : 502);
    console.error('Marketing video script generation failed:', error.code || error.message);
    res.status(status).json({
      success: false,
      code: error.code || 'SYLVA_VIDEO_SCRIPT_FAILED',
      message: error.message || 'Unable to generate a video storyboard.',
    });
  }
});

module.exports = router;
