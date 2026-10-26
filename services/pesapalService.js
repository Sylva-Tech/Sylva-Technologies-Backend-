const axios = require('axios');

const getPesapalConfig = () => {
  const environment = String(process.env.PESAPAL_ENV || 'sandbox').trim().toLowerCase();
  if (!['sandbox', 'production'].includes(environment)) {
    throw new Error('PESAPAL_ENV must be sandbox or production.');
  }
  const consumerKey = String(process.env.PESAPAL_CONSUMER_KEY || '').trim();
  const consumerSecret = String(process.env.PESAPAL_CONSUMER_SECRET || '').trim();
  if (!consumerKey || !consumerSecret) {
    const error = new Error('Pesapal is not configured. Add PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET to the backend environment.');
    error.statusCode = 503;
    throw error;
  }
  return {
    consumerKey,
    consumerSecret,
    baseUrl: environment === 'production'
      ? 'https://pay.pesapal.com/v3/api'
      : 'https://cybqa.pesapal.com/pesapalv3/api',
  };
};

const requestToken = async () => {
  const config = getPesapalConfig();
  const response = await axios.post(config.baseUrl + '/Auth/RequestToken', {
    consumer_key: config.consumerKey,
    consumer_secret: config.consumerSecret,
  }, {
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    timeout: 15000,
  });
  if (!response.data?.token) throw new Error('Pesapal did not return an access token.');
  return { ...config, token: response.data.token };
};

const registerPesapalIpn = async (url, method = 'GET') => {
  if (!/^https:\/\//i.test(String(url || ''))) throw new Error('Pesapal IPN URL must use HTTPS.');
  if (!['GET', 'POST'].includes(method)) throw new Error('Pesapal IPN method must be GET or POST.');
  const { baseUrl, token } = await requestToken();
  const response = await axios.post(baseUrl + '/URLSetup/RegisterIPN', {
    url,
    ipn_notification_type: method,
  }, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' },
    timeout: 15000,
  });
  if (!response.data?.ipn_id || String(response.data?.status || '') !== '200') {
    throw new Error(response.data?.error?.message || 'Pesapal did not register the IPN URL.');
  }
  return response.data;
};

const submitPesapalOrder = async ({ reference, amount, description, callbackUrl, cancellationUrl, notificationId, billingAddress }) => {
  const { baseUrl, token } = await requestToken();
  if (!notificationId) {
    const error = new Error('Pesapal IPN is not configured. Set PESAPAL_IPN_ID after registering the public IPN URL.');
    error.statusCode = 503;
    throw error;
  }
  const payload = {
    id: String(reference),
    currency: 'KES',
    amount: Number(amount),
    description: String(description || 'Sylva Technologies payment').slice(0, 100),
    callback_url: callbackUrl,
    cancellation_url: cancellationUrl || callbackUrl,
    notification_id: notificationId,
    billing_address: {
      email_address: String(billingAddress?.email_address || ''),
      phone_number: String(billingAddress?.phone_number || ''),
      country_code: String(billingAddress?.country_code || 'KE'),
      first_name: String(billingAddress?.first_name || 'Sylva'),
      last_name: String(billingAddress?.last_name || 'Customer'),
      line_1: String(billingAddress?.line_1 || 'Kenya'),
      city: String(billingAddress?.city || 'Nairobi'),
      state: String(billingAddress?.state || ''),
      postal_code: String(billingAddress?.postal_code || ''),
    },
  };
  const response = await axios.post(baseUrl + '/Transactions/SubmitOrderRequest', payload, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' },
    timeout: 20000,
  });
  const data = response.data || {};
  if (!data.order_tracking_id || !data.redirect_url) {
    throw new Error(data.error?.message || data.message || 'Pesapal did not return a payment link.');
  }
  return {
    trackingId: String(data.order_tracking_id),
    merchantReference: String(data.merchant_reference || reference),
    redirectUrl: String(data.redirect_url),
  };
};

const getPesapalTransactionStatus = async (trackingId) => {
  if (!String(trackingId || '').trim()) throw new Error('Pesapal tracking ID is required.');
  const { baseUrl, token } = await requestToken();
  const response = await axios.get(baseUrl + '/Transactions/GetTransactionStatus', {
    params: { orderTrackingId: String(trackingId) },
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    timeout: 15000,
  });
  return response.data || {};
};

module.exports = { getPesapalConfig, requestToken, registerPesapalIpn, submitPesapalOrder, getPesapalTransactionStatus };
