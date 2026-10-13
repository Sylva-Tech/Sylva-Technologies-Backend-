const test = require('node:test');
const assert = require('node:assert/strict');

const {
  checkKraPin,
  namesMatch,
  normalizePin,
} = require('../services/kraPinVerificationService');

test('normalizes KRA PINs without changing valid content', () => {
  assert.equal(normalizePin(' a123456789b '), 'A123456789B');
});

test('rejects a malformed PIN before making a provider request', async () => {
  const result = await checkKraPin('NOT-A-PIN');
  assert.equal(result.status, 'invalid_format');
  assert.equal(result.provider, 'KRA');
});

test('matches normalized names with exact agreement', () => {
  assert.equal(namesMatch('Jane Wanjiku Doe', 'JANE WANJIKU DOE'), true);
});

test('does not treat a weak name overlap as proof of identity', () => {
  assert.equal(namesMatch('Jane Doe', 'Jane Njeri'), false);
});
