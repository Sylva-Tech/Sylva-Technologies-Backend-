'use strict';

const mongoose = require('mongoose');

const walletPaymentAttemptSchema = new mongoose.Schema({
  idempotencyKey: { type: String, required: true, unique: true, immutable: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true, immutable: true },
  walletAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'WalletAccount', default: null, index: true },
  purpose: { type: String, enum: ['wallet_deposit', 'order_wallet_payment', 'split_order_payment', 'seller_withdrawal', 'sponsored_product'], required: true, index: true },
  provider: { type: String, enum: ['mpesa', 'paypal', 'wallet', 'admin'], required: true },
  currency: { type: String, enum: ['KES', 'USD'], default: 'KES', required: true },
  amountMinor: { type: Number, required: true, min: 1 },
  phoneNumber: { type: String, default: '', trim: true },
  merchantRequestId: { type: String, default: '', index: true },
  checkoutRequestId: { type: String, default: '', index: true },
  mpesaReceiptNumber: { type: String, default: '', trim: true },
  providerReference: { type: String, default: '', trim: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
  status: { type: String, enum: ['created', 'pending', 'succeeded', 'failed', 'cancelled', 'expired', 'reconciliation_required', 'reversed'], default: 'created', index: true },
  resultCode: { type: String, default: '' },
  resultDescription: { type: String, default: '', maxlength: 1000 },
  callbackPayloadHash: { type: String, default: '' },
  initiatedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  lastQueriedAt: { type: Date, default: null },
  reconciliationAttempts: { type: Number, default: 0, min: 0 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, optimisticConcurrency: true });

walletPaymentAttemptSchema.index({ checkoutRequestId: 1 }, { unique: true, partialFilterExpression: { checkoutRequestId: { $type: 'string', $gt: '' } } });
walletPaymentAttemptSchema.index({ mpesaReceiptNumber: 1 }, { unique: true, partialFilterExpression: { mpesaReceiptNumber: { $type: 'string', $gt: '' } } });
walletPaymentAttemptSchema.index({ status: 1, initiatedAt: 1 });
walletPaymentAttemptSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.models.WalletPaymentAttempt || mongoose.model('WalletPaymentAttempt', walletPaymentAttemptSchema);
