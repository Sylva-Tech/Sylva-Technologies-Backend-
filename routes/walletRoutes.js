const express = require('express');
const mongoose = require('mongoose');

const User = require('../models/User');
const AdminWallet = require('../models/AdminWallet');

const {
  protect,
  adminOnly,
  requireVerified,
} = require('../middleware/authMiddleware');

const router = express.Router();

/*
|--------------------------------------------------------------------------
| SECURITY / RATE LIMITING
|--------------------------------------------------------------------------
|
| Lightweight in-memory rate limiter for wallet payout endpoints.
|
| This helps prevent a single account/IP from hammering the payout
| endpoint repeatedly.
|
| IMPORTANT:
| This is an additional protection, not a replacement for proper
| authentication, authorization, validation and MongoDB safeguards.
|
| On a multi-instance deployment, use a shared Redis-based limiter
| later for centralized rate limiting.
|
|--------------------------------------------------------------------------
*/

const payoutRateLimitStore = new Map();

const PAYOUT_RATE_WINDOW_MS = 15 * 60 * 1000;
const PAYOUT_RATE_MAX_REQUESTS = 5;

const getClientIp = (req) => (
  // app.js configures Express trust proxy; use its resolved client IP rather
  // than trusting a caller-supplied X-Forwarded-For header directly.
  req.ip ||
  req.socket?.remoteAddress ||
  'unknown'
);

const cleanupRateLimitStore = () => {
  const now = Date.now();

  for (const [
    key,
    record,
  ] of payoutRateLimitStore.entries()) {
    if (
      now - record.windowStart >
      PAYOUT_RATE_WINDOW_MS
    ) {
      payoutRateLimitStore.delete(key);
    }
  }
};

const payoutRateLimit = (req, res, next) => {
  cleanupRateLimitStore();

  const userId =
    req.user?._id
      ? String(req.user._id)
      : 'anonymous';

  const ip = getClientIp(req);

  const key = `${userId}:${ip}`;
  const now = Date.now();

  let record =
    payoutRateLimitStore.get(key);

  if (
    !record ||
    now - record.windowStart >
      PAYOUT_RATE_WINDOW_MS
  ) {
    record = {
      count: 0,
      windowStart: now,
    };
  }

  record.count += 1;

  payoutRateLimitStore.set(
    key,
    record
  );

  if (
    record.count >
    PAYOUT_RATE_MAX_REQUESTS
  ) {
    const retryAfterSeconds =
      Math.ceil(
        (
          PAYOUT_RATE_WINDOW_MS -
          (now - record.windowStart)
        ) / 1000
      );

    res.set(
      'Retry-After',
      String(retryAfterSeconds)
    );

    return res.status(429).json({
      success: false,
      message:
        'Too many payout requests. Please wait before trying again.',
    });
  }

  next();
};

/*
|--------------------------------------------------------------------------
| WALLET HELPERS
|--------------------------------------------------------------------------
*/

const roundMoney = (value) => {
  const normalized = Number(value);

  if (!Number.isFinite(normalized)) {
    return 0;
  }

  return Number(
    normalized.toFixed(2)
  );
};

/*
|--------------------------------------------------------------------------
| Ensure wallet structure exists
|--------------------------------------------------------------------------
*/

const ensureWallet = (user) => {
  if (!user.wallet) {
    user.wallet = {};
  }

  const wallet = user.wallet;

  wallet.currency =
    wallet.currency || 'KES';

  wallet.availableBalance =
    roundMoney(
      wallet.availableBalance || 0
    );

  wallet.pendingBalance =
    roundMoney(
      wallet.pendingBalance || 0
    );

  wallet.transactions =
    Array.isArray(
      wallet.transactions
    )
      ? wallet.transactions
      : [];

  wallet.lastUpdatedAt =
    wallet.lastUpdatedAt ||
    new Date();

  user.wallet = wallet;

  return wallet;
};

/*
|--------------------------------------------------------------------------
| Safely serialize a transaction for the seller
|--------------------------------------------------------------------------
|
| Do NOT expose internal admin-review information to the seller.
|--------------------------------------------------------------------------
*/

const serializeSellerTransaction = (
  entry
) => {
  const metadata =
    entry.metadata || {};

  return {
    _id:
      entry._id ||
      entry.id ||
      undefined,

    type:
      entry.type ||
      'credit',

    amount:
      roundMoney(
        entry.amount || 0
      ),

    category:
      entry.category ||
      'manual_adjustment',

    status:
      entry.status ||
      'completed',

    description:
      entry.description ||
      '',

    reference:
      entry.reference ||
      '',

    relatedOrder:
      entry.relatedOrder ||
      null,

    createdAt:
      entry.createdAt ||
      null,

    processedAt:
      entry.processedAt ||
      null,

    metadata: {
      payoutMethod:
        metadata.payoutMethod ||
        undefined,

      requestedAt:
        metadata.requestedAt ||
        undefined,

      /*
       * Only expose the seller's own payout destination.
       */
      destination:
        metadata.destination ||
        undefined,

      rejectionReason:
        metadata.rejectionReason ||
        undefined,

      accountDisplayName:
        metadata.accountDisplayName ||
        undefined,
    },
  };
};

const ensureUsdWallet = (user) => {
  if (!user.usdWallet) user.usdWallet = {};
  const wallet = user.usdWallet;
  wallet.currency = 'USD';
  wallet.availableBalance = roundMoney(wallet.availableBalance || 0);
  wallet.pendingBalance = roundMoney(wallet.pendingBalance || 0);
  wallet.transactions = Array.isArray(wallet.transactions) ? wallet.transactions : [];
  wallet.lastUpdatedAt = wallet.lastUpdatedAt || new Date();
  user.usdWallet = wallet;
  return wallet;
};

const serializeUsdWallet = (user) => {
  const wallet = ensureUsdWallet(user);
  const transactions = [...wallet.transactions]
    .sort((a, b) => new Date(b.createdAt || b.processedAt || 0) - new Date(a.createdAt || a.processedAt || 0))
    .map((entry) => ({
      _id: entry._id,
      type: entry.type || 'credit',
      amount: roundMoney(entry.amount || 0),
      currency: 'USD',
      category: entry.category || 'manual_adjustment',
      status: entry.status || 'pending',
      description: entry.description || '',
      reference: entry.reference || '',
      createdAt: entry.createdAt || null,
      processedAt: entry.processedAt || null,
      metadata: {
        payoutMethod: entry.metadata?.payoutMethod || undefined,
        destination: entry.metadata?.destination || undefined,
        rejectionReason: entry.metadata?.rejectionReason || undefined,
      },
    }));
  return {
    currency: 'USD',
    availableBalance: roundMoney(wallet.availableBalance),
    pendingBalance: roundMoney(wallet.pendingBalance),
    totalBalance: roundMoney(wallet.availableBalance + wallet.pendingBalance),
    lastUpdatedAt: wallet.lastUpdatedAt || null,
    transactions,
  };
};

const paypalApiBase = () => (
  String(process.env.PAYPAL_MODE || process.env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com'
);

const getPayPalAccessToken = async () => {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const error = new Error('PayPal is not configured on the server.');
    error.statusCode = 503;
    throw error;
  }
  const response = await axios.post(
    paypalApiBase() + '/v1/oauth2/token',
    'grant_type=client_credentials',
    {
      auth: { username: clientId, password: clientSecret },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    }
  );
  if (!response.data?.access_token) throw new Error('PayPal did not return an access token.');
  return response.data.access_token;
};

const isInternationalSeller = (user) => (
  user?.role === 'seller' &&
  String(user.sellerProfile?.country || 'KE').toUpperCase() !== 'KE' &&
  user.sellerStatus === 'approved' &&
  ['active', 'warning'].includes(user.accountStatus) &&
  user.storeStatus === 'active' &&
  user.isVerified === true
);

/*
|--------------------------------------------------------------------------
| Serialize complete seller wallet
|--------------------------------------------------------------------------
*/

