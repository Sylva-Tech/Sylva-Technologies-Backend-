const mongoose = require('mongoose');
const replySchema = new mongoose.Schema({
  from: { type: String, required: true, trim: true },
  to: { type: String, required: true, trim: true, lowercase: true },
  subject: { type: String, required: true, trim: true },
  text: { type: String, required: true },
  providerMessageId: { type: String, default: '' },
  sentAt: { type: Date, default: Date.now },
}, { _id: true });
const schema = new mongoose.Schema({
  providerMessageId: { type: String, default: undefined },
  source: { type: String, enum: ['email', 'website'], default: 'email', index: true },
  folder: { type: String, enum: ['inbox', 'archive', 'trash'], default: 'inbox', index: true },
  from: { type: String, required: true, trim: true, lowercase: true, index: true },
  to: [{ type: String, trim: true, lowercase: true }],
  name: { type: String, default: '', trim: true },
  subject: { type: String, required: true, trim: true },
  text: { type: String, default: '' },
  html: { type: String, default: '' },
  contentCiphertext: { type: String, default: '', select: false },
  contentIv: { type: String, default: '', select: false },
  contentAuthTag: { type: String, default: '', select: false },
  contentEncryptionVersion: { type: Number, default: 0, select: false },
  receivedAt: { type: Date, default: Date.now, index: true },
  isRead: { type: Boolean, default: false, index: true },
  replies: { type: [replySchema], default: [] },
}, { timestamps: true });
schema.index({ providerMessageId: 1 }, { unique: true, sparse: true });
module.exports = mongoose.models.SupportMessage || mongoose.model('SupportMessage', schema);
