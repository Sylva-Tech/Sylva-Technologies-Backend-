'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cloudflareOriginGuard,
  noStoreFinancialResponses,
} = require('../middleware/financialSecurity');

function mockResponse() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    set(values) {
      Object.assign(this.headers, values);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('origin guard stays backward compatible when no secret is configured', (t) => {
  const old = process.env.CLOUDFLARE_ORIGIN_SECRET;
  delete process.env.CLOUDFLARE_ORIGIN_SECRET;
  t.after(() => {
    if (old === undefined) delete process.env.CLOUDFLARE_ORIGIN_SECRET;
    else process.env.CLOUDFLARE_ORIGIN_SECRET = old;
  });

  let continued = false;
  cloudflareOriginGuard({ get: () => '' }, mockResponse(), () => { continued = true; });
  assert.equal(continued, true);
});

test('origin guard rejects a missing or incorrect secret', (t) => {
  const old = process.env.CLOUDFLARE_ORIGIN_SECRET;
  process.env.CLOUDFLARE_ORIGIN_SECRET = 'test-secret-that-is-long-enough';
  t.after(() => {
    if (old === undefined) delete process.env.CLOUDFLARE_ORIGIN_SECRET;
    else process.env.CLOUDFLARE_ORIGIN_SECRET = old;
  });

  const res = mockResponse();
  let continued = false;
  cloudflareOriginGuard({ get: () => 'wrong-secret', method: 'POST', path: '/payout' }, res, () => { continued = true; });
  assert.equal(continued, false);
  assert.equal(res.statusCode, 403);
});

test('origin guard accepts the configured secret', (t) => {
  const old = process.env.CLOUDFLARE_ORIGIN_SECRET;
  process.env.CLOUDFLARE_ORIGIN_SECRET = 'test-secret-that-is-long-enough';
  t.after(() => {
    if (old === undefined) delete process.env.CLOUDFLARE_ORIGIN_SECRET;
    else process.env.CLOUDFLARE_ORIGIN_SECRET = old;
  });

  let continued = false;
  cloudflareOriginGuard({ get: () => 'test-secret-that-is-long-enough' }, mockResponse(), () => { continued = true; });
  assert.equal(continued, true);
});

test('financial responses are explicitly marked non-cacheable', () => {
  const res = mockResponse();
  let continued = false;
  noStoreFinancialResponses({}, res, () => { continued = true; });
  assert.equal(continued, true);
  assert.match(res.headers['Cache-Control'], /no-store/);
  assert.equal(res.headers.Pragma, 'no-cache');
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
});
