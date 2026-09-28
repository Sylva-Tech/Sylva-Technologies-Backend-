const mongoose = require('mongoose');

const sellerAppealSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ['suspension', 'ban'],
      required: true,
    },

    reason: {
      type: String,
      required: [true, 'Appeal reason is required'],
      trim: true,
      minlength: 10,
      maxlength: 2000,
    },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },

    adminResponse: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

sellerAppealSchema.index({
  seller: 1,
  type: 1,
  status: 1,
});

module.exports = mongoose.model(
  'SellerAppeal',
  sellerAppealSchema
);