const serializeWallet = (user) => {
  const wallet =
    ensureWallet(user);

  const transactions = [
    ...wallet.transactions,
  ]
    .sort(
      (a, b) =>
        new Date(
          b.createdAt ||
            b.processedAt ||
            b.updatedAt ||
            0
        ) -
        new Date(
          a.createdAt ||
            a.processedAt ||
            a.updatedAt ||
            0
        )
    )
    .map(
      serializeSellerTransaction
    );

  return {
    currency:
      wallet.currency,

    availableBalance:
      roundMoney(
        wallet.availableBalance
      ),

    pendingBalance:
      roundMoney(
        wallet.pendingBalance
      ),

    totalBalance:
      roundMoney(
        wallet.availableBalance +
          wallet.pendingBalance
      ),

    lastUpdatedAt:
      wallet.lastUpdatedAt ||
      null,

    payoutPreferences: {
      mpesaPhone:
        user.sellerProfile
          ?.mpesaPhone || '',

      storeName:
        user.sellerProfile
          ?.storeName || '',
    },

    transactions,
  };
};

/*
|--------------------------------------------------------------------------
| VALIDATION HELPERS
|--------------------------------------------------------------------------
*/

const validatePayoutAmount = (
  value
) => {
  /*
   * Reject empty, null, undefined,
   * Infinity, NaN and non-numeric values.
   */
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return {
      valid: false,
      message:
        'Please enter a payout amount.',
    };
  }

  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return {
      valid: false,
      message:
        'Please enter a valid payout amount.',
    };
  }

  if (amount <= 0) {
    return {
      valid: false,
      message:
        'Payout amount must be greater than zero.',
    };
  }

  /*
   * Prevent excessively precise values.
   */
  if (
    !Number.isInteger(
      Math.round(amount * 100)
    )
  ) {
    return {
      valid: false,
      message:
        'Payout amount can have a maximum of two decimal places.',
    };
  }

  if (amount < 50) {
    return {
      valid: false,
      message:
        'The minimum withdrawal amount is KSh 50.',
    };
  }

  return {
    valid: true,
    amount:
      roundMoney(amount),
  };
};

/*
|--------------------------------------------------------------------------
| Normalize Kenyan phone number
|--------------------------------------------------------------------------
|
| Supported:
|
| 0712345678
| 0112345678
| +254712345678
| 254712345678
|--------------------------------------------------------------------------
*/

const normalizeKenyanPhone = (
  value
) => {
  let phone = String(
    value || ''
  )
    .trim()
    .replace(/\s+/g, '')
    .replace(/-/g, '');

  if (!phone) {
    return '';
  }

  if (
    /^07\d{8}$/.test(phone)
  ) {
    return `254${phone.substring(
      1
    )}`;
  }

  if (
    /^01\d{8}$/.test(phone)
  ) {
    return `254${phone.substring(
      1
    )}`;
  }

  if (
    /^\+254\d{9}$/.test(phone)
  ) {
    return phone.substring(1);
  }

  if (
    /^254\d{9}$/.test(phone)
  ) {
    return phone;
  }

  return '';
};

/*
|--------------------------------------------------------------------------
| Validate payout destination
|--------------------------------------------------------------------------
*/

const validatePayoutDestination = (
  payoutMethod,
  destination
) => {
  const value = String(
    destination || ''
  ).trim();

  if (
    payoutMethod === 'mpesa' ||
    payoutMethod === 'airtel_money'
  ) {
    const normalized =
      normalizeKenyanPhone(value);

    if (!normalized) {
      return {
        valid: false,
        message: payoutMethod === 'airtel_money'
          ? 'Please provide a valid Kenyan Airtel Money phone number.'
          : 'Please provide a valid Kenyan M-Pesa phone number.',
      };
    }

    return {
      valid: true,
      destination: normalized,
    };
  }

  if (payoutMethod === 'paypal') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) {
      return {
        valid: false,
        message: 'Enter a valid email address linked to the recipient PayPal account.',
      };
    }

    return {
      valid: true,
      destination: value.toLowerCase(),
    };
  }

  if (
    payoutMethod === 'bank'
  ) {
    if (!value) {
      return {
        valid: false,
        message:
          'A bank payout destination is required.',
      };
    }

    /*
     * Prevent absurdly large input.
     */
    if (value.length > 200) {
      return {
        valid: false,
        message:
          'Bank payout details are too long.',
      };
    }

    return {
      valid: true,
      destination: value,
    };
  }

  return {
    valid: false,
    message:
      'Unsupported payout method. Choose M-Pesa, Airtel Money, PayPal, or bank.',
  };
};

/*
|--------------------------------------------------------------------------
| GET CURRENT USER WALLET
|--------------------------------------------------------------------------
|
| GET /wallet/me
|--------------------------------------------------------------------------
*/

