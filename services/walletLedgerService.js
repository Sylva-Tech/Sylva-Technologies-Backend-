'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const WalletAccount = require('../models/WalletAccount');
const WalletLedgerEntry = require('../models/WalletLedgerEntry');

const BUCKET_FIELD = Object.freeze({
  available: 'availableMinor',
  pending: 'pendingMinor',
  escrow: 'escrowMinor',
});

function toMinorUnits(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError('Amount must be a finite, non-negative monetary value.');
  }
  return Math.round((value + Number.EPSILON) * 100);
}

function fromMinorUnits(amountMinor) {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new TypeError('Minor-unit amount must be a safe integer.');
  }
  return amountMinor / 100;
}

/**
 * Calculate commission on the product subtotal only. Delivery fees must never
 * be passed into this function. Basis points: 400 = 4.00%.
 */
function calculateCommissionMinor(productSubtotalMinor, commissionRateBps = 400) {
  if (!Number.isSafeInteger(productSubtotalMinor) || productSubtotalMinor < 0) {
    throw new TypeError('Product subtotal must be a non-negative integer in minor units.');
  }
  if (!Number.isInteger(commissionRateBps) || commissionRateBps < 0 || commissionRateBps > 10000) {
    throw new TypeError('Commission rate must be an integer from 0 to 10000 basis points.');
  }
  return Math.round((productSubtotalMinor * commissionRateBps) / 10000);
}

function normalizePostings(postings) {
  if (!Array.isArray(postings) || postings.length < 2) {
    throw new TypeError('A ledger transaction requires at least two postings.');
  }

  const normalized = postings.map((posting, index) => {
    if (!posting || !mongoose.isValidObjectId(posting.walletAccount)) {
      throw new TypeError(`Posting ${index + 1} requires a valid walletAccount ID.`);
    }
    if (!['debit', 'credit'].includes(posting.direction)) {
      throw new TypeError(`Posting ${index + 1} has an invalid direction.`);
    }
    if (!Number.isSafeInteger(posting.amountMinor) || posting.amountMinor <= 0) {
      throw new TypeError(`Posting ${index + 1} amountMinor must be a positive safe integer.`);
    }
    if (!BUCKET_FIELD[posting.bucket]) {
      throw new TypeError(`Posting ${index + 1} has an invalid balance bucket.`);
    }
    return { ...posting, index };
  });

  const debits = normalized.filter((p) => p.direction === 'debit')
    .reduce((sum, p) => sum + p.amountMinor, 0);
  const credits = normalized.filter((p) => p.direction === 'credit')
    .reduce((sum, p) => sum + p.amountMinor, 0);

  if (!Number.isSafeInteger(debits) || !Number.isSafeInteger(credits) || debits !== credits) {
    throw new Error('Unbalanced wallet transaction: total debits must equal total credits.');
  }
  return normalized;
}

/**
 * Posts a balanced, immutable ledger group and applies bucket deltas atomically.
 *
 * IMPORTANT: caller must pass a MongoDB session and call this from inside
 * session.withTransaction(). This service intentionally does not start or
 * commit a transaction itself, and must not be called outside a transaction.
 *
 * Each posting uses a stable idempotencyKey derived from transactionKey and
 * its position. A repeated fully committed request returns the original group;
 * a partial prior group is treated as an integrity error.
 */
async function postBalancedTransaction({
  session,
  transactionKey,
  description = '',
  orderId = null,
  sellerId = null,
  createdBy = null,
  postings,
}) {
  if (!session || typeof session.inTransaction !== 'function' || !session.inTransaction()) {
    throw new Error('A live MongoDB transaction session is required for wallet ledger writes.');
  }
  if (typeof transactionKey !== 'string' || transactionKey.trim().length < 8 || transactionKey.length > 180) {
    throw new TypeError('transactionKey must be a stable string between 8 and 180 characters.');
  }

  const items = normalizePostings(postings);
  const transactionGroupId = crypto.createHash('sha256').update(transactionKey).digest('hex');
  const existing = await WalletLedgerEntry.find({ transactionGroupId }).session(session).lean();

  if (existing.length) {
    if (existing.length !== items.length) {
      throw new Error('Ledger idempotency conflict: an incomplete transaction group already exists.');
    }
    return { transactionGroupId, entries: existing, alreadyApplied: true };
  }

  const accountIds = [...new Set(items.map((p) => String(p.walletAccount)))];
  const accounts = await WalletAccount.find({ _id: { $in: accountIds } }).session(session);
  const accountById = new Map(accounts.map((account) => [String(account._id), account]));

  if (accounts.length !== accountIds.length) {
    throw new Error('One or more wallet accounts do not exist.');
  }

  const now = new Date();
  const entries = [];

  for (const posting of items) {
    const account = accountById.get(String(posting.walletAccount));
    if (account.status !== 'active') {
      throw new Error('A wallet in this transaction is not active.');
    }
    if (account.currency !== posting.currency) {
      throw new Error('Wallet posting currency does not match the wallet account currency.');
    }
    if (posting.ownerType !== account.ownerType ||
        String(posting.ownerId || '') !== String(account.ownerId || '')) {
      throw new Error('Ledger owner details do not match the wallet account.');
    }

    const field = BUCKET_FIELD[posting.bucket];
    const delta = posting.direction === 'credit' ? posting.amountMinor : -posting.amountMinor;
    const filter = { _id: account._id, status: 'active' };
    if (delta < 0) filter[field] = { $gte: posting.amountMinor };

    const updated = await WalletAccount.findOneAndUpdate(
      filter,
      { $inc: { [field]: delta, ledgerVersion: 1 }, $set: { lastLedgerAt: now } },
      { new: true, session, runValidators: true }
    );

    if (!updated) {
      throw new Error('Insufficient funds or wallet account changed during posting.');
    }

    const before = updated[field] - delta;
    entries.push({
      entryId: crypto.randomUUID(),
      transactionGroupId,
      idempotencyKey: `${transactionKey}:${posting.index}`,
      walletAccount: account._id,
      ownerType: account.ownerType,
      ownerId: account.ownerId || null,
      currency: account.currency,
      direction: posting.direction,
      type: posting.type,
      amountMinor: posting.amountMinor,
      balanceBeforeMinor: before,
      balanceAfterMinor: updated[field],
      bucket: posting.bucket,
      reference: posting.reference || transactionKey,
      orderId: orderId || posting.orderId || null,
      sellerId: sellerId || posting.sellerId || null,
      paymentReceipt: posting.paymentReceipt || '',
      createdBy: createdBy || null,
      description: posting.description || description,
      metadata: posting.metadata || {},
      createdAt: now,
    });
  }

  const created = await WalletLedgerEntry.insertMany(entries, { session, ordered: true });
  return { transactionGroupId, entries: created, alreadyApplied: false };
}

module.exports = {
  BUCKET_FIELD,
  toMinorUnits,
  fromMinorUnits,
  calculateCommissionMinor,
  normalizePostings,
  postBalancedTransaction,
};
