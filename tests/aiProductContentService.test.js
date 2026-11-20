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

test('Sylva AI enrichment uses the configured Ollama model without external provider calls', async (t) => {
  const previousUrl=process.env.OLLAMA_BASE_URL, previousModel=process.env.OLLAMA_MODEL, previousFetch=global.fetch;
  t.after(()=>{if(previousUrl===undefined)delete process.env.OLLAMA_BASE_URL;else process.env.OLLAMA_BASE_URL=previousUrl;if(previousModel===undefined)delete process.env.OLLAMA_MODEL;else process.env.OLLAMA_MODEL=previousModel;global.fetch=previousFetch;});
  process.env.OLLAMA_BASE_URL='http://private-model.internal:11434';
  process.env.OLLAMA_MODEL='qwen2.5:3b';
  const draft={verifiedBrand:'Example Brand',modelNumber:'EX-100',specifications:[{name:'Connectivity',value:'Wireless'}],researchSources:[],keyFeatures:['Wireless connectivity','Touch display','Activity tracking','Rechargeable design','Mobile notifications'],shortDescription:'A practical wearable with a touch display and activity tracking.',fullDescription:'<h3>Overview</h3><p>A wearable with a touch display and activity tracking features for everyday use.</p>',seoTitle:'Smart Wearable with Touch Display',seoMetaDescription:'Explore a smart wearable with a touch display, activity tracking and wireless connectivity.',marketingTags:['smart wearable','touch display','activity tracker','wireless device','wearable technology'],socialPromoCaption:'Keep everyday activity and notifications close with this practical wearable.',suggestedCategory:'Wearables',warnings:[],suggestions:[],missingSections:[]};
  let requestUrl='',body;
  global.fetch=async(url,options)=>{requestUrl=String(url);body=JSON.parse(options.body);return {ok:true,json:async()=>({message:{content:JSON.stringify(draft)}})};};
  const result=await generateAliExpressProductContent({title:'Smart Wearable',supplierBrand:'Example Brand',categoryName:'Wearables',rawDescription:'Touch display and activity tracking.',productAttributes:[{name:'Connectivity',value:'Wireless'}]});
  assert.equal(requestUrl,'http://private-model.internal:11434/api/chat');
  assert.equal(body.model,'qwen2.5:3b');
  assert.equal(result.provider,'sylva');
  assert.equal(result.model,'qwen2.5:3b');
  assert.equal(result.researchStatus,'no_sources_found');
  assert.equal(result.researchSources.length,0);
  assert.ok(result.warnings.some(x=>x.includes('no live web research')));
});