router.get(
  '/me',
  protect,
  async (req, res) => {
    try {
      const user =
        await User.findById(
          req.user._id
        ).select('-password');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Wallet could not be found.',
        });
      }
      if (!['customer', 'seller'].includes(user.role) ||
          (user.role === 'customer' && user.isVerified !== true)) {
        return res.status(403).json({
          success: false,
          message: 'Verify your customer account to access your private wallet.',
        });
      }

      const walletData = serializeWallet(user);
      const international = user.role === 'seller' &&
        String(user.sellerProfile?.country || 'KE').toUpperCase() !== 'KE';
      return res.json({
        success: true,
        data: {
          ...walletData,
          usdWallet: international ? serializeUsdWallet(user) : null,
          sellerCountry: user.role === 'seller' ? (user.sellerProfile?.country || 'KE') : null,
        },
      });
    } catch (error) {
      console.error(
        'Get wallet error:',
        error.message
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to load your wallet.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| GET WALLET TRANSACTIONS
|--------------------------------------------------------------------------
|
| GET /wallet/transactions
|--------------------------------------------------------------------------
*/

router.get(
  '/transactions',
  protect,
  async (req, res) => {
    try {
      const user =
        await User.findById(
          req.user._id
        ).select('-password');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Wallet could not be found.',
        });
      }
      if (!['customer', 'seller'].includes(user.role) ||
          (user.role === 'customer' && user.isVerified !== true)) {
        return res.status(403).json({
          success: false,
          message: 'Verify your customer account to access wallet transactions.',
        });
      }

      const wallet =
        ensureWallet(user);

      const transactions =
        [...wallet.transactions]
          .sort(
            (a, b) =>
              new Date(
                b.createdAt ||
                  b.processedAt ||
                  b.updatedAt ||
                  0
              ) -
              new Date(
                a.createdAt ||
                  a.processedAt ||
                  a.updatedAt ||
                  0
              )
          )
          .map(
            serializeSellerTransaction
          );

      return res.json({
        success: true,
        data: transactions,
      });
    } catch (error) {
      console.error(
        'Get wallet transactions error:',
        error.message
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to load wallet transactions.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| SELLER - REQUEST PAYOUT
|--------------------------------------------------------------------------
|
| POST /wallet/payout-request
|--------------------------------------------------------------------------
*/

router.post(
  '/payout-request',
  protect,
  payoutRateLimit,
  async (req, res) => {
    try {
      /*
       * Always retrieve fresh user data from MongoDB.
       */
      const user =
        await User.findById(
          req.user._id
        );

      if (!user) {
        return res.status(404).json({
          success: false,
          message:
            'User account not found.',
        });
      }

      if (user.isVerified !== true) {
        return res.status(403).json({ success: false, message: 'Verify your email before requesting a wallet withdrawal.' });
      }
      const activeSeller = user.role === 'seller' &&
        user.sellerStatus === 'approved' &&
        ['active', 'warning'].includes(user.accountStatus) &&
        user.storeStatus === 'active';
      const activeCustomer = user.role === 'customer' && user.accountStatus === 'active';
      if (!activeSeller && !activeCustomer) {
        return res.status(403).json({ success: false, message: 'Only verified active customers and approved active sellers can request wallet withdrawals.' });
      }

      /*
       * Validate amount.
       */
      const amountValidation =
        validatePayoutAmount(
          req.body?.amount
        );

      if (
        !amountValidation.valid
      ) {
        return res.status(400).json({
          success: false,
          message:
            amountValidation.message,
        });
      }

      const amount =
        amountValidation.amount;

      /*
       * Validate payout method.
       */
      const payoutMethod =
        String(
          req.body?.payoutMethod ||
            'mpesa'
        )
          .trim()
          .toLowerCase();

      if (
        ![
          'mpesa',
          'airtel_money',
          'bank',
        ].includes(
          payoutMethod
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Unsupported payout method. Choose M-Pesa or bank.',
        });
      }

      /*
       * Get requested destination.
       */
      let payoutDestination =
        String(
          req.body?.destination ||
            ''
        ).trim();

      /*
       * For M-Pesa, fall back to the
       * seller's saved M-Pesa number.
       */
      if (
        payoutMethod === 'mpesa' &&
        !payoutDestination
      ) {
        payoutDestination =
          (user.role === 'seller' ? user.sellerProfile?.mpesaPhone : user.phone) || '';
      }

      const destinationValidation =
        validatePayoutDestination(
          payoutMethod,
          payoutDestination
        );

      if (
        !destinationValidation.valid
      ) {
        return res.status(400).json({
          success: false,
          message:
            destinationValidation.message,
        });
      }

      payoutDestination =
        destinationValidation.destination;

      /*
       * Ensure wallet exists.
       */
      const wallet =
        ensureWallet(user);

      /*
       * Prevent multiple pending payouts.
       */
      const existingPendingPayout =
        wallet.transactions.find(
          (entry) =>
            entry.category ===
              'payout_request' &&
            entry.status ===
              'pending'
        );

      if (
        existingPendingPayout
      ) {
        return res.status(409).json({
          success: false,
          message:
            'You already have a pending payout request. Please wait for it to be processed before submitting another payout request.',
          data: {
            transactionId:
              existingPendingPayout._id ||
              existingPendingPayout.id ||
              null,

            amount:
              roundMoney(
                existingPendingPayout.amount ||
                  0
              ),

            status:
              existingPendingPayout.status,

            createdAt:
              existingPendingPayout.createdAt ||
              null,
          },
        });
      }

      /*
       * Never trust a balance supplied by the frontend.
       * Only use MongoDB's balance.
       */
      const availableBalance =
        roundMoney(
          wallet.availableBalance
        );

      const pendingBalance =
        roundMoney(
          wallet.pendingBalance
        );

      /*
       * Basic wallet integrity check.
       */
      if (
        availableBalance < 0 ||
        pendingBalance < 0
      ) {
        console.error(
          `Wallet integrity issue for user ${user._id}`
        );

        return res.status(409).json({
          success: false,
          message:
            'Your wallet requires administrator review before a payout can be requested.',
        });
      }

      /*
       * Check available balance.
       */
      if (
        amount >
        availableBalance
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Requested amount exceeds the available wallet balance.',
          data: {
            availableBalance,
            requestedAmount:
              amount,
          },
        });
      }

      /*
       * Reserve funds atomically. The query rechecks the balance and pending
       * payout condition at write time, so concurrent requests cannot spend
       * the same available funds or create multiple pending payouts.
       */
      const updateFilter = {
        _id: user._id,
        isVerified: true,
        role: user.role,
        accountStatus: user.accountStatus,
        'wallet.availableBalance': mongoose.trusted({ $gte: amount }),
        'wallet.transactions': mongoose.trusted({
          $not: { $elemMatch: { category: 'payout_request', status: 'pending' } },
        }),
      };
      if (user.role === 'seller') {
        updateFilter.sellerStatus = 'approved';
        updateFilter.storeStatus = 'active';
      }

      const updatedUser = await User.findOneAndUpdate(
        updateFilter,
        {
          $inc: {
            'wallet.availableBalance': -amount,
            'wallet.pendingBalance': amount,
          },
          $set: { 'wallet.lastUpdatedAt': now },
          $push: { 'wallet.transactions': { $each: [transaction], $position: 0 } },
        },
        { new: true, runValidators: true }
      );

      if (!updatedUser) {
        return res.status(409).json({
          success: false,
          message: 'Your wallet changed or a withdrawal is already pending. Refresh your wallet and try again.',
        });
      }

      const savedTransaction = updatedUser.wallet.transactions.id(transactionId);

      return res.status(201).json({
        success: true,
        message: 'Withdrawal request submitted successfully and is awaiting payout processing.',
        data: {
          wallet: serializeWallet(updatedUser),
          transaction: serializeSellerTransaction(savedTransaction || transaction),
        },
      });
    } catch (error) {
      console.error(
        'Request payout error:',
        error.message
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to create your payout request.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| ADMIN - GET PENDING PAYOUTS
|--------------------------------------------------------------------------
|
| GET /wallet/admin/payouts
|--------------------------------------------------------------------------
*/

/* USD-only PayPal withdrawal request. Payouts are manually processed by an
   authorized admin; requesting one does not send money automatically. */
router.post('/payout-request-usd', protect, payoutRateLimit, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!isInternationalSeller(user)) {
      return res.status(403).json({ success: false, message: 'USD withdrawals are available to verified, approved sellers registered outside Kenya.' });
    }
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || Math.round(amount * 100) !== amount * 100 || amount < 10 || amount > 10000) {
      return res.status(400).json({ success: false, message: 'Enter a USD withdrawal amount between $10.00 and $10,000.00.' });
    }
    const destination = String(req.body?.destination || '').trim().toLowerCase();
    if (destination.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) {
      return res.status(400).json({ success: false, message: 'Enter a valid email address for your PayPal account.' });
    }
    const wallet = ensureUsdWallet(user);
    if (wallet.transactions.some((entry) => entry.category === 'payout_request' && entry.status === 'pending')) {
      return res.status(409).json({ success: false, message: 'You already have a pending USD withdrawal request.' });
    }
    const now = new Date();
    const transaction = {
      _id: new mongoose.Types.ObjectId(),
      type: 'debit',
      amount: roundMoney(amount),
      currency: 'USD',
      category: 'payout_request',
      status: 'pending',
      description: 'USD PayPal withdrawal awaiting administrator processing.',
      reference: 'USD-PAYOUT-' + new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase(),
      createdAt: now,
      updatedAt: now,
      processedAt: null,
      metadata: { walletCurrency: 'USD', payoutMethod: 'paypal', destination, requestedAt: now.toISOString() },
    };
    const updatedUser = await User.findOneAndUpdate(
      {
        _id: user._id,
        isVerified: true,
        role: 'seller',
        sellerStatus: 'approved',
        storeStatus: 'active',
        accountStatus: user.accountStatus,
        'usdWallet.availableBalance': mongoose.trusted({ $gte: amount }),
        'usdWallet.transactions': mongoose.trusted({ $not: { $elemMatch: { category: 'payout_request', status: 'pending' } } }),
      },
      {
        $inc: { 'usdWallet.availableBalance': -amount, 'usdWallet.pendingBalance': amount },
        $set: { 'usdWallet.lastUpdatedAt': now },
        $push: { 'usdWallet.transactions': { $each: [transaction], $position: 0 } },
      },
      { new: true, runValidators: true }
    );
    if (!updatedUser) {
      return res.status(409).json({ success: false, message: 'Your USD wallet changed or another withdrawal is pending. Refresh and try again.' });
    }
    return res.status(201).json({
      success: true,
      message: 'USD withdrawal request submitted. An administrator must send and confirm the PayPal payout.',
      data: { wallet: serializeUsdWallet(updatedUser), currency: 'USD', transactionId: String(transaction._id), status: 'pending' },
    });
  } catch (error) {
    console.error('USD payout request error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to create the USD withdrawal request.' });
  }
});

