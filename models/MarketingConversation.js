const mongoose = require('mongoose');

const marketingConversationSchema = new mongoose.Schema({
  platform: { type: String, enum: ['whatsapp', 'instagram'], required: true, default: 'whatsapp', index: true },
  externalContactId: { type: String, required: true, trim: true, maxlength: 120 },
  displayName: { type: String, default: '', trim: true, maxlength: 160 },
  status: { type: String, enum: ['unread', 'open', 'resolved'], default: 'unread', index: true },
  lastMessageAt: { type: Date, default: Date.now, index: true },
  lastInboundAt: { type: Date, default: null },
  messages: [{
    externalId: { type: String, default: '', maxlength: 180 },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    type: { type: String, default: 'text', maxlength: 40 },
    text: { type: String, default: '', maxlength: 5000 },
    status: { type: String, default: 'received', maxlength: 40 },
    at: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

marketingConversationSchema.index({ platform: 1, externalContactId: 1 }, { unique: true });
module.exports = mongoose.model('MarketingConversation', marketingConversationSchema);
