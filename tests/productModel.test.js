const test = require('node:test');
const assert = require('node:assert/strict');

const Product = require('../models/Product');

test('product schema exposes recommended merchandising fields', () => {
  assert.ok(Product.schema.paths.recommended, 'recommended flag missing');
  assert.ok(Product.schema.paths.recommendedReason, 'recommendedReason missing');
  assert.ok(Product.schema.paths.highlightTags, 'highlightTags missing');
  assert.ok(Product.schema.paths.isBestSeller, 'isBestSeller missing');
});