router.get(
  '/admin/payouts',
  protect,
  adminOnly,
  requireVerified,
  async (req, res) => {
    try {
      const payoutAccounts = await User.find({
        role: mongoose.trusted({ $in: ['seller', 'customer'] }),
        $or: [
          { 'wallet.transactions': mongoose.trusted({ $elemMatch: { category: 'payout_request', status: 'pending' } }) },
          { 'usdWallet.transactions': mongoose.trusted({ $elemMatch: { category: 'payout_request', status: 'pending' } }) },
        ],
      })
          .select('name email phone role sellerProfile wallet usdWallet')
          .lean();

      const pendingPayouts =
        [];

      for (
        const seller of payoutAccounts
      ) {
        const transactions =
          Array.isArray(
            seller.wallet
              ?.transactions
          )
            ? seller.wallet
                .transactions
            : [];

        for (
          const entry of transactions
        ) {
          if (
            entry.category !==
              'payout_request' ||
            entry.status !==
              'pending'
          ) {
            continue;
          }

          pendingPayouts.push({
            _id:
              entry._id,

            account: {
              role: seller.role,
              _id:
                seller._id,

              name:
                seller.name || '',

              email:
                seller.email || '',

              phone:
                seller.phone || '',

              storeName:
                seller.sellerProfile?.storeName || '',

              mpesaPhone:
                seller.sellerProfile
                  ?.mpesaPhone || '',
            },
            seller: {
              _id: seller._id,
              name: seller.name || '',
              email: seller.email || '',
              phone: seller.phone || '',
              storeName: seller.sellerProfile?.storeName || '',
              mpesaPhone: seller.sellerProfile?.mpesaPhone || '',
            },

            type:
              entry.type ||
              'debit',

            amount:
              roundMoney(
                entry.amount ||
                  0
              ),

            status:
              entry.status,

            payoutMethod:
              entry.metadata
                ?.payoutMethod ||
              'mpesa',

            destination:
              entry.metadata
                ?.destination ||
              '',

            reference:
              entry.reference ||
              '',

            createdAt:
              entry.createdAt ||
              null,
          });
        }
      }

      // Include pending USD-wallet payouts in the same admin review queue.
      for (const seller of payoutAccounts) {
        for (const entry of (Array.isArray(seller.usdWallet?.transactions) ? seller.usdWallet.transactions : [])) {
          if (entry.category !== 'payout_request' || entry.status !== 'pending') continue;
          pendingPayouts.push({
            _id: entry._id,
            account: { role: seller.role, _id: seller._id, name: seller.name || '', email: seller.email || '', phone: seller.phone || '', storeName: seller.sellerProfile?.storeName || '', mpesaPhone: seller.sellerProfile?.mpesaPhone || '' },
            seller: { _id: seller._id, name: seller.name || '', email: seller.email || '', phone: seller.phone || '', storeName: seller.sellerProfile?.storeName || '', mpesaPhone: seller.sellerProfile?.mpesaPhone || '' },
            type: entry.type || 'debit',
            amount: roundMoney(entry.amount || 0),
            currency: 'USD',
            status: entry.status,
            payoutMethod: entry.metadata?.payoutMethod || 'paypal',
            destination: entry.metadata?.destination || '',
            reference: entry.reference || '',
            createdAt: entry.createdAt || null,
          });
        }
      }

      /*
       * Newest requests first.
       */
      pendingPayouts.sort(
        (a, b) =>
          new Date(
            b.createdAt || 0
          ) -
          new Date(
            a.createdAt || 0
          )
      );

      return res.json({
        success: true,

        count:
          pendingPayouts.length,

        data:
          pendingPayouts,
      });
    } catch (error) {
      console.error(
        'Admin payout list error:',
        error.message
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to load pending payouts.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| ADMIN - APPROVE / REJECT PAYOUT
|--------------------------------------------------------------------------
|
| PATCH /wallet/admin/payouts/:transactionId
|--------------------------------------------------------------------------
|
| Approved:
| {
|   "decision": "approved"
| }
|
| Rejected:
| {
|   "decision": "rejected",
|   "reason": "Incorrect payout details"
| }
|
|--------------------------------------------------------------------------
*/

router.patch(
  '/admin/payouts/:transactionId',
  protect,
  adminOnly,
  requireVerified,
  async (req, res) => {
    try {
      const {
        transactionId,
      } = req.params;

      const decision =
        String(
          req.body?.decision ||
            ''
        )
          .trim()
          .toLowerCase();

      const reason =
        String(
          req.body?.reason ||
            ''
        ).trim();

      /*
       * Validate transaction ID.
       */
      if (
        !mongoose.Types.ObjectId.isValid(
          transactionId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid payout request ID.',
        });
      }

      /*
       * Validate decision.
       */
      if (
        ![
          'approved',
          'rejected',
        ].includes(
          decision
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Decision must be either approved or rejected.',
        });
      }

      /*
       * Rejection requires a reason.
       */
      if (
        decision ===
          'rejected' &&
        !reason
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Please provide a reason for rejecting the payout.',
        });
      }

      /*
       * Prevent excessively large rejection input.
       */
      if (
        reason.length > 500
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Rejection reason is too long.',
        });
      }

      /*
       * Find seller containing this transaction.
       */
      const seller =
        await User.findOne({
          $or: [
            { 'wallet.transactions._id': transactionId },
            { 'usdWallet.transactions._id': transactionId },
          ],
        });

      if (!seller) {
        return res.status(404).json({
          success: false,
          message:
            'Payout request not found.',
        });
      }

      if (!['seller', 'customer'].includes(seller.role)) {
        return res.status(400).json({ success: false, message: 'This withdrawal does not belong to a customer or seller wallet.' });
      }

      /*
       * An admin should not process a payout
       * belonging to the same account.
       */
      if (
        String(
          seller._id
        ) ===
        String(
          req.user._id
        )
      ) {
        return res.status(403).json({
          success: false,
          message:
            'An administrator cannot process their own payout.',
        });
      }

      const isUsdPayout = (seller.usdWallet?.transactions || []).some((entry) => String(entry._id) === String(transactionId));
      const wallet = isUsdPayout ? ensureUsdWallet(seller) : ensureWallet(seller);
      const tx = wallet.transactions.id(transactionId);

      if (!tx) {
        return res.status(404).json({
          success: false,
          message:
            'Payout transaction not found.',
        });
      }

      /*
       * Only payout transactions may be processed.
       */
      if (
        tx.category !==
        'payout_request'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Requested transaction is not a payout request.',
        });
      }

      /*
       * Prevent double approval/rejection.
       */
      if (
        tx.status !==
        'pending'
      ) {
        return res.status(409).json({
          success: false,
          message:
            'This payout request has already been processed.',
          data: {
            status:
              tx.status,

            processedAt:
              tx.processedAt ||
              null,
          },
        });
      }

      const payoutAmount =
        roundMoney(
          tx.amount || 0
        );

      /*
       * Validate payout amount.
       */
      if (
        payoutAmount <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            'This payout contains an invalid amount.',
        });
      }

      const currentPendingBalance = roundMoney(wallet.pendingBalance);
      const currentAvailableBalance = roundMoney(wallet.availableBalance);
      const currencyLabel = isUsdPayout ? 'USD' : 'KES';

      /*
       * IMPORTANT:
       *
       * Do NOT silently clamp the pending balance.
       *
       * If pendingBalance is smaller than the
       * payout amount, something is wrong with
       * the ledger and the payout must stop.
       */
      if (
        currentPendingBalance <
        payoutAmount
      ) {
        console.error(
          `Wallet integrity mismatch while processing ${currencyLabel} payout ${transactionId} for seller ${seller._id}`
        );

        return res.status(409).json({
          success: false,
          message:
            'The seller wallet balance does not match this payout request. The payout has not been processed and requires administrator review.',
        });
      }

      const now =
        new Date();

      /*
       * APPROVE PAYOUT
       */
      if (
        decision ===
        'approved'
      ) {
        tx.status =
          'paid';

        tx.description =
          'Seller payout approved and marked as paid by admin.';

        tx.processedAt =
          now;

        tx.updatedAt =
          now;

        tx.metadata = {
          ...(tx.metadata ||
            {}),

          adminReviewedBy:
            req.user._id,

          adminReviewedAt:
            now.toISOString(),

          adminDecision:
            'approved',

          payoutProcessedManually:
            true,
        };

        /*
         * Release amount from pending.
         *
         * The amount was already removed from
         * availableBalance when the request
         * was created.
         */
        wallet.pendingBalance =
          roundMoney(
            currentPendingBalance -
              payoutAmount
          );
      }

      /*
       * REJECT PAYOUT
       */
      if (
        decision ===
        'rejected'
      ) {
        tx.status =
          'rejected';

        tx.description =
          'Seller payout request rejected by admin.';

        tx.processedAt =
          now;

        tx.updatedAt =
          now;

        tx.metadata = {
          ...(tx.metadata ||
            {}),

          rejectionReason:
            reason,

          adminReviewedBy:
            req.user._id,

          adminReviewedAt:
            now.toISOString(),

          adminDecision:
            'rejected',
        };

        /*
         * Release pending amount and return
         * it to seller's available balance.
         */
        wallet.pendingBalance =
          roundMoney(
            currentPendingBalance -
              payoutAmount
          );

        wallet.availableBalance =
          roundMoney(
            currentAvailableBalance +
              payoutAmount
          );
      }

      wallet.lastUpdatedAt =
        now;

      /*
       * Save the entire ledger change.
       */
      await seller.save();

      /*
       * Never return unnecessary internal
       * admin information to the frontend.
       */
      return res.json({
        success: true,

        message:
          decision ===
          'approved'
            ? 'Withdrawal marked as paid. Confirm the external payout was sent first.'
            : 'Withdrawal rejected and the amount has been returned to the account wallet.',

        data: {
          transaction: {
            _id:
              tx._id,

            type:
              tx.type,

            amount:
              roundMoney(
                tx.amount
              ),

            category:
              tx.category,

            status:
              tx.status,

            description:
              tx.description,

            reference:
              tx.reference,

            createdAt:
              tx.createdAt,

            processedAt:
              tx.processedAt,
          },

          wallet:
            serializeWallet(
              seller
            ),
        },
      });
    } catch (error) {
      console.error(
        'Admin payout decision error:',
        error.message
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to update the payout request.',
      });
    }
  }
);



