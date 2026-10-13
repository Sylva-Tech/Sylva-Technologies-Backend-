const axios = require('axios');

let cachedToken = null;
let tokenExpiresAt = 0;

const normalizePin = (value) => String(value || '').trim().toUpperCase();
const normalizeId = (value) => String(value || '').trim().replace(/\s+/g, '');

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
    idUrl: process.env.KRA_ID_CHECK_URL || (
      sandbox
        ? 'https://sbx.kra.go.ke/checker/v1/pin'
        : 'https://api.kra.go.ke/checker/v1/pin'
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

const logProviderFailure = (label, error) => {
  // Never log credentials, access tokens, submitted IDs/PINs, or response bodies.
  console.error(label + ' request failed:', {
    code: error.code || 'KRA_REQUEST_FAILED',
    statusCode: error.response?.status || null,
  });
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
    const responseCode = String(body.ResponseCode ?? body.responseCode ?? '');
    const responseStatus = String(body.Status ?? body.status ?? '').toUpperCase();
    const pinData = body.PINDATA || body.pinData || {};
    const returnedPin = normalizePin(pinData.KRAPIN || '');

    if (responseCode === '19005') {
      return {
        status: 'invalid',
        reason: 'KRA reported that this PIN is invalid.',
        responseCode,
        message: String(body.Message || body.message || 'Invalid PIN'),
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
    const common = {
      responseCode,
      message: String(body.Message || body.message || ''),
      taxpayerType: String(pinData.TypeOfTaxpayer || ''),
      taxpayerName: String(pinData.Name || ''),
      taxpayerPin: returnedPin,
      pinStatus,
      checkedAt: new Date(),
      provider: 'KRA',
    };

    if (pinStatus.toLowerCase() !== 'active') {
      return {
        ...common,
        status: 'inactive',
        reason: pinStatus
          ? 'KRA reports that this PIN is ' + pinStatus + '.'
          : 'KRA did not confirm that this PIN is active.',
      };
    }

    return {
      ...common,
      status: 'verified',
      reason: 'KRA confirmed that the PIN is valid and active.',
      message: common.message || 'Valid PIN',
    };
  } catch (error) {
    logProviderFailure('KRA PIN verification', error);
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

/**
 * Verify a Kenyan national ID through KRA PIN Checker by ID.
 * Do not use this endpoint for passports, military IDs, or other ID types
 * unless KRA explicitly confirms the correct TaxpayerType for those documents.
 */
const checkKraId = async (idValue, taxpayerType = 'KE') => {
  const id = normalizeId(idValue);
  const type = String(taxpayerType || '').trim().toUpperCase();

  if (!id || !type) {
    return {
      status: 'invalid_format',
      reason: 'A taxpayer ID and taxpayer type are required.',
      checkedAt: new Date(),
      provider: 'KRA',
    };
  }

  try {
    const token = await getAccessToken();
    const { idUrl } = getKraEndpoints();
    const response = await axios.post(
      idUrl,
      { TaxpayerType: type, TaxpayerID: id },
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
    const errorCode = String(body.ErrorCode ?? body.errorCode ?? '');
    const taxpayerPin = normalizePin(body.TaxpayerPIN || body.taxpayerPIN || '');
    const taxpayerName = String(body.TaxpayerName || body.taxpayerName || '').trim();

    if (errorCode === '30002' || /invalid id/i.test(String(body.ErrorMessage || body.errorMessage || ''))) {
      return {
        status: 'invalid',
        reason: 'KRA reported that this ID number is invalid.',
        responseCode: errorCode,
        checkedAt: new Date(),
        provider: 'KRA',
      };
    }

    if (!taxpayerPin || !taxpayerName) {
      return {
        status: 'provider_unavailable',
        reason: 'KRA did not return a conclusive ID verification result.',
        responseCode: errorCode || undefined,
        checkedAt: new Date(),
        provider: 'KRA',
      };
    }

    return {
      status: 'verified',
      reason: 'KRA returned taxpayer details for this ID.',
      responseCode: errorCode || 'OK',
      taxpayerPin,
      taxpayerName,
      taxpayerType: type,
      checkedAt: new Date(),
      provider: 'KRA',
    };
  } catch (error) {
    logProviderFailure('KRA ID verification', error);
    return {
      status: 'provider_unavailable',
      reason: error.code === 'KRA_NOT_CONFIGURED'
        ? 'KRA API credentials are not configured.'
        : 'KRA ID verification is temporarily unavailable. Please retry later.',
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

  // Name similarity is a review signal, never standalone proof of identity.
  const submittedTokens = new Set(submitted.split(' ').filter(Boolean));
  const officialTokens = official.split(' ').filter(Boolean);
  const shared = officialTokens.filter((token) => submittedTokens.has(token)).length;
  return shared >= 2 && shared / Math.max(submittedTokens.size, officialTokens.length) >= 0.6;
};

module.exports = {
  checkKraPin,
  checkKraId,
  namesMatch,
  normalizePin,
  normalizeId,
};
