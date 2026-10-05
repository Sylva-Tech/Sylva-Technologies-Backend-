const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    /* ==========================================
     * BASIC USER INFORMATION
     * ========================================== */

    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },

    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    phone: {
      type: String,
      trim: true,
      index: true,
    },

    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
    },

    role: {
      type: String,
      enum: ['customer', 'admin', 'seller'],
      default: 'customer',
    },

    address: {
      type: String,
      default: '',
      trim: true,
    },

    /* ==========================================
     * SELLER APPLICATION STATUS
     * ==========================================
     *
     * This controls the seller application itself.
     *
     * none     = normal customer / no application
     * pending  = application submitted and awaiting review
     * approved = application approved
     * rejected = application rejected and may be resubmitted
     *
     * IMPORTANT:
     * sellerStatus is intentionally separate from
     * accountStatus and storeStatus.
     * ========================================== */

    sellerStatus: {
      type: String,
      enum: ['none', 'pending', 'approved', 'rejected'],
      default: 'none',
      index: true,
    },

    /* ==========================================
     * SELLER OPERATIONAL ACCOUNT STATUS
     * ==========================================
     *
     * This controls whether an approved seller
     * is allowed to operate.
     *
     * active    = seller account operating normally
     * warning   = seller receives a warning but
     *             can continue operating
     * suspended = temporarily restricted
     * banned    = permanently/indefinitely restricted
     *
     * This does NOT replace sellerStatus.
     * ========================================== */

    accountStatus: {
      type: String,
      enum: [
        'active',
        'warning',
        'suspended',
        'banned',
      ],
      default: 'active',
      index: true,
    },

    /* ==========================================
     * WARNING INFORMATION
     * ========================================== */

    warningReason: {
      type: String,
      default: '',
      trim: true,
    },

    warnedAt: {
      type: Date,
      default: null,
    },

    warnedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    /* ==========================================
     * SELLER STORE STATUS
     * ==========================================
     *
     * active   = seller storefront is operational
     * inactive = storefront is not operational
     *
     * A seller should normally only have an active
     * store when:
     *
     * sellerStatus === 'approved'
     *
     * and accountStatus is active or warning.
     * ========================================== */

    storeStatus: {
      type: String,
      enum: ['inactive', 'active'],
      default: 'inactive',
      index: true,
    },

    /* ==========================================
     * SUSPENSION INFORMATION
     * ========================================== */

    suspensionReason: {
      type: String,
      default: '',
      trim: true,
    },

    suspendedAt: {
      type: Date,
      default: null,
    },

    suspendedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    /* ==========================================
     * BAN INFORMATION
     * ========================================== */

    banReason: {
      type: String,
      default: '',
      trim: true,
    },

    bannedAt: {
      type: Date,
      default: null,
    },

    bannedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    /* ==========================================
     * SELLER PRODUCT ACTIVITY
     * ========================================== */

    lastProductAddedAt: {
      type: Date,
      default: null,
    },

    /* ==========================================
     * SELLER PROFILE
     * ==========================================
     *
     * Sensitive seller information and private
     * verification documents are stored here.
     *
     * These fields must NOT be returned by normal
     * public APIs.
     * ========================================== */

    sellerProfile: {
      /* ------------------------------------------
       * PERSONAL INFORMATION
       * ------------------------------------------ */

      officialName: {
        type: String,
        default: '',
        trim: true,
      },

      idType: {
        type: String,
        enum: [
          'national_id',
          'passport',
          'military_id',
          'other',
          '',
        ],
        default: '',
      },

      idNumber: {
        type: String,
        default: '',
        trim: true,
      },

      dateOfBirth: {
        type: Date,
        default: null,
      },

      /* ------------------------------------------
       * PRIVATE IDENTIFICATION DOCUMENTS
       *
       * These should contain private Cloudinary
       * references only.
       * ------------------------------------------ */

      idFrontDocument: {
        type: String,
        default: '',
      },

      idBackDocument: {
        type: String,
        default: '',
      },

      /* ------------------------------------------
       * STORE INFORMATION
       * ------------------------------------------ */

      storeName: {
        type: String,
        default: '',
        trim: true,
      },

      storeEmail: {
        type: String,
        default: '',
        lowercase: true,
        trim: true,
      },

      storePhone: {
        type: String,
        default: '',
        trim: true,
      },

      mpesaPhone: {
        type: String,
        default: '',
        trim: true,
      },

      kraPin: {
        type: String,
        default: '',
        trim: true,
      },

      /* ------------------------------------------
       * PRIVATE KRA DOCUMENT
       * ------------------------------------------ */

      kraPinDocument: {
        type: String,
        default: '',
      },

      storeLocation: {
        type: String,
        default: '',
        trim: true,
      },

      /* ------------------------------------------
       * SELLER APPLICATION INFORMATION
       * ------------------------------------------ */

      applicationDate: {
        type: Date,
        default: null,
      },

      reviewedAt: {
        type: Date,
        default: null,
      },

      rejectionReason: {
        type: String,
        default: '',
        trim: true,
      },
    },

    /* ==========================================
     * SELLER / CUSTOMER WALLET
     * ==========================================
     *
     * This model stores wallet balances and transaction
     * history server-side. Payout and settlement actions are
     * validated on the backend before any balance changes are
     * applied.
     * ========================================== */

    wallet: {
      currency: {
        type: String,
        default: 'KES',
        trim: true,
      },

      availableBalance: {
        type: Number,
        default: 0,
        min: 0,
      },

      pendingBalance: {
        type: Number,
        default: 0,
        min: 0,
      },

      lastUpdatedAt: {
        type: Date,
        default: null,
      },

      transactions: [
        {
          _id: {
            type: mongoose.Schema.Types.ObjectId,
            default: () => new mongoose.Types.ObjectId(),
          },

          type: {
            type: String,
            enum: ['credit', 'debit'],
            default: 'credit',
          },

          amount: {
            type: Number,
            default: 0,
            min: 0,
          },

          category: {
            type: String,
            default: 'manual_adjustment',
            trim: true,
          },

          status: {
            type: String,
            enum: [
              'pending',
              'completed',
              'paid',
              'rejected',
              'failed',
              'reversed',
            ],
            default: 'completed',
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
          },

          metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
          },

          createdAt: {
            type: Date,
            default: Date.now,
          },

          updatedAt: {
            type: Date,
            default: Date.now,
          },
        },
      ],
    },

    /* ==========================================
     * SELLER / CUSTOMER AGREEMENTS
     * ========================================== */

    consent: {
      privacyPolicy: {
        type: Boolean,
        default: false,
      },

      termsAndConditions: {
        type: Boolean,
        default: false,
      },

      sellerPolicy: {
        type: Boolean,
        default: false,
      },

      marketplacePolicy: {
        type: Boolean,
        default: false,
      },

      productListingPolicy: {
        type: Boolean,
        default: false,
      },

      returnsPolicy: {
        type: Boolean,
        default: false,
      },

      informationAccuracy: {
        type: Boolean,
        default: false,
      },

      acceptedAt: {
        type: Date,
        default: null,
      },
    },

    /* ==========================================
     * EMAIL / ACCOUNT VERIFICATION
     * ========================================== */

    isVerified: {
      type: Boolean,
      default: false,
    },

    verificationMethod: {
      type: String,
      enum: ['email', 'sms'],
      default: 'email',
    },

    lastOtpRequestedAt: {
      type: Date,
      default: null,
    },

    otpCooldownUntil: {
      type: Date,
      default: null,
    },

    /* ==========================================
     * LOGIN SECURITY
     * ========================================== */

    loginAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },

    lockUntil: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