/* SELLER M-PESA STK TOP-UP. Configure Daraja secrets in the backend environment. */
const axios = require('axios');
const normalizeStkPhone = (value) => {
  const phone = normalizeKenyanPhone(value);
  return phone && /^254(?:7|1)\d{8}$/.test(phone) ? phone : '';
};
const getWalletAccountLabel = (user) => {
  if (user?.role === 'admin') return 'Sylva Tech';
  const source = user?.role === 'seller'
    ? user?.sellerProfile?.storeName
    : user?.name;
  const cleaned = String(source || (user?.role === 'seller' ? 'Seller Store' : 'Customer'))
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 12) || (user?.role === 'seller' ? 'Seller Store' : 'Customer');
};
const getWalletAccountDisplayName = (user) => user?.role === 'admin'
  ? 'Sylva Technologies'
  : String(user?.role === 'seller' ? user?.sellerProfile?.storeName : user?.name || '')
      .trim() || (user?.role === 'seller' ? 'Seller Store' : 'Customer');

const isEligibleWalletTopup = (user) => {
  if (!user || user.isVerified !== true || !['customer', 'seller'].includes(user.role)) return false;
  if (user.role === 'customer') return user.accountStatus === 'active';
  return user.sellerStatus === 'approved' && ['active', 'warning'].includes(user.accountStatus) && user.storeStatus === 'active';
};
const getMpesaTimestamp = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + values.month + values.day + values.hour + values.minute + values.second;
};
const getMpesaAccessToken = async () => {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  if (!key || !secret) throw new Error('M-Pesa credentials are not configured.');
  const host = process.env.MPESA_ENV === 'sandbox' ? 'https://sandbox.safaricom.co.ke' : 'https://api.safaricom.co.ke';
  const auth = Buffer.from(key + ':' + secret).toString('base64');
  const response = await axios.get(host + '/oauth/v1/generate?grant_type=client_credentials', {
    headers: { Authorization: 'Basic ' + auth }, timeout: 15000,
  });
  if (!response.data?.access_token) throw new Error('M-Pesa access token was not returned.');
  return { token: response.data.access_token, host };
};

router.post('/topup/stk', protect, payoutRateLimit, async (req, res) => {
  let user;
  let transaction;
  try {
    user = await User.findById(req.user._id);
    const isAdminDeposit = user?.role === 'admin' && user?.isVerified === true;
    if (!user || (!isAdminDeposit && !isEligibleWalletTopup(user))) {
      return res.status(403).json({ success: false, message: 'Verify your account first. Deposits are available to verified customers, approved active sellers, and verified administrators.' });
    }
    const amount = Number(req.body?.amount);
    if (!Number.isSafeInteger(amount) || amount < 10 || amount > 150000) {
      return res.status(400).json({ success: false, message: 'Enter a whole-number deposit between KSh 10 and KSh 150,000.' });
    }
    const phone = normalizeStkPhone(req.body?.phone || user.sellerProfile?.mpesaPhone || user.phone);
    if (!phone) return res.status(400).json({ success: false, message: 'Enter a valid Kenyan M-Pesa phone number.' });

    const shortcode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    const callbackUrl = process.env.MPESA_CALLBACK_URL;
    const requiredMpesaSettings = [
      'MPESA_CONSUMER_KEY',
      'MPESA_CONSUMER_SECRET',
      'MPESA_SHORTCODE',
      'MPESA_PASSKEY',
      'MPESA_CALLBACK_URL',
    ];
    const missingMpesaSettings = requiredMpesaSettings.filter((name) => !String(process.env[name] || '').trim());
    if (!/^https:\/\//i.test(String(callbackUrl || ''))) {
      if (!missingMpesaSettings.includes('MPESA_CALLBACK_URL')) missingMpesaSettings.push('MPESA_CALLBACK_URL');
    }
    if (missingMpesaSettings.length) {
      return res.status(503).json({
        success: false,
        message: 'M-Pesa deposits are not fully configured.',
        data: {
          missingConfiguration: missingMpesaSettings,
          requiredCallbackPath: '/api/wallet/topup/stk/callback',
          environment: process.env.MPESA_ENV === 'sandbox' ? 'sandbox' : 'production',
        },
      });
    }

    const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
    if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(idempotencyKey))) {
      return res.status(400).json({ success: false, message: 'Invalid deposit request key. Please refresh the page and try again.' });
    }

    if (idempotencyKey) {
      const existing = isAdminDeposit
        ? await AdminWallet.findOne({ key: 'platform', transactions: { $elemMatch: { category: 'mpesa_topup', 'metadata.idempotencyKey': idempotencyKey } } })
        : await User.findOne({ _id: user._id, 'wallet.transactions': { $elemMatch: { category: 'mpesa_topup', 'metadata.idempotencyKey': idempotencyKey } } });
      const existingTx = isAdminDeposit
        ? existing?.transactions.find((entry) => entry.category === 'mpesa_topup' && entry.metadata?.idempotencyKey === idempotencyKey)
        : existing?.wallet?.transactions?.find((entry) => entry.category === 'mpesa_topup' && entry.metadata?.idempotencyKey === idempotencyKey);
      if (existingTx) {
        if (existingTx.status === 'failed') {
          return res.status(409).json({ success: false, message: 'This deposit attempt has already failed. Start a new deposit request.', data: { status: existingTx.status, transactionId: String(existingTx._id) } });
        }
        return res.status(202).json({
          success: true,
          message: existingTx.status === 'completed' ? 'This deposit was already confirmed.' : 'This deposit request already exists; do not initiate another payment.',
          data: { transactionId: String(existingTx._id), status: existingTx.status, checkoutRequestId: existingTx.metadata?.checkoutRequestID || null, amount: existingTx.amount, reference: existingTx.reference },
        });
      }
    }

    const now = new Date();
    const transactionId = new mongoose.Types.ObjectId();
    const accountLabel = getWalletAccountLabel(user);
    const accountDisplayName = getWalletAccountDisplayName(user);
    const internalReference = 'DEP-' + transactionId.toString().slice(-8).toUpperCase();
    transaction = {
      _id: transactionId, type: 'credit', amount, category: 'mpesa_topup',
      status: 'pending', description: 'Wallet deposit awaiting M-Pesa confirmation.',
      reference: `${accountDisplayName} ${internalReference}`, createdAt: now, updatedAt: now, processedAt: null,
      metadata: { provider: 'safaricom-daraja', phone, initiatedBy: String(user._id), walletOwnerType: isAdminDeposit ? 'platform' : 'user', accountReference: accountLabel, accountDisplayName, internalReference, ...(idempotencyKey ? { idempotencyKey } : {}) },
    };
    if (isAdminDeposit) {
      let platformWallet = await AdminWallet.findOne({ key: 'platform' });
      if (!platformWallet) platformWallet = new AdminWallet({ key: 'platform', currency: 'KES' });
      platformWallet.transactions.push(transaction);
      platformWallet.lastUpdatedAt = now;
      await platformWallet.save();
      transaction = platformWallet.transactions.id(transactionId);
    } else {
      const wallet = ensureWallet(user);
      wallet.transactions.unshift(transaction);
      transaction = wallet.transactions.id(transactionId);
      wallet.lastUpdatedAt = now;
      await user.save();
    }

    let providerAccepted = false;
    let stkRequestStarted = false;
    let providerRejected = false;
    let acceptedCheckoutRequestID = '';
    let acceptedMerchantRequestID = '';
    try {
      const credentials = await getMpesaAccessToken();
      const timestamp = getMpesaTimestamp();
      const password = Buffer.from(String(shortcode) + String(passkey) + timestamp).toString('base64');
      stkRequestStarted = true;
      const response = await axios.post(credentials.host + '/mpesa/stkpush/v1/processrequest', {
        BusinessShortCode: shortcode, Password: password, Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline', Amount: amount, PartyA: phone,
        PartyB: shortcode, PhoneNumber: phone, CallBackURL: callbackUrl,
        AccountReference: accountLabel, TransactionDesc: 'Deposit',
      }, { headers: { Authorization: 'Bearer ' + credentials.token, 'Content-Type': 'application/json' }, timeout: 20000 });

      if (response.data?.ResponseCode !== '0' || !response.data?.CheckoutRequestID) {
        providerRejected = true;
        throw new Error(response.data?.ResponseDescription || 'M-Pesa did not accept the STK request.');
      }
      providerAccepted = true;
      acceptedCheckoutRequestID = String(response.data.CheckoutRequestID);
      acceptedMerchantRequestID = String(response.data.MerchantRequestID || '');
      transaction.metadata = {
        ...transaction.metadata,
        merchantRequestID: acceptedMerchantRequestID,
        checkoutRequestID: acceptedCheckoutRequestID,
      };
      transaction.description = 'Deposit requested. Awaiting M-Pesa confirmation.';
      transaction.updatedAt = new Date();
      if (isAdminDeposit) {
        const platformWallet = await AdminWallet.findOne({ key: 'platform' });
        const savedTransaction = platformWallet?.transactions.id(transactionId);
        if (savedTransaction) {
          savedTransaction.metadata = transaction.metadata;
          savedTransaction.description = transaction.description;
          savedTransaction.updatedAt = transaction.updatedAt;
          await platformWallet.save();
        }
      } else {
        await user.save();
      }
      return res.status(202).json({
        success: true,
        message: 'Deposit request sent. Enter your M-Pesa PIN; the wallet updates after payment is confirmed.',
        data: { transactionId: String(transaction._id), reference: accountDisplayName, accountReference: accountLabel, checkoutRequestId: response.data.CheckoutRequestID, amount, phone: '+' + phone, status: 'pending' },
      });
    } catch (providerError) {
      // A network timeout or server error after STK submission is ambiguous: the
      // customer may have approved payment. Keep it pending and correlate callbacks;
      // never label an uncertain payment failed and allow a second charge.
      const uncertain = providerAccepted || (stkRequestStarted && !providerRejected &&
        (!providerError.response || Number(providerError.response.status) >= 500));
      transaction.status = uncertain ? 'pending' : 'failed';
      transaction.description = uncertain
        ? 'Deposit request status is uncertain; awaiting Safaricom confirmation or reconciliation.'
        : 'Wallet deposit request could not be started.';
      transaction.processedAt = uncertain ? null : new Date();
      transaction.updatedAt = new Date();
      transaction.metadata = {
        ...transaction.metadata,
        ...(acceptedCheckoutRequestID ? { checkoutRequestID: acceptedCheckoutRequestID } : {}),
        ...(acceptedMerchantRequestID ? { merchantRequestID: acceptedMerchantRequestID } : {}),
        ...(uncertain ? { initiationUncertain: true, reconciliationRequired: true } : {}),
        providerError: uncertain ? 'Deposit initiation status uncertain' : 'Deposit initiation rejected',
      };
      if (isAdminDeposit) {
        const platformWallet = await AdminWallet.findOne({ key: 'platform' });
        const savedTransaction = platformWallet?.transactions.id(transactionId);
        if (savedTransaction) {
          savedTransaction.status = transaction.status;
          savedTransaction.description = transaction.description;
          savedTransaction.processedAt = transaction.processedAt;
          savedTransaction.updatedAt = transaction.updatedAt;
          savedTransaction.metadata = transaction.metadata;
          await platformWallet.save();
        }
      } else {
        await user.save();
      }
      if (uncertain) {
        return res.status(202).json({
          success: true,
          message: 'The STK request status is not yet certain. Do not pay again; Sylva is waiting for Safaricom confirmation.',
          data: { transactionId: String(transaction._id), checkoutRequestId: acceptedCheckoutRequestID || null, amount, status: 'pending', reconciliationRequired: true },
        });
      }
      throw providerError;
    }
  } catch (error) {
    console.error('M-Pesa deposit initiation failed:', error.response?.data || error.message);
    return res.status(502).json({
      success: false,
      message: 'Unable to start the deposit. Check the transaction status before trying again.',
      ...(transaction?._id ? { data: { transactionId: String(transaction._id), status: transaction.status || 'pending' } } : {}),
    });
  }
});

