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

// Fail closed: a missing or misspelled environment must never select Production.
// Sandbox is the safe default until Safaricom approves Go Live.
const getMpesaEnvironment = () => {
  const environment = String(process.env.MPESA_ENV || 'sandbox').trim().toLowerCase();
  if (!['sandbox', 'production'].includes(environment)) {
    throw new Error('Invalid M-Pesa environment. Set MPESA_ENV to sandbox or production.');
  }
  return environment;
};

const getMpesaHost = () => getMpesaEnvironment() === 'sandbox'
  ? 'https://sandbox.safaricom.co.ke'
  : 'https://api.safaricom.co.ke';


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

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];

  if (forwarded) {
    return String(forwarded)
      .split(',')[0]
      .trim();
  }

  return (
    req.ip ||
    req.socket?.remoteAddress ||
    'unknown'
  );
};

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

  if (amount < 100) {
    return {
      valid: false,
      message:
        'The minimum payout amount is KSh 100.',
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
    payoutMethod === 'mpesa'
  ) {
    const normalized =
      normalizeKenyanPhone(value);

    if (!normalized) {
      return {
        valid: false,
        message:
          'Please provide a valid Kenyan M-Pesa phone number.',
      };
    }

    return {
      valid: true,
      destination:
        normalized,
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
      'Unsupported payout method. Choose M-Pesa or bank.',
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

      return res.json({
        success: true,
        data: serializeWallet(user),
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
       * Move available -> pending.
       */
      wallet.availableBalance =
        roundMoney(
          availableBalance -
            amount
        );

      wallet.pendingBalance =
        roundMoney(
          pendingBalance +
            amount
        );

      wallet.lastUpdatedAt =
        new Date();

      /*
       * Create transaction ID.
       */
      const transactionId =
        new mongoose.Types.ObjectId();

      const now =
        new Date();

      const transactionReference =
        `payout-${Date.now()}-${transactionId
          .toString()
          .slice(-6)}`;

      /*
       * Create payout transaction.
       */
      const transaction = {
        _id: transactionId,

        type: 'debit',

        amount,

        category:
          'payout_request',

        status:
          'pending',

        description:
          (user.role === 'seller' ? 'Seller' : 'Customer') + ' wallet withdrawal request submitted for admin review.',

        reference:
          transactionReference,

        relatedOrder:
          null,

        createdAt:
          now,

        processedAt:
          null,

        updatedAt:
          now,

        metadata: {
          payoutMethod,

          destination:
            payoutDestination,

          requestedAt:
            now.toISOString(),
        },
      };

      /*
       * Add newest transaction first.
       */
      wallet.transactions.unshift(
        transaction
      );

      /*
       * Save wallet.
       */
      await user.save();

      /*
       * Return safe response.
       */
      return res.status(201).json({
        success: true,

        message:
          'Withdrawal request submitted successfully and is awaiting payout processing.',

        data: {
          wallet:
            serializeWallet(user),

          transaction:
            serializeSellerTransaction(
              transaction
            ),
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

router.get(
  '/admin/payouts',
  protect,
  adminOnly,
  requireVerified,
  async (req, res) => {
    try {
      const payoutAccounts = await User.find(
        mongoose.trusted({
          $or: [
            { role: 'seller' },
            { role: 'customer' },
          ],
          'wallet.transactions': {
            $elemMatch: {
              category: 'payout_request',
              status: 'pending',
            },
          },
        })
      )
          .select(
            'name email phone role sellerProfile wallet'
          )
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
          'wallet.transactions._id':
            transactionId,
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

      const wallet =
        ensureWallet(
          seller
        );

      const tx =
        wallet.transactions.id(
          transactionId
        );

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

      const currentPendingBalance =
        roundMoney(
          wallet.pendingBalance
        );

      const currentAvailableBalance =
        roundMoney(
          wallet.availableBalance
        );

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
          `Wallet integrity mismatch while processing payout ${transactionId} for seller ${seller._id}`
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
  const host = getMpesaHost();
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
    if (!Number.isSafeInteger(amount) || amount < 100 || amount > 150000) {
      return res.status(400).json({ success: false, message: 'Enter a whole-number deposit between KSh 100 and KSh 150,000.' });
    }
    const phone = normalizeStkPhone(req.body?.phone || user.sellerProfile?.mpesaPhone || user.phone);
    if (!phone) return res.status(400).json({ success: false, message: 'Enter a valid Kenyan M-Pesa phone number.' });

    const shortcode = String(process.env.MPESA_SHORTCODE || '').trim();
    const passkey = process.env.MPESA_PASSKEY;
    const callbackUrl = process.env.MPESA_CALLBACK_URL;
    const tillNumber = String(process.env.MPESA_TILL_NUMBER || '').trim();
    const transactionType = String(
      process.env.MPESA_TRANSACTION_TYPE ||
      (tillNumber ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline')
    ).trim();
    if (!['CustomerPayBillOnline', 'CustomerBuyGoodsOnline'].includes(transactionType)) {
      return res.status(503).json({
        success: false,
        message: 'M-Pesa configuration error: MPESA_TRANSACTION_TYPE must be CustomerPayBillOnline or CustomerBuyGoodsOnline.',
      });
    }
    if (transactionType === 'CustomerBuyGoodsOnline' && !/^\d{5,10}$/.test(tillNumber)) {
      return res.status(503).json({
        success: false,
        message: 'M-Pesa Till configuration is incomplete. Set MPESA_TILL_NUMBER to the approved Buy Goods Till number.',
      });
    }
    const partyB = transactionType === 'CustomerBuyGoodsOnline' ? tillNumber : shortcode;
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
          environment: String(process.env.MPESA_ENV || 'sandbox').trim().toLowerCase(),
        },
      });
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
      metadata: { provider: 'safaricom-daraja', phone, initiatedBy: String(user._id), walletOwnerType: isAdminDeposit ? 'platform' : 'user', accountReference: accountLabel, accountDisplayName, internalReference },
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

    try {
      const credentials = await getMpesaAccessToken();
      const timestamp = getMpesaTimestamp();
      const password = Buffer.from(String(shortcode) + String(passkey) + timestamp).toString('base64');
      const response = await axios.post(credentials.host + '/mpesa/stkpush/v1/processrequest', {
        BusinessShortCode: shortcode, Password: password, Timestamp: timestamp,
        TransactionType: transactionType, Amount: amount, PartyA: phone,
        PartyB: partyB, PhoneNumber: phone, CallBackURL: callbackUrl,
        AccountReference: accountLabel, TransactionDesc: 'Deposit',
      }, { headers: { Authorization: 'Bearer ' + credentials.token, 'Content-Type': 'application/json' }, timeout: 20000 });

      if (response.data?.ResponseCode !== '0' || !response.data?.CheckoutRequestID) {
        throw new Error(response.data?.ResponseDescription || 'M-Pesa did not accept the STK request.');
      }
      transaction.metadata = {
        ...transaction.metadata,
        merchantRequestID: response.data.MerchantRequestID,
        checkoutRequestID: response.data.CheckoutRequestID,
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
        data: { transactionId: String(transactionId), status: 'pending', reference: accountDisplayName, accountReference: accountLabel, checkoutRequestId: response.data.CheckoutRequestID, amount, phone: '+' + phone },
      });
    } catch (providerError) {
      transaction.status = 'failed';
      transaction.description = 'Wallet deposit request could not be started.';
      transaction.processedAt = new Date();
      transaction.updatedAt = new Date();
      transaction.metadata = { ...transaction.metadata, providerError: 'Deposit initiation failed' };
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
      throw providerError;
    }
  } catch (error) {
    const providerCode = String(error.response?.data?.errorCode || '');
    const providerMessage = String(
      error.response?.data?.errorMessage ||
      error.response?.data?.ResponseDescription ||
      error.message ||
      ''
    );
    // Safe diagnostics only: never log the Consumer Secret, passkey, access token,
    // phone number, or complete credential values.
    const diagnosticEnvironment = String(process.env.MPESA_ENV || 'sandbox').trim().toLowerCase();
    const diagnosticShortcode = String(process.env.MPESA_SHORTCODE || '').trim();
    const diagnosticTill = String(process.env.MPESA_TILL_NUMBER || '').trim();
    const diagnosticTransactionType = String(
      process.env.MPESA_TRANSACTION_TYPE ||
      (diagnosticTill ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline')
    ).trim();
    console.error('M-Pesa deposit initiation failed:', {
      code: providerCode || undefined,
      message: providerMessage,
      environment: diagnosticEnvironment,
      apiHost: diagnosticEnvironment === 'sandbox'
        ? 'https://sandbox.safaricom.co.ke'
        : diagnosticEnvironment === 'production'
          ? 'https://api.safaricom.co.ke'
          : 'invalid-environment',
      shortcodeConfigured: Boolean(diagnosticShortcode),
      shortcodeLastTwo: diagnosticShortcode ? diagnosticShortcode.slice(-2) : undefined,
      tillConfigured: Boolean(diagnosticTill),
      tillLastTwo: diagnosticTill ? diagnosticTill.slice(-2) : undefined,
      transactionType: diagnosticTransactionType,
      providerResponse: error.response?.data || undefined,
    });

    let message = 'Unable to start the M-Pesa deposit. Please verify the phone number and try again.';
    if (providerCode === '400.002.02' || /invalid business shortcode/i.test(providerMessage)) {
      message = 'M-Pesa configuration error: the business shortcode does not match the selected Daraja environment. Please contact support; no wallet funds were added.';
    } else if (/invalid access token|unauthorized|invalid consumer key/i.test(providerMessage)) {
      message = 'M-Pesa configuration error: Daraja credentials are not valid for the selected environment. Please contact support; no wallet funds were added.';
    } else if (/passkey|password/i.test(providerMessage) && /invalid|incorrect|error/i.test(providerMessage)) {
      message = 'M-Pesa configuration error: the STK passkey or shortcode is incorrect. Please contact support; no wallet funds were added.';
    }

    return res.status(502).json({ success: false, message });
  }
});

/* Read the signed-in user's own deposit status. This endpoint never credits funds;
   only the Safaricom callback and server-side payment verification can do that. */
router.get('/topup/status/:transactionId', protect, async (req, res) => {
  try {
    const transactionId = String(req.params.transactionId || '');
    if (!mongoose.isValidObjectId(transactionId)) {
      return res.status(400).json({ success: false, message: 'Invalid deposit reference.' });
    }

    const user = await User.findById(req.user._id).select('role wallet.transactions');
    let transaction = user?.wallet?.transactions?.id(transactionId);

    if (!transaction && user?.role === 'admin') {
      const platformWallet = await AdminWallet.findOne({ key: 'platform', transactions: { $elemMatch: { _id: transactionId, category: 'mpesa_topup' } } });
      transaction = platformWallet?.transactions?.id(transactionId);
    }

    if (!transaction || transaction.category !== 'mpesa_topup') {
      return res.status(404).json({ success: false, message: 'Deposit reference was not found for this account.' });
    }

    return res.json({ success: true, data: {
      transactionId: String(transaction._id),
      status: transaction.status || 'pending',
      amount: roundMoney(transaction.amount),
      reference: transaction.reference || '',
      reconciliationRequired: Boolean(transaction.metadata?.reconciliationRequired),
      processedAt: transaction.processedAt || null,
    } });
  } catch (error) {
    console.error('M-Pesa deposit status lookup failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to check deposit status right now.' });
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
    if (!owner) return res.json({ ResultCode: 0, ResultDesc: 'Callback received.' });

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
        (paidPhone && paidPhone !== String(tx.metadata?.phone || ''))) {
      console.error('M-Pesa wallet callback amount/phone/receipt mismatch', { checkoutRequestID });
      return res.json({ ResultCode: 0, ResultDesc: 'Callback received for review.' });
    }

    const duplicateUserReceipt = await User.exists({ 'wallet.transactions.metadata.mpesaReceiptNumber': receipt });
    const duplicatePlatformReceipt = await AdminWallet.exists({ 'transactions.metadata.mpesaReceiptNumber': receipt });
    if (duplicateUserReceipt || duplicatePlatformReceipt) return res.json({ ResultCode: 0, ResultDesc: 'Callback received.' });

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
    const pendingPayouts = await User.countDocuments(mongoose.trusted({
      $or: [{ role: 'seller' }, { role: 'customer' }],
      'wallet.transactions': { $elemMatch: { category: 'payout_request', status: 'pending' } },
    }));
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
        environment: String(process.env.MPESA_ENV || 'sandbox').trim().toLowerCase(),
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