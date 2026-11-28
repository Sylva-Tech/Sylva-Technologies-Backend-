const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REQUIRED_PERMISSIONS,
  TARGET_PAGE_NAME,
  encryptPageToken,
  decryptPageToken,
  chooseSylvaPage,
  verifyMetaSignedRequest,
} = require('../services/metaFacebookService');

test('Meta publishing requests only the minimum Page permissions', () => {
  assert.deepEqual(REQUIRED_PERMISSIONS, [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
  ]);
});

test('Page token encryption uses authenticated encryption and round-trips', () => {
  process.env.META_TOKEN_ENCRYPTION_KEY = '11'.repeat(32);
  const token = 'test-page-token-never-store-in-plain-text';
  const encrypted = encryptPageToken(token);

  assert.notEqual(encrypted.pageTokenCiphertext, Buffer.from(token).toString('base64'));
  assert.equal(decryptPageToken(encrypted), token);
  assert.ok(encrypted.pageTokenIv);
  assert.ok(encrypted.pageTokenAuthTag);
});

test('Page token encryption rejects missing or incorrectly sized keys', () => {
  const previous = process.env.META_TOKEN_ENCRYPTION_KEY;
  process.env.META_TOKEN_ENCRYPTION_KEY = 'not-a-valid-key';
  assert.throws(() => encryptPageToken('token'), { code: 'META_ENCRYPTION_KEY_MISSING' });
  if (previous === undefined) delete process.env.META_TOKEN_ENCRYPTION_KEY;
  else process.env.META_TOKEN_ENCRYPTION_KEY = previous;
});

test('only the exact Sylva Technologies Page is selected', () => {
  const page = chooseSylvaPage([{
    id: '123456789',
    name: 'sylva technologies',
    access_token: 'page-token',
    tasks: ['CREATE_CONTENT'],
  }]);
  assert.equal(TARGET_PAGE_NAME, 'Sylva Technologies');
  assert.equal(page.id, '123456789');
});

test('Page selection accepts Meta can_post confirmation when /me/accounts omits task details', () => {
  const page = chooseSylvaPage([{
    id: '1436924676168084',
    name: 'Sylva Technologies',
    access_token: 'page-token',
    can_post: true,
  }]);
  assert.equal(page.can_post, true);
});

test('Page selection rejects a similarly named Page', () => {
  assert.throws(
    () => chooseSylvaPage([{
      id: '123',
      name: 'Sylva Technologies Kenya Fan Club',
      access_token: 'token',
      tasks: ['CREATE_CONTENT'],
    }]),
    { code: 'META_PAGE_NOT_FOUND' }
  );
});

test('Page selection rejects accounts without content publishing task', () => {
  assert.throws(
    () => chooseSylvaPage([{
      id: '123',
      name: 'Sylva Technologies',
      access_token: 'token',
      tasks: ['ANALYZE'],
    }]),
    { code: 'META_PAGE_TASK_MISSING' }
  );
});

test('Meta data deletion callback verifies the signed request before trusting its user ID', () => {
  const crypto = require('node:crypto');
  process.env.META_APP_SECRET = 'test-meta-app-secret';
  const encodedPayload = Buffer.from(JSON.stringify({
    algorithm: 'HMAC-SHA256',
    user_id: '987654321',
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', process.env.META_APP_SECRET)
    .update(encodedPayload).digest('base64url');
  const payload = verifyMetaSignedRequest(signature + '.' + encodedPayload);
  assert.equal(payload.user_id, '987654321');
  assert.throws(
    () => verifyMetaSignedRequest(Buffer.from('wrong').toString('base64url') + '.' + encodedPayload),
    { code: 'META_SIGNED_REQUEST_INVALID' }
  );
});
