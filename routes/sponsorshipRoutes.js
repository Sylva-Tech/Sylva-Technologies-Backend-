'use strict';

const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const Product = require('../models/Product');
const User = require('../models/User');
const SellerProductSponsorship = require('../models/SellerProductSponsorship');
const { protect, approvedSellerOnly } = require('../middleware/authMiddleware');

const router = express.Router();
const SPONSORSHIP_PLANS = Object.freeze({
  '1-day': { amount: 100, durationDays: 1, label: '1 day' },
  '7-days': { amount: 400, durationDays: 7, label: '7 days' },
  '30-days': { amount: 900, durationDays: 30, label: '1 month' },
  '90-days': { amount: 2400, durationDays: 90, label: '3 months' },
  '180-days': { amount: 4200, durationDays: 180, label: '6 months' },
  '365-days': { amount: 7500, durationDays: 365, label: '12 months' },
});

const normalizePhone = (value) => {
  let phone = String(value || '').replace(/[\s()+-]/g, '');
  if (phone.startsWith('0')) phone = '254' + phone.slice(1);
  if (phone.startsWith('7') || phone.startsWith('1')) phone = '254' + phone;
  return /^254(?:7|1)\d{8}$/.test(phone) ? phone : '';
};

const mpesaHost = () => {
  const environment = String(process.env.MPESA_ENV || 'sandbox').trim().toLowerCase();
  if (!['sandbox', 'production'].includes(environment)) throw new Error('Invalid M-Pesa environment.');
  return environment === 'sandbox' ? 'https://sandbox.safaricom.co.ke' : 'https://api.safaricom.co.ke';
};

const getMpesaCredentials = async () => {
  const { MPESA_CONSUMER_KEY: key, MPESA_CONSUMER_SECRET: secret } = process.env;
  if (!key || !secret) throw new Error('M-Pesa credentials are not configured.');
  const host = mpesaHost();
  const response = await axios.get(host + '/oauth/v1/generate?grant_type=client_credentials', {
    headers: { Authorization: 'Basic ' + Buffer.from(key + ':' + secret).toString('base64') },
    timeout: 15000,
  });
  if (!response.data?.access_token) throw new Error('M-Pesa access token was not returned.');
  return { host, token: response.data.access_token };
};

const mpesaTimestamp = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + values.month + values.day + values.hour + values.minute + values.second;
};

const expirePromotions = async (sellerId = null) => {
  const filter = {
    seller: mongoose.trusted({ $ne: null }),
    featured: true,
    featuredExpiresAt: mongoose.trusted({ $ne: null, $lte: new Date() }),
  };
  if (sellerId) filter.seller = sellerId;
  await Product.updateMany(filter, {
    $set: {
      featured: false,
      isNew: false,
      sponsorshipStatus: 'expired',
    },
  });
  await SellerProductSponsorship.updateMany(
    { status: 'active', expiresAt: mongoose.trusted({ $ne: null, $lte: new Date() }), ...(sellerId ? { seller: sellerId } : {}) },
    { $set: { status: 'expired' } },
  );
};

const activate = async (sponsorship, receipt = '') => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Number(sponsorship.durationDays) * 24 * 60 * 60 * 1000);
  const product = await Product.findOne({
    _id: sponsorship.product,
    seller: sponsorship.seller,
    approvalStatus: 'approved',
    isActive: true,
  });
  if (!product) {
    sponsorship.status = 'failed';
    sponsorship.providerResultCode = 'PRODUCT_NOT_APPROVED';
    sponsorship.failureReason = 'The product is no longer approved and active. Contact Sylva support to review this payment.';
    await sponsorship.save();
    return null;
  }
  // A successfully paid sponsorship places the approved product in both
  // homepage Featured and New Arrivals until the paid promotion expires.
  product.featured = true;
  product.isNew = true;
  product.featuredExpiresAt = expiresAt;
  product.sponsorshipStatus = 'active';
  await product.save();
  sponsorship.status = 'active';
  sponsorship.startsAt = now;
  sponsorship.expiresAt = expiresAt;
  sponsorship.failureReason = '';
  if (receipt) sponsorship.mpesaReceiptNumber = receipt;
  await sponsorship.save();
  return { product, sponsorship };
};

