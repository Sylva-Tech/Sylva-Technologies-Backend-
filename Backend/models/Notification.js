const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    /* ==========================================
     * RECIPIENT
     * ========================================== */

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /* ==========================================
     * NOTIFICATION TYPE
     * ========================================== */

    type: {
      type: String,
      enum: [
        'account_warning',
        'account_suspended',
        'account_banned',
        'account_reactivated',

        'seller_application_submitted',
        'seller_application_approved',
        'seller_application_rejected',
        'seller_application_resubmitted',

        'appeal_submitted',
        'appeal_approved',
        'appeal_rejected',

        'order_received',
        'order_status',
        'payment_received',

        'product_approved',
        'product_rejected',

        'system',
      ],
      required: true,
      index: true,
    },

    /* ==========================================
     * NOTIFICATION CONTENT
     * ========================================== */

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },

    /* ==========================================
     * OPTIONAL REFERENCE
     * ========================================== */

    relatedId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    relatedModel: {
      type: String,
      default: '',
      trim: true,
    },

    /* ==========================================
     * READ STATUS
     * ========================================== */

    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },

    readAt: {
      type: Date,
      default: null,
    },

    /* ==========================================
     * EMAIL STATUS
     * ========================================== */

    emailSent: {
      type: Boolean,
      default: false,
    },

    emailSentAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

/*
 * Quickly retrieve a user's newest notifications.
 */
notificationSchema.index({
  user: 1,
  createdAt: -1,
});

module.exports = mongoose.model(
  'Notification',
  notificationSchema
);