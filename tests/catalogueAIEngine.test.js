const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDraft, CATEGORIES } = require('../services/catalogueAIEngine');

const validDraft = () => ({
  title: 'Wireless Bluetooth Keyboard',
  category: 'Accessories',
  shortDescription: 'A compact wireless keyboard for compatible devices.',
  longDescription: '<h3>Overview</h3><p>A wireless keyboard for everyday typing tasks.</p>',
  keyFeatures: [
    'Wireless connectivity',
    'Compact keyboard layout',
    'Dedicated typing keys',
    'Portable design',
    'Compatible connection interface',
  ],
  specifications: {
    Brand: 'Logitech',
    Model: 'K380',
    Category: 'Accessories',
    'Key Technical Specs': ['Bluetooth connectivity'],
  },
  delivery_information: 'Refer to Sylva Technologies shipping information.',
  warranty_policy: 'Refer to the manufacturer warranty information.',
  return_policy: 'See Sylva Technologies Returns & Refunds policy.',
  seo_meta: {
    meta_title: 'Wireless Bluetooth Keyboard',
    meta_description: 'A compact wireless keyboard for everyday typing and compatible devices.',
    tags: ['wireless keyboard', 'Bluetooth keyboard', 'computer accessories', 'compact keyboard', 'typing'],
  },
});

test('validates a catalogue draft and strips unsupported HTML', () => {
  const input = validDraft();
  input.longDescription += '<script>alert(1)</script><iframe src="x"></iframe>';
  const result = validateDraft(input);
  assert.equal(result.keyFeatures.length, 5);
  assert.equal(result.seo_meta.tags.length, 5);
  assert.equal(result.longDescription.includes('<script'), false);
  assert.equal(result.longDescription.includes('<iframe'), false);
  assert.ok(CATEGORIES.includes(result.category));
});

test('accepts fewer than five factual features without inventing missing details', () => {
  const input = validDraft();
  input.keyFeatures = input.keyFeatures.slice(0, 4);
  const result = validateDraft(input);
  assert.equal(result.keyFeatures.length, 4);
});

test('rejects drafts with no factual key features', () => {
  const input = validDraft();
  input.keyFeatures = [];
  assert.throws(() => validateDraft(input), { code: 'CATALOGUE_AI_QUALITY_FAILED' });
});

test('rejects supplier-facing or private business copy', () => {
  const input = validDraft();
  input.shortDescription = 'AliExpress supplier product at a low wholesale price.';
  assert.throws(() => validateDraft(input), { code: 'CATALOGUE_AI_PRIVATE_CONTENT' });
});

test('rejects unsupported business-use claims when product input does not support them', () => {
  const input = validDraft();
  input.longDescription = '<h3>Overview</h3><p>This laptop is designed for business use.</p>';
  assert.throws(
    () => validateDraft(input, { title: 'Dell Latitude 5420', brand: 'Dell', category: 'Laptop', description: 'Intel Core i5' }),
    { code: 'CATALOGUE_AI_UNSUPPORTED_CLAIM' }
  );
});

test('rejects numeric specifications that are absent from supplied product facts', () => {
  const input = validDraft();
  input.shortDescription = 'A wireless Bluetooth keyboard with 16GB memory for compatible devices.';
  assert.throws(
    () => validateDraft(input, { title: 'Wireless Bluetooth Keyboard', brand: 'Logitech', specifications: { Connectivity: 'Bluetooth' } }),
    { code: 'CATALOGUE_AI_UNSUPPORTED_CLAIM' }
  );
});

test('does not accept a category outside Sylva catalogue taxonomy', () => {
  const input = validDraft();
  input.category = 'Home Appliances';
  assert.equal(validateDraft(input).category, 'Accessories');
});