/**
 * POST /api/sponsorship/products/:productId
 * Wallet debits are conditional and server-side. M-Pesa promotions are not
 * activated until a matching successful Safaricom callback and STK query.
 */
router.post('/products/:productId', protect, approvedSellerOnly, async (req, res) => {
  let sponsorship;
  let stkRequestStarted = false;
  try {
    const product = await Product.findOne({
      _id: req.params.productId,
      seller: req.user._id,
      approvalStatus: 'approved',
      isActive: true,
    });
    if (!product) return res.status(404).json({ success: false, message: 'Only your approved, active products can be sponsored.' });

    await expirePromotions(req.user._id);
    if (product.featured && product.featuredExpiresAt && product.featuredExpiresAt > new Date()) {
      return res.status(409).json({ success: false, message: 'This product already has an active Featured promotion.', data: { expiresAt: product.featuredExpiresAt } });
    }

    const planId = String(req.body?.planId || '7-days');
    const plan = SPONSORSHIP_PLANS[planId];
    if (!plan) return res.status(400).json({ success: false, message: 'Choose a valid sponsorship package.' });
    const { amount: feeKes, durationDays } = plan;

    const paymentMethod = String(req.body?.paymentMethod || '').toLowerCase();
    if (!['wallet', 'mpesa'].includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: 'Choose wallet or M-Pesa as the payment method.' });
    }
    const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
    if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(idempotencyKey))) {
      return res.status(400).json({ success: false, message: 'Invalid sponsorship request key.' });
    }
    if (idempotencyKey) {
      const existing = await SellerProductSponsorship.findOne({ seller: req.user._id, idempotencyKey });
      if (existing) {
        return res.status(existing.status === 'active' ? 200 : 202).json({
          success: true,
          message: existing.status === 'active' ? 'Sponsorship is active.' : 'This sponsorship request already exists.',
          data: existing,
        });
      }
    }

    if (paymentMethod === 'wallet') {
      const sponsorId = new mongoose.Types.ObjectId();
      sponsorship = await SellerProductSponsorship.create({
        _id: sponsorId,
        idempotencyKey: idempotencyKey || 'sponsor-wallet-' + sponsorId.toString(),
        product: product._id,
        seller: req.user._id,
        amount: feeKes,
        currency: 'KES',
        durationDays: durationDays,
        paymentMethod: 'wallet',
        status: 'pending',
      });

      const now = new Date();
      const user = await User.findOneAndUpdate(
        { _id: req.user._id, sellerStatus: 'approved', 'wallet.availableBalance': { $gte: feeKes } },
        {
          $inc: { 'wallet.availableBalance': -feeKes },
          $set: { 'wallet.lastUpdatedAt': now },
          $push: {
            'wallet.transactions': {
              type: 'debit',
              amount: feeKes,
              category: 'product_sponsorship',
              status: 'completed',
              description: `${durationDays}-day Featured promotion: ${product.name}`,
              reference: 'SPON-' + String(sponsorship._id).slice(-8).toUpperCase(),
              createdAt: now,
              updatedAt: now,
              processedAt: now,
              metadata: { sponsorshipId: String(sponsorship._id), productId: String(product._id) },
            },
          },
        },
        { returnDocument: 'after', runValidators: true },
      );

      if (!user) {
        sponsorship.status = 'failed';
        sponsorship.failureReason = 'Insufficient available wallet balance.';
        await sponsorship.save();
        return res.status(400).json({ success: false, message: `Your available wallet balance is below KSh ${feeKes}. Deposit funds or choose M-Pesa.` });
      }

      const activated = await activate(sponsorship);
      if (!activated) {
        const refundAt = new Date();
        await User.updateOne({ _id: req.user._id }, {
          $inc: { 'wallet.availableBalance': feeKes },
          $set: { 'wallet.lastUpdatedAt': refundAt },
          $push: { 'wallet.transactions': {
            type: 'credit', amount: feeKes, category: 'product_sponsorship_refund',
            status: 'completed', description: 'Refund for sponsorship that could not be activated.',
            reference: 'SPON-REFUND-' + String(sponsorship._id).slice(-8).toUpperCase(),
            createdAt: refundAt, updatedAt: refundAt, processedAt: refundAt,
            metadata: { sponsorshipId: String(sponsorship._id), productId: String(product._id) },
          } },
        });
        return res.status(409).json({ success: false, message: 'The product could not be sponsored. The wallet charge was refunded.' });
      }
      return res.status(201).json({
        success: true,
        message: `Payment confirmed. Your product is Featured for ${durationDays} day(s).`,
        data: { sponsorshipId: String(activated.sponsorship._id), status: 'active', expiresAt: activated.sponsorship.expiresAt },
      });
    }

    const phone = normalizePhone(req.body?.phone || req.user?.sellerProfile?.mpesaPhone || req.user?.phone);
    if (!phone) return res.status(400).json({ success: false, message: 'Enter a valid Kenyan M-Pesa phone number.' });
    const required = ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'MPESA_PASSKEY', 'MPESA_CALLBACK_URL'];
    const missing = required.filter((key) => !String(process.env[key] || '').trim());
    if (missing.length) return res.status(503).json({ success: false, message: 'M-Pesa is not fully configured.', data: { missingConfiguration: missing } });

    const callbackBase = new URL(process.env.MPESA_CALLBACK_URL);
    const callbackOrigin = callbackBase.origin;
    const shortcode = String(process.env.MPESA_SHORTCODE).trim();
    const passkey = process.env.MPESA_PASSKEY;
    const till = String(process.env.MPESA_TILL_NUMBER || '').trim();
    const transactionType = String(process.env.MPESA_TRANSACTION_TYPE || (till ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline')).trim();
    if (!['CustomerPayBillOnline', 'CustomerBuyGoodsOnline'].includes(transactionType)) return res.status(503).json({ success: false, message: 'M-Pesa transaction type is not configured correctly.' });
    if (transactionType === 'CustomerBuyGoodsOnline' && !/^\d{5,10}$/.test(till)) return res.status(503).json({ success: false, message: 'M-Pesa Till configuration is incomplete.' });

    sponsorship = await SellerProductSponsorship.create({
      idempotencyKey: idempotencyKey || 'sponsor-mpesa-' + new mongoose.Types.ObjectId().toString(),
      product: product._id,
      seller: req.user._id,
      amount: feeKes,
      currency: 'KES',
      durationDays: durationDays,
      paymentMethod: 'mpesa',
      phoneNumber: phone,
      status: 'pending',
    });
    product.sponsorshipStatus = 'pending';
    await product.save();

    const callbackUrl = callbackOrigin + '/api/sponsorship/mpesa/callback?sponsorshipId=' + encodeURIComponent(String(sponsorship._id));
    const credentials = await getMpesaCredentials();
    const timestamp = mpesaTimestamp();
    const password = Buffer.from(shortcode + passkey + timestamp).toString('base64');
    const partyB = transactionType === 'CustomerBuyGoodsOnline' ? till : shortcode;
    stkRequestStarted = true;
    const response = await axios.post(credentials.host + '/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: transactionType,
      Amount: feeKes,
      PartyA: phone,
      PartyB: partyB,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: 'SYLVA-FEAT',
      TransactionDesc: 'Product sponsorship',
    }, {
      headers: { Authorization: 'Bearer ' + credentials.token, 'Content-Type': 'application/json' },
      timeout: 20000,
    });
    if (response.data?.ResponseCode !== '0' || !response.data?.CheckoutRequestID) {
      sponsorship.status = 'failed';
      sponsorship.failureReason = String(response.data?.ResponseDescription || 'Safaricom did not accept the STK request.').slice(0, 500);
      await sponsorship.save();
      await Product.updateOne({ _id: product._id, seller: req.user._id }, { $set: { sponsorshipStatus: 'failed' } });
      return res.status(502).json({ success: false, message: sponsorship.failureReason });
    }
    sponsorship.checkoutRequestId = String(response.data.CheckoutRequestID);
    sponsorship.merchantRequestId = String(response.data.MerchantRequestID || '');
    await sponsorship.save();

    const mpesaEnvironment = String(process.env.MPESA_ENV || 'sandbox').trim().toLowerCase();
    const providerMessage = String(response.data?.CustomerMessage || response.data?.ResponseDescription || '').trim();
    const destinationHint = 'ending ' + phone.slice(-4);
    console.info('[Seller sponsorship STK]', JSON.stringify({
      environment: mpesaEnvironment,
      responseCode: String(response.data?.ResponseCode ?? ''),
      responseDescription: String(response.data?.ResponseDescription || ''),
      customerMessage: providerMessage,
      checkoutRequestId: sponsorship.checkoutRequestId,
      phoneLast4: phone.slice(-4),
      amount: feeKes,
      transactionType,
    }));
    const message = mpesaEnvironment === 'sandbox'
      ? 'Safaricom sandbox accepted the test request, but sandbox does not send a real M-Pesa prompt to a live phone. Set MPESA_ENV=production in Render and verify your live Daraja credentials before retrying.'
      : `Safaricom accepted the STK request for the number ${destinationHint}. ${providerMessage || 'If no prompt arrives, confirm the number is M-Pesa registered and check Render logs for the Safaricom response.'} Payment is not complete until verified.`;
    return res.status(202).json({
      success: true,
      message,
      data: { sponsorshipId: String(sponsorship._id), status: 'pending', checkoutRequestId: sponsorship.checkoutRequestId, amount: feeKes, durationDays: durationDays, environment: mpesaEnvironment, providerMessage, phoneLast4: phone.slice(-4) },
    });
  } catch (error) {
    if (sponsorship && sponsorship.status === 'pending' && !sponsorship.checkoutRequestId && !stkRequestStarted) {
      sponsorship.status = 'failed';
      sponsorship.failureReason = String(error.message || 'Unable to start sponsorship payment.').slice(0, 500);
      try { await sponsorship.save(); } catch (_) {}
      try { await Product.updateOne({ _id: sponsorship.product, seller: sponsorship.seller }, { $set: { sponsorshipStatus: 'failed' } }); } catch (_) {}
    } else if (sponsorship && sponsorship.status === 'pending' && stkRequestStarted && !sponsorship.checkoutRequestId) {
      // A timeout after submission is ambiguous. Keep it pending so the callback
      // can correlate via the sponsorshipId in its callback URL; never claim failure.
      sponsorship.failureReason = 'M-Pesa request outcome is being reconciled. Do not initiate another payment for this request.';
      try { await sponsorship.save(); } catch (_) {}
    }
    console.error('Seller product sponsorship error:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Unable to start sponsorship.' });
  }
});

