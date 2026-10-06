const express = require('express');
const mongoose = require('mongoose');

const User = require('../models/User');

const {
  protect,
  adminOnly,
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
          message:
            'Wallet could not be found.',
        });
      }

      return res.json({
        success: true,
        data:
          serializeWallet(user),
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
          message:
            'Wallet could not be found.',
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

      /*
       * IMPORTANT:
       *
       * isActiveSeller() requires:
       * role = seller
       * sellerStatus = approved
       * accountStatus = active/warning
       * storeStatus = active
       */
      const isActiveSeller =
        typeof user.isActiveSeller ===
        'function'
          ? user.isActiveSeller()
          : (
              user.role === 'seller' &&
              user.sellerStatus ===
                'approved' &&
              [
                'active',
                'warning',
              ].includes(
                user.accountStatus
              ) &&
              user.storeStatus ===
                'active'
            );

      if (!isActiveSeller) {
        return res.status(403).json({
          success: false,
          message:
            'Only active and approved sellers can request payouts.',
        });
      }

      /*
       * Explicitly block suspended/banned accounts.
       */
      if (
        user.accountStatus ===
          'suspended' ||
        user.accountStatus ===
          'banned'
      ) {
        return res.status(403).json({
          success: false,
          message:
            'Your seller account is not permitted to request payouts.',
        });
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
          user.sellerProfile
            ?.mpesaPhone || '';
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
          'Seller payout request submitted for admin review.',

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
          'Payout request submitted successfully and is awaiting admin processing.',

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
  async (req, res) => {
    try {
      const sellers =
        await User.find({
          role: 'seller',

          'wallet.transactions': {
            $elemMatch: {
              category:
                'payout_request',

              status:
                'pending',
            },
          },
        })
          .select(
            'name email phone sellerProfile wallet'
          )
          .lean();

      const pendingPayouts =
        [];

      for (
        const seller of sellers
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

            seller: {
              _id:
                seller._id,

              name:
                seller.name || '',

              email:
                seller.email || '',

              phone:
                seller.phone || '',

              storeName:
                seller.sellerProfile
                  ?.storeName || '',

              mpesaPhone:
                seller.sellerProfile
                  ?.mpesaPhone || '',
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

      /*
       * Make sure this is a seller.
       */
      if (
        seller.role !==
        'seller'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'This payout does not belong to a seller account.',
        });
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
            ? 'Payout approved and marked as paid successfully.'
            : 'Payout rejected and the amount has been returned to the seller wallet.',

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

module.exports = router;