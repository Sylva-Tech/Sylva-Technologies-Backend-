const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const User = require('../models/User');
const VerificationToken = require('../models/VerificationToken');

const { protect } = require('../middleware/authMiddleware');
const generateToken = require('../utils/generateToken');

const sellerUpload = require('../middleware/sellerUpload');
const uploadBufferToCloudinary = require('../utils/uploadToCloudinary');
const cloudinary = require('../config/cloudinary');

const {
  sendVerificationLinkEmail,
  sendPasswordResetCodeAndLinkEmail,
} = require('../services/emailService');

const router = express.Router();

const OTP_EXPIRY_MINUTES = Number(
  process.env.OTP_EXPIRY_MINUTES || 10
);

const RESEND_COOLDOWN_MINUTES = Number(
  process.env.RESEND_COOLDOWN_MINUTES || 1
);

const MAX_OTP_ATTEMPTS = Number(
  process.env.MAX_OTP_ATTEMPTS || 5
);

const MAX_OTP_REQUESTS = Number(
  process.env.MAX_OTP_REQUESTS || 3
);

// ============================================================================
// NORMALIZATION HELPERS
// ============================================================================

const normalizeEmail = (value) =>
  (value || '').toString().trim().toLowerCase();

const normalizePhone = (value) =>
  (value || '').toString().trim();

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const KENYAN_PHONE_REGEX = /^\+2547\d{8}$/;

const isValidEmail = (value) =>
  EMAIL_REGEX.test(normalizeEmail(value));

const isValidKenyanPhone = (value) =>
  KENYAN_PHONE_REGEX.test(normalizePhone(value));

// ============================================================================
// USER SANITIZATION
// ============================================================================

const sanitizeUser = (user) => {
  const sellerProfile = user.sellerProfile || {};

  return {
    _id: user._id,
    name: user.name || '',
    email: user.email || '',
    phone: user.phone || '',
    role: user.role || 'customer',

    isVerified: !!user.isVerified,

    verificationMethod:
      user.verificationMethod || 'email',

    address: user.address || '',

    sellerStatus:
      user.sellerStatus || 'none',

    accountStatus:
      user.accountStatus || 'active',

    storeStatus:
      user.storeStatus ||
      (user.sellerStatus === 'approved'
        ? 'active'
        : 'inactive'),

    warningReason:
      user.warningReason || '',

    warnedAt:
      user.warnedAt || null,

    warnedBy:
      user.warnedBy || null,

    suspensionReason:
      user.suspensionReason || '',

    suspendedAt:
      user.suspendedAt || null,

    suspendedBy:
      user.suspendedBy || null,

    banReason:
      user.banReason || '',

    bannedAt:
      user.bannedAt || null,

    bannedBy:
      user.bannedBy || null,

    storeName:
      sellerProfile.storeName || '',

    sellerProfile: {
      officialName:
        sellerProfile.officialName || '',

      storeName:
        sellerProfile.storeName || '',

      storeEmail:
        sellerProfile.storeEmail || '',

      storePhone:
        sellerProfile.storePhone || '',

      mpesaPhone:
        sellerProfile.mpesaPhone || '',

      storeLocation:
        sellerProfile.storeLocation || '',

      applicationDate:
        sellerProfile.applicationDate || null,

      reviewedAt:
        sellerProfile.reviewedAt || null,

      rejectionReason:
        sellerProfile.rejectionReason || '',
    },

    consent: user.consent
      ? {
          privacyPolicy:
            !!user.consent.privacyPolicy,

          termsAndConditions:
            !!user.consent.termsAndConditions,

          acceptedAt:
            user.consent.acceptedAt || null,
        }
      : null,

    createdAt:
      user.createdAt || null,
  };
};

// ============================================================================
// FIND USER
// ============================================================================

