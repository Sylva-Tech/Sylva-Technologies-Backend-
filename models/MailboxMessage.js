const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
  filename: { type: String, required: true, trim: true, maxlength: 255 },
  contentType: { type: String, default: 'application/octet-stream', maxlength: 150 },
  size: { type: Number, default: 0, min: 0 },
  providerId: { type: String, default: '' },
}, { _id: false });

const eventSchema = new mongoose.Schema({
  type: { type: String, required: true, trim: true },
  at: { type: Date, default: Date.now },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false });

const schema = new mongoose.Schema({
  providerMessageId: { type: String, default: undefined, trim: true, maxlength: 300 },
  providerEmailId: { type: String, default: '', trim: true, maxlength: 300 },
  direction: { type: String, enum: ['inbound', 'outbound'], required: true, index: true },
  folder: { type: String, enum: ['inbox', 'outbox', 'sent', 'drafts', 'archive', 'trash'], default: 'inbox', index: true },
  from: { type: String, required: true, trim: true, lowercase: true, index: true },
  to: [{ type: String, trim: true, lowercase: true }],
  cc: [{ type: String, trim: true, lowercase: true }],
  bcc: [{ type: String, trim: true, lowercase: true }],
  subject: { type: String, default: '(No subject)', trim: true, maxlength: 300 },
  text: { type: String, default: '', maxlength: 100000 },
  html: { type: String, default: '', maxlength: 250000 },
  attachments: { type: [attachmentSchema], default: [] },
  senderAlias: { type: String, default: 'support', trim: true },
  status: {
    type: String,
    enum: ['draft', 'queued', 'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'received'],
    default: 'received',
    index: true,
  },
  isRead: { type: Boolean, default: false, index: true },
  receivedAt: { type: Date, default: Date.now, index: true },
  sentAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  lastStatusAt: { type: Date, default: Date.now },
  events: { type: [eventSchema], default: [] },
  inReplyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'MailboxMessage', default: null },
}, { timestamps: true });

schema.index({ providerMessageId: 1 }, { unique: true, sparse: true });
schema.index({ folder: 1, receivedAt: -1 });
schema.index({ folder: 1, sentAt: -1 });

module.exports = mongoose.models.MailboxMessage || mongoose.model('MailboxMessage', schema);
