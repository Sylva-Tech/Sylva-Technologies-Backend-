const test = require('node:test');
const assert = require('node:assert/strict');
const { hashSource, validateContent, generateAliExpressProductContent } = require('../services/aiProductContentService');

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
    fullDescription: '<h3>Overview</h3><p>A sufficiently detailed product description based only on supplied verified attributes.</p><h3>Features</h3><ul><li>Verified USB-C connectivity</li><li>Compact design</li></ul>',
    seoTitle: 'Example USB-C Hub | Sylva Technologies',
    seoMetaDescription: 'A practical USB-C hub with verified connectivity details for everyday work.',
    marketingTags: ['USB-C hub', 'laptop accessories', 'connectivity', 'computer accessories', 'workstation accessories'],
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
  assert.throws(() => validateContent({ keyFeatures: [], shortDescription: 'Short', fullDescription: 'Too short', seoTitle: '', seoMetaDescription: '', marketingTags: [], socialPromoCaption: '', suggestedCategory: '', warnings: [] }), { code: 'AI_CONTENT_QUALITY_FAILED' });
});

test('validateContent rejects supplier and price disclosures in generated copy', () => {
  const input = {
    keyFeatures: ['Verified USB-C connectivity', 'Compact accessory design'],
    shortDescription: 'A practical USB-C hub for compatible laptops and work setups.',
    fullDescription: 'A sufficiently detailed product description that includes the supplier cost price of USD 10.',
    seoTitle: 'USB-C Hub for compatible laptops',
    seoMetaDescription: 'A practical USB-C hub for everyday use.',
    marketingTags: ['USB-C hub', 'laptop accessory', 'computer accessories', 'connectivity', 'workstation accessories'],
    socialPromoCaption: 'A practical accessory for compatible devices.',
    suggestedCategory: 'Computer Accessories',
    warnings: [],
  };
  assert.throws(() => validateContent(input), { code: 'AI_CONTENT_QUALITY_FAILED' });
});

test('validateContent preserves safe HTML and strips scripts, event attributes and unsafe elements', () => {
  const result = validateContent({
    keyFeatures: ['Verified USB-C connectivity', 'Compact accessory design', 'Seven ports', 'Plug-and-play operation', 'Laptop accessory'],
    shortDescription: 'A practical USB-C hub for compatible laptops and work setups.',
    fullDescription: '<h3>Overview</h3><p onclick="alert(1)">A sufficiently detailed description of this product using only verified supplier facts.</p><script>alert(2)</script><iframe src="bad">unsafe</iframe>',
    seoTitle: 'USB-C Hub for compatible laptops',
    seoMetaDescription: 'A practical USB-C hub with verified connectivity details for compatible laptops.',
    marketingTags: ['USB-C hub', 'laptop accessory', 'computer accessories', 'connectivity', 'workstation accessories'],
    socialPromoCaption: 'A practical accessory for compatible devices and everyday work.',
    suggestedCategory: 'Computer Accessories',
    warnings: [],
  });
  assert.match(result.description, /<h3>Overview<\/h3>/);
  assert.match(result.description, /<p>A sufficiently detailed description/);
  assert.doesNotMatch(result.description, /<script\b|<iframe\b|\bonclick\s*=|alert\s*\(/i);
});

test('Gemini generation sends the Sylva writing rules and uses the configured model', async (t) => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousModel = process.env.GEMINI_MODEL;
  const previousFetch = global.fetch;
  t.after(() => {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previousModel;
    global.fetch = previousFetch;
  });
  process.env.GEMINI_API_KEY = 'unit-test-key';
  process.env.GEMINI_MODEL = 'gemini-3.5-flash-lite';
  const draft = {
    keyFeatures: ['Wireless connectivity', 'Touch display', 'Activity tracking', 'Rechargeable design', 'Mobile notifications'],
    shortDescription: 'A practical wearable with a touch display and activity tracking.',
    fullDescription: '<h3>Overview</h3><p>A wearable with a touch display and activity tracking features for everyday use.</p>',
    seoTitle: 'Smart Wearable with Touch Display',
    seoMetaDescription: 'Explore a smart wearable with a touch display, activity tracking and wireless connectivity.',
    marketingTags: ['smart wearable', 'touch display', 'activity tracker', 'wireless device', 'wearable technology'],
    socialPromoCaption: 'Keep everyday activity and notifications close with this practical wearable.',
    suggestedCategory: 'Wearables',
    warnings: ['Battery capacity was not supplied.'],
    suggestions: [],
    missingSections: ['Battery capacity'],
  };
  let requestUrl = '';
  let requestBody;
  global.fetch = async (url, options) => {
    requestUrl = String(url);
    requestBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(draft) }] } }] }) };
  };
  const result = await generateAliExpressProductContent({
    title: 'Smart Wearable',
    supplierBrand: 'Example Brand',
    categoryName: 'Wearables',
    rawDescription: 'Touch display and activity tracking.',
    productAttributes: [{ name: 'Connectivity', value: 'Wireless' }],
  });
  assert.match(requestUrl, /models\/gemini-3\.5-flash-lite:generateContent$/);
  const instructions = requestBody.systemInstruction.parts[0].text;
  assert.match(instructions, /Never invent missing technical specifications, RAM, storage, battery capacity, model numbers/);
  assert.match(instructions, /clean, semantic HTML/);
  assert.match(instructions, /administrator must review and approve every draft/);
  assert.equal(result.model, 'gemini-3.5-flash-lite');
  assert.equal(result.marketingTags.length, 5);
});