const getUserByEmailOrPhone = async (value) => {
  const normalized = (value || '')
    .toString()
    .trim();

  if (!normalized) {
    return null;
  }

  const query = EMAIL_REGEX.test(normalized)
    ? {
        email: normalizeEmail(normalized),
      }
    : {
        phone: normalizePhone(normalized),
      };

  return User.findOne(query);
};

// ============================================================================
// SECURE TOKEN HELPERS
// ============================================================================

const hashToken = (token) =>
  crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

const createSecureTokenRecord = async ({
  user,
  purpose,
  expiresMinutes = 60 * 24,
  method = 'email',
}) => {
  await VerificationToken.deleteMany({
    user: user._id,
    purpose,
    usedAt: null,
  });

  const token = crypto
    .randomBytes(32)
    .toString('hex');

  const tokenHash = hashToken(token);

  const expiresAt = new Date(
    Date.now() +
      expiresMinutes * 60 * 1000
  );

  await VerificationToken.create({
    user: user._id,
    purpose,
    tokenHash,
    expiresAt,
    method,
  });

  return token;
};

// ============================================================================
// FRONTEND URL
// ============================================================================

const getFrontendUrl = () => {
  return (
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    'https://sylvatechnologies.co.ke'
  );
};

// ============================================================================
// SELLER REGISTRATION
// ============================================================================

