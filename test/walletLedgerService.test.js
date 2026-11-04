'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  toMinorUnits,
  fromMinorUnits,
  calculateCommissionMinor,
  getCommissionRateBps,
  normalizePostings,
} = require('../services/walletLedgerService');
const { paypalHelpers } = require('../routes/orderRoutes');

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

test('defaults to a configurable 4% commission rate in basis points', () => {
  assert.equal(getCommissionRateBps(undefined), 400);
  assert.equal(getCommissionRateBps('250'), 250);
  assert.equal(getCommissionRateBps('0'), 0);
  assert.throws(() => getCommissionRateBps('4%'), /PLATFORM_COMMISSION_RATE_BPS/);
  assert.throws(() => getCommissionRateBps('10001'), /PLATFORM_COMMISSION_RATE_BPS/);
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

test('paypal helpers use sandbox by default and validate the conversion rate', () => {
  const previousMode = process.env.PAYPAL_MODE;
  const previousRate = process.env.WALLET_KES_PER_USD;

  process.env.PAYPAL_MODE = 'sandbox';
  process.env.WALLET_KES_PER_USD = '120';

  try {
    assert.equal(paypalHelpers.getPayPalApiBase(), 'https://api-m.sandbox.paypal.com');
    assert.equal(paypalHelpers.getPayPalUsdAmount(2400), 20);
    assert.throws(() => paypalHelpers.getPayPalUsdAmount(-1), /Invalid KES amount/);
  } finally {
    if (previousMode === undefined) delete process.env.PAYPAL_MODE;
    else process.env.PAYPAL_MODE = previousMode;

    if (previousRate === undefined) delete process.env.WALLET_KES_PER_USD;
    else process.env.WALLET_KES_PER_USD = previousRate;
  }
});

test('paypal access token helper fails fast when sandbox credentials are missing', async () => {
  const previousClientId = process.env.PAYPAL_CLIENT_ID;
  const previousSecret = process.env.PAYPAL_CLIENT_SECRET;

  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;

  try {
    await assert.rejects(
      () => paypalHelpers.getPayPalAccessToken(),
      /PayPal is not configured on the server/
    );
  } finally {
    if (previousClientId === undefined) delete process.env.PAYPAL_CLIENT_ID;
    else process.env.PAYPAL_CLIENT_ID = previousClientId;

    if (previousSecret === undefined) delete process.env.PAYPAL_CLIENT_SECRET;
    else process.env.PAYPAL_CLIENT_SECRET = previousSecret;
  }
});
