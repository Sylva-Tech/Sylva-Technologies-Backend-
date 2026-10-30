const axios = require('axios');

const SANDBOX_BASE_URL = 'https://cybqa.pesapal.com/pesapalv3/api';
const LIVE_BASE_URL = 'https://pay.pesapal.com/v3/api';
let cachedToken = null;
let tokenExpiresAt = 0;

const getPesapalConfig = () => {
  const environment = String(process.env.PESAPAL_ENVIRONMENT || 'sandbox').trim().toLowerCase();

  if (!['sandbox', 'production'].includes(environment)) {
    throw new Error('PESAPAL_ENVIRONMENT must be sandbox or production.');
  }

  // This migration is deliberately sandbox-only. Live payments must not be
  // enabled until the complete checkout/IPN flow has passed acceptance tests.
  if (environment !== 'sandbox') {
    throw new Error('Pesapal production mode is disabled during sandbox integration.');
  }

  const consumerKey = String(process.env.PESAPAL_CONSUMER_KEY || '').trim();
  const consumerSecret = String(process.env.PESAPAL_CONSUMER_SECRET || '').trim();

  if (!consumerKey || !consumerSecret) {
    throw new Error('Pesapal sandbox credentials are not configured.');
  }

  return {
    environment,
    baseUrl: SANDBOX_BASE_URL,
    consumerKey,
    consumerSecret,
  };
};

const getAccessToken = async ({ forceRefresh = false } = {}) => {
  const config = getPesapalConfig();
  if (!forceRefresh && cachedToken && Date.now() < tokenExpiresAt - 30000) {
    return cachedToken;
  }

  const response = await axios.post(
    config.baseUrl + '/Auth/RequestToken',
    {
      consumer_key: config.consumerKey,
      consumer_secret: config.consumerSecret,
    },
    {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      timeout: 20000,
    }
  );

  const token = response.data?.token;
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Pesapal did not return an access token.');
  }

  const expiry = response.data?.expiryDate ? Date.parse(response.data.expiryDate) : NaN;
  cachedToken = token;
  tokenExpiresAt = Number.isFinite(expiry) && expiry > Date.now()
    ? expiry
    : Date.now() + 4 * 60 * 1000;

  return cachedToken;
};

const checkSandboxAuthentication = async () => {
  const config = getPesapalConfig();
  await getAccessToken({ forceRefresh: true });
  return {
    authenticated: true,
    environment: config.environment,
    message: 'Pesapal sandbox authentication succeeded.',
  };
};

const resetTokenCache = () => {
  cachedToken = null;
  tokenExpiresAt = 0;
};

module.exports = {
  getPesapalConfig,
  getAccessToken,
  checkSandboxAuthentication,
  resetTokenCache,
};
