const mongoose = require('mongoose');

const metaPageConnectionSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'sylva-facebook-page' },
  pageId: { type: String, required: true, trim: true, maxlength: 100 },
  pageName: { type: String, required: true, trim: true, maxlength: 200 },
  metaUserId: { type: String, default: '', trim: true, maxlength: 100, index: true },
  pageTokenCiphertext: { type: String, required: true, select: false },
  pageTokenIv: { type: String, required: true, select: false },
  pageTokenAuthTag: { type: String, required: true, select: false },
  grantedPermissions: { type: [String], default: [] },
  connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  connectedAt: { type: Date, default: Date.now },
  lastVerifiedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('MetaPageConnection', metaPageConnectionSchema);
