const axios = require('axios');

const getPesapalEnvironment = () => {
  const environment = String(process.env.PESAPAL_ENV || 'sandbox').trim().toLowerCase();
  if (!['sandbox', 'production'].includes(environment)) {
    throw new Error('PESAPAL_ENV must be set to sandbox or production.');
  }
  return environment;
};

const getPesapalBaseUrl = () => getPesapalEnvironment() === 'sandbox'
  ? 'https://cybqa.pesapal.com/pesapalv3'
  : 'https://pay.pesapal.com/v3';

const getCredentials = () => {
  const consumerKey = String(process.env.PESAPAL_CONSUMER_KEY || '').trim();
  const consumerSecret = String(process.env.PESAPAL_CONSUMER_SECRET || '').trim();
  if (!consumerKey || !consumerSecret) {
    throw new Error('Pesapal credentials are not configured for the selected environment.');
  }
  return { consumerKey, consumerSecret };
};

let cachedToken = '';
let cachedTokenExpiresAt = 0;
let cachedTokenHost = '';

async function getAccessToken() {
  const host = getPesapalBaseUrl();
  if (cachedToken && cachedTokenHost === host && Date.now() < cachedTokenExpiresAt - 30000) {
    return cachedToken;
  }

  const { consumerKey, consumerSecret } = getCredentials();
  const response = await axios.post(
    host + '/api/Auth/RequestToken',
    { consumer_key: consumerKey, consumer_secret: consumerSecret },
    { headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, timeout: 20000 }
  );

  const token = String(response.data?.token || '').trim();
  if (!token) throw new Error('Pesapal did not return an access token.');

  cachedToken = token;
  cachedTokenHost = host;
  cachedTokenExpiresAt = Date.now() + Math.max(60, Number(response.data?.expiryDate ? (new Date(response.data.expiryDate).getTime() - Date.now()) / 1000 : 240)) * 1000;
  return token;
}

async function pesapalRequest(path, method, body) {
  const token = await getAccessToken();
  const response = await axios({
    method,
    url: getPesapalBaseUrl() + path,
    ...(body ? { data: body } : {}),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    timeout: 25000,
  });
  return response.data;
}

async function registerIpnUrl(url, notificationType = 'POST') {
  if (!/^https:\/\//i.test(String(url || ''))) throw new Error('Pesapal IPN URL must use HTTPS.');
  const type = String(notificationType || 'POST').toUpperCase();
  if (!['GET', 'POST'].includes(type)) throw new Error('Pesapal IPN notification type must be GET or POST.');
  return pesapalRequest('/api/URLSetup/RegisterIPN', 'post', { url, ipn_notification_type: type });
}

async function submitOrder({
  amount,
  reference,
  description,
  email,
  phone,
  callbackUrl,
  notificationId,
  billingAddress = {},
}) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) throw new Error('A valid Pesapal payment amount is required.');
  if (!reference || !email) throw new Error('A payment reference and customer email are required.');
  if (!/^https:\/\//i.test(String(callbackUrl || ''))) throw new Error('Pesapal callback URL must use HTTPS.');
  if (!notificationId) throw new Error('PESAPAL_IPN_ID is missing. Register the deployed IPN URL before initializing payments.');

  const payload = {
    id: String(reference).slice(0, 50),
    currency: 'KES',
    amount: Number(numericAmount.toFixed(2)),
    description: String(description || 'Sylva Technologies payment').slice(0, 100),
    callback_url: callbackUrl,
    notification_id: notificationId,
    billing_address: {
      email_address: String(email).slice(0, 100),
      phone_number: String(phone || '').slice(0, 20),
      country_code: String(billingAddress.country_code || 'KE').slice(0, 2),
      first_name: String(billingAddress.first_name || 'Sylva').slice(0, 50),
      last_name: String(billingAddress.last_name || 'Customer').slice(0, 50),
      line_1: String(billingAddress.line_1 || '').slice(0, 100),
      city: String(billingAddress.city || '').slice(0, 50),
      state: String(billingAddress.state || '').slice(0, 50),
      postal_code: String(billingAddress.postal_code || '').slice(0, 20),
    },
  };

  const result = await pesapalRequest('/api/Transactions/SubmitOrderRequest', 'post', payload);
  if (!result?.order_tracking_id || !result?.redirect_url) {
    throw new Error(result?.message || result?.error?.message || 'Pesapal did not return a payment redirect URL.');
  }
  return result;
}

async function getTransactionStatus(orderTrackingId) {
  if (!String(orderTrackingId || '').trim()) throw new Error('Pesapal order tracking ID is required.');
  return pesapalRequest('/api/Transactions/GetTransactionStatus?orderTrackingId=' + encodeURIComponent(orderTrackingId), 'get');
}

module.exports = {
  getPesapalEnvironment,
  getPesapalBaseUrl,
  getAccessToken,
  registerIpnUrl,
  submitOrder,
  getTransactionStatus,
};
