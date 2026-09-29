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
  sendPasswordResetLinkEmail,
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

const normalizeEmail = (value) =>
  (value || '').toString().trim().toLowerCase();

const normalizePhone = (value) =>
  (value || '').toString().trim();

/*
|--------------------------------------------------------------------------
| VALIDATION HELPERS
|--------------------------------------------------------------------------
*/

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const KENYAN_PHONE_REGEX = /^\+2547\d{8}$/;

const isValidEmail = (value) =>
  EMAIL_REGEX.test(normalizeEmail(value));

const isValidKenyanPhone = (value) =>
  KENYAN_PHONE_REGEX.test(normalizePhone(value));

/*
|--------------------------------------------------------------------------
| USER SANITIZATION
|--------------------------------------------------------------------------
|
| Never return:
| - password
| - loginAttempts
| - lockUntil
| - private Cloudinary document IDs
| - sensitive internal fields
|
*/

const sanitizeUser = (user) => {
  const sellerProfile = user.sellerProfile || {};

  return {
    _id: user._id,
    name: user.name || '',
    email: user.email || '',
    phone: user.phone || '',
    role: user.role || 'customer',

    isVerified: !!user.isVerified,
    verificationMethod: user.verificationMethod || 'email',

    address: user.address || '',

    sellerStatus: user.sellerStatus || 'none',

    accountStatus:
      user.accountStatus || 'active',

    storeStatus:
      user.storeStatus ||
      (user.sellerStatus === 'approved'
        ? 'active'
        : 'inactive'),

    suspensionReason:
      user.suspensionReason || '',

    banReason:
      user.banReason || '',

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

      applicationDate:
        sellerProfile.applicationDate || null,

      reviewedAt:
        sellerProfile.reviewedAt || null,

      rejectionReason:
        sellerProfile.rejectionReason || '',

      storeLocation:
        sellerProfile.storeLocation || '',
    },

    createdAt: user.createdAt || null,
  };
};

/*
|--------------------------------------------------------------------------
| FIND USER
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| SECURE TOKEN HELPERS
|--------------------------------------------------------------------------
*/

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
  /*
   * Remove old unused tokens for the same purpose.
   * This prevents a user from accumulating
   * multiple active reset/verification tokens.
   */
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

const getFrontendUrl = () => {
  return (
    process.env.FRONTEND_URL ||
    'https://sylvatechnologies.vercel.app'
  );
};

/*
|--------------------------------------------------------------------------
| SELLER REGISTRATION
|--------------------------------------------------------------------------
*/

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

      /*
       * Upload seller verification documents.
       */
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

      /*
       * Create email verification token.
       */
      const verificationToken =
        await createSecureTokenRecord({
          user,
          purpose: 'verification',
          expiresMinutes: 60 * 24,
        });

      const verifyLink =
        `${getFrontendUrl()}/verify-email?token=${verificationToken}`;

      /*
       * Email failure should not leave the
       * database user/document state half-created.
       *
       * Registration still reports failure if
       * the verification email cannot be sent,
       * because the user needs the verification flow.
       */
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

      /*
       * Clean up uploaded Cloudinary files
       * when registration fails.
       */
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

