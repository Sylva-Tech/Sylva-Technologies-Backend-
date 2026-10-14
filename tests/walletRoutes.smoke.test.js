const test = require('node:test');
const assert = require('node:assert/strict');

test('wallet routes load without syntax or module errors', () => {
  assert.doesNotThrow(() => require('../routes/walletRoutes'));
  assert.doesNotThrow(() => require('../routes/adminWalletRoutes'));
});
