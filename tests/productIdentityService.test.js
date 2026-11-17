const test = require('node:test');
const assert = require('node:assert/strict');

const Product = require('../models/Product');
const ProductCodeSequence = require('../models/ProductCodeSequence');
const { generateUniqueProductCode } = require('../services/productIdentityService');

test('generates a sequential seller product code', async () => {
  const originalSequence = ProductCodeSequence.findOneAndUpdate;
  const originalExists = Product.exists;
  let sequence = 0;

  ProductCodeSequence.findOneAndUpdate = async () => ({ sequence: ++sequence });
  Product.exists = async () => null;

  try {
    assert.equal(await generateUniqueProductCode('SELL'), 'SELL-000001');
    assert.equal(await generateUniqueProductCode('SELL'), 'SELL-000002');
  } finally {
    ProductCodeSequence.findOneAndUpdate = originalSequence;
    Product.exists = originalExists;
  }
});

test('skips a code already present in products', async () => {
  const originalSequence = ProductCodeSequence.findOneAndUpdate;
  const originalExists = Product.exists;
  let sequence = 0;

  ProductCodeSequence.findOneAndUpdate = async () => ({ sequence: ++sequence });
  Product.exists = async ({ code }) => code === 'ALI-000001' ? { _id: 'existing' } : null;

  try {
    assert.equal(await generateUniqueProductCode('ALI'), 'ALI-000002');
  } finally {
    ProductCodeSequence.findOneAndUpdate = originalSequence;
    Product.exists = originalExists;
  }
});

test('rejects unsupported product code prefixes', async () => {
  await assert.rejects(
    () => generateUniqueProductCode('SYLT'),
    /Unsupported product code prefix/
  );
});
