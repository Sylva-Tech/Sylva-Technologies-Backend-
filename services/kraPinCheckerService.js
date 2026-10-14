const axios = require('axios');

const DEFAULT_KRA_BASE_URL = 'https://sbx.kra.go.ke';
const ALLOWED_TAXPAYER_TYPES = new Set(['KE', 'NKE', 'NKENR', 'COMP']);

let cachedToken = '';
let tokenExpiresAt = 0;

const getBaseUrl = () =>
  String(process.env.KRA_BASE_URL || DEFAULT_KRA_BASE_URL).replace(/\/+$/, '');

const getAccessToken = async () => {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 30000) {
    return cachedToken;
  }

  const consumerKey = String(process.env.KRA_CONSUMER_KEY || '').trim();
  const consumerSecret = String(process.env.KRA_CONSUMER_SECRET || '').trim();

  if (!consumerKey || !consumerSecret) {
    const error = new Error('KRA PIN Checker credentials are not configured on the server.');
    error.statusCode = 503;
    throw error;
  }

  try {
    const response = await axios.get(
      `${getBaseUrl()}/v1/token/generate`,
      {
        params: { grant_type: 'client_credentials' },
        auth: { username: consumerKey, password: consumerSecret },
        timeout: 15000,
      }
    );

    const token = response.data?.access_token;
    const expiresIn = Number(response.data?.expires_in || 3600);
    if (!token) {
      const error = new Error('KRA authorization did not return an access token.');
      error.statusCode = 502;
      throw error;
    }

    cachedToken = String(token);
    tokenExpiresAt = Date.now() + Math.max(60, expiresIn) * 1000;
    return cachedToken;
  } catch (cause) {
    if (cause.statusCode) throw cause;
    const error = new Error(
      cause.response?.status === 401
        ? 'KRA rejected the configured Consumer Key and Consumer Secret.'
        : 'Unable to authenticate with KRA PIN Checker at this time.'
    );
    error.statusCode = cause.response?.status === 401 ? 502 : 503;
    throw error;
  }
};

const checkPinById = async ({ taxpayerType, taxpayerID, expectedPin }) => {
  const normalizedType = String(taxpayerType || '').trim().toUpperCase();
  const normalizedId = String(taxpayerID || '').trim();
  const normalizedExpectedPin = String(expectedPin || '').trim().toUpperCase();

  if (!ALLOWED_TAXPAYER_TYPES.has(normalizedType)) {
    const error = new Error('Select a valid KRA taxpayer type.');
    error.statusCode = 400;
    throw error;
  }
  if (!normalizedId || normalizedId.length > 50) {
    const error = new Error('Enter a valid ID or taxpayer identification number.');
    error.statusCode = 400;
    throw error;
  }
  if (!/^[A-Z]\\d{9}[A-Z]$/.test(normalizedExpectedPin)) {
    const error = new Error('Enter the KRA PIN to compare with the ID lookup.');
    error.statusCode = 400;
    throw error;
  }

  const token = await getAccessToken();
  try {
    const response = await axios.post(
      `${getBaseUrl()}/checker/v1/pin`,
      { TaxpayerType: normalizedType, TaxpayerID: normalizedId },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const taxpayerPin = String(response.data?.TaxpayerPIN || '').trim().toUpperCase();
    const taxpayerName = String(response.data?.TaxpayerName || '').trim();

    if (!taxpayerPin || !taxpayerName) {
      const error = new Error('KRA returned an incomplete PIN Checker response.');
      error.statusCode = 502;
      throw error;
    }

    return {
      verified: true,
      pinMatches: taxpayerPin === normalizedExpectedPin,
      taxpayerName,
    };
  } catch (cause) {
    if (cause.statusCode) throw cause;
    const body = cause.response?.data || {};
    const code = String(body.ErrorCode || body.errorCode || '');
    if (code === '30002') {
      const error = new Error('KRA could not verify this ID. Check the number and taxpayer type.');
      error.statusCode = 422;
      throw error;
    }
    if (cause.response?.status === 401) {
      cachedToken = '';
      tokenExpiresAt = 0;
      const error = new Error('KRA authorization expired or was rejected. Please retry shortly.');
      error.statusCode = 503;
      throw error;
    }
    const error = new Error(
      code === '400'
        ? 'KRA requires the taxpayer ID and taxpayer type. Please check both fields.'
        : 'KRA PIN Checker could not complete the lookup. Please try again later.'
    );
    error.statusCode = cause.response?.status === 400 ? 422 : 503;
    throw error;
  }
};

module.exports = { checkPinById };
