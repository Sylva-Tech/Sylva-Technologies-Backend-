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

/**
 * Request a full or partial refund through Paystack.
 * Amount is expressed in naira/KES before conversion to the minor unit.
 */
async function refundTransaction({ reference, amount, customerNote }) {
  if (!reference) {
    throw new Error('Payment reference is required for a refund.');
  }

  const payload = {
    transaction: reference,
    currency: 'KES',
  };

  if (amount !== undefined && amount !== null) {
    const minorAmount = Math.round(Number(amount) * 100);
    if (!Number.isFinite(minorAmount) || minorAmount <= 0) {
      throw new Error('A valid refund amount is required.');
    }
    payload.amount = minorAmount;
  }

  if (customerNote) {
    payload.customer_note = String(customerNote).slice(0, 200);
    payload.merchant_note = 'Customer cancellation within the five-minute cancellation window.';
  }

  const response = await axios.post(
    `${PAYSTACK_BASE_URL}/refund`,
    payload,
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
  refundTransaction,
};