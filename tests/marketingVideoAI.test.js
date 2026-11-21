const test = require('node:test');
const assert = require('node:assert/strict');
const { generateMarketingVideoScript } = require('../services/marketingVideoAI');

const originalFetch = global.fetch;
const originalBase = process.env.OLLAMA_BASE_URL;
const originalModel = process.env.OLLAMA_MODEL;

test('video script generation fails closed when Ollama is not configured', async () => {
  delete process.env.OLLAMA_BASE_URL;
  await assert.rejects(
    generateMarketingVideoScript({ name: 'Test product', price: 100, stock: 1 }),
    (error) => error.code === 'SYLVA_AI_NOT_CONFIGURED' && error.status === 503
  );
});

test('video script generation uses Ollama and returns a validated storyboard', async () => {
  process.env.OLLAMA_BASE_URL = 'http://ollama.test';
  process.env.OLLAMA_MODEL = 'qwen2.5:3b';
  const storyboard = {
    title: 'A better way to work',
    hook: 'Meet your next everyday essential.',
    voiceover: 'Discover this product at Sylva Technologies.',
    caption: 'Shop online at Sylva Technologies.',
    hashtags: ['#SylvaTechnologies', '#TechKenya'],
    scenes: [
      { heading: 'Meet the product', overlay: 'A practical choice for everyday use.', narration: 'Meet the product.', visualDirection: 'Show the product image.', seconds: 4 },
      { heading: 'Made for your routine', overlay: 'Explore the product details.', narration: 'Explore the details.', visualDirection: 'Slow product zoom.', seconds: 4 },
      { heading: 'Available at Sylva', overlay: 'Shop with Sylva Technologies.', narration: 'Shop with Sylva.', visualDirection: 'Show the brand mark.', seconds: 4 },
      { heading: 'Shop online', overlay: 'Visit sylvatechnologies.co.ke.', narration: 'Visit our website.', visualDirection: 'Show the call to action.', seconds: 4 },
    ],
  };
  global.fetch = async (url, options) => {
    assert.equal(url, 'http://ollama.test/api/chat');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'qwen2.5:3b');
    assert.equal(body.stream, false);
    return new Response(JSON.stringify({ message: { content: JSON.stringify(storyboard) } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const result = await generateMarketingVideoScript({
    name: 'Test product',
    brand: 'Test brand',
    sku: 'TEST-1',
    price: 100,
    stock: 2,
    description: 'A simple test product.',
    keyFeatures: ['Simple setup'],
    specifications: {},
    images: ['https://images.example.test/product.jpg'],
    slug: 'test-product',
  }, { platform: 'instagram', durationSeconds: 20 });
  assert.equal(result.generation.provider, 'sylva-ollama');
  assert.equal(result.scenes.length, 4);
  assert.equal(result.product.priceKes, 100);
  assert.equal(result.product.image, 'https://images.example.test/product.jpg');
});

test('video script generation rejects unsupported numeric product claims', async () => {
  process.env.OLLAMA_BASE_URL = 'http://ollama.test';
  global.fetch = async () => new Response(JSON.stringify({
    message: { content: JSON.stringify({
      title: 'Test product 999',
      hook: 'A product for your day.',
      voiceover: 'Explore this product.',
      caption: 'Available now.',
      hashtags: [],
      scenes: [
        { heading: 'Test product', overlay: 'A simple product.', seconds: 4 },
        { heading: 'Explore', overlay: 'See the details.', seconds: 4 },
        { heading: 'Shop', overlay: 'Visit Sylva.', seconds: 4 },
        { heading: 'Order', overlay: 'Shop online.', seconds: 4 },
      ],
    }) },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(
    generateMarketingVideoScript({ name: 'Test product', price: 100, stock: 1, images: [] }),
    (error) => error.code === 'SYLVA_AI_UNSUPPORTED_CLAIM' && error.status === 422
  );
});

test.after(() => {
  global.fetch = originalFetch;
  if (originalBase === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = originalBase;
  if (originalModel === undefined) delete process.env.OLLAMA_MODEL;
  else process.env.OLLAMA_MODEL = originalModel;
});
