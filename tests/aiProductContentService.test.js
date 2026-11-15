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
    seoTitle: 'Example USB-C Hub | Sylva Technologies',
    seoMetaDescription: 'A practical USB-C hub with verified connectivity details for everyday work.',
    marketingTags: ['USB-C hub', 'laptop accessories', 'connectivity'],
    socialPromoCaption: 'A practical USB-C hub for compatible devices. Check the listed specifications before ordering.',
    suggestedCategory: 'Computer Accessories',
    warnings: [],
  });
  assert.equal(result.keyFeatures.length, 7);
  assert.ok(result.shortDescription.length <= 160);
  assert.ok(result.seoTitle.length <= 60);
  assert.ok(result.seoMetaDescription.length <= 155);
  assert.equal(result.suggestedCategory, 'Computer Accessories');
});

test('validateContent rejects incomplete or low-quality output', () => {
  assert.throws(() => validateContent({ keyFeatures: [], shortDescription: 'Short', description: 'Too short', seoTitle: '', seoMetaDescription: '', marketingTags: [], socialPromoCaption: '', suggestedCategory: '', warnings: [] }), { code: 'AI_CONTENT_QUALITY_FAILED' });
});

test('validateContent rejects supplier and price disclosures in generated copy', () => {
  const input = {
    keyFeatures: ['Verified USB-C connectivity', 'Compact accessory design'],
    shortDescription: 'A practical USB-C hub for compatible laptops and work setups.',
    description: 'A sufficiently detailed product description that includes the supplier cost price of USD 10.',
    seoTitle: 'USB-C Hub for compatible laptops',
    seoMetaDescription: 'A practical USB-C hub for everyday use.',
    marketingTags: ['USB-C hub', 'laptop accessory'],
    socialPromoCaption: 'A practical accessory for compatible devices.',
    suggestedCategory: 'Computer Accessories',
    warnings: [],
  };
  assert.throws(() => validateContent(input), { code: 'AI_CONTENT_QUALITY_FAILED' });
});
