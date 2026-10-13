const test = require('node:test');
const assert = require('node:assert/strict');

process.env.MAIL_ATTACHMENT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('hex');

const { encryptAttachment, decryptAttachment } = require('../utils/mailAttachmentCrypto');
const { encryptMessageContent, decryptMessageContent } = require('../utils/mailMessageCrypto');

test('message content is encrypted at rest and round-trips', () => {
  const original = { subject: 'Private subject', text: 'Private message body', html: '<p>Private HTML</p>', replies: [{ text: 'Reply body' }] };
  const encrypted = encryptMessageContent(original);

  assert.equal(encrypted.subject, '(Encrypted message)');
  assert.equal(encrypted.text, '');
  assert.equal(encrypted.html, '');
  assert.equal(encrypted.contentEncryptionVersion, 1);
  assert.ok(!encrypted.contentCiphertext.includes(original.text));

  const opened = decryptMessageContent(encrypted);
  assert.equal(opened.subject, original.subject);
  assert.equal(opened.text, original.text);
  assert.equal(opened.html, original.html);
  assert.deepEqual(opened.replies, original.replies);
  assert.equal(Object.hasOwn(opened, 'contentCiphertext'), false);
});

test('tampered message ciphertext fails authentication', () => {
  const encrypted = encryptMessageContent({ subject: 'Subject', text: 'Body' });
  encrypted.contentAuthTag = Buffer.alloc(16).toString('base64');
  assert.throws(() => decryptMessageContent(encrypted));
});

test('attachment bytes are encrypted and round-trip', () => {
  const original = Buffer.from('private attachment bytes');
  const encrypted = encryptAttachment(original);
  assert.notEqual(Buffer.from(encrypted.contentBase64, 'base64').toString('utf8'), original.toString('utf8'));
  assert.deepEqual(decryptAttachment(encrypted), original);
});

test('tampered attachment fails authentication', () => {
  const encrypted = encryptAttachment(Buffer.from('private file'));
  encrypted.encryptionAuthTag = Buffer.alloc(16).toString('base64');
  assert.throws(() => decryptAttachment(encrypted));
});
