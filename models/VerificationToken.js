const mongoose = require('mongoose');

const verificationTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    purpose: {
      type: String,
      enum: ['verification', 'password-reset'],
      required: true,
    },
    tokenHash: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    usedAt: {
      type: Date,
      default: null,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
    },
    method: {
      type: String,
      enum: ['email', 'sms'],
      default: 'email',
    },
  },
  {
    timestamps: true,
  }
);

verificationTokenSchema.index({ user: 1, purpose: 1, expiresAt: 1 });

module.exports = mongoose.model('VerificationToken', verificationTokenSchema);
