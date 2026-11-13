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
  catalogProtocolVerifiedAt: { type: Date, default: null },
  catalogMethodEntitlementVerifiedAt: { type: Date, default: null },
  catalogReadOnlyProductTestAt: { type: Date, default: null },
  catalogLastTestProductId: { type: String, default: '' },
  catalogLastTestProductTitle: { type: String, default: '' },
  catalogLastTestError: { type: String, default: '' },
  catalogFeedNamesVerifiedAt: { type: Date, default: null },
  catalogFeedItemIdsVerifiedAt: { type: Date, default: null },
  catalogLastFeedName: { type: String, default: '' },
  catalogLastFeedItemCount: { type: Number, default: 0 },
  catalogLastFeedCursor: { type: String, default: '' },
  catalogLastSyncAt: { type: Date, default: null },
  catalogLastSyncCount: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.models.AliExpressConnection || mongoose.model('AliExpressConnection', AliExpressConnectionSchema);
