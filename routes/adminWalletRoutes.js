const express = require('express');
const mongoose = require('mongoose');
const AdminWallet = require('../models/AdminWallet');
const User = require('../models/User');
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

router.post('/transfer-in', protect, requireVerified, async (req, res) => {
  const amount = Number(req.body?.amount);
  if (!['customer', 'seller'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Only customer and seller wallets can transfer funds to the platform wallet.' });
  if (req.user.accountStatus !== 'active' || (req.user.role === 'seller' && (req.user.sellerStatus !== 'approved' || req.user.storeStatus !== 'active'))) return res.status(403).json({ success: false, message: 'Your account is not eligible to transfer funds.' });
  if (!Number.isFinite(amount) || amount < 100 || Math.round(amount * 100) !== amount * 100) return res.status(400).json({ success: false, message: 'Enter a valid amount of at least KSh 100.' });
  const session = await mongoose.startSession();
  try {
    let outcome;
    await session.withTransaction(async () => {
      const sender = await User.findById(req.user._id).session(session);
      if (!sender || sender.isVerified !== true || sender.accountStatus !== 'active' || !sender.wallet || Number(sender.wallet.availableBalance || 0) < amount) {
        throw Object.assign(new Error('Insufficient available wallet funds or account is not eligible.'), { statusCode: 409 });
      }
      let platform = await AdminWallet.findOne({ key: 'platform' }).session(session);
      if (!platform) {
        platform = new AdminWallet({ key: 'platform', currency: 'KES' });
        await platform.save({ session });
      }
      const ref = 'PLATFORM-' + new mongoose.Types.ObjectId().toString().toUpperCase();
      sender.wallet.availableBalance = Number((Number(sender.wallet.availableBalance || 0) - amount).toFixed(2));
      sender.wallet.lastUpdatedAt = new Date();
      sender.wallet.transactions.push({ type: 'debit', amount, category: 'platform_transfer', status: 'completed', description: 'Transferred to Sylva Technologies platform wallet.', reference: ref, createdAt: new Date(), processedAt: new Date() });
      platform.availableBalance = Number((Number(platform.availableBalance || 0) + amount).toFixed(2));
      platform.lastUpdatedAt = new Date();
      platform.transactions.push({ type: 'credit', amount, category: sender.role === 'seller' ? 'seller_transfer_in' : 'customer_transfer_in', status: 'completed', description: 'Transfer received from a verified account wallet.', reference: ref, relatedUser: sender._id, metadata: { senderRole: sender.role, senderEmail: sender.email } });
      await sender.save({ session });
      await platform.save({ session });
      outcome = { reference: ref, amount };
    });
    return res.json({ success: true, message: 'Transfer recorded in both wallet ledgers.', data: outcome });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Unable to complete transfer.' });
  } finally { await session.endSession(); }
});

router.post('/withdrawals', protect, adminOnly, requireVerified, async (req, res) => {
  const amount = Number(req.body?.amount);
  const method = String(req.body?.method || '').toLowerCase();
  let destination = String(req.body?.destination || '').trim();
  if (!Number.isFinite(amount) || amount < 100 || Math.round(amount * 100) !== amount * 100) return res.status(400).json({ success: false, message: 'Enter a valid withdrawal amount of at least KSh 100.' });
  if (method === 'mpesa') {
    destination = destination.replace(/[\s-]/g, '');
    if (/^0[17]\d{8}$/.test(destination)) destination = '254' + destination.slice(1);
    if (/^\+254[17]\d{8}$/.test(destination)) destination = destination.slice(1);
    if (!/^254[17]\d{8}$/.test(destination)) return res.status(400).json({ success: false, message: 'Enter a valid Kenyan M-Pesa phone number.' });
  } else if (method === 'bank') {
    if (destination.length < 5 || destination.length > 200) return res.status(400).json({ success: false, message: 'Enter valid bank payout details.' });
  } else return res.status(400).json({ success: false, message: 'Choose M-Pesa or bank.' });
  try {
    const wallet = await platformWallet();
    if (Number(wallet.availableBalance || 0) < amount) return res.status(409).json({ success: false, message: 'Insufficient available platform funds.' });
    const ref = 'WITHDRAW-' + new mongoose.Types.ObjectId().toString().toUpperCase();
    wallet.availableBalance = Number((wallet.availableBalance - amount).toFixed(2));
    wallet.pendingBalance = Number((wallet.pendingBalance + amount).toFixed(2));
    wallet.lastUpdatedAt = new Date();
    wallet.transactions.push({ type: 'debit', amount, category: 'withdrawal_request', status: 'pending', description: 'Platform withdrawal awaiting external payout processing.', reference: ref, metadata: { payoutMethod: method, destination, requestedBy: String(req.user._id) } });
    await wallet.save();
    return res.status(202).json({ success: true, message: 'Withdrawal request saved and funds reserved. The M-Pesa or bank transfer still needs to be sent and confirmed externally.', data: { reference: ref, amount, method, status: 'pending' } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to create withdrawal request.' });
  }
});

router.patch('/withdrawals/:transactionId', protect, adminOnly, requireVerified, async (req, res) => {
  const decision = String(req.body?.decision || '').toLowerCase();
  const reason = String(req.body?.reason || '').trim().slice(0, 300);
  if (!['paid', 'rejected'].includes(decision)) return res.status(400).json({ success: false, message: 'Choose paid or rejected.' });
  if (decision === 'rejected' && !reason) return res.status(400).json({ success: false, message: 'A rejection reason is required.' });
  if (!mongoose.isValidObjectId(req.params.transactionId)) return res.status(400).json({ success: false, message: 'Invalid withdrawal transaction.' });
  try {
    const wallet = await platformWallet();
    const tx = wallet.transactions.id(req.params.transactionId);
    if (!tx || tx.category !== 'withdrawal_request' || tx.status !== 'pending') return res.status(404).json({ success: false, message: 'Pending withdrawal not found.' });
    if (Number(wallet.pendingBalance || 0) < Number(tx.amount || 0)) return res.status(409).json({ success: false, message: 'Platform pending balance does not cover this withdrawal.' });
    wallet.pendingBalance = Number((wallet.pendingBalance - tx.amount).toFixed(2));
    tx.status = decision === 'paid' ? 'paid' : 'rejected';
    tx.processedAt = new Date();
    tx.description = decision === 'paid' ? 'External payout confirmed as sent by admin.' : 'Withdrawal rejected; funds returned to available platform balance.';
    tx.metadata = { ...(tx.metadata || {}), reviewedBy: String(req.user._id), reviewedAt: new Date().toISOString(), ...(decision === 'rejected' ? { rejectionReason: reason } : {}) };
    if (decision === 'rejected') wallet.availableBalance = Number((wallet.availableBalance + tx.amount).toFixed(2));
    wallet.lastUpdatedAt = new Date();
    await wallet.save();
    return res.json({ success: true, message: decision === 'paid' ? 'Marked paid. Only do this after the external M-Pesa/bank transfer is complete.' : 'Withdrawal rejected and funds returned.', data: safe(wallet) });
  } catch (error) {
    console.error('Platform withdrawal review error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to update withdrawal request.' });
  }
});

module.exports = router;
