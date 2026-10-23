const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    image: {
      type: String,
      default: '',
    },

    quantity: {
      type: Number,
      required: true,
      min: 1,
    },

    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  {
    _id: true,
  }
);

const orderSchema = new mongoose.Schema(
  {
    /*
    |--------------------------------------------------------------------------
    | ORDER IDENTIFICATION
    |--------------------------------------------------------------------------
    */

    orderNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    trackingCode: {
      type: String,
      default: '',
      index: true,
      trim: true,
    },

    // Admin inbox review is separate from fulfillment/payment status.
    adminReviewedAt: {
      type: Date,
      default: null,
      index: true,
    },
    adminReviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    /*
    |--------------------------------------------------------------------------
    | CUSTOMER
    |--------------------------------------------------------------------------
    */

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    customerName: {
      type: String,
      default: '',
      trim: true,
    },

    customerEmail: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
    },

    customerPhone: {
      type: String,
      default: '',
      trim: true,
    },

    /*
    |--------------------------------------------------------------------------
    | ORDER ITEMS
    |--------------------------------------------------------------------------
    */

    items: {
      type: [orderItemSchema],
      required: true,
      validate: {
        validator: function (items) {
          return Array.isArray(items) && items.length > 0;
        },
        message:
          'An order must contain at least one product.',
      },
    },

    /*
    |--------------------------------------------------------------------------
    | ORDER TOTALS
    |--------------------------------------------------------------------------
    |
    | These values are calculated by the backend.
    |
    | subtotal = sum of all item subtotals
    | deliveryFee = delivery charge
    | total = subtotal + deliveryFee
    |
    |--------------------------------------------------------------------------
    */

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },

    deliveryFee: {
      type: Number,
      default: 0,
      min: 0,
    },

    total: {
      type: Number,
      required: true,
      min: 0,
    },

    /*
    |--------------------------------------------------------------------------
    | CUSTOMER DELIVERY DETAILS
    |--------------------------------------------------------------------------
    */

    customerDetails: {
      fullName: {
        type: String,
        trim: true,
      },

      phone: {
        type: String,
        trim: true,
      },

      email: {
        type: String,
        trim: true,
        lowercase: true,
      },

      idNumber: { type: String, trim: true, maxlength: 50, default: '' },
      customerReference: { type: String, trim: true, maxlength: 30, default: '' },

      country: { type: String, trim: true, maxlength: 100, default: 'Kenya' },
      county: { type: String, trim: true },
      subCounty: { type: String, trim: true },
      ward: { type: String, trim: true },

      deliveryLocation: {
        type: String,
        trim: true,
      },

      address: {
        type: String,
        trim: true,
      },

      notes: {
        type: String,
        trim: true,
      },
    },

    /*
    |--------------------------------------------------------------------------
    | PAYMENT
    |--------------------------------------------------------------------------
    */

   paymentMethod: {
  type: String,
  enum: [
    'Cash on Delivery',
    'M-Pesa',
    'PayPal',
    'WhatsApp Order',
    'Paystack',
    'Card',
    'Wallet',
  ],
  default: 'Cash on Delivery',
},

    mpesaPhone: {
      type: String,
      trim: true,
      default: '',
    },

    mpesaCheckoutRequestId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },

    mpesaReceiptNumber: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },

    paymentReference: {
      type: String,
      trim: true,
      default: '',
    },

    paidAt: {
      type: Date,
      default: null,
    },

    cancellationDeadline: {
      type: Date,
      default: null,
    },

    cancellationRequestedAt: {
      type: Date,
      default: null,
    },

    refundReference: {
      type: String,
      trim: true,
      default: '',
    },

    paymentStatus: {
      type: String,
      enum: [
        'Pending',
        'Paid',
        'Failed',
        'Refunded',
        'Refund Pending',
        'Refund Processing',
        'Refund Failed',
      ],
      default: 'Pending',
    },

    /*
    |--------------------------------------------------------------------------
    | ORDER STATUS
    |--------------------------------------------------------------------------
    */

    status: {
      type: String,
      enum: [
        'Pending',
        'Confirmed',
        'Processing',
        'Ready for Delivery',
        'Shipped',
        'Delivered',
        'Cancelled',
      ],
      default: 'Pending',
    },

    // Customer receipt confirmation and settlement audit.
    deliveryConfirmationTokenHash: { type: String, default: '', select: false },
    deliveryConfirmationExpiresAt: { type: Date, default: null, index: true },
    deliveryConfirmedAt: { type: Date, default: null, index: true },
    deliveryConfirmationSignature: { type: String, default: '', trim: true, maxlength: 120 },
    deliveryConfirmationSignatureImage: { type: String, default: '', maxlength: 250000 },
    // Recipient identity evidence is excluded from default queries to avoid leaking it to seller-facing order views.
    deliveryConfirmationRecipientName: { type: String, default: '', trim: true, maxlength: 120 },
    deliveryConfirmationRecipientIdNumber: { type: String, default: '', trim: true, maxlength: 50 },
    deliveryConfirmationRecipientIdImage: { type: String, default: '', maxlength: 1450000, select: false },
    deliveryConfirmationIsAuthorizedRecipient: { type: Boolean, default: false },
    deliveryConfirmationCustomerAuthorizationConfirmed: { type: Boolean, default: false },
    deliveryConfirmationIp: { type: String, default: '', maxlength: 100 },
    deliveryConfirmationUserAgent: { type: String, default: '', maxlength: 500 },
    sellerSettledAt: { type: Date, default: null },
    platformCommissionRecordedAt: { type: Date, default: null },

    /*
    |--------------------------------------------------------------------------
    | NOTES
    |--------------------------------------------------------------------------
    */

    notes: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

/*
|--------------------------------------------------------------------------
| INDEXES
|--------------------------------------------------------------------------
*/

orderSchema.index({
  customer: 1,
  createdAt: -1,
});

orderSchema.index({
  status: 1,
  createdAt: -1,
});

orderSchema.index({
  paymentStatus: 1,
  createdAt: -1,
});

/*
|--------------------------------------------------------------------------
| MODEL
|----------------------------------------------------------------
----------
*/

module.exports =
  mongoose.model('Order', orderSchema);