/* Authenticated deposit status: a seller can only inspect their own deposit. */
/* PayPal USD deposits: create a server-priced order, then credit only
   after the authenticated owner captures it and PayPal confirms USD amount/status. */
router.post('/topup/paypal/create-order', protect, payoutRateLimit, async (req, res) => {
  let user;
  let transaction;
  try {
    user = await User.findById(req.user._id);
    if (!isInternationalSeller(user)) {
      return res.status(403).json({ success: false, message: 'PayPal USD deposits are available to verified, approved sellers registered outside Kenya.' });
    }
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || Math.round(amount * 100) !== amount * 100 || amount < 1 || amount > 10000) {
      return res.status(400).json({ success: false, message: 'Enter a USD deposit amount between $1.00 and $10,000.00.' });
    }
    const wallet = ensureUsdWallet(user);
    const now = new Date();
    transaction = {
      _id: new mongoose.Types.ObjectId(),
      type: 'credit',
      amount: roundMoney(amount),
      currency: 'USD',
      category: 'paypal_topup',
      status: 'pending',
      description: 'PayPal USD wallet deposit awaiting capture.',
      reference: '',
      createdAt: now,
      updatedAt: now,
      processedAt: null,
      metadata: { provider: 'paypal', currency: 'USD', amount: roundMoney(amount) },
    };
    wallet.transactions.unshift(transaction);
    wallet.lastUpdatedAt = now;
    await user.save();

    const accessToken = await getPayPalAccessToken();
    const frontendUrl = String(process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://www.sylvatechnologies.co.ke').replace(/\/$/, '');
    const orderResponse = await axios.post(
      paypalApiBase() + '/v2/checkout/orders',
      {
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: String(transaction._id),
          custom_id: String(user._id),
          description: 'Sylva Technologies USD wallet deposit',
          amount: { currency_code: 'USD', value: amount.toFixed(2) },
        }],
        application_context: {
          brand_name: 'Sylva Technologies',
          user_action: 'PAY_NOW',
          return_url: frontendUrl + '/seller/wallet?paypal=return',
          cancel_url: frontendUrl + '/seller/wallet?paypal=cancel',
        },
      },
      {
        headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        timeout: 20000,
      }
    );
    const order = orderResponse.data;
    const approvalUrl = order?.links?.find((link) => link.rel === 'approve')?.href;
    if (!order?.id || !approvalUrl) throw new Error('PayPal did not return an approval URL.');
    transaction.metadata = { ...transaction.metadata, paypalOrderId: order.id };
    await user.save();
    return res.status(201).json({
      success: true,
      message: 'PayPal order created. Approve it on PayPal to continue.',
      data: { transactionId: String(transaction._id), orderId: order.id, approvalUrl, currency: 'USD', amount: roundMoney(amount) },
    });
  } catch (error) {
    if (user && transaction?._id) {
      try {
        const tx = user.usdWallet?.transactions?.id(transaction._id);
        if (tx && tx.status === 'pending' && !tx.metadata?.paypalOrderId) {
          tx.status = 'failed';
          tx.description = 'PayPal order could not be created.';
          tx.processedAt = new Date();
          await user.save();
        }
      } catch (saveError) {
        console.error('PayPal order failure ledger update error:', saveError.message);
      }
    }
    console.error('PayPal create-order error:', error.response?.data || error.message);
    return res.status(error.statusCode || 502).json({
      success: false,
      message: error.statusCode === 503 ? error.message : 'Unable to start PayPal deposit. No USD wallet credit was made.',
    });
  }
});