router.post(
  '/seller/register',

  (req, res, next) => {
    sellerUpload.fields([
      {
        name: 'idFront',
        maxCount: 1,
      },
      {
        name: 'idBack',
        maxCount: 1,
      },
      {
        name: 'kraPin',
        maxCount: 1,
      },
    ])(req, res, (error) => {
      if (error) {
        return res.status(400).json({
          success: false,
          message:
            error.message ||
            'Unable to upload seller documents.',
        });
      }

      next();
    });
  },

  async (req, res) => {
    const uploadedFiles = [];

    try {
      const {
        officialName,
        email,
        mpesaPhone,
        storeName,
        password,
        confirmPassword,
        privacyPolicyAccepted,
        termsAndConditionsAccepted,
      } = req.body;

      const files = req.files || {};

      const idFrontFile =
        files.idFront?.[0];

      const idBackFile =
        files.idBack?.[0];

      const kraPinFile =
        files.kraPin?.[0];

      if (
        !officialName ||
        !email ||
        !mpesaPhone ||
        !storeName ||
        !password
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Official/business name, email, phone number, store name and password are required.',
        });
      }

      const trimmedOfficialName =
        officialName.toString().trim();

      if (
        trimmedOfficialName.length < 2
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Please enter a valid official or business name.',
        });
      }

      const trimmedStoreName =
        storeName.toString().trim();

      if (
        !trimmedStoreName ||
        trimmedStoreName.length < 2 ||
        trimmedStoreName.length > 100
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Store name is required and must be between 2 and 100 characters.',
        });
      }

      if (!isValidEmail(email)) {
        return res.status(400).json({
          success: false,
          message:
            'Please enter a valid email address.',
        });
      }

      const normalizedSellerPhone =
        normalizePhone(mpesaPhone);

      if (
        !isValidKenyanPhone(
          normalizedSellerPhone
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Enter a valid Kenyan phone number in the format +2547XXXXXXXX.',
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message:
            'Password must be at least 6 characters.',
        });
      }

      if (confirmPassword !== password) {
        return res.status(400).json({
          success: false,
          message:
            'Passwords do not match.',
        });
      }

      if (
        privacyPolicyAccepted !== 'true' ||
        termsAndConditionsAccepted !== 'true'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'You must agree to the Privacy Policy and Terms & Conditions before registering as a seller.',
        });
      }

      if (
        !idFrontFile ||
        !idBackFile ||
        !kraPinFile
      ) {
        return res.status(400).json({
          success: false,
          message:
            'ID front, ID back and KRA PIN documents are all required.',
        });
      }

      const normalizedEmail =
        normalizeEmail(email);

      const existingEmail =
        await User.findOne({
          email: normalizedEmail,
        });

      if (existingEmail) {
        return res.status(409).json({
          success: false,
          message:
            'An account with this email already exists. Please log in to your existing account.',
        });
      }

      const existingPhone =
        await User.findOne({
          phone: normalizedSellerPhone,
        });

      if (existingPhone) {
        return res.status(409).json({
          success: false,
          message:
            'An account with this phone number already exists. Please log in to your existing account.',
        });
      }

      const idFrontUpload =
        await uploadBufferToCloudinary(
          idFrontFile.buffer
        );

      uploadedFiles.push(idFrontUpload);

      const idBackUpload =
        await uploadBufferToCloudinary(
          idBackFile.buffer
        );

      uploadedFiles.push(idBackUpload);

      const kraPinUpload =
        await uploadBufferToCloudinary(
          kraPinFile.buffer
        );

      uploadedFiles.push(kraPinUpload);

      const user = await User.create({
        name: trimmedOfficialName,
        email: normalizedEmail,
        phone: normalizedSellerPhone,
        password,

        role: 'seller',

        sellerStatus: 'pending',
        accountStatus: 'active',
        storeStatus: 'inactive',

        sellerProfile: {
          officialName:
            trimmedOfficialName,

          storeName:
            trimmedStoreName,

          storeEmail:
            normalizedEmail,

          storePhone:
            normalizedSellerPhone,

          mpesaPhone:
            normalizedSellerPhone,

          idFrontDocument:
            idFrontUpload.public_id,

          idBackDocument:
            idBackUpload.public_id,

          kraPinDocument:
            kraPinUpload.public_id,

          applicationDate:
            new Date(),

          reviewedAt: null,

          rejectionReason: '',
        },

        consent: {
          privacyPolicy: true,
          termsAndConditions: true,
          acceptedAt: new Date(),
        },

        isVerified: false,
        verificationMethod: 'email',
      });

      const verificationToken =
        await createSecureTokenRecord({
          user,
          purpose: 'verification',
          expiresMinutes: 60 * 24,
        });

      const verifyLink =
        `${getFrontendUrl()}/verify-email?token=${verificationToken}`;

      await sendVerificationLinkEmail({
        to: user.email,
        name: user.name,
        verifyLink,
        expiresInMinutes: 60 * 24,
      });

      const token =
        generateToken(user._id);

      return res.status(201).json({
        success: true,
        message:
          'Seller registration submitted successfully. Please verify your email. Your seller account is awaiting admin approval.',

        data: {
          user: sanitizeUser(user),
          verificationPending: true,
          sellerStatus: 'pending',
          token,
        },
      });
    } catch (error) {
      console.error(
        'Seller registration error:',
        error
      );

      for (const uploadedFile of uploadedFiles) {
        try {
          await cloudinary.uploader.destroy(
            uploadedFile.public_id,
            {
              type: 'authenticated',
              resource_type:
                uploadedFile.resource_type ||
                'image',
            }
          );
        } catch (cleanupError) {
          console.error(
            'Cloudinary cleanup error:',
            cleanupError.message
          );
        }
      }

      return res.status(500).json({
        success: false,
        message:
          'Seller registration failed. Please try again.',
      });
    }
  }
);

// ============================================================================
// NORMAL CUSTOMER REGISTRATION
// ============================================================================

