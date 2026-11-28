const mongoose = require('mongoose');

const platformContentSchema = new mongoose.Schema({
  caption: { type: String, default: '', maxlength: 5000 },
  hashtags: { type: [String], default: [] },
  callToAction: { type: String, default: '', maxlength: 180 },
}, { _id: false });

const marketingCampaignSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  campaignType: { type: String, enum: ['product', 'page'], default: 'product', index: true },
  destination: {
    label: { type: String, default: '', maxlength: 100 },
    url: { type: String, default: '', maxlength: 500 },
  },
  objective: { type: String, enum: ['product_awareness', 'sales', 'promotion', 'engagement', 'seller_acquisition', 'traffic'], default: 'sales' },
  product: {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    name: { type: String, default: '' },
    sku: { type: String, default: '' },
    price: { type: Number, default: null },
    image: { type: String, default: '' },
    productUrl: { type: String, default: '' },
    stockAtDraft: { type: Number, default: null },
  },
  platforms: {
    type: [String],
    enum: ['facebook', 'instagram', 'tiktok', 'whatsapp'],
    default: [],
    validate: { validator: (items) => items.length > 0 && new Set(items).size === items.length, message: 'Select at least one unique marketing platform.' },
  },
  content: {
    headline: { type: String, default: '', maxlength: 180 },
    body: { type: String, default: '', maxlength: 5000 },
    facebook: { type: platformContentSchema, default: () => ({}) },
    instagram: { type: platformContentSchema, default: () => ({}) },
    tiktok: { type: platformContentSchema, default: () => ({}) },
    whatsapp: { type: platformContentSchema, default: () => ({}) },
  },
  assets: [{
    kind: { type: String, enum: ['poster', 'video', 'image'], required: true },
    url: { type: String, required: true, maxlength: 2000 },
    publicId: { type: String, default: '', maxlength: 240 },
    alt: { type: String, default: '', maxlength: 240 },
    status: { type: String, enum: ['draft', 'approved'], default: 'draft' },
  }],
  status: {
    type: String,
    enum: ['draft', 'pending_approval', 'approved', 'scheduled', 'ready_to_publish', 'published', 'failed', 'paused', 'cancelled', 'rejected'],
    default: 'draft',
    index: true,
  },
  scheduledAt: { type: Date, default: null, index: true },
  facebookScheduled: { type: Boolean, default: false, index: true },
  timezone: { type: String, enum: ['Africa/Nairobi'], default: 'Africa/Nairobi' },
  approvedAt: { type: Date, default: null },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  publishedAt: { type: Date, default: null },
  publishingResults: [{
    platform: { type: String, enum: ['facebook', 'instagram', 'tiktok', 'whatsapp'] },
    status: { type: String, enum: ['pending', 'published', 'failed', 'skipped'] },
    externalId: { type: String, default: '' },
    externalUrl: { type: String, default: '', maxlength: 2000 },
    message: { type: String, default: '', maxlength: 500 },
    publishedAt: { type: Date, default: null },
  }],
  activity: [{
    action: { type: String, required: true, maxlength: 80 },
    note: { type: String, default: '', maxlength: 500 },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    at: { type: Date, default: Date.now },
  }],
  lastError: { type: String, default: '', maxlength: 500 },
}, { timestamps: true });

marketingCampaignSchema.index({ status: 1, scheduledAt: 1 });
marketingCampaignSchema.index({ createdAt: -1 });

module.exports = mongoose.model('MarketingCampaign', marketingCampaignSchema);
