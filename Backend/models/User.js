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
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },

    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: [150, 'Email cannot exceed 150 characters'],
      index: true,
    },

    phone: {
      type: String,
      trim: true,
      maxlength: [30, 'Phone number is too long'],
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
      index: true,
    },

    address: {
      type: String,
      default: '',
      trim: true,
      maxlength: [300, 'Address cannot exceed 300 characters'],
    },

    /* ==========================================
     * SELLER APPLICATION STATUS
     * ========================================== */

    sellerStatus: {
      type: String,
      enum: [
        'none',
        'pending',
        'approved',
        'rejected',
      ],
      default: 'none',
      index: true,
    },

    /* ==========================================
     * SELLER OPERATIONAL ACCOUNT STATUS
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
      maxlength: [
        500,
        'Warning reason cannot exceed 500 characters',
      ],
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
      maxlength: [
        500,
        'Suspension reason cannot exceed 500 characters',
      ],
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
      maxlength: [
        500,
        'Ban reason cannot exceed 500 characters',
      ],
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
     * ========================================== */

    sellerProfile: {
      /* ------------------------------------------
       * PERSONAL INFORMATION
       * ------------------------------------------ */

      officialName: {
        type: String,
        default: '',
        trim: true,
        maxlength: [
          150,
          'Official name cannot exceed 150 characters',
        ],
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
        maxlength: [
          50,
          'ID number cannot exceed 50 characters',
        ],
      },

      dateOfBirth: {
        type: Date,
        default: null,
      },

      /* ------------------------------------------
       * PRIVATE IDENTIFICATION DOCUMENTS
       *
       * These contain private Cloudinary
       * references and must never be exposed
       * through normal public APIs.
       * ------------------------------------------ */

      idFrontDocument: {
        type: String,
        default: '',
        maxlength: [
          500,
          'Document reference is too long',
        ],
      },

      idBackDocument: {
        type: String,
        default: '',
        maxlength: [
          500,
          'Document reference is too long',
        ],
      },

      /* ------------------------------------------
       * STORE INFORMATION
       * ------------------------------------------ */

      storeName: {
        type: String,
        default: '',
        trim: true,
        maxlength: [
          150,
          'Store name cannot exceed 150 characters',
        ],
      },

      storeEmail: {
        type: String,
        default: '',
        lowercase: true,
        trim: true,
        maxlength: [
          150,
          'Store email cannot exceed 150 characters',
        ],
      },

      storePhone: {
        type: String,
        default: '',
        trim: true,
        maxlength: [
          30,
          'Store phone number is too long',
        ],
      },

      mpesaPhone: {
        type: String,
        default: '',
        trim: true,
        maxlength: [
          30,
          'M-Pesa phone number is too long',
        ],
      },

      kraPin: {
        type: String,
        default: '',
        trim: true,
        maxlength: [
          30,
          'KRA PIN is too long',
        ],
      },

      /* ------------------------------------------
       * PRIVATE KRA DOCUMENT
       * ------------------------------------------ */

      kraPinDocument: {
        type: String,
        default: '',
        maxlength: [
          500,
          'KRA document reference is too long',
        ],
      },

      storeLocation: {
        type: String,
        default: '',
        trim: true,
        maxlength: [
          250,
          'Store location cannot exceed 250 characters',
        ],
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
        maxlength: [
          500,
          'Rejection reason cannot exceed 500 characters',
        ],
      },
    },

    /* ==========================================
     * SELLER / CUSTOMER WALLET
     * ==========================================
     *
     * availableBalance:
     * Money currently available for withdrawal.
     *
     * pendingBalance:
     * Money temporarily locked in pending operations,
     * such as payout requests.
     *
     * totalBalance:
     * availableBalance + pendingBalance
     *
     * IMPORTANT:
     * Wallet changes must always be performed by
     * backend-controlled routes/services.
     * Never trust balances sent by the frontend.
     * ========================================== */

    wallet: {
      currency: {
        type: String,
        default: 'KES',
        trim: true,
        maxlength: 10,
      },

      availableBalance: {
        type: Number,
        default: 0,
        min: [
          0,
          'Available balance cannot be negative',
        ],
      },

      pendingBalance: {
        type: Number,
        default: 0,
        min: [
          0,
          'Pending balance cannot be negative',
        ],
      },

      lastUpdatedAt: {
        type: Date,
        default: null,
      },

      /* ==========================================
       * WALLET TRANSACTIONS
       * ========================================== */

      transactions: [
        {
          _id: {
            type: mongoose.Schema.Types.ObjectId,
            default: () =>
              new mongoose.Types.ObjectId(),
          },

          /* ----------------------------------------
           * CREDIT / DEBIT
           * ---------------------------------------- */

          type: {
            type: String,
            enum: [
              'credit',
              'debit',
            ],
            default: 'credit',
          },

          /* ----------------------------------------
           * MONEY AMOUNT
           * ---------------------------------------- */

          amount: {
            type: Number,
            default: 0,
            min: [
              0,
              'Transaction amount cannot be negative',
            ],
          },

          /* ----------------------------------------
           * TRANSACTION CATEGORY
           * ---------------------------------------- */

          category: {
            type: String,
            default: 'manual_adjustment',
            trim: true,
            maxlength: 100,
          },

          /* ----------------------------------------
           * TRANSACTION STATUS
           * ---------------------------------------- */

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

          /* ----------------------------------------
           * DESCRIPTION
           * ---------------------------------------- */

          description: {
            type: String,
            default: '',
            trim: true,
            maxlength: [
              500,
              'Transaction description cannot exceed 500 characters',
            ],
          },

          /* ----------------------------------------
           * UNIQUE / HUMAN-READABLE REFERENCE
           * ---------------------------------------- */

          reference: {
            type: String,
            default: '',
            trim: true,
            maxlength: [
              150,
              'Transaction reference cannot exceed 150 characters',
            ],
          },

          /* ----------------------------------------
           * OPTIONAL RELATED ORDER
           * ---------------------------------------- */

          relatedOrder: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Order',
            default: null,
          },

          /* ----------------------------------------
           * FLEXIBLE INTERNAL METADATA
           * ----------------------------------------
           *
           * Examples:
           *
           * payoutMethod
           * destination
           * sellerId
           * requestedAt
           * adminReviewedBy
           * adminDecision
           * rejectionReason
           *
           * Do not expose sensitive metadata through
           * public/customer endpoints.
           * ---------------------------------------- */

          metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
          },

          /* ----------------------------------------
           * TRANSACTION CREATION TIME
           * ---------------------------------------- */

          createdAt: {
            type: Date,
            default: Date.now,
          },

          /* ----------------------------------------
           * TRANSACTION PROCESSING TIME
           * ----------------------------------------
           *
           * Used when:
           * - payout is approved
           * - payout is rejected
           * - another pending transaction is processed
           * ---------------------------------------- */

          processedAt: {
            type: Date,
            default: null,
          },

          /* ----------------------------------------
           * LAST TRANSACTION UPDATE
           * ---------------------------------------- */

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
      enum: [
        'email',
        'sms',
      ],
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

userSchema.pre(
  'save',
  async function () {
    if (!this.isModified('password')) {
      return;
    }

    const salt =
      await bcrypt.genSalt(10);

    this.password =
      await bcrypt.hash(
        this.password,
        salt
      );
  }
);

/* ==========================================
 * PASSWORD VERIFICATION
 * ========================================== */

userSchema.methods.matchPassword =
  async function (enteredPassword) {
    return bcrypt.compare(
      enteredPassword,
      this.password
    );
  };

/* ==========================================
 * ACCOUNT LOCK CHECK
 * ========================================== */

userSchema.methods.isLocked =
  function () {
    return (
      !!this.lockUntil &&
      this.lockUntil > Date.now()
    );
  };

/* ==========================================
 * SELLER OPERATIONAL CHECK
 * ==========================================
 *
 * A seller is operational when:
 *
 * 1. role === seller
 * 2. sellerStatus === approved
 * 3. accountStatus === active/warning
 * 4. storeStatus === active
 *
 * Warning does NOT prevent seller operations.
 *
 * Suspended and banned sellers return false.
 * ========================================== */

userSchema.methods.isActiveSeller =
  function () {
    return (
      this.role === 'seller' &&
      this.sellerStatus ===
        'approved' &&
      [
        'active',
        'warning',
      ].includes(
        this.accountStatus
      ) &&
      this.storeStatus ===
        'active'
    );
  };

/* ==========================================
 * SELLER ACCOUNT RESTRICTION CHECK
 * ========================================== */

userSchema.methods.isSellerRestricted =
  function () {
    return (
      this.accountStatus ===
        'suspended' ||
      this.accountStatus ===
        'banned'
    );
  };

/* ==========================================
 * SELLER WARNING CHECK
 * ========================================== */

userSchema.methods.isSellerWarned =
  function () {
    return (
      this.accountStatus ===
      'warning'
    );
  };

/* ==========================================
 * SELLER APPLICATION CHECKS
 * ========================================== */

userSchema.methods.hasPendingSellerApplication =
  function () {
    return (
      this.sellerStatus ===
      'pending'
    );
  };

userSchema.methods.isApprovedSeller =
  function () {
    return (
      this.role === 'seller' &&
      this.sellerStatus ===
        'approved'
    );
  };

userSchema.methods.canResubmitSellerApplication =
  function () {
    return (
      this.sellerStatus ===
      'rejected'
    );
  };

/* ==========================================
 * WALLET HELPERS
 * ========================================== */

userSchema.methods.getAvailableWalletBalance =
  function () {
    return Number(
      (
        this.wallet
          ?.availableBalance ||
        0
      ).toFixed(2)
    );
  };

userSchema.methods.getPendingWalletBalance =
  function () {
    return Number(
      (
        this.wallet
          ?.pendingBalance ||
        0
      ).toFixed(2)
    );
  };

userSchema.methods.getTotalWalletBalance =
  function () {
    return Number(
      (
        this.getAvailableWalletBalance() +
        this.getPendingWalletBalance()
      ).toFixed(2)
    );
  };

/* ==========================================
 * WALLET INTEGRITY CHECK
 * ==========================================
 *
 * Returns false if wallet balances are invalid.
 *
 * This does NOT calculate the balance from
 * transactions. It only checks that the stored
 * balances themselves are valid.
 * ========================================== */

userSchema.methods.hasValidWallet =
  function () {
    const available =
      Number(
        this.wallet
          ?.availableBalance
      );

    const pending =
      Number(
        this.wallet
          ?.pendingBalance
      );

    return (
      Number.isFinite(
        available
      ) &&
      Number.isFinite(
        pending
      ) &&
      available >= 0 &&
      pending >= 0
    );
  };

/* ==========================================
 * MODEL EXPORT
 * ========================================== */

module.exports = mongoose.model(
  'User',
  userSchema
);