router.post(
  '/register',

  async (req, res) => {
    try {
      const {
        name,
        email,
        phone,
        password,
        confirmPassword,
        consentAccepted,
        verificationMethod = 'email',
      } = req.body;

      if (!name || !email || !password) {
        return res.status(400).json({
          success: false,
          message:
            'Name, email and password are required.',
        });
      }

      const trimmedName =
        name.toString().trim();

      if (trimmedName.length < 2) {
        return res.status(400).json({
          success: false,
          message:
            'Please enter your full name.',
        });
      }

      if (!isValidEmail(email)) {
        return res.status(400).json({
          success: false,
          message:
            'Please enter a valid email address.',
        });
      }

      if (
        !phone ||
        !isValidKenyanPhone(
          normalizePhone(phone)
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Enter a valid Kenyan phone number in the format +2547XXXXXXXX.',
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message:
            'Password must be at least 6 characters.',
        });
      }

      if (!confirmPassword) {
        return res.status(400).json({
          success: false,
          message:
            'Please confirm your new password.',
        });
      }

      if (password !== confirmPassword) {
        return res.status(400).json({
          success: false,
          message:
            'Passwords do not match.',
        });
      }

      if (consentAccepted !== true) {
        return res.status(400).json({
          success: false,
          message:
            'You must agree to the Privacy Policy and Terms & Conditions before creating an account.',
        });
      }

      if (
        !['email', 'sms'].includes(
          verificationMethod
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Please select a valid verification method.',
        });
      }

      const normalizedEmail =
        normalizeEmail(email);

      const normalizedPhone =
        normalizePhone(phone);

      const existingEmail =
        await User.findOne({
          email: normalizedEmail,
        });

      if (existingEmail) {
        return res.status(409).json({
          success: false,
          message:
            'Email already registered.',
        });
      }

      const existingPhone =
        await User.findOne({
          phone: normalizedPhone,
        });

      if (existingPhone) {
        return res.status(409).json({
          success: false,
          message:
            'Phone number already registered.',
        });
      }

      const user = await User.create({
        name: trimmedName,
        email: normalizedEmail,
        phone: normalizedPhone,
        password,

        role: 'customer',

        sellerStatus: 'none',
        accountStatus: 'active',
        storeStatus: 'inactive',

        verificationMethod,

        consent: {
          privacyPolicy: true,
          termsAndConditions: true,
          acceptedAt: new Date(),
        },

        isVerified: false,
      });

      const verificationToken =
        await createSecureTokenRecord({
          user,
          purpose: 'verification',
          expiresMinutes: 60 * 24,
        });

      const verifyLink =
        `${getFrontendUrl()}/verify-email?token=${verificationToken}`;

      await sendVerificationLinkEmail({
        to: user.email,
        name: user.name,
        verifyLink,
        expiresInMinutes: 60 * 24,
      });

      const token =
        generateToken(user._id);

      return res.status(201).json({
        success: true,
        message:
          'Registration successful. Verification email sent.',

        data: {
          user: sanitizeUser(user),
          verificationPending: true,
          token,
        },
      });
    } catch (error) {
      console.error(
        'Registration error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Registration failed. Please try again.',
      });
    }
  }
);

// ============================================================================
// VERIFY ACCOUNT
// ============================================================================

router.post(
  '/verify',

  async (req, res) => {
    try {
      const {
        email,
        phone,
        otp,
        token: bodyToken,
      } = req.body;

      const identifier =
        email || phone;

      const tokenValue =
        bodyToken ||
        otp ||
        req.query.token;

      if (!identifier && !tokenValue) {
        return res.status(400).json({
          success: false,
          message:
            'Email/phone or verification token is required.',
        });
      }

      let user = null;

      if (identifier) {
        user =
          await getUserByEmailOrPhone(
            identifier
          );
      }

      let record = null;

      if (tokenValue) {
        const tokenHash =
          hashToken(tokenValue);

        record =
          await VerificationToken.findOne({
            purpose: 'verification',
            tokenHash,
            usedAt: null,
            expiresAt: {
              $gt: new Date(),
            },
          });

        if (record && !user) {
          user =
            await User.findById(
              record.user
            );
        }
      }

      if (!user) {
        return res.status(404).json({
          success: false,
          message:
            'User account not found.',
        });
      }

      if (user.isVerified) {
        return res.status(200).json({
          success: true,
          message:
            'Account already verified.',
          data: {
            user: sanitizeUser(user),
          },
        });
      }

      if (!tokenValue) {
        return res.status(400).json({
          success: false,
          message:
            'Verification token or code is required.',
        });
      }

      if (!record) {
        const tokenHash =
          hashToken(tokenValue);

        record =
          await VerificationToken.findOne({
            user: user._id,
            purpose: 'verification',
            tokenHash,
            usedAt: null,
            expiresAt: {
              $gt: new Date(),
            },
          });
      }

      if (!record) {
        return res.status(400).json({
          success: false,
          message:
            'Verification token expired or invalid.',
        });
      }

      user.isVerified = true;

      user.verificationMethod =
        user.verificationMethod ||
        'email';

      user.otpCooldownUntil = null;

      await user.save();

      record.usedAt = new Date();

      await record.save();

      await VerificationToken.deleteMany({
        user: user._id,
        purpose: 'verification',
        usedAt: {
          $ne: null,
        },
      });

      return res.status(200).json({
        success: true,
        message:
          'Verification successful. Your account is now verified.',
        data: {
          user: sanitizeUser(user),
        },
      });
    } catch (error) {
      console.error(
        'Verification error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to verify account right now.',
      });
    }
  }
);

