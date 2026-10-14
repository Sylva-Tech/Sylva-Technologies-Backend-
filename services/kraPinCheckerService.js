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
  if (!/^[A-Z]\d{9}[A-Z]$/.test(normalizedExpectedPin)) {
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

    // KRA/GavaConnect may wrap the response in different envelopes. Search
    // nested objects rather than assuming a single "data" or "payload" shape.
    const root = response.data;
    const queue = [{ value: root, depth: 0 }];
    const visited = new Set();
    let taxpayerPin = '';
    let taxpayerName = '';
    let kraErrorCode = '';
    let kraErrorMessage = '';

    while (queue.length) {
      const { value, depth } = queue.shift();
      if (!value || typeof value !== 'object' || visited.has(value) || depth > 6) continue;
      visited.add(value);

      const pin = value.TaxpayerPIN || value.taxpayerPIN || value.taxpayerPin ||
        value.taxpayer_pin || value.KRAPIN || value.KraPIN || value.Pin;
      const name = value.TaxpayerName || value.taxpayerName || value.taxpayername ||
        value.taxpayer_name || value.Name || value.name;
      if (pin && name) {
        taxpayerPin = String(pin).trim().toUpperCase();
        taxpayerName = String(name).trim();
        break;
      }

      const code = value.ErrorCode ?? value.errorCode ?? value.error_code ??
        value.ResponseCode ?? value.responseCode;
      const message = value.ErrorMessage ?? value.errorMessage ?? value.error_message ??
        value.Message ?? value.message;
      if (code !== undefined && code !== null && String(code).trim() !== '') {
        kraErrorCode = String(code).trim();
        if (message) kraErrorMessage = String(message).trim();
      }

      for (const nested of Object.values(value)) {
        if (nested && typeof nested === 'object') queue.push({ value: nested, depth: depth + 1 });
        // A few gateways serialize their nested payload as a JSON string.
        else if (typeof nested === 'string' && /^[\s]*[[{]/.test(nested)) {
          try {
            const parsed = JSON.parse(nested);
            if (parsed && typeof parsed === 'object') queue.push({ value: parsed, depth: depth + 1 });
          } catch { /* Ignore non-JSON strings. */ }
        }
      }
    }

    // Some sandbox errors arrive with HTTP 200, so inspect the body as well.
    if (kraErrorCode === '30002') {
      const error = new Error('KRA could not verify this ID. Check the number and taxpayer type.');
      error.statusCode = 422;
      throw error;
    }
    if (kraErrorCode && (!taxpayerPin || !taxpayerName)) {
      const error = new Error(
        `KRA PIN Checker returned error ${kraErrorCode}${kraErrorMessage ? `: ${kraErrorMessage}` : ''}.`
      );
      error.statusCode = kraErrorCode === '400' ? 422 : 502;
      throw error;
    }

    if (!taxpayerPin || !taxpayerName) {
      // Avoid logging taxpayer information; provide only safe response-shape diagnostics.
      const rootKeys = root && typeof root === 'object' ? Object.keys(root).slice(0, 20).join(', ') : typeof root;
      const error = new Error(
        `KRA responded without TaxpayerPIN/TaxpayerName. Top-level response keys: ${rootKeys || '(none)'}. Confirm TCOO2 is subscribed to PIN Checker BY ID and compare the raw test response structure.`
      );
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