router.post('/topup/paypal/capture', protect, payoutRateLimit, async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || '').trim();
    if (!/^[A-Z0-9-]{8,80}$/i.test(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid PayPal order reference.' });
    }
    const user = await User.findById(req.user._id);
    if (!isInternationalSeller(user)) {
      return res.status(403).json({ success: false, message: 'Only verified international sellers can capture PayPal wallet deposits.' });
    }
    const wallet = ensureUsdWallet(user);
    let tx = wallet.transactions.find((entry) => entry.metadata?.paypalOrderId === orderId);
    if (!tx) return res.status(404).json({ success: false, message: 'PayPal deposit was not found in this seller wallet.' });
    if (tx.status === 'completed') {
      return res.json({ success: true, message: 'This PayPal deposit was already credited.', data: { status: 'completed', currency: 'USD', amount: roundMoney(tx.amount), wallet: serializeUsdWallet(user) } });
    }
    if (tx.status !== 'pending') {
      return res.status(409).json({ success: false, message: 'This PayPal deposit is not pending and cannot be credited.' });
    }

    const accessToken = await getPayPalAccessToken();
    const captureResponse = await axios.post(
      paypalApiBase() + '/v2/checkout/orders/' + encodeURIComponent(orderId) + '/capture',
      {},
      { headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    const order = captureResponse.data;
    const purchase = order?.purchase_units?.find((item) => String(item.reference_id || '') === String(tx._id));
    const capture = purchase?.payments?.captures?.find((item) => item.status === 'COMPLETED');
    const captureAmount = Number(capture?.amount?.value);
    if (
      order?.status !== 'COMPLETED' ||
      !purchase ||
      String(purchase.custom_id || '') !== String(user._id) ||
      capture?.amount?.currency_code !== 'USD' ||
      !Number.isFinite(captureAmount) ||
      roundMoney(captureAmount) !== roundMoney(tx.amount)
    ) {
      console.error('PayPal capture verification mismatch for order', orderId);
      return res.status(409).json({ success: false, message: 'PayPal returned details that do not match this deposit. No wallet credit was made; contact support with the order reference.' });
    }

    const now = new Date();
    const updatedUser = await User.findOneAndUpdate(
      {
        _id: user._id,
        'usdWallet.transactions': mongoose.trusted({
          $elemMatch: { _id: tx._id, status: 'pending', 'metadata.paypalOrderId': orderId },
        }),
      },
      {
        $inc: { 'usdWallet.availableBalance': roundMoney(tx.amount) },
        $set: {
          'usdWallet.lastUpdatedAt': now,
          'usdWallet.transactions.$.status': 'completed',
          'usdWallet.transactions.$.description': 'PayPal USD wallet deposit verified and credited.',
          'usdWallet.transactions.$.reference': String(capture.id || orderId),
          'usdWallet.transactions.$.processedAt': now,
          'usdWallet.transactions.$.updatedAt': now,
        },
      },
      { new: true, runValidators: true }
    );
    if (!updatedUser) {
      const latest = await User.findById(user._id);
      const alreadyCredited = latest?.usdWallet?.transactions?.find((entry) => String(entry._id) === String(tx._id));
      if (alreadyCredited?.status === 'completed') {
        return res.json({ success: true, message: 'This PayPal deposit was already credited.', data: { status: 'completed', currency: 'USD', amount: roundMoney(tx.amount), wallet: serializeUsdWallet(latest) } });
      }
      return res.status(409).json({ success: false, message: 'The wallet changed while verifying this payment. Contact support before retrying.' });
    }
    return res.json({
      success: true,
      message: 'PayPal deposit verified and credited to your USD wallet.',
      data: { status: 'completed', currency: 'USD', amount: roundMoney(tx.amount), wallet: serializeUsdWallet(updatedUser) },
    });
  } catch (error) {
    console.error('PayPal capture error:', error.response?.data || error.message);
    return res.status(error.statusCode || 502).json({
      success: false,
      message: error.statusCode === 503 ? error.message : 'Unable to verify/capture this PayPal payment. Your wallet was not credited; check status before retrying.',
    });
  }
});

router.get('/topup/status/:transactionId', protect, async (req, res) => {
  try {
    const { transactionId } = req.params;
    if (!mongoose.isValidObjectId(transactionId)) {
      return res.status(400).json({ success: false, message: 'Invalid deposit reference.' });
    }
    const isAdmin = req.user?.role === 'admin';
    const owner = isAdmin
      ? await AdminWallet.findOne({ key: 'platform', 'transactions._id': transactionId })
      : await User.findOne({ _id: req.user._id, 'wallet.transactions._id': transactionId });
    if (!owner) return res.status(404).json({ success: false, message: 'Deposit transaction was not found in your wallet.' });
    const tx = isAdmin
      ? owner.transactions.id(transactionId)
      : owner.wallet?.transactions?.id(transactionId);
    if (!tx || tx.category !== 'mpesa_topup') {
      return res.status(404).json({ success: false, message: 'Deposit transaction was not found in your wallet.' });
    }
    return res.json({ success: true, data: {
      transactionId: String(tx._id),
      status: tx.status,
      amount: roundMoney(tx.amount),
      reference: tx.reference || '',
      description: tx.description || '',
      createdAt: tx.createdAt || null,
      updatedAt: tx.updatedAt || null,
      processedAt: tx.processedAt || null,
      reconciliationRequired: tx.metadata?.reconciliationRequired === true,
    } });
  } catch (error) {
    console.error('Wallet deposit status error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to check the deposit status.' });
  }
});

/* Safaricom callback: match a pending server-created request, verify amount/phone,
   and atomically transition pending -> completed to avoid duplicate credits. */
