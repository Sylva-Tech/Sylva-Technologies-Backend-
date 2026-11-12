const mongoose = require('mongoose');

const AliExpressConnectionSchema = new mongoose.Schema({
  provider: { type: String, default: 'aliexpress', unique: true, immutable: true },
  status: { type: String, enum: ['disconnected', 'connected', 'expired'], default: 'disconnected' },
  sellerId: { type: String, default: '' },
  account: { type: String, default: '' },
  accountPlatform: { type: String, default: '' },
  accessTokenEncrypted: { type: String, default: '', select: false },
  refreshTokenEncrypted: { type: String, default: '', select: false },
  accessTokenExpiresAt: { type: Date, default: null },
  refreshTokenExpiresAt: { type: Date, default: null },
  lastConnectedAt: { type: Date, default: null },
  lastError: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.models.AliExpressConnection || mongoose.model('AliExpressConnection', AliExpressConnectionSchema);