// ============================================================================
// VERIFY EMAIL
// ============================================================================

router.post(
  '/verify-email',
  (req, res) => {
    return res.redirect(
      307,
      '/verify'
    );
  }
);

// ============================================================================
// RESEND VERIFICATION
// ============================================================================

router.post(
  '/resend-verification',

  async (req, res) => {
    try {
      const {
        email,
        phone,
      } = req.body;

      const identifier =
        email || phone;

      if (!identifier) {
        return res.status(400).json({
          success: false,
          message:
            'Email or phone is required.',
        });
      }

      const user =
        await getUserByEmailOrPhone(
          identifier
        );

      if (!user) {
        return res.status(404).json({
          success: false,
          message:
            'User account not found.',
        });
      }

      if (user.isVerified) {
        return res.status(200).json({
          success: true,
          message:
            'Your account is already verified.',
        });
      }

      const cooldown =
        user.otpCooldownUntil
          ? new Date(
              user.otpCooldownUntil
            )
          : null;

      if (
        cooldown &&
        cooldown > new Date()
      ) {
        const remainingSeconds =
          Math.ceil(
            (cooldown - new Date()) /
              1000
          );

        return res.status(429).json({
          success: false,
          message:
            `Please wait ${remainingSeconds} seconds before requesting a new code.`,
        });
      }

      const activeRequestCount =
        await VerificationToken.countDocuments(
          {
            user: user._id,
            purpose: 'verification',
            createdAt: {
              $gte: new Date(
                Date.now() -
                  24 *
                    60 *
                    60 *
                    1000
              ),
            },
          }
        );

      if (
        activeRequestCount >=
        MAX_OTP_REQUESTS
      ) {
        return res.status(429).json({
          success: false,
          message:
            'Too many verification requests. Please try again later.',
        });
      }

      user.otpCooldownUntil =
        new Date(
          Date.now() +
            RESEND_COOLDOWN_MINUTES *
              60 *
              1000
        );

      await user.save();

      const verificationToken =
        await createSecureTokenRecord({
          user,
          purpose: 'verification',
          expiresMinutes: 60 * 24,
        });

      const verifyLink =
        `${getFrontendUrl()}/verify-email?token=${verificationToken}`;

      await sendVerificationLinkEmail({
        to: user.email,
        name: user.name,
        verifyLink,
        expiresInMinutes: 60 * 24,
      });

      return res.status(200).json({
        success: true,
        message:
          'Verification email resent successfully. Please check your inbox.',
      });
    } catch (error) {
      console.error(
        'Resend verification error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to resend verification code.',
      });
    }
  }
);

// ============================================================================
// LOGIN
// ============================================================================

