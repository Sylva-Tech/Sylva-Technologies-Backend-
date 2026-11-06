const crypto = require('crypto');
const { getKey } = require('./mailAttachmentCrypto');

const VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const MARKER = '(Encrypted message)';

// Derive a purpose-specific key from the configured 256-bit mailbox master key.
function getMessageKey() {
  return Buffer.from(crypto.hkdfSync('sha256', getKey(), Buffer.from('sylva-mail'), Buffer.from('message-content-v1'), 32));
}

function encryptMessageContent(value = {}) {
  const payload = JSON.stringify({
    subject: String(value.subject || ''),
    text: String(value.text || ''),
    html: String(value.html || ''),
    replies: Array.isArray(value.replies) ? value.replies : undefined,
  });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getMessageKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  return {
    subject: MARKER,
    text: '',
    html: '',
    contentCiphertext: ciphertext.toString('base64'),
    contentIv: iv.toString('base64'),
    contentAuthTag: cipher.getAuthTag().toString('base64'),
    contentEncryptionVersion: VERSION,
  };
}

function decryptMessageContent(message) {
  const source = typeof message?.toObject === 'function' ? message.toObject() : { ...message };
  if (Number(source.contentEncryptionVersion) === VERSION &&
      source.contentCiphertext && source.contentIv && source.contentAuthTag) {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      getMessageKey(),
      Buffer.from(source.contentIv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(source.contentAuthTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(source.contentCiphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    const content = JSON.parse(plaintext);
    source.subject = content.subject || '(No subject)';
    source.text = content.text || '';
    source.html = content.html || '';
    if (Array.isArray(content.replies)) source.replies = content.replies;
  } else {
    // Legacy records remain readable until the authenticated migration endpoint encrypts them.
    source.subject = source.subject || '(No subject)';
    source.text = source.text || source.message || '';
    source.html = source.html || '';
  }
  delete source.contentCiphertext;
  delete source.contentIv;
  delete source.contentAuthTag;
  delete source.contentEncryptionVersion;
  return source;
}

module.exports = { encryptMessageContent, decryptMessageContent, getMessageKey };