router.get('/seller/:sponsorshipId', protect, approvedSellerOnly, async (req, res) => {
  try {
    await expirePromotions(req.user._id);
    const sponsorship = await SellerProductSponsorship.findOne({ _id: req.params.sponsorshipId, seller: req.user._id });
    if (!sponsorship) return res.status(404).json({ success: false, message: 'Sponsorship request not found.' });
    return res.json({ success: true, data: {
      _id: String(sponsorship._id),
      status: sponsorship.status,
      paymentMethod: sponsorship.paymentMethod,
      amount: sponsorship.amount,
      durationDays: sponsorship.durationDays,
      expiresAt: sponsorship.expiresAt,
      mpesaReceiptNumber: sponsorship.mpesaReceiptNumber,
      failureReason: sponsorship.failureReason,
    } });
  } catch (error) {
    console.error('Sponsorship status error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load sponsorship status.' });
  }
});

/* Public provider callback: only a matched, successful Safaricom payment can activate Featured. */
router.post('/mpesa/callback', async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;
    const checkoutRequestId = String(callback?.CheckoutRequestID || '');
    if (!checkoutRequestId) return res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback.' });

    let sponsorship = await SellerProductSponsorship.findOne({ checkoutRequestId });
    if (!sponsorship && req.query?.sponsorshipId && mongoose.isValidObjectId(req.query.sponsorshipId)) {
      sponsorship = await SellerProductSponsorship.findById(req.query.sponsorshipId);
    }
    if (!sponsorship) return res.status(503).json({ ResultCode: 1, ResultDesc: 'Sponsorship request not correlated yet.' });
    if (sponsorship.checkoutRequestId && sponsorship.checkoutRequestId !== checkoutRequestId) {
      return res.status(503).json({ ResultCode: 1, ResultDesc: 'M-Pesa checkout request does not match this sponsorship.' });
    }
    if (!sponsorship.checkoutRequestId) {
      sponsorship.checkoutRequestId = checkoutRequestId;
      sponsorship.merchantRequestId = String(callback.MerchantRequestID || '');
      await sponsorship.save();
    }
    if (sponsorship.status === 'active') return res.json({ ResultCode: 0, ResultDesc: 'Sponsorship already activated.' });
    if (sponsorship.status !== 'pending') return res.json({ ResultCode: 0, ResultDesc: 'Sponsorship request already closed.' });

    if (Number(callback.ResultCode) !== 0) {
      sponsorship.status = 'failed';
      sponsorship.providerResultCode = String(callback.ResultCode);
      sponsorship.failureReason = String(callback.ResultDesc || 'M-Pesa payment was cancelled or failed.').slice(0, 500);
      await sponsorship.save();
      await Product.updateOne({ _id: sponsorship.product, seller: sponsorship.seller }, { $set: { sponsorshipStatus: 'failed' } });
      return res.json({ ResultCode: 0, ResultDesc: 'Payment failure recorded.' });
    }

    const items = callback.CallbackMetadata?.Item || [];
    const field = (name) => items.find((item) => item.Name === name)?.Value;
    const paidAmount = Number(field('Amount'));
    const receipt = String(field('MpesaReceiptNumber') || '');
    const paidPhone = String(field('PhoneNumber') || '');
    if (!receipt || paidAmount !== Number(sponsorship.amount) || !paidPhone ||
        normalizePhone(paidPhone) !== normalizePhone(sponsorship.phoneNumber)) {
      sponsorship.providerResultCode = 'CALLBACK_VALIDATION_FAILED';
      sponsorship.failureReason = 'Payment amount, receipt or phone did not match; administrator review is required.';
      await sponsorship.save();
      return res.status(503).json({ ResultCode: 1, ResultDesc: 'Payment requires verification.' });
    }

    const credentials = await getMpesaCredentials();
    const timestamp = mpesaTimestamp();
    const shortcode = String(process.env.MPESA_SHORTCODE).trim();
    const password = Buffer.from(shortcode + String(process.env.MPESA_PASSKEY) + timestamp).toString('base64');
    const query = await axios.post(credentials.host + '/mpesa/stkpushquery/v1/query', {
      BusinessShortCode: shortcode, Password: password, Timestamp: timestamp, CheckoutRequestID: checkoutRequestId,
    }, {
      headers: { Authorization: 'Bearer ' + credentials.token, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    if (String(query.data?.ResultCode) !== '0') {
      return res.status(503).json({ ResultCode: 1, ResultDesc: 'Safaricom has not confirmed this payment yet.' });
    }

    sponsorship.providerResultCode = '0';
    sponsorship.mpesaReceiptNumber = receipt;
    const activated = await activate(sponsorship, receipt);
    if (!activated) return res.json({ ResultCode: 0, ResultDesc: 'Payment recorded for review; product was not activated.' });
    return res.json({ ResultCode: 0, ResultDesc: `Sponsorship activated for ${sponsorship.durationDays} days.` });
  } catch (error) {
    console.error('Sponsorship M-Pesa callback error:', error.message);
    return res.status(503).json({ ResultCode: 1, ResultDesc: 'Unable to verify sponsorship payment; retry callback.' });
  }
});

module.exports = router;
