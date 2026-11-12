const test = require('node:test');
const assert = require('node:assert/strict');
const { encryptAttachment, decryptAttachment } = require('../utils/mailAttachmentCrypto');
const { encryptMessageContent, decryptMessageContent } = require('../utils/mailMessageCrypto');

const previousKey = process.env.MAIL_ATTACHMENT_ENCRYPTION_KEY;

test('Sylva Mail encrypts and decrypts message content with authenticated encryption', () => {
  process.env.MAIL_ATTACHMENT_ENCRYPTION_KEY = 'b'.repeat(64);
  const encrypted = encryptMessageContent({ subject: 'Private subject', text: 'Private body', html: '<p>Private</p>' });
  assert.equal(encrypted.subject, '(Encrypted message)');
  const opened = decryptMessageContent(encrypted);
  assert.equal(opened.subject, 'Private subject');
  assert.equal(opened.text, 'Private body');
  assert.equal(opened.html, '<p>Private</p>');
});

test('Sylva Mail encrypts attachment bytes and rejects tampered ciphertext', () => {
  process.env.MAIL_ATTACHMENT_ENCRYPTION_KEY = 'b'.repeat(64);
  const original = Buffer.from('confidential attachment');
  const encrypted = encryptAttachment(original);
  assert.deepEqual(decryptAttachment(encrypted), original);
  assert.throws(() => decryptAttachment({ ...encrypted, contentBase64: Buffer.from('tampered').toString('base64') }));
});

test.after(() => {
  if (previousKey === undefined) delete process.env.MAIL_ATTACHMENT_ENCRYPTION_KEY;
  else process.env.MAIL_ATTACHMENT_ENCRYPTION_KEY = previousKey;
});