router.post(
  '/login',

  async (req, res) => {
    try {
      const {
        email,
        phone,
        password,
      } = req.body;

      const identifier =
        email || phone;

      if (!identifier || !password) {
        return res.status(400).json({
          success: false,
          message:
            'Email/phone and password are required.',
        });
      }

      const user =
        await getUserByEmailOrPhone(
          identifier
        );

      if (!user) {
        return res.status(401).json({
          success: false,
          message:
            'Invalid credentials.',
        });
      }

      let accountLocked = false;

      if (
        typeof user.isLocked ===
        'function'
      ) {
        accountLocked =
          user.isLocked();
      } else if (user.lockUntil) {
        accountLocked =
          new Date(
            user.lockUntil
          ) > new Date();
      }

      if (accountLocked) {
        return res.status(423).json({
          success: false,
          message:
            'Your account is temporarily locked. Please try again later.',
        });
      }

      const isMatch =
        await bcrypt.compare(
          password,
          user.password
        );

      if (!isMatch) {
        user.loginAttempts =
          (user.loginAttempts || 0) +
          1;

        if (
          user.loginAttempts >= 5
        ) {
          user.lockUntil =
            new Date(
              Date.now() +
                15 *
                  60 *
                  1000
            );

          user.loginAttempts = 0;

          await user.save();

          return res.status(423).json({
            success: false,
            message:
              'Too many failed login attempts. Your account is temporarily locked for 15 minutes.',
          });
        }

        await user.save();

        return res.status(401).json({
          success: false,
          message:
            'Invalid credentials.',
        });
      }

      user.loginAttempts = 0;
      user.lockUntil = null;

      await user.save();

      const token =
        generateToken(user._id);

      const responsePayload = {
        success: true,

        message:
          'Login successful.',

        data: {
          user: sanitizeUser(user),
          token,

          emailVerified:
            !!user.isVerified,

          verificationPending:
            !user.isVerified,
        },
      };

      if (!user.isVerified) {
        responsePayload.message =
          'Login successful. Email verification is pending.';

        try {
          const existing =
            await VerificationToken.findOne({
              user: user._id,
              purpose: 'verification',
              usedAt: null,
              expiresAt: {
                $gt: new Date(),
              },
            }).sort({
              expiresAt: -1,
            });

          if (!existing) {
            const verificationToken =
              await createSecureTokenRecord({
                user,
                purpose: 'verification',
                expiresMinutes:
                  60 * 24,
              });

            const verifyLink =
              `${getFrontendUrl()}/verify-email?token=${verificationToken}`;

            try {
              await sendVerificationLinkEmail({
                to: user.email,
                name: user.name,
                verifyLink,
                expiresInMinutes:
                  60 * 24,
              });
            } catch (emailError) {
              console.error(
                'Login verification email error:',
                emailError
              );
            }
          }
        } catch (verificationError) {
          console.error(
            'Login verification reminder error:',
            verificationError
          );
        }
      }

      return res.json(
        responsePayload
      );
    } catch (error) {
      console.error(
        'Login error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Login failed. Please try again.',
      });
    }
  }
);

// ============================================================================
// FORGOT PASSWORD
// ============================================================================

