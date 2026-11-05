'use strict';

const mongoose = require('mongoose');

const WALLET_ENTRY_TYPES = [
  'deposit', 'order_payment', 'escrow_hold', 'escrow_release', 'commission',
  'refund', 'transfer_in', 'transfer_out', 'feature_payment', 'withdrawal',
  'admin_adjustment', 'payout', 'reversal', 'opening_balance',
];

const walletLedgerEntrySchema = new mongoose.Schema({
  entryId: { type: String, required: true, unique: true, immutable: true },
  transactionGroupId: { type: String, required: true, index: true, immutable: true },
  idempotencyKey: { type: String, required: true, unique: true, immutable: true },
  walletAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'WalletAccount', required: true, index: true, immutable: true },
  ownerType: { type: String, enum: ['customer', 'seller', 'platform'], required: true, immutable: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, immutable: true },
  currency: { type: String, enum: ['KES', 'USD'], required: true, immutable: true },
  direction: { type: String, enum: ['debit', 'credit'], required: true, immutable: true },
  type: { type: String, enum: WALLET_ENTRY_TYPES, required: true, immutable: true, index: true },
  amountMinor: { type: Number, required: true, min: 1, immutable: true },
  balanceBeforeMinor: { type: Number, required: true, min: 0, immutable: true },
  balanceAfterMinor: { type: Number, required: true, min: 0, immutable: true },
  bucket: { type: String, enum: ['available', 'pending', 'escrow'], required: true, immutable: true },
  reference: { type: String, default: '', trim: true, immutable: true, index: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, immutable: true, index: true },
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, immutable: true, index: true },
  paymentReceipt: { type: String, default: '', trim: true, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, immutable: true },
  description: { type: String, default: '', trim: true, maxlength: 500, immutable: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
}, { versionKey: false });

walletLedgerEntrySchema.index({ walletAccount: 1, createdAt: -1 });
walletLedgerEntrySchema.index({ orderId: 1, sellerId: 1, type: 1 });
walletLedgerEntrySchema.index({ paymentReceipt: 1 }, { unique: true, partialFilterExpression: { paymentReceipt: { $type: 'string', $gt: '' } } });

for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  walletLedgerEntrySchema.pre(operation, function rejectLedgerMutation() {
    throw new Error('Wallet ledger entries are immutable. Record a compensating reversal instead.');
  });
}
walletLedgerEntrySchema.pre('save', function rejectSavedLedgerMutation() {
  if (!this.isNew) throw new Error('Wallet ledger entries are immutable. Record a compensating reversal instead.');
});

walletLedgerEntrySchema.statics.ENTRY_TYPES = WALLET_ENTRY_TYPES;
module.exports = mongoose.models.WalletLedgerEntry || mongoose.model('WalletLedgerEntry', walletLedgerEntrySchema);
