const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const {
  getPesapalConfig,
  checkSandboxAuthentication,
  resetTokenCache,
} = require('../services/pesapalService');

const originalEnvironment = process.env.PESAPAL_ENVIRONMENT;
const originalKey = process.env.PESAPAL_CONSUMER_KEY;
const originalSecret = process.env.PESAPAL_CONSUMER_SECRET;
const originalPost = axios.post;

test.after(() => {
  if (originalEnvironment === undefined) delete process.env.PESAPAL_ENVIRONMENT;
  else process.env.PESAPAL_ENVIRONMENT = originalEnvironment;
  if (originalKey === undefined) delete process.env.PESAPAL_CONSUMER_KEY;
  else process.env.PESAPAL_CONSUMER_KEY = originalKey;
  if (originalSecret === undefined) delete process.env.PESAPAL_CONSUMER_SECRET;
  else process.env.PESAPAL_CONSUMER_SECRET = originalSecret;
  axios.post = originalPost;
  resetTokenCache();
});

test('Pesapal configuration defaults to sandbox and uses the sandbox API', () => {
  process.env.PESAPAL_ENVIRONMENT = 'sandbox';
  process.env.PESAPAL_CONSUMER_KEY = 'test-key';
  process.env.PESAPAL_CONSUMER_SECRET = 'test-secret';

  const config = getPesapalConfig();
  assert.equal(config.environment, 'sandbox');
  assert.equal(config.baseUrl, 'https://cybqa.pesapal.com/pesapalv3/api');
});

test('production mode is rejected during sandbox integration', () => {
  process.env.PESAPAL_ENVIRONMENT = 'production';
  process.env.PESAPAL_CONSUMER_KEY = 'test-key';
  process.env.PESAPAL_CONSUMER_SECRET = 'test-secret';

  assert.throws(() => getPesapalConfig(), /production mode is disabled/i);
});

test('missing sandbox credentials are rejected', () => {
  process.env.PESAPAL_ENVIRONMENT = 'sandbox';
  delete process.env.PESAPAL_CONSUMER_KEY;
  delete process.env.PESAPAL_CONSUMER_SECRET;

  assert.throws(() => getPesapalConfig(), /credentials are not configured/i);
});

test('sandbox authentication obtains a token without returning it', async () => {
  process.env.PESAPAL_ENVIRONMENT = 'sandbox';
  process.env.PESAPAL_CONSUMER_KEY = 'test-key';
  process.env.PESAPAL_CONSUMER_SECRET = 'test-secret';
  resetTokenCache();

  let request;
  axios.post = async (...args) => {
    request = args;
    return { data: { token: 'mock-access-token', expiryDate: new Date(Date.now() + 240000).toISOString() } };
  };

  const result = await checkSandboxAuthentication();
  assert.equal(request[0], 'https://cybqa.pesapal.com/pesapalv3/api/Auth/RequestToken');
  assert.equal(request[1].consumer_key, 'test-key');
  assert.equal(request[1].consumer_secret, 'test-secret');
  assert.deepEqual(result, {
    authenticated: true,
    environment: 'sandbox',
    message: 'Pesapal sandbox authentication succeeded.',
  });
  assert.equal(JSON.stringify(result).includes('mock-access-token'), false);
});
