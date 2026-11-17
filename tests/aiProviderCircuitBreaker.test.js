const test = require('node:test');
const assert = require('node:assert/strict');
const { isQuotaExhaustion, getCooldownMinutes } = require('../services/aiProviderCircuitBreaker');

test('recognizes exhausted Gemini quota separately from ordinary rate limiting', () => {
  assert.equal(isQuotaExhaustion({ providerStatus: 429, providerCode: 'RESOURCE_EXHAUSTED', providerMessage: 'You exceeded your current quota. Check billing details.' }), true);
  assert.equal(isQuotaExhaustion({ providerStatus: 429, providerCode: 'RESOURCE_EXHAUSTED', providerMessage: 'Requests per minute exceeded.' }), false);
  assert.equal(isQuotaExhaustion({ providerStatus: 429, providerCode: 'RESOURCE_EXHAUSTED', providerMessage: 'Too many requests. Please retry later.' }), false);
  assert.equal(isQuotaExhaustion({ providerStatus: 429, providerCode: 'RESOURCE_EXHAUSTED', providerMessage: 'You exceeded your current quota. See https://aistudio.google.com/docs/rate-limits.' }), true);
  assert.equal(isQuotaExhaustion({ providerStatus: 503, providerMessage: 'quota exceeded' }), false);
});

test('bounds quota cooldown to 15 minutes through 24 hours', (t) => {
  const previous = process.env.GEMINI_QUOTA_COOLDOWN_MINUTES;
  t.after(() => { if (previous === undefined) delete process.env.GEMINI_QUOTA_COOLDOWN_MINUTES; else process.env.GEMINI_QUOTA_COOLDOWN_MINUTES = previous; });
  delete process.env.GEMINI_QUOTA_COOLDOWN_MINUTES;
  assert.equal(getCooldownMinutes(), 1440);
  process.env.GEMINI_QUOTA_COOLDOWN_MINUTES = '5';
  assert.equal(getCooldownMinutes(), 15);
  process.env.GEMINI_QUOTA_COOLDOWN_MINUTES = '2000';
  assert.equal(getCooldownMinutes(), 1440);
});
