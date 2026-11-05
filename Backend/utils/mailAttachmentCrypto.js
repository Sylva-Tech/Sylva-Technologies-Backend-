const crypto = require('crypto');

const VERSION = 1;
const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const value = String(process.env.MAIL_ATTACHMENT_ENCRYPTION_KEY || '').trim();
  if (!/^[a-fA-F0-9]{64}$/.test(value)) {
    const error = new Error('Sylva Mail attachment encryption is not configured. Set MAIL_ATTACHMENT_ENCRYPTION_KEY to a 64-character hexadecimal key before storing or opening attachments.');
    error.code = 'MAIL_ATTACHMENT_ENCRYPTION_NOT_CONFIGURED';
    throw error;
  }
  return Buffer.from(value, 'hex');
}

function encryptAttachment(input) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(input)), cipher.final()]);
  return {
    contentBase64: encrypted.toString('base64'),
    encryptionIv: iv.toString('base64'),
    encryptionAuthTag: cipher.getAuthTag().toString('base64'),
    encryptionVersion: VERSION,
  };
}

function decryptAttachment(document) {
  getKey();
  if (Number(document?.encryptionVersion) !== VERSION || !document?.encryptionIv || !document?.encryptionAuthTag) {
    const error = new Error('This attachment is stored in the legacy format and must be encrypted before it can be opened or sent.');
    error.code = 'MAIL_ATTACHMENT_LEGACY_FORMAT';
    throw error;
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(document.encryptionIv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(document.encryptionAuthTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(String(document.contentBase64 || ''), 'base64')),
    decipher.final(),
  ]);
}

module.exports = { encryptAttachment, decryptAttachment, getKey };