router.post(
  '/forgot-password',

  async (req, res) => {
    try {
      const {
        email,
        phone,
      } = req.body;

      const identifier =
        email || phone;

      const genericMessage =
        'If an account exists for this email address, a password reset code and link have been sent.';

      if (!identifier) {
        return res.status(400).json({
          message:
            'Email address is required.',
        });
      }

      const user =
        await getUserByEmailOrPhone(
          identifier
        );

      // Do not reveal whether an account exists.
      if (!user) {
        return res.status(200).json({
          message: genericMessage,
        });
      }

      if (!user.email) {
        return res.status(200).json({
          message: genericMessage,
        });
      }

      // Remove previous active password-reset records.
      await VerificationToken.deleteMany({
        user: user._id,

        purpose: {
          $in: [
            'password-reset',
            'password-reset-code',
            'password-reset-verified',
          ],
        },

        usedAt: null,
      });

      // Secure token used by the reset link.
      const resetToken =
        await createSecureTokenRecord({
          user,
          purpose: 'password-reset',
          expiresMinutes: 60,
          method: 'email',
        });

      // Generate a cryptographically secure 6-digit code.
      const resetCode =
        crypto
          .randomInt(
            100000,
            1000000
          )
          .toString();

      // Store only the hash of the code.
      const resetCodeHash =
        hashToken(resetCode);

      await VerificationToken.create({
        user: user._id,

        purpose:
          'password-reset-code',

        tokenHash:
          resetCodeHash,

        expiresAt:
          new Date(
            Date.now() +
              OTP_EXPIRY_MINUTES *
                60 *
                1000
          ),

        usedAt: null,

        attempts: 0,

        maxAttempts:
          MAX_OTP_ATTEMPTS,

        method: 'email',
      });

      const resetLink =
        `${getFrontendUrl()}/reset-password` +
        `?token=${encodeURIComponent(
          resetToken
        )}` +
        `&email=${encodeURIComponent(
          user.email
        )}`;

      const emailResult =
        await sendPasswordResetCodeAndLinkEmail({
          to: user.email,
          name: user.name,
          resetCode,
          resetLink,
          expiresInMinutes:
            OTP_EXPIRY_MINUTES,
        });

      // Resend returns an object instead of throwing
      // when the email provider rejects the request.
      if (
        emailResult &&
        emailResult.success === false
      ) {
        console.error(
          'Password reset email was not sent:',
          emailResult.message
        );

        return res.status(500).json({
          message:
            'Unable to send the password reset email right now. Please try again later.',
        });
      }

      return res.status(200).json({
        message: genericMessage,
      });
    } catch (error) {
      console.error(
        '========================================'
      );

      console.error(
        'FORGOT PASSWORD ERROR'
      );

      console.error(
        'Message:',
        error.message
      );

      console.error(
        'Name:',
        error.name
      );

      console.error(
        'Code:',
        error.code
      );

      console.error(
        'Stack:',
        error.stack
      );

      console.error(
        '========================================'
      );

      return res.status(500).json({
        message:
          'Unable to process the password reset request right now.',
      });
    }
  }
);

// ============================================================================
// VERIFY PASSWORD RESET CODE
// ============================================================================

router.post(
  '/verify-password-reset-code',

  async (req, res) => {
    try {
      const {
        email,
        code,
        token,
      } = req.body;

      if (!email || !code) {
        return res.status(400).json({
          message:
            'Email address and reset code are required.',
        });
      }

      const normalizedEmail =
        normalizeEmail(email);

      if (
        !/^\d{6}$/.test(
          String(code)
        )
      ) {
        return res.status(400).json({
          message:
            'Please enter the 6-digit reset code.',
        });
      }

      const user =
        await User.findOne({
          email: normalizedEmail,
        });

      if (!user) {
        return res.status(400).json({
          message:
            'Invalid or expired reset code.',
        });
      }

      const codeHash =
        hashToken(String(code));

      const codeRecord =
        await VerificationToken.findOne({
          user: user._id,

          purpose:
            'password-reset-code',

          tokenHash: codeHash,

          usedAt: null,

          expiresAt: {
            $gt: new Date(),
          },
        });

      if (!codeRecord) {
        const activeCode =
          await VerificationToken.findOne({
            user: user._id,

            purpose:
              'password-reset-code',

            usedAt: null,

            expiresAt: {
              $gt: new Date(),
            },
          });

        if (activeCode) {
          activeCode.attempts += 1;

          if (
            activeCode.attempts >=
            activeCode.maxAttempts
          ) {
            activeCode.usedAt =
              new Date();
          }

          await activeCode.save();

          if (
            activeCode.attempts >=
            activeCode.maxAttempts
          ) {
            return res.status(400).json({
              message:
                'Too many incorrect attempts. Please request a new reset code.',
            });
          }
        }

        return res.status(400).json({
          message:
            'Invalid or expired reset code.',
        });
      }

      // If a link token was supplied, validate it too.
      if (token) {
        const resetTokenHash =
          hashToken(token);

        const resetTokenRecord =
          await VerificationToken.findOne({
            user: user._id,

            purpose:
              'password-reset',

            tokenHash:
              resetTokenHash,

            usedAt: null,

            expiresAt: {
              $gt: new Date(),
            },
          });

        if (!resetTokenRecord) {
          return res.status(400).json({
            message:
              'This password reset link is invalid or expired. Please request a new one.',
          });
        }
      }

      // Code is correct.
      codeRecord.usedAt =
        new Date();

      await codeRecord.save();

      // Create a separate short-lived token
      // that can actually change the password.
      const verifiedResetToken =
        await createSecureTokenRecord({
          user,

          purpose:
            'password-reset-verified',

          expiresMinutes: 15,

          method: 'email',
        });

      return res.status(200).json({
        message:
          'Reset code verified successfully.',

        resetToken:
          verifiedResetToken,
      });
    } catch (error) {
      console.error(
        'Verify password reset code error:',
        error
      );

      return res.status(500).json({
        message:
          'Unable to verify the reset code right now.',
      });
    }
  }
);

