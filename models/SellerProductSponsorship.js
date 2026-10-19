'use strict';

const mongoose = require('mongoose');

const sellerProductSponsorshipSchema = new mongoose.Schema({
  idempotencyKey: { type: String, required: true, unique: true, immutable: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true, immutable: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true, immutable: true },
  amount: { type: Number, required: true, min: 1, default: 400, immutable: true },
  currency: { type: String, enum: ['KES'], default: 'KES', required: true, immutable: true },
  durationDays: { type: Number, required: true, enum: [1, 7, 30, 90, 180, 365], default: 7, immutable: true },
  paymentMethod: { type: String, enum: ['wallet', 'mpesa'], required: true, immutable: true },
  status: { type: String, enum: ['pending', 'active', 'failed', 'expired'], default: 'pending', index: true },
  phoneNumber: { type: String, default: '', trim: true },
  merchantRequestId: { type: String, default: '', index: true },
  checkoutRequestId: { type: String, default: '', index: true },
  mpesaReceiptNumber: { type: String, default: '', trim: true },
  providerResultCode: { type: String, default: '' },
  failureReason: { type: String, default: '', maxlength: 500 },
  startsAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null, index: true },
}, { timestamps: true, optimisticConcurrency: true });

sellerProductSponsorshipSchema.index({ checkoutRequestId: 1 }, {
  unique: true,
  partialFilterExpression: { checkoutRequestId: { $type: 'string', $gt: '' } },
});
sellerProductSponsorshipSchema.index({ product: 1, status: 1, expiresAt: -1 });
sellerProductSponsorshipSchema.index({ seller: 1, createdAt: -1 });

module.exports = mongoose.models.SellerProductSponsorship ||
  mongoose.model('SellerProductSponsorship', sellerProductSponsorshipSchema);
