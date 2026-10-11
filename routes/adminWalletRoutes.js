const express = require('express');
const mongoose = require('mongoose');
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

router.post('/transfer-out', protect, adminOnly, requireVerified, async (req, res) => {
  const amount = Number(req.body?.amount);
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!Number.isFinite(amount) || amount < 100 || Math.round(amount * 100) !== amount * 100 || !email) {
    return res.status(400).json({ success: false, message: 'Enter a recipient email and a valid amount of at least KSh 100.' });
  }
  const session = await mongoose.startSession();
  try {
    let outcome;
    await session.withTransaction(async () => {
      const AdminWallet = require('../models/AdminWallet');
      const User = require('../models/User');
      const platform = await AdminWallet.findOne({ key: 'platform' }).session(session);
      const recipient = await User.findOne({ email }).session(session);
      if (!platform || platform.availableBalance < amount) throw Object.assign(new Error('Insufficient available platform funds.'), { statusCode: 409 });
      if (!recipient || !['customer', 'seller'].includes(recipient.role) || recipient.isVerified !== true || recipient.accountStatus !== 'active' ||
        (recipient.role === 'seller' && (recipient.sellerStatus !== 'approved' || recipient.storeStatus !== 'active'))) {
        throw Object.assign(new Error('Recipient must be a verified active customer or approved active seller.'), { statusCode: 400 });
      }
      if (!recipient.wallet) recipient.wallet = {};
      recipient.wallet.availableBalance = Number(recipient.wallet.availableBalance || 0);
      recipient.wallet.transactions = Array.isArray(recipient.wallet.transactions) ? recipient.wallet.transactions : [];
      const ref = 'PLATFORM-' + new mongoose.Types.ObjectId().toString().toUpperCase();
      platform.availableBalance = Number((platform.availableBalance - amount).toFixed(2));
      platform.lastUpdatedAt = new Date();
      platform.transactions.push({ type: 'debit', amount, category: recipient.role === 'seller' ? 'transfer_to_seller' : 'transfer_to_customer', status: 'completed', description: 'Platform wallet transfer to verified account.', reference: ref, relatedUser: recipient._id });
      recipient.wallet.availableBalance = Number((recipient.wallet.availableBalance + amount).toFixed(2));
      recipient.wallet.lastUpdatedAt = new Date();
      recipient.wallet.transactions.push({ type: 'credit', amount, category: 'admin_transfer', status: 'completed', description: 'Transfer received from Sylva Technologies platform wallet.', reference: ref, createdAt: new Date(), processedAt: new Date() });
      await platform.save({ session });
      await recipient.save({ session });
      outcome = { reference: ref, amount, recipient: { name: recipient.name, email: recipient.email, role: recipient.role } };
    });
    return res.json({ success: true, message: 'Transfer recorded in both wallet ledgers.', data: outcome });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Unable to complete transfer.' });
  } finally {
    await session.endSession();
  }
});

module.exports = router;
