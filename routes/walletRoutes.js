const express = require('express');
const mongoose = require('mongoose');

const User = require('../models/User');
const {
  protect,
  adminOnly,
} = require('../middleware/authMiddleware');

const router = express.Router();

const roundMoney = (value) => {
  const normalized = Number(value || 0);
  if (!Number.isFinite(normalized)) {
    return 0;
  }

  return Number(normalized.toFixed(2));
};

const ensureWallet = (user) => {
  const wallet = user.wallet || {};

  wallet.currency = wallet.currency || 'KES';
  wallet.availableBalance = roundMoney(
    wallet.availableBalance || 0
  );
  wallet.pendingBalance = roundMoney(
    wallet.pendingBalance || 0
  );
  wallet.transactions = Array.isArray(
    wallet.transactions
  )
    ? wallet.transactions
    : [];
  wallet.lastUpdatedAt =
    wallet.lastUpdatedAt || new Date();

  user.wallet = wallet;

  return wallet;
};

const serializeWallet = (user) => {
  const wallet = ensureWallet(user);

  const transactions = [...wallet.transactions]
    .sort(
      (a, b) =>
        new Date(b.createdAt || b.updatedAt || 0) -
        new Date(a.createdAt || a.updatedAt || 0)
    )
    .map((entry) => ({
      _id: entry._id || entry.id || undefined,
      type: entry.type || 'credit',
      amount: roundMoney(entry.amount || 0),
      category: entry.category || 'manual_adjustment',
      status: entry.status || 'completed',
      description: entry.description || '',
      reference: entry.reference || '',
      relatedOrder: entry.relatedOrder || null,
      createdAt: entry.createdAt || null,
      metadata: entry.metadata || {},
    }));

  return {
    currency: wallet.currency,
    availableBalance: wallet.availableBalance,
    pendingBalance: wallet.pendingBalance,
    totalBalance: roundMoney(
      wallet.availableBalance + wallet.pendingBalance
    ),
    lastUpdatedAt: wallet.lastUpdatedAt || null,
    payoutPreferences: {
      mpesaPhone:
        user.sellerProfile?.mpesaPhone || '',
      storeName:
        user.sellerProfile?.storeName || '',
    },
    transactions,
  };
};

router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      '-password'
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Wallet could not be found.',
      });
    }

    return res.json({
      success: true,
      data: serializeWallet(user),
    });
  } catch (error) {
    console.error('Get wallet error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load your wallet.',
    });
  }
});

router.get('/transactions', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      '-password'
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Wallet could not be found.',
      });
    }

    const wallet = ensureWallet(user);

    return res.json({
      success: true,
      data: [...wallet.transactions]
        .sort(
          (a, b) =>
            new Date(b.createdAt || b.updatedAt || 0) -
            new Date(a.createdAt || a.updatedAt || 0)
        )
        .map((entry) => ({
          _id: entry._id || entry.id || undefined,
          type: entry.type || 'credit',
          amount: roundMoney(entry.amount || 0),
          category: entry.category || 'manual_adjustment',
          status: entry.status || 'completed',
          description: entry.description || '',
          reference: entry.reference || '',
          relatedOrder: entry.relatedOrder || null,
          createdAt: entry.createdAt || null,
          metadata: entry.metadata || {},
        })),
    });
  } catch (error) {
    console.error('Get wallet transactions error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load wallet transactions.',
    });
  }
});

router.post('/payout-request', protect, async (req, res) => {
  try {
    if (
      req.user.role !== 'seller' ||
      req.user.sellerStatus !== 'approved'
    ) {
      return res.status(403).json({
        success: false,
        message: 'Only approved sellers can request payouts.',
      });
    }

    if (
      req.user.accountStatus === 'suspended' ||
      req.user.accountStatus === 'banned'
    ) {
      return res.status(403).json({
        success: false,
        message: 'Your seller account is not permitted to request payouts.',
      });
    }

    const amount = roundMoney(req.body.amount);
    const payoutMethod = String(
      req.body.payoutMethod || 'mpesa'
    ).trim();
    const payoutDestination = String(
      req.body.destination ||
        req.user.sellerProfile?.mpesaPhone ||
        ''
    ).trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'A valid payout amount is required.',
      });
    }

    if (!['mpesa', 'bank'].includes(payoutMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported payout method.',
      });
    }

    if (!payoutDestination) {
      return res.status(400).json({
        success: false,
        message: 'A payout destination is required.',
      });
    }

    const user = await User.findById(req.user._id);
    const wallet = ensureWallet(user);

    if (amount > wallet.availableBalance) {
      return res.status(400).json({
        success: false,
        message: 'Requested amount exceeds the available wallet balance.',
      });
    }

    wallet.availableBalance = roundMoney(
      wallet.availableBalance - amount
    );
    wallet.pendingBalance = roundMoney(
      wallet.pendingBalance + amount
    );
    wallet.lastUpdatedAt = new Date();

    const transaction = {
      _id: new mongoose.Types.ObjectId(),
      type: 'debit',
      amount,
      category: 'payout_request',
      status: 'pending',
      description: 'Seller payout request submitted for review.',
      reference: `payout-${Date.now()}`,
      createdAt: new Date(),
      metadata: {
        payoutMethod,
        destination: payoutDestination,
      },
    };

    wallet.transactions.unshift(transaction);
    await user.save();

    return res.status(201).json({
      success: true,
      message: 'Payout request submitted successfully.',
      data: {
        wallet: serializeWallet(user),
        transaction,
      },
    });
  } catch (error) {
    console.error('Request payout error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to create your payout request.',
    });
  }
});