/* ==========================================
 * PASSWORD HASHING
 * ========================================== */

userSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);

  this.password = await bcrypt.hash(
    this.password,
    salt
  );
});

/* ==========================================
 * PASSWORD VERIFICATION
 * ========================================== */

userSchema.methods.matchPassword = async function (
  enteredPassword
) {
  return bcrypt.compare(
    enteredPassword,
    this.password
  );
};

/* ==========================================
 * ACCOUNT LOCK CHECK
 * ========================================== */

userSchema.methods.isLocked = function () {
  return (
    !!this.lockUntil &&
    this.lockUntil > Date.now()
  );
};

/* ==========================================
 * SELLER OPERATIONAL CHECK
 * ==========================================
 *
 * Returns true when the seller:
 *
 * 1. Has an approved seller application
 * 2. Has an active account OR warning status
 * 3. Has an active store
 *
 * A warning does NOT prevent normal seller
 * operations.
 *
 * Suspended and banned sellers return false.
 * ========================================== */

userSchema.methods.isActiveSeller = function () {
  return (
    this.role === 'seller' &&
    this.sellerStatus === 'approved' &&
    ['active', 'warning'].includes(
      this.accountStatus
    ) &&
    this.storeStatus === 'active'
  );
};

/* ==========================================
 * SELLER ACCOUNT RESTRICTION CHECK
 * ========================================== */

userSchema.methods.isSellerRestricted = function () {
  return (
    this.accountStatus === 'suspended' ||
    this.accountStatus === 'banned'
  );
};

/* ==========================================
 * SELLER WARNING CHECK
 * ========================================== */

userSchema.methods.isSellerWarned = function () {
  return this.accountStatus === 'warning';
};

/* ==========================================
 * MODEL EXPORT
 * ========================================== */

module.exports = mongoose.model(
  'User',
  userSchema
);