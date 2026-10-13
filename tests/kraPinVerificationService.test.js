const test = require('node:test');
const assert = require('node:assert/strict');

const {
  checkKraPin,
  checkKraId,
  namesMatch,
  normalizePin,
  normalizeId,
} = require('../services/kraPinVerificationService');

test('normalizes KRA PINs without changing valid content', () => {
  assert.equal(normalizePin(' a123456789b '), 'A123456789B');
});

test('rejects a malformed PIN before making a provider request', async () => {
  const result = await checkKraPin('NOT-A-PIN');
  assert.equal(result.status, 'invalid_format');
  assert.equal(result.provider, 'KRA');
});

test('matches normalized names with exact agreement', () => {
  assert.equal(namesMatch('Jane Wanjiku Doe', 'JANE WANJIKU DOE'), true);
});

test('does not treat a weak name overlap as proof of identity', () => {
  assert.equal(namesMatch('Jane Doe', 'Jane Njeri'), false);
});


test('normalizes national ID values by trimming whitespace only', () => {
  assert.equal(normalizeId(' 4178 9723 '), '41789723');
});

test('returns invalid_format for a missing ID without calling KRA', async () => {
  const result = await checkKraId('', 'KE');
  assert.equal(result.status, 'invalid_format');
});

test('checks national ID through KRA and returns the linked PIN/name', async () => {
  const axios = require('axios');
  const oldGet = axios.get;
  const oldPost = axios.post;
  const oldKey = process.env.KRA_CONSUMER_KEY;
  const oldSecret = process.env.KRA_CONSUMER_SECRET;
  const requests = [];

  process.env.KRA_CONSUMER_KEY = 'test-consumer-key';
  process.env.KRA_CONSUMER_SECRET = 'test-consumer-secret';
  axios.get = async (url, options) => {
    assert.match(url, /token\/generate/);
    assert.match(options.headers.Authorization, /^Basic /);
    return { data: { access_token: 'unit-test-token', expires_in: '3599' } };
  };
  axios.post = async (url, data, options) => {
    requests.push({ url, data, options });
    return {
      data: {
        TaxpayerPIN: 'A744610021G',
        TaxpayerName: 'SAMPLE TEST PERSON',
      },
    };
  };

  try {
    const result = await checkKraId('41789723', 'KE');
    assert.equal(result.status, 'verified');
    assert.equal(result.taxpayerPin, 'A744610021G');
    assert.equal(result.taxpayerName, 'SAMPLE TEST PERSON');
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/checker\/v1\/pin$/);
    assert.deepEqual(requests[0].data, {
      TaxpayerType: 'KE',
      TaxpayerID: '41789723',
    });
    assert.equal(requests[0].options.headers.Authorization, 'Bearer unit-test-token');
  } finally {
    axios.get = oldGet;
    axios.post = oldPost;
    if (oldKey === undefined) delete process.env.KRA_CONSUMER_KEY;
    else process.env.KRA_CONSUMER_KEY = oldKey;
    if (oldSecret === undefined) delete process.env.KRA_CONSUMER_SECRET;
    else process.env.KRA_CONSUMER_SECRET = oldSecret;
  }
});

test('recognizes KRA invalid national ID response', async () => {
  const axios = require('axios');
  const oldPost = axios.post;
  axios.post = async () => ({
    data: {
      ErrorCode: '30002',
      ErrorMessage: 'Invalid ID',
    },
  });
  try {
    const result = await checkKraId('00000000', 'KE');
    assert.equal(result.status, 'invalid');
    assert.equal(result.responseCode, '30002');
  } finally {
    axios.post = oldPost;
  }
});
