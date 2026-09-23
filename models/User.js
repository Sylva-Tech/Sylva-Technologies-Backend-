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
     * Seller account/application information.
     * Seller documents are stored as private references and
     * must never be exposed through public product APIs.
     */
    sellerStatus: {
      type: String,
      enum: ['none', 'pending', 'approved', 'rejected'],
      default: 'none',
      index: true,
    },

    sellerProfile: {
      officialName: {
        type: String,
        default: '',
        trim: true,
      },

      mpesaPhone: {
        type: String,
        default: '',
        trim: true,
      },

      idFrontDocument: {
        type: String,
        default: '',
      },

      idBackDocument: {
        type: String,
        default: '',
      },

      kraPinDocument: {
        type: String,
        default: '',
      },

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

    consent: {
      privacyPolicy: {
        type: Boolean,
        default: false,
      },

      termsAndConditions: {
        type: Boolean,
        default: false,
      },

      acceptedAt: {
        type: Date,
        default: null,
      },
    },

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


userSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.isLocked = function () {
  return !!this.lockUntil && this.lockUntil > Date.now();
};

module.exports = mongoose.model('User', userSchema);