router.get('/admin/payouts', protect, adminOnly, async (req, res) => {
  try {
    const sellers = await User.find({
      role: 'seller',
      'wallet.transactions.category': 'payout_request',
    }).select('-password');

    const pendingPayouts = sellers
      .map((seller) => {
        const wallet = ensureWallet(seller);

        return wallet.transactions
          .filter(
            (entry) =>
              entry.category === 'payout_request' &&
              entry.status === 'pending'
          )
          .map((entry) => ({
            _id: entry._id,
            seller: {
              _id: seller._id,
              name: seller.name,
              email: seller.email,
              storeName:
                seller.sellerProfile?.storeName || '',
            },
            type: entry.type,
            amount: roundMoney(entry.amount || 0),
            status: entry.status,
            payoutMethod: entry.metadata?.payoutMethod || 'mpesa',
            destination:
              entry.metadata?.destination || '',
            createdAt: entry.createdAt || null,
          }));
      })
      .flat();

    return res.json({
      success: true,
      data: pendingPayouts,
    });
  } catch (error) {
    console.error('Admin payout list error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load pending payouts.',
    });
  }
});

router.patch(
  '/admin/payouts/:transactionId',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { transactionId } = req.params;
      const { decision = 'approved', reason = '' } = req.body;

      if (!mongoose.Types.ObjectId.isValid(transactionId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid payout request ID.',
        });
      }

      const seller = await User.findOne({
        'wallet.transactions._id': transactionId,
      });

      if (!seller) {
        return res.status(404).json({
          success: false,
          message: 'Payout request not found.',
        });
      }

      const wallet = ensureWallet(seller);
      const tx = wallet.transactions.id(transactionId);

      if (!tx || tx.category !== 'payout_request') {
        return res.status(400).json({
          success: false,
          message: 'Requested transaction is not a payout request.',
        });
      }

      if (tx.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: 'This payout request is no longer pending.',
        });
      }

      if (decision === 'approved') {
        tx.status = 'paid';
        tx.description = 'Seller payout approved and processed.';
        tx.metadata = {
          ...(tx.metadata || {}),
          adminReviewedBy: req.user._id,
          adminReviewedAt: new Date().toISOString(),
        };
        tx.processedAt = new Date();
        wallet.pendingBalance = roundMoney(
          wallet.pendingBalance - (tx.amount || 0)
        );
      } else {
        tx.status = 'rejected';
        tx.description = 'Seller payout request rejected.';
        tx.metadata = {
          ...(tx.metadata || {}),
          rejectionReason: String(reason || '').trim(),
          adminReviewedBy: req.user._id,
          adminReviewedAt: new Date().toISOString(),
        };
        wallet.pendingBalance = roundMoney(
          wallet.pendingBalance - (tx.amount || 0)
        );
        wallet.availableBalance = roundMoney(
          wallet.availableBalance + (tx.amount || 0)
        );
      }

      wallet.lastUpdatedAt = new Date();
      await seller.save();

      return res.json({
        success: true,
        message:
          decision === 'approved'
            ? 'Payout approved successfully.'
            : 'Payout rejected successfully.',
        data: {
          transaction: tx,
          wallet: serializeWallet(seller),
        },
      });
    } catch (error) {
      console.error('Admin payout decision error:', error);

      return res.status(500).json({
        success: false,
        message: 'Unable to update the payout request.',
      });
    }
  }
);

module.exports = router;
