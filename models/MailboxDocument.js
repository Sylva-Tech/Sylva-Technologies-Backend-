const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'MailboxMessage', required: true, index: true },
  filename: { type: String, required: true, trim: true, maxlength: 255 },
  contentType: { type: String, default: 'application/octet-stream', maxlength: 150 },
  size: { type: Number, required: true, min: 0 },
  contentBase64: { type: String, required: true, select: false },
}, { timestamps: true });

schema.index({ messageId: 1, filename: 1 });

module.exports = mongoose.models.MailboxDocument || mongoose.model('MailboxDocument', schema);
