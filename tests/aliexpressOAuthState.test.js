const test = require('node:test');
const assert = require('node:assert/strict');
const { isAliExpressOAuthStateValid } = require('../services/aliexpressOAuthState');

test('accepts a valid, unexpired OAuth state date', () => {
  const now = Date.parse('2026-11-12T18:00:00.000Z');
  assert.equal(isAliExpressOAuthStateValid(new Date(now + 60_000), now), true);
});

test('rejects an expired OAuth state date', () => {
  const now = Date.parse('2026-11-12T18:00:00.000Z');
  assert.equal(isAliExpressOAuthStateValid(new Date(now - 1), now), false);
});

test('rejects a state expiring at the current instant', () => {
  const now = Date.parse('2026-11-12T18:00:00.000Z');
  assert.equal(isAliExpressOAuthStateValid(new Date(now), now), false);
});

test('rejects missing, malformed, and non-Date expiry values', () => {
  assert.equal(isAliExpressOAuthStateValid(null), false);
  assert.equal(isAliExpressOAuthStateValid(undefined), false);
  assert.equal(isAliExpressOAuthStateValid('2026-11-12T18:01:00.000Z'), false);
  assert.equal(isAliExpressOAuthStateValid(new Date(Number.NaN)), false);
});
