'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  toMinorUnits,
  fromMinorUnits,
  calculateCommissionMinor,
  normalizePostings,
} = require('../services/walletLedgerService');

const accountA = '507f1f77bcf86cd799439011';
const accountB = '507f1f77bcf86cd799439012';

test('converts KES values to integer minor units', () => {
  assert.equal(toMinorUnits(125.45), 12545);
  assert.equal(fromMinorUnits(12545), 125.45);
});

test('rejects invalid money values', () => {
  assert.throws(() => toMinorUnits(-1), /non-negative/);
  assert.throws(() => toMinorUnits(Number.NaN), /finite/);
  assert.throws(() => fromMinorUnits(1.2), /safe integer/);
});

test('calculates 4% commission on product subtotal minor units', () => {
  const productSubtotalMinor = toMinorUnits(1000);
  const deliveryFeeMinor = toMinorUnits(150);
  const commissionMinor = calculateCommissionMinor(productSubtotalMinor, 400);

  assert.equal(commissionMinor, 4000);
  assert.equal(fromMinorUnits(commissionMinor), 40);
  assert.equal(fromMinorUnits(commissionMinor), 1000 * 0.04);
  // Delivery is deliberately not an input to the commission function.
  assert.equal(fromMinorUnits(commissionMinor), 40);
  assert.equal(deliveryFeeMinor, 15000);
});

test('supports configurable commission rates and safe validation', () => {
  assert.equal(calculateCommissionMinor(10000, 250), 250);
  assert.equal(calculateCommissionMinor(10000, 0), 0);
  assert.throws(() => calculateCommissionMinor(-1, 400), /subtotal/);
  assert.throws(() => calculateCommissionMinor(100, 10001), /basis points/);
});

test('requires ledger postings to balance debits and credits', () => {
  const balanced = normalizePostings([
    { walletAccount: accountA, direction: 'debit', amountMinor: 5000, bucket: 'available' },
    { walletAccount: accountB, direction: 'credit', amountMinor: 5000, bucket: 'escrow' },
  ]);
  assert.equal(balanced.length, 2);
  assert.throws(() => normalizePostings([
    { walletAccount: accountA, direction: 'debit', amountMinor: 5000, bucket: 'available' },
    { walletAccount: accountB, direction: 'credit', amountMinor: 4999, bucket: 'escrow' },
  ]), /Unbalanced/);
});
