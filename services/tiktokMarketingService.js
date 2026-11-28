const crypto = require('node:crypto');
const axios = require('axios');

function getConfig() {
  const clientKey = String(process.env.TIKTOK_CLIENT_KEY || '').trim();
  const clientSecret = String(process.env.TIKTOK_CLIENT_SECRET || '').trim();
  const redirectUri = String(process.env.TIKTOK_REDIRECT_URI || '').trim();
  if (!clientKey || !clientSecret || !redirectUri) {
    const error = new Error('TikTok Login Kit is not configured. Set the client key, secret and registered redirect URI.');
    error.code = 'TIKTOK_CONFIGURATION_MISSING';
    throw error;
  }
  const parsed = new URL(redirectUri);
  if (parsed.protocol !== 'https:' || parsed.search || parsed.hash) {
    const error = new Error('TikTok redirect URI must be a static HTTPS URL without query parameters or fragments.');
    error.code = 'TIKTOK_REDIRECT_URI_INVALID';
    throw error;
  }
  return { clientKey, clientSecret, redirectUri };
}

function stateSecret() {
  const secret = String(process.env.JWT_SECRET || '');
  if (secret.length < 32) {
    const error = new Error('The server JWT secret is not configured securely enough for TikTok OAuth.');
    error.code = 'TIKTOK_STATE_SECRET_MISSING';
    throw error;
  }
  return crypto.createHash('sha256').update(secret + ':sylva-tiktok-oauth').digest();
}

function buildAuthorizationUrl(state) {
  const config = getConfig();
  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.searchParams.set('client_key', config.clientKey);
  url.searchParams.set('scope', 'user.info.basic,video.publish');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

function encryptionKey() {
  const raw = String(process.env.TIKTOK_TOKEN_ENCRYPTION_KEY || '').trim();
  let key = null;
  if (/^[a-f\d]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
  else {
    try { key = Buffer.from(raw, 'base64'); } catch { key = null; }
  }
  if (!key || key.length !== 32) {
    const error = new Error('TikTok token encryption is not configured. Set TIKTOK_TOKEN_ENCRYPTION_KEY to a 32-byte key.');
    error.code = 'TIKTOK_ENCRYPTION_KEY_MISSING';
    throw error;
  }
  return key;
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return {
    Ciphertext: ciphertext.toString('base64'),
    Iv: iv.toString('base64'),
    AuthTag: cipher.getAuthTag().toString('base64'),
  };
}

function decrypt(prefix, record) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(record[prefix + 'Iv'], 'base64')
  );
  decipher.setAuthTag(Buffer.from(record[prefix + 'AuthTag'], 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(record[prefix + 'Ciphertext'], 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

async function exchangeCode(code) {
  const config = getConfig();
  const body = new URLSearchParams({
    client_key: config.clientKey,
    client_secret: config.clientSecret,
    code: String(code),
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
  });
  const response = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000,
    maxRedirects: 0,
  });
  const data = response.data?.data;
  if (response.data?.error?.code && response.data.error.code !== 'ok') {
    const error = new Error(response.data.error.message || 'TikTok rejected the authorization code.');
    error.code = 'TIKTOK_TOKEN_EXCHANGE_FAILED';
    throw error;
  }
  if (!data?.access_token || !data?.refresh_token || !data?.open_id) {
    const error = new Error('TikTok did not return the required user tokens and account ID.');
    error.code = 'TIKTOK_TOKEN_RESPONSE_INVALID';
    throw error;
  }
  return data;
}

async function getUserProfile(accessToken) {
  const response = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
    params: { fields: 'open_id,display_name,avatar_url' },
    headers: { Authorization: 'Bearer ' + accessToken },
    timeout: 15000,
    maxRedirects: 0,
  });
  const data = response.data?.data?.user;
  if (!data?.open_id) {
    const error = new Error('TikTok did not return the connected creator profile.');
    error.code = 'TIKTOK_PROFILE_LOOKUP_FAILED';
    throw error;
  }
  return data;
}

function encryptTokens(tokens) {
  return {
    accessToken: encrypt(tokens.access_token),
    refreshToken: encrypt(tokens.refresh_token),
  };
}

function decryptAccessToken(connection) {
  return decrypt('accessToken', connection);
}

function decryptRefreshToken(connection) {
  return decrypt('refreshToken', connection);
}

async function refreshTokens(connection) {
  const config = getConfig();
  const refreshToken = decryptRefreshToken(connection);
  const body = new URLSearchParams({
    client_key: config.clientKey,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const response = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000,
    maxRedirects: 0,
  });
  const data = response.data?.data;
  if (response.data?.error?.code && response.data.error.code !== 'ok') {
    const error = new Error(response.data.error.message || 'TikTok token refresh failed.');
    error.code = 'TIKTOK_TOKEN_REFRESH_FAILED';
    throw error;
  }
  if (!data?.access_token || !data?.refresh_token) {
    const error = new Error('TikTok did not return refreshed access and refresh tokens.');
    error.code = 'TIKTOK_TOKEN_RESPONSE_INVALID';
    throw error;
  }
  return data;
}

module.exports = {
  getConfig,
  stateSecret,
  buildAuthorizationUrl,
  encryptTokens,
  decryptAccessToken,
  decryptRefreshToken,
  exchangeCode,
  getUserProfile,
  refreshTokens,
};
