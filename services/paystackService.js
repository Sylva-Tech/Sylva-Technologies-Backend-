const axios = require('axios');

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

function getPaystackHeaders() {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    throw new Error('PAYSTACK_SECRET_KEY is missing.');
  }

  return {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/json',
  };
};

/**
 * Initialize a Paystack transaction.
 */
async function initializeTransaction({
  email,
  amount,
  reference,
  callbackUrl,
  metadata = {},
}) {
  if (!email) {
    throw new Error('Customer email is required.');
  }

  if (!amount || Number(amount) <= 0) {
    throw new Error('A valid payment amount is required.');
  }

  if (!reference) {
    throw new Error('Payment reference is required.');
  }

  const response = await axios.post(
    `${PAYSTACK_BASE_URL}/transaction/initialize`,
    {
      email,
      amount: Math.round(Number(amount) * 100),
      currency: 'KES',
      reference,
      callback_url: callbackUrl,
      metadata,
    },
    {
      headers: getPaystackHeaders(),
      timeout: 30000,
    }
  );

  return response.data;
}

/**
 * Verify a Paystack transaction.
 */
async function verifyTransaction(reference) {
  if (!reference) {
    throw new Error('Payment reference is required.');
  }

  const response = await axios.get(
    `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(
      reference
    )}`,
    {
      headers: getPaystackHeaders(),
      timeout: 30000,
    }
  );

  return response.data;
}

module.exports = {
  initializeTransaction,
  verifyTransaction,
};