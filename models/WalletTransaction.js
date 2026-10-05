const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['credit', 'debit'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'KES',
      trim: true,
    },
    category: {
      type: String,
      enum: [
        'order_settlement',
        'payout_request',
        'payout_paid',
        'refund',
        'manual_adjustment',
      ],
      default: 'manual_adjustment',
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'paid', 'rejected', 'failed', 'reversed'],
      default: 'completed',
      index: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    reference: {
      type: String,
      default: '',
      trim: true,
    },
    relatedOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  'WalletTransaction',
  walletTransactionSchema
);
