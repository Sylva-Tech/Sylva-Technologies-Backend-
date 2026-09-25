const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
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
    },

    /*
     * ==========================================
     * SELLER ACCOUNT / APPLICATION INFORMATION
     * ==========================================
     *
     * Verification documents are stored as
     * private Cloudinary references.
     *
     * They must NEVER be exposed through public
     * product APIs.
     */
    sellerStatus: {
      type: String,
      enum: ['none', 'pending', 'approved', 'rejected'],
      default: 'none',
      index: true,
    },

    sellerProfile: {
      /*
       * ==============================
       * PERSONAL INFORMATION
       * ==============================
       */

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

      /*
       * Private identification documents.
       */
      idFrontDocument: {
        type: String,
        default: '',
      },

      idBackDocument: {
        type: String,
        default: '',
      },

      /*
       * ==============================
       * STORE INFORMATION
       * ==============================
       */

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

      /*
       * Private KRA PIN document.
       */
      kraPinDocument: {
        type: String,
        default: '',
      },

      storeLocation: {
        type: String,
        default: '',
        trim: true,
      },

      /*
       * ==============================
       * SELLER APPLICATION
       * ==============================
       */

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

    /*
     * ==========================================
     * SELLER / CUSTOMER AGREEMENTS
     * ==========================================
     */
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

    /*
     * ==========================================
     * EMAIL / ACCOUNT VERIFICATION
     * ==========================================
     */

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

    /*
     * ==========================================
     * LOGIN SECURITY
     * ==========================================
     */

    loginAttempts: {
      type: Number,
      default: 0,
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

/*
 * ==========================================
 * PASSWORD HASHING
 * ==========================================
 */
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

/*
 * ==========================================
 * PASSWORD VERIFICATION
 * ==========================================
 */
userSchema.methods.matchPassword = async function (
  enteredPassword
) {
  return bcrypt.compare(
    enteredPassword,
    this.password
  );
};

/*
 * ==========================================
 * ACCOUNT LOCK CHECK
 * ==========================================
 */
userSchema.methods.isLocked = function () {
  return (
    !!this.lockUntil &&
    this.lockUntil > Date.now()
  );
};

module.exports = mongoose.model(
  'User',
  userSchema
);