router.post('/topup/stk/callback', async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;
    const checkoutRequestID = String(callback?.CheckoutRequestID || '');
    if (!checkoutRequestID) return res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback.' });

    const pendingQuery = {
      category: 'mpesa_topup',
      status: 'pending',
      'metadata.checkoutRequestID': checkoutRequestID,
    };
    const [platformWallet, account] = await Promise.all([
      AdminWallet.findOne({ key: 'platform', transactions: { $elemMatch: pendingQuery } }),
      User.findOne({ 'wallet.transactions': { $elemMatch: pendingQuery } }),
    ]);
    const isPlatformDeposit = Boolean(platformWallet);
    const owner = isPlatformDeposit ? platformWallet : account;
    if (!owner) {
      const alreadyKnown = await Promise.all([
        AdminWallet.exists({ key: 'platform', 'transactions.metadata.checkoutRequestID': checkoutRequestID }),
        User.exists({ 'wallet.transactions.metadata.checkoutRequestID': checkoutRequestID }),
      ]);
      if (alreadyKnown.some(Boolean)) {
        return res.json({ ResultCode: 0, ResultDesc: 'Callback already processed.' });
      }
      // Ask Safaricom to retry rather than silently losing an uncorrelated callback.
      return res.status(503).json({ ResultCode: 1, ResultDesc: 'Deposit transaction is not yet correlated. Please retry callback.' });
    }

    const tx = isPlatformDeposit
      ? platformWallet.transactions.find((item) => item.category === 'mpesa_topup' && item.status === 'pending' && item.metadata?.checkoutRequestID === checkoutRequestID)
      : account.wallet.transactions.find((item) => item.category === 'mpesa_topup' && item.status === 'pending' && item.metadata?.checkoutRequestID === checkoutRequestID);
    if (!tx) return res.json({ ResultCode: 0, ResultDesc: 'Callback already processed.' });

    const ownerFilter = isPlatformDeposit
      ? { _id: platformWallet._id, 'transactions': { $elemMatch: { _id: tx._id, status: 'pending', 'metadata.checkoutRequestID': checkoutRequestID } } }
      : { _id: account._id, 'wallet.transactions': { $elemMatch: { _id: tx._id, status: 'pending', 'metadata.checkoutRequestID': checkoutRequestID } } };

    if (Number(callback.ResultCode) !== 0) {
      const failureUpdate = isPlatformDeposit
        ? { $set: { 'transactions.$.status': 'failed', 'transactions.$.description': 'M-Pesa deposit was cancelled or failed.', 'transactions.$.processedAt': new Date() } }
        : { $set: { 'wallet.transactions.$.status': 'failed', 'wallet.transactions.$.description': 'M-Pesa deposit was cancelled or failed.', 'wallet.transactions.$.processedAt': new Date(), 'wallet.transactions.$.updatedAt': new Date() } };
      await (isPlatformDeposit ? AdminWallet : User).updateOne(ownerFilter, failureUpdate);
      return res.json({ ResultCode: 0, ResultDesc: 'Callback received.' });
    }

    // Confirm the transaction with Safaricom before crediting any wallet.
    const shortcode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    if (!shortcode || !passkey) {
      return res.status(503).json({ ResultCode: 1, ResultDesc: 'Payment verification is not configured.' });
    }
    const credentials = await getMpesaAccessToken();
    const timestamp = getMpesaTimestamp();
    const password = Buffer.from(String(shortcode) + String(passkey) + timestamp).toString('base64');
    const verification = await axios.post(credentials.host + '/mpesa/stkpushquery/v1/query', {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestID,
    }, {
      headers: { Authorization: 'Bearer ' + credentials.token, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    if (String(verification.data?.ResultCode) !== '0') {
      console.warn('M-Pesa deposit query has not confirmed a successful payment yet.', { checkoutRequestID, resultCode: verification.data?.ResultCode });
      return res.status(503).json({ ResultCode: 1, ResultDesc: 'Payment is not yet confirmed.' });
    }

    const items = callback.CallbackMetadata?.Item || [];
    const field = (name) => items.find((item) => item.Name === name)?.Value;
    const paidAmount = Number(field('Amount'));
    const receipt = String(field('MpesaReceiptNumber') || '');
    const paidPhone = String(field('PhoneNumber') || '');
    if (!receipt || !Number.isFinite(paidAmount) || paidAmount !== Number(tx.amount) ||
        (paidPhone && normalizeKenyanPhone(paidPhone) !== normalizeKenyanPhone(tx.metadata?.phone || ''))) {
      console.error('M-Pesa wallet callback amount/phone/receipt mismatch', { checkoutRequestID });
      const mismatchUpdate = isPlatformDeposit
        ? { $set: { 'transactions.$.status': 'failed', 'transactions.$.description': 'Payment confirmation needs administrator review.', 'transactions.$.processedAt': new Date(), 'transactions.$.metadata.reconciliationRequired': true } }
        : { $set: { 'wallet.transactions.$.status': 'failed', 'wallet.transactions.$.description': 'Payment confirmation needs administrator review.', 'wallet.transactions.$.processedAt': new Date(), 'wallet.transactions.$.updatedAt': new Date(), 'wallet.transactions.$.metadata.reconciliationRequired': true } };
      await (isPlatformDeposit ? AdminWallet : User).updateOne(ownerFilter, mismatchUpdate);
      return res.json({ ResultCode: 0, ResultDesc: 'Callback received for review.' });
    }

    const duplicateUserReceipt = await User.exists({ 'wallet.transactions.metadata.mpesaReceiptNumber': receipt });
    const duplicatePlatformReceipt = await AdminWallet.exists({ 'transactions.metadata.mpesaReceiptNumber': receipt });
    if (duplicateUserReceipt || duplicatePlatformReceipt) {
      console.error('M-Pesa receipt already linked to a wallet transaction; manual reconciliation required.', { checkoutRequestID });
      const duplicateUpdate = isPlatformDeposit
        ? { $set: { 'transactions.$.status': 'failed', 'transactions.$.description': 'Payment receipt is already linked to another transaction; administrator review required.', 'transactions.$.processedAt': new Date(), 'transactions.$.metadata.reconciliationRequired': true } }
        : { $set: { 'wallet.transactions.$.status': 'failed', 'wallet.transactions.$.description': 'Payment receipt is already linked to another transaction; administrator review required.', 'wallet.transactions.$.processedAt': new Date(), 'wallet.transactions.$.updatedAt': new Date(), 'wallet.transactions.$.metadata.reconciliationRequired': true } };
      await (isPlatformDeposit ? AdminWallet : User).updateOne(ownerFilter, duplicateUpdate);
      return res.json({ ResultCode: 0, ResultDesc: 'Callback received for review.' });
    }

    const now = new Date();
    const successUpdate = isPlatformDeposit
      ? {
          $inc: { availableBalance: paidAmount },
          $set: {
            lastUpdatedAt: now,
            'transactions.$.status': 'completed',
            'transactions.$.description': 'M-Pesa deposit confirmed.',
            'transactions.$.processedAt': now,
            'transactions.$.metadata.mpesaReceiptNumber': receipt,
            'transactions.$.metadata.callbackResultCode': 0,
          },
        }
      : {
          $inc: { 'wallet.availableBalance': paidAmount },
          $set: {
            'wallet.lastUpdatedAt': now,
            'wallet.transactions.$.status': 'completed',
            'wallet.transactions.$.description': 'M-Pesa deposit confirmed.',
            'wallet.transactions.$.processedAt': now,
            'wallet.transactions.$.updatedAt': now,
            'wallet.transactions.$.metadata.mpesaReceiptNumber': receipt,
            'wallet.transactions.$.metadata.callbackResultCode': 0,
          },
        };
    const update = await (isPlatformDeposit ? AdminWallet : User).updateOne(ownerFilter, successUpdate);
    if (!update.modifiedCount) return res.json({ ResultCode: 0, ResultDesc: 'Callback already processed.' });
    return res.json({ ResultCode: 0, ResultDesc: 'Deposit confirmed.' });
  } catch (error) {
    console.error('M-Pesa wallet callback error:', error.message);
    return res.status(500).json({ ResultCode: 1, ResultDesc: 'Callback processing failed.' });
  }
});

/* Admin-only overview. Seller wallet balances are liabilities, not company profit. */
router.get('/admin/overview', protect, adminOnly, requireVerified, async (req, res) => {
  try {
    const result = await User.aggregate([
      { $match: { role: { $in: ['seller', 'customer'] } } },
      { $group: {
        _id: '$role',
        availableLiability: { $sum: '$wallet.availableBalance' },
        pendingLiability: { $sum: '$wallet.pendingBalance' },
        accountsWithWallets: { $sum: 1 },
      } },
    ]);
    const pendingPayouts = await User.countDocuments({
      role: mongoose.trusted({ $in: ['seller', 'customer'] }),
      'wallet.transactions': mongoose.trusted({
        $elemMatch: { category: 'payout_request', status: 'pending' },
      }),
    });
    const requiredMpesaSettings = [
      'MPESA_CONSUMER_KEY',
      'MPESA_CONSUMER_SECRET',
      'MPESA_SHORTCODE',
      'MPESA_PASSKEY',
      'MPESA_CALLBACK_URL',
    ];
    const missingMpesaSettings = requiredMpesaSettings.filter((name) => !String(process.env[name] || '').trim());
    if (!/^https:\/\//i.test(String(process.env.MPESA_CALLBACK_URL || '')) &&
        !missingMpesaSettings.includes('MPESA_CALLBACK_URL')) {
      missingMpesaSettings.push('MPESA_CALLBACK_URL');
    }
    return res.json({ success: true, data: {
      sellerAvailableLiability: roundMoney(result.find((item) => item._id === 'seller')?.availableLiability || 0),
      sellerPendingLiability: roundMoney(result.find((item) => item._id === 'seller')?.pendingLiability || 0),
      sellersWithWallets: result.find((item) => item._id === 'seller')?.accountsWithWallets || 0,
      customerAvailableLiability: roundMoney(result.find((item) => item._id === 'customer')?.availableLiability || 0),
      customerPendingLiability: roundMoney(result.find((item) => item._id === 'customer')?.pendingLiability || 0),
      customersWithWallets: result.find((item) => item._id === 'customer')?.accountsWithWallets || 0,
      pendingPayouts,
      mpesaConfiguration: {
        configured: missingMpesaSettings.length === 0,
        missing: missingMpesaSettings,
        environment: process.env.MPESA_ENV === 'sandbox' ? 'sandbox' : 'production',
        callbackPath: '/api/wallet/topup/stk/callback',
        expectedCallbackUrl: 'https://sylva-technologies-backend.onrender.com/api/wallet/topup/stk/callback',
      },
      note: 'Customer and seller wallet balances are separate account-holder liabilities, not Sylva Technologies company funds.',
    } });
  } catch (error) {
    console.error('Admin wallet overview error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load wallet overview.' });
  }
});

module.exports = router;