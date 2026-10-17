'use strict';

const mongoose = require('mongoose');

/**
 * Additive wallet-account schema for the ledger migration.
 * Amounts are integer minor units (KES 1.00 = 100) to avoid floating-point
 * accounting errors. Existing User.wallet balances remain untouched until a
 * separately reviewed, idempotent migration is implemented.
 */
const walletAccountSchema = new mongoose.Schema({
  accountKey: { type: String, required: true, unique: true, immutable: true, trim: true },
  ownerType: { type: String, enum: ['customer', 'seller', 'platform'], required: true, immutable: true, index: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, immutable: true, index: true },
  currency: { type: String, enum: ['KES', 'USD'], default: 'KES', required: true, immutable: true },
  availableMinor: { type: Number, default: 0, min: 0, required: true },
  pendingMinor: { type: Number, default: 0, min: 0, required: true },
  escrowMinor: { type: Number, default: 0, min: 0, required: true },
  ledgerVersion: { type: Number, default: 1, min: 1, required: true },
  lastLedgerAt: { type: Date, default: null },
  status: { type: String, enum: ['active', 'frozen', 'closed'], default: 'active', index: true },
}, { timestamps: true, optimisticConcurrency: true });

walletAccountSchema.index({ ownerType: 1, ownerId: 1, currency: 1 });
walletAccountSchema.index({ ownerType: 1, currency: 1, status: 1 });

module.exports = mongoose.models.WalletAccount || mongoose.model('WalletAccount', walletAccountSchema);
