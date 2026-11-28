const mongoose = require('mongoose');

const tikTokConnectionSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'sylva-tiktok-account', required: true },
  openId: { type: String, required: true, trim: true, maxlength: 120 },
  displayName: { type: String, default: '', trim: true, maxlength: 200 },
  avatarUrl: { type: String, default: '', maxlength: 1000 },
  grantedScopes: { type: [String], default: [] },
  accessTokenCiphertext: { type: String, required: true, select: false },
  accessTokenIv: { type: String, required: true, select: false },
  accessTokenAuthTag: { type: String, required: true, select: false },
  refreshTokenCiphertext: { type: String, required: true, select: false },
  refreshTokenIv: { type: String, required: true, select: false },
  refreshTokenAuthTag: { type: String, required: true, select: false },
  accessTokenExpiresAt: { type: Date, required: true },
  refreshTokenExpiresAt: { type: Date, required: true },
  connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  connectedAt: { type: Date, default: Date.now },
  lastRefreshedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('TikTokConnection', tikTokConnectionSchema);
