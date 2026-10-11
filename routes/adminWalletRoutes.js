const express = require('express');
const AdminWallet = require('../models/AdminWallet');
const { protect, adminOnly, requireVerified } = require('../middleware/authMiddleware');
const router = express.Router();

router.get('/', protect, adminOnly, requireVerified, async (req, res) => {
  try {
    let wallet = await AdminWallet.findOne({ key: 'platform' });
    if (!wallet) wallet = await AdminWallet.create({ key: 'platform', currency: 'KES' });
    return res.json({ success: true, data: {
      currency: wallet.currency,
      availableBalance: wallet.availableBalance,
      pendingBalance: wallet.pendingBalance,
      totalBalance: Number((wallet.availableBalance + wallet.pendingBalance).toFixed(2)),
      lastUpdatedAt: wallet.lastUpdatedAt,
      transactions: [...wallet.transactions].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)),
    }});
  } catch (error) {
    console.error('Platform wallet read error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load platform wallet.' });
  }
});

module.exports = router;
