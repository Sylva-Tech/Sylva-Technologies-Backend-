const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAuthorizationUrl,
  encryptSecret,
  decryptSecret,
} = require('../services/aliexpressService');

const originalEnv = { ...process.env };

test('builds the AliExpress OAuth URL with the registered callback and state', () => {
  process.env.ALIEXPRESS_APP_KEY = 'test-app-key';
  process.env.ALIEXPRESS_APP_SECRET = 'test-app-secret';
  process.env.ALIEXPRESS_REDIRECT_URI = 'https://www.sylvatechnologies.co.ke/callback';
  const url = new URL(buildAuthorizationUrl('one-time-state'));
  assert.equal(url.origin, 'https://api-sg.aliexpress.com');
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'test-app-key');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://www.sylvatechnologies.co.ke/callback');
  assert.equal(url.searchParams.get('state'), 'one-time-state');
  assert.equal(url.searchParams.get('response_type'), 'code');
});

test('encrypts and decrypts supplier tokens with AES-256-GCM', () => {
  process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
  const token = 'private-access-token-value';
  const encrypted = encryptSecret(token);
  assert.notEqual(encrypted, token);
  assert.equal(decryptSecret(encrypted), token);
});

test('rejects invalid token encryption keys', () => {
  process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY = 'not-a-32-byte-hex-key';
  assert.throws(() => encryptSecret('token'), /64-character hexadecimal key/);
});

test.after(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;
});
