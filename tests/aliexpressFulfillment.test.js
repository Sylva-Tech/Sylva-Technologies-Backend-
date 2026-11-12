const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFulfillmentIdempotencyKey } = require('../services/aliexpressFulfillmentService');

test('builds a stable unique key for each order item', () => {
  assert.equal(buildFulfillmentIdempotencyKey('order-1', 'item-2'), 'order-1:item-2');
});

test('rejects missing order or item identifiers', () => {
  assert.throws(() => buildFulfillmentIdempotencyKey('', 'item-2'));
  assert.throws(() => buildFulfillmentIdempotencyKey('order-1', null));
});
