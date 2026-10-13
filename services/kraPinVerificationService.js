const axios = require('axios');

let cachedToken = null;
let tokenExpiresAt = 0;

const normalizePin = (value) => String(value || '').trim().toUpperCase();

const normalizeName = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getKraEndpoints = () => {
  const environment = String(process.env.KRA_API_ENV || 'sandbox').toLowerCase();
  const sandbox = environment !== 'production';

  return {
    tokenUrl: process.env.KRA_TOKEN_URL || (
      sandbox
        ? 'https://sbx.kra.go.ke/v1/token/generate?grant_type=client_credentials'
        : 'https://api.kra.go.ke/v1/token/generate?grant_type=client_credentials'
    ),
    pinUrl: process.env.KRA_PIN_CHECK_URL || (
      sandbox
        ? 'https://sbx.kra.go.ke/checker/v1/pinbypin'
        : 'https://api.kra.go.ke/checker/v1/pinbypin'
    ),
  };
};

const getAccessToken = async () => {
  if (cachedToken && Date.now() < tokenExpiresAt - 30000) {
    return cachedToken;
  }

  const key = process.env.KRA_CONSUMER_KEY;
  const secret = process.env.KRA_CONSUMER_SECRET;

  if (!key || !secret) {
    const error = new Error('KRA API credentials are not configured.');
    error.code = 'KRA_NOT_CONFIGURED';
    throw error;
  }

  const { tokenUrl } = getKraEndpoints();
  const basic = Buffer.from(key + ':' + secret, 'utf8').toString('base64');
  const response = await axios.get(tokenUrl, {
    headers: { Authorization: 'Basic ' + basic, Accept: 'application/json' },
    timeout: 10000,
  });

  const token = response.data?.access_token;
  const expiresIn = Number(response.data?.expires_in || 3600);

  if (!token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    const error = new Error('KRA token endpoint returned an unexpected response.');
    error.code = 'KRA_BAD_TOKEN_RESPONSE';
    throw error;
  }

  cachedToken = token;
  tokenExpiresAt = Date.now() + expiresIn * 1000;
  return cachedToken;
};

const checkKraPin = async (pinValue) => {
  const pin = normalizePin(pinValue);

  if (!/^[AP]\d{9}[A-Z]$/.test(pin)) {
    return {
      status: 'invalid_format',
      reason: 'The KRA PIN format is invalid.',
      checkedAt: new Date(),
      provider: 'KRA',
    };
  }

  try {
    const token = await getAccessToken();
    const { pinUrl } = getKraEndpoints();
    const response = await axios.post(
      pinUrl,
      { KRAPIN: pin },
      {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 10000,
      }
    );

    const body = response.data || {};
    const responseCode = String(body.ResponseCode || '');
    const responseStatus = String(body.Status || '').toUpperCase();
    const pinData = body.PINDATA || {};
    const returnedPin = normalizePin(pinData.KRAPIN || pin);

    if (responseCode === '19005') {
      return {
        status: 'invalid',
        reason: 'KRA reported that this PIN is invalid.',
        responseCode,
        message: String(body.Message || 'Invalid PIN'),
        checkedAt: new Date(),
        provider: 'KRA',
      };
    }

    if (responseStatus !== 'OK' || responseCode !== '23000' || returnedPin !== pin) {
      return {
        status: 'provider_unavailable',
        reason: 'KRA did not return a conclusive PIN verification result.',
        responseCode: responseCode || undefined,
        checkedAt: new Date(),
        provider: 'KRA',
      };
    }

    const pinStatus = String(pinData.StatusOfPIN || '').trim();
    if (pinStatus.toLowerCase() !== 'active') {
      return {
        status: 'inactive',
        reason: pinStatus
          ? 'KRA reports that this PIN is ' + pinStatus + '.'
          : 'KRA did not confirm that this PIN is active.',
        responseCode,
        message: String(body.Message || ''),
        taxpayerType: String(pinData.TypeOfTaxpayer || ''),
        taxpayerName: String(pinData.Name || ''),
        pinStatus,
        checkedAt: new Date(),
        provider: 'KRA',
      };
    }

    return {
      status: 'verified',
      reason: 'KRA confirmed that the PIN is valid and active.',
      responseCode,
      message: String(body.Message || 'Valid PIN'),
      taxpayerType: String(pinData.TypeOfTaxpayer || ''),
      taxpayerName: String(pinData.Name || ''),
      pinStatus,
      checkedAt: new Date(),
      provider: 'KRA',
    };
  } catch (error) {
    // Never log credentials, access tokens, or full provider response payloads.
    const statusCode = error.response?.status;
    console.error('KRA PIN verification request failed:', {
      code: error.code || 'KRA_REQUEST_FAILED',
      statusCode: statusCode || null,
      message: error.message,
    });

    return {
      status: 'provider_unavailable',
      reason: error.code === 'KRA_NOT_CONFIGURED'
        ? 'KRA API credentials are not configured.'
        : 'KRA verification is temporarily unavailable. Please retry later.',
      checkedAt: new Date(),
      provider: 'KRA',
    };
  }
};

const namesMatch = (submittedName, taxpayerName) => {
  const submitted = normalizeName(submittedName);
  const official = normalizeName(taxpayerName);
  if (!submitted || !official) return false;
  if (submitted === official) return true;

  // KRA may abbreviate names. Treat a clear token overlap as review-worthy,
  // not proof of identity; callers must never auto-reject on a name mismatch.
  const submittedTokens = new Set(submitted.split(' ').filter(Boolean));
  const officialTokens = official.split(' ').filter(Boolean);
  const shared = officialTokens.filter((token) => submittedTokens.has(token)).length;
  return shared >= 2 && shared / Math.max(submittedTokens.size, officialTokens.length) >= 0.6;
};

module.exports = {
  checkKraPin,
  namesMatch,
  normalizePin,
};
