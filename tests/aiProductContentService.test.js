const test = require('node:test');
const assert = require('node:assert/strict');
const { hashSource, validateContent } = require('../services/aiProductContentService');

test('hashSource is stable for the same whitelisted product facts', () => {
  const product = { title: 'USB-C Hub', supplierBrand: 'Example', productAttributes: [{ name: 'Ports', value: '7' }] };
  assert.equal(hashSource(product), hashSource(product));
});

test('hashSource ignores unrelated private catalogue fields', () => {
  const first = { title: 'USB-C Hub', supplierBrand: 'Example', productAttributes: [{ name: 'Ports', value: '7' }], supplierPrice: 12 };
  const second = { ...first, supplierPrice: 999, supplierStoreUrl: 'https://private.invalid' };
  assert.equal(hashSource(first), hashSource(second));
});

test('validateContent accepts factual structured content and caps key features', () => {
  const result = validateContent({
    keyFeatures: Array.from({ length: 10 }, (_, index) => 'Feature ' + index),
    shortDescription: 'A concise and factual product summary for customers.',
    description: 'A sufficiently detailed product description based only on supplied verified attributes.',
    warnings: [],
  });
  assert.equal(result.keyFeatures.length, 8);
});

test('validateContent rejects incomplete or low-quality output', () => {
  assert.throws(() => validateContent({ keyFeatures: [], shortDescription: 'Short', description: 'Too short', warnings: [] }), { code: 'AI_CONTENT_QUALITY_FAILED' });
});
