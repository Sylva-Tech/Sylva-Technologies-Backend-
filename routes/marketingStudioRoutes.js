const express = require('express');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const MarketingCampaign = require('../models/MarketingCampaign');
const Product = require('../models/Product');

const router = express.Router();
const campaignLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many marketing studio requests. Please try again later.' },
});

const PLATFORMS = ['facebook', 'instagram', 'tiktok', 'whatsapp'];
const safeText = (value, max = 5000) => String(value || '').trim().slice(0, max);
const activity = (action, note, actor) => ({ action, note: safeText(note, 500), actor, at: new Date() });

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
      MarketingCampaign.find({ status: 'scheduled', scheduledAt: { $gte: new Date() } }).sort({ scheduledAt: 1 }).limit(5).lean(),
      MarketingCampaign.find({}).sort({ updatedAt: -1 }).limit(8).lean(),
    ]);
    const totals = Object.fromEntries(counts.map((item) => [item._id, item.count]));
    res.json({ success: true, data: { totals, upcoming, recent, timezone: 'Africa/Nairobi', publishingEnabled: false } });
  } catch (error) {
    console.error('Marketing Studio overview failed:', error.message);
    res.status(500).json({ success: false, message: 'Unable to load Marketing Studio overview.' });
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

router.post('/campaigns/:id/schedule', async (req, res) => {
  try {
    const campaign = await MarketingCampaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });
    if (campaign.status !== 'approved') return res.status(409).json({ success: false, message: 'Approve the campaign before scheduling it.' });
    const scheduledAt = new Date(req.body?.scheduledAt);
    if (!req.body?.scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) {
      return res.status(400).json({ success: false, message: 'Choose a valid future publishing date and time.' });
    }
    campaign.scheduledAt = scheduledAt;
    campaign.timezone = 'Africa/Nairobi';
    campaign.status = 'scheduled';
    campaign.activity.push(activity('scheduled', 'Scheduled for ' + scheduledAt.toISOString() + ' (Africa/Nairobi).', req.user._id));
    await campaign.save();
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

module.exports = router;
