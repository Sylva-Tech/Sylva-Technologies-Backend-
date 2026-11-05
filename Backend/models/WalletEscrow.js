'use strict';

const mongoose = require('mongoose');

const walletEscrowSchema = new mongoose.Schema({
  escrowKey: { type: String, required: true, unique: true, immutable: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true, immutable: true },
  orderNumber: { type: String, required: true, trim: true, immutable: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true, immutable: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true, immutable: true },
  currency: { type: String, enum: ['KES', 'USD'], default: 'KES', required: true, immutable: true },
  orderValueMinor: { type: Number, required: true, min: 1, immutable: true },
  deliveryFeeMinor: { type: Number, default: 0, min: 0, immutable: true },
  commissionRateBps: { type: Number, required: true, min: 0, max: 10000, immutable: true },
  commissionMinor: { type: Number, required: true, min: 0, immutable: true },
  sellerNetMinor: { type: Number, required: true, min: 0, immutable: true },
  heldMinor: { type: Number, required: true, min: 1 },
  releasedMinor: { type: Number, default: 0, min: 0 },
  refundedMinor: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['held', 'partially_released', 'released', 'partially_refunded', 'refunded', 'disputed', 'cancelled'], default: 'held', index: true },
  deliveredAt: { type: Date, default: null },
  customerConfirmedAt: { type: Date, default: null },
  autoConfirmAt: { type: Date, default: null, index: true },
  disputeOpenedAt: { type: Date, default: null },
  disputeResolvedAt: { type: Date, default: null },
  resolutionNote: { type: String, default: '', trim: true, maxlength: 1000 },
  releasedAt: { type: Date, default: null },
  refundedAt: { type: Date, default: null },
  createdByPaymentKey: { type: String, required: true, immutable: true },
}, { timestamps: true, optimisticConcurrency: true });

walletEscrowSchema.index({ order: 1, seller: 1 }, { unique: true });
walletEscrowSchema.index({ status: 1, autoConfirmAt: 1 });
walletEscrowSchema.index({ customer: 1, status: 1, createdAt: -1 });
walletEscrowSchema.index({ seller: 1, status: 1, createdAt: -1 });

module.exports = mongoose.models.WalletEscrow || mongoose.model('WalletEscrow', walletEscrowSchema);