// ============================================================================
// RESET PASSWORD
// ============================================================================

router.post(
  '/reset-password',

  async (req, res) => {
    try {
      const {
        token,
        password,
        confirmPassword,
      } = req.body;

      if (!token || !password) {
        return res.status(400).json({
          message:
            'Reset token and new password are required.',
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          message:
            'Password must be at least 6 characters long.',
        });
      }

      if (
        confirmPassword &&
        password !== confirmPassword
      ) {
        return res.status(400).json({
          message:
            'Passwords do not match.',
        });
      }

      const tokenHash =
        hashToken(token);

      const record =
        await VerificationToken.findOne({
          purpose:
            'password-reset-verified',

          tokenHash,

          usedAt: null,

          expiresAt: {
            $gt: new Date(),
          },
        });

      if (!record) {
        return res.status(400).json({
          message:
            'This password reset session is invalid or expired. Please request a new reset code.',
        });
      }

      const user =
        await User.findById(
          record.user
        );

      if (!user) {
        return res.status(400).json({
          message:
            'The account associated with this reset request could not be found.',
        });
      }

      user.password =
        password;

      user.loginAttempts = 0;
      user.lockUntil = null;

      await user.save();

      // Consume the verified reset token.
      record.usedAt =
        new Date();

      await record.save();

      // Clean up all password-reset records.
      await VerificationToken.deleteMany({
        user: user._id,

        purpose: {
          $in: [
            'password-reset',
            'password-reset-code',
            'password-reset-verified',
          ],
        },
      });

      return res.status(200).json({
        message:
          'Your password has been reset successfully. You can now log in with your new password.',
      });
    } catch (error) {
      console.error(
        'Reset password error:',
        error
      );

      return res.status(500).json({
        message:
          'Unable to reset your password right now.',
      });
    }
  }
);

// ============================================================================
// LOGOUT
// ============================================================================

router.post(
  '/logout',

  (req, res) => {
    return res.status(200).json({
      success: true,
      message:
        'Logged out successfully.',
    });
  }
);

// ============================================================================
// CURRENT USER
// ============================================================================

router.get(
  '/me',

  protect,

  async (req, res) => {
    try {
      return res.json({
        success: true,

        data:
          sanitizeUser(
            req.user
          ),
      });
    } catch (error) {
      console.error(
        'Get current user error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to load your account information.',
      });
    }
  }
);

// ============================================================================
// EXPORT ROUTER
// ============================================================================

module.exports = router;