/*
|--------------------------------------------------------------------------
| NORMAL CUSTOMER REGISTRATION
|--------------------------------------------------------------------------
*/

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

      if (
        confirmPassword &&
        password !== confirmPassword
      ) {
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

/*
|--------------------------------------------------------------------------
| VERIFY ACCOUNT
|--------------------------------------------------------------------------
|
| Supports:
| - token from email link
| - token in request body
|
*/

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

/*
|--------------------------------------------------------------------------
| VERIFY EMAIL
|--------------------------------------------------------------------------
*/

router.post(
  '/verify-email',
  (req, res) => {
    return res.redirect(
      307,
      '/verify'
    );
  }
);

/*
|--------------------------------------------------------------------------
| RESEND VERIFICATION
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| LOGIN
|--------------------------------------------------------------------------
|
| IMPORTANT:
| - Password verification is handled with bcrypt.compare().
| - Unverified users may still log in.
| - Suspended/banned sellers may still log in so they can see
|   their account status and appeal/restriction information.
| - Seller operational access is controlled separately by
|   sellerStatus, accountStatus, and storeStatus.
| - Verification-email failures must never turn a valid login
|   into HTTP 500.
|
*/

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

      /*
       * Check temporary login lock.
       */
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

      /*
       * Verify password.
       *
       * Do not use user.matchPassword() here.
       * bcrypt.compare() works directly with the
       * hashed password stored in the User document.
       */
      const isMatch =
        await bcrypt.compare(
          password,
          user.password
        );

      if (!isMatch) {
        user.loginAttempts =
          (user.loginAttempts || 0) +
          1;

        /*
         * Lock after 5 failed attempts.
         * Lock duration: 15 minutes.
         */
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

      /*
       * Successful login.
       *
       * Reset failed-attempt counters.
       */
      user.loginAttempts = 0;
      user.lockUntil = null;

      await user.save();

      const token =
        generateToken(user._id);

      /*
       * Build the response before attempting
       * any verification-email operation.
       */
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

      /*
       * Unverified users can still log in.
       *
       * We only attempt to send a verification
       * reminder when there is no active token.
       *
       * Any token/email failure is isolated from
       * the successful authentication response.
       */
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

          /*
           * Only create and send a new token
           * when there is no valid existing token.
           */
          if (!existing) {
            const verificationToken =
              await createSecureTokenRecord({
                user,
                purpose: 'verification',
                expiresMinutes: 60 * 24,
              });

            const verifyLink =
              `${getFrontendUrl()}/verify-email?token=${verificationToken}`;

            try {
              await sendVerificationLinkEmail({
                to: user.email,
                name: user.name,
                verifyLink,
                expiresInMinutes: 60 * 24,
              });
            } catch (emailError) {
              /*
               * Email failure must never invalidate
               * the authenticated login.
               */
              console.error(
                'Login verification email error:',
                emailError
              );
            }
          }
        } catch (verificationError) {
          /*
           * Token/reminder failure must never
           * invalidate a successful login.
           */
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
        'If an account exists for this email address, a password reset link has been sent.';

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

      /*
       * Prevent account enumeration.
       */
      if (!user) {
        return res.status(200).json({
          success: true,
          message: genericMessage,
        });
      }

      const resetToken =
        await createSecureTokenRecord({
          user,
          purpose: 'password-reset',
          expiresMinutes: 60,
        });

      const resetLink =
        `${getFrontendUrl()}/reset-password?token=${resetToken}`;

      await sendPasswordResetLinkEmail({
        to: user.email,
        name: user.name,
        resetLink,
        expiresInMinutes: 60,
      });

      return res.status(200).json({
        success: true,
        message: genericMessage,
      });
    } catch (error) {
      console.error(
        'Forgot password error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to process reset request right now.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| RESET PASSWORD
|--------------------------------------------------------------------------
*/

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
          success: false,
          message:
            'Token and new password are required.',
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message:
            'Password must be at least 6 characters.',
        });
      }

      if (
        confirmPassword &&
        password !== confirmPassword
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Passwords do not match.',
        });
      }

      const tokenHash =
        hashToken(token);

      const record =
        await VerificationToken.findOne({
          purpose: 'password-reset',
          tokenHash,
          usedAt: null,
          expiresAt: {
            $gt: new Date(),
          },
        });

      if (!record) {
        return res.status(400).json({
          success: false,
          message:
            'Password reset token expired or invalid.',
        });
      }

      const user =
        await User.findById(
          record.user
        );

      if (!user) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid password reset request.',
        });
      }

      user.password = password;

      user.loginAttempts = 0;

      user.lockUntil = null;

      await user.save();

      record.usedAt = new Date();

      await record.save();

      await VerificationToken.deleteMany({
        user: user._id,
        purpose: 'password-reset',
        usedAt: {
          $ne: null,
        },
      });

      return res.status(200).json({
        success: true,
        message:
          'Password reset successful.',
      });
    } catch (error) {
      console.error(
        'Reset password error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to reset password right now.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| LOGOUT
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| CURRENT USER
|--------------------------------------------------------------------------
*/

router.get(
  '/me',
  protect,
  async (req, res) => {
    return res.json({
      success: true,
      data: sanitizeUser(
        req.user
      ),
    });
  }
);

module.exports = router;