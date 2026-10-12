const mongoose = require('mongoose');

const adminWalletTransactionSchema = new mongoose.Schema({
  type: { type: String, enum: ['credit', 'debit'], required: true },
  amount: { type: Number, required: true, min: 0.01 },
  category: {
    type: String,
    enum: ['customer_transfer_in', 'seller_transfer_in', 'transfer_to_customer', 'transfer_to_seller', 'withdrawal_request', 'withdrawal_paid', 'withdrawal_rejected', 'adjustment', 'mpesa_topup'],
    required: true,
  },
  status: { type: String, enum: ['pending', 'completed', 'paid', 'rejected', 'failed'], default: 'completed' },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  reference: { type: String, trim: true, maxlength: 100, unique: true, sparse: true },
  relatedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
  processedAt: { type: Date, default: null },
  updatedAt: { type: Date, default: Date.now },
}, { _id: true });

const adminWalletSchema = new mongoose.Schema({
  key: { type: String, default: 'platform', unique: true, required: true },
  currency: { type: String, default: 'KES' },
  availableBalance: { type: Number, default: 0, min: 0 },
  pendingBalance: { type: Number, default: 0, min: 0 },
  lastUpdatedAt: { type: Date, default: Date.now },
  transactions: { type: [adminWalletTransactionSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.models.AdminWallet || mongoose.model('AdminWallet', adminWalletSchema);
