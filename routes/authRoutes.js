const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const mongoose = require('mongoose');
const User = require('../models/User');
const VerificationToken = require('../models/VerificationToken');
const sellerUpload = require('../middleware/sellerUpload');
const uploadBufferToCloudinary = require('../utils/uploadToCloudinary');
const cloudinary = require('../config/cloudinary');
const { checkPinById } = require('../services/kraPinCheckerService');

const {
  sendVerificationCodeAndLinkEmail,
  sendPasswordResetCodeAndLinkEmail,
} = require('../services/emailService');

const router = express.Router();

/* ============================================================
 * CONFIGURATION
 * ============================================================ */

const PASSWORD_RESET_MINUTES = 10;
const PASSWORD_RESET_CODE_LENGTH = 6;

const getFrontendUrl = () => {
  return (
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    'https://sylvatechnologies.co.ke'
  ).replace(/\/$/, '');
};

/* ============================================================
 * HELPERS
 * ============================================================ */

/**
 * Normalize email.
 */
const normalizeEmail = (email) => {
  return String(email || '')
    .trim()
    .toLowerCase();
};

/**
 * Create a secure random token.
 */
const generateSecureToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Hash a token before storing it in MongoDB.
 */
const hashToken = (token) => {
  return crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
};

/**
 * Generate a six-digit password reset code.
 */
const generateResetCode = () => {
  return crypto
    .randomInt(0, 1000000)
    .toString()
    .padStart(PASSWORD_RESET_CODE_LENGTH, '0');
};

/**
 * Generate a six-digit email verification code.
 */
const generateVerificationCode = () => {
  return crypto
    .randomInt(0, 1000000)
    .toString()
    .padStart(6, '0');
};

/**
 * Create JWT.
 */
const createJwt = (user) => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET is not configured.');
  }

  return jwt.sign(
    {
      id: user._id.toString(),
      role: user.role,
    },
    secret,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    }
  );
};

/**
 * Remove sensitive fields before sending user data.
 */
const safeUser = (user) => {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    role: user.role,
    sellerStatus: user.sellerStatus,
    accountStatus: user.accountStatus,
    storeStatus: user.storeStatus,
    isVerified: user.isVerified,
  };
};

/* ============================================================
 * REGISTER
 * POST /api/auth/register
 * ============================================================ */

/*
 * KRA PIN CHECKER BY ID
 * POST /api/auth/kra/pin-checker-by-id
 * Consumer credentials stay server-side; never accept them from the browser.
 */
router.post('/kra/pin-checker-by-id', async (req, res) => {
  try {
    const result = await checkPinById({
      taxpayerType: req.body?.TaxpayerType,
      taxpayerID: req.body?.TaxpayerID,
      expectedPin: req.body?.expectedPin,
    });

    return res.json({
      success: true,
      verified: result.verified,
      pinMatches: result.pinMatches,
      taxpayerName: result.taxpayerName,
      message: result.pinMatches
        ? 'KRA confirmed that the supplied ID and PIN match.'
        : 'KRA found the ID, but the returned PIN does not match the PIN entered.',
    });
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      success: false,
      verified: false,
      message: error.message || 'KRA PIN Checker is temporarily unavailable.',
    });
  }
});

/*
 * SELLER REGISTRATION
 * Requires typed ID/KRA PIN details and matching private document uploads.
 */
router.post(
  '/seller/register',
  sellerUpload.fields([
    { name: 'idFront', maxCount: 1 },
    { name: 'idBack', maxCount: 1 },
    { name: 'kraPin', maxCount: 1 },
  ]),
  async (req, res) => {
    const uploadedDocuments = [];
    let createdUser = null;

    try {
      const name = String(req.body?.officialName || '').trim();
      const email = normalizeEmail(req.body?.email);
      const phone = String(req.body?.mpesaPhone || '').trim().replace(/\s+/g, '');
      const password = String(req.body?.password || '');
      const confirmPassword = String(req.body?.confirmPassword || '');
      const storeName = String(req.body?.storeName || '').trim();
      const storeProfile = String(req.body?.storeProfile || '').trim();
      const idType = String(req.body?.idType || '').trim();
      const idNumber = String(req.body?.idNumber || '').trim();
      const kraPinNumber = String(req.body?.kraPinNumber || '').trim().toUpperCase();
      const privacyAccepted = String(req.body?.privacyPolicyAccepted) === 'true';
      const termsAccepted = String(req.body?.termsAndConditionsAccepted) === 'true';
      const files = req.files || {};
      const idFront = files.idFront?.[0];
      const idBack = files.idBack?.[0];
      const kraPinFile = files.kraPin?.[0];

      if (!name || name.length < 2 || !email || !phone || !password || !storeName || !storeProfile || !idType || !idNumber || !kraPinNumber) {
        return res.status(400).json({ success: false, message: 'Complete all required account, store, ID and KRA PIN fields.' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
      }
      if (!/^\+254[17]\d{8}$/.test(phone)) {
        return res.status(400).json({ success: false, message: 'Enter a valid Kenyan mobile number in +254 format.' });
      }
      if (password.length < 6 || password !== confirmPassword) {
        return res.status(400).json({ success: false, message: 'Use a password of at least 6 characters and confirm it correctly.' });
      }
      if (!['national_id', 'passport', 'military_id', 'other'].includes(idType)) {
        return res.status(400).json({ success: false, message: 'Select a valid identification document type.' });
      }
      if (idNumber.length < 5 || idNumber.length > 50) {
        return res.status(400).json({ success: false, message: 'Enter a valid ID or passport number.' });
      }
      if (!/^[A-Z]\d{9}[A-Z]$/.test(kraPinNumber)) {
        return res.status(400).json({ success: false, message: 'Enter a valid KRA PIN number, for example A123456789B.' });
      }
      if (storeName.length < 2 || storeName.length > 100 || storeProfile.length < 20 || storeProfile.length > 1000) {
        return res.status(400).json({ success: false, message: 'Enter a store name and a store description between 20 and 1000 characters.' });
      }
      if (!privacyAccepted || !termsAccepted) {
        return res.status(400).json({ success: false, message: 'Accept the Privacy Policy and Terms & Conditions to continue.' });
      }
      if (!idFront || !idBack || !kraPinFile) {
        return res.status(400).json({ success: false, message: 'Upload the front and back of your ID and your KRA PIN certificate.' });
      }

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
      }

      const [frontUpload, backUpload, kraUpload] = await Promise.all([
        uploadBufferToCloudinary(idFront.buffer),
        uploadBufferToCloudinary(idBack.buffer),
        uploadBufferToCloudinary(kraPinFile.buffer),
      ]);
      uploadedDocuments.push(frontUpload, backUpload, kraUpload);

      const now = new Date();
      createdUser = await User.create({
        name,
        email,
        phone,
        password,
        role: 'seller',
        sellerStatus: 'pending',
        accountStatus: 'active',
        storeStatus: 'inactive',
        isVerified: false,
        consent: {
          privacyPolicy: true,
          termsAndConditions: true,
          informationAccuracy: true,
          acceptedAt: now,
        },
        sellerProfile: {
          officialName: name,
          idType,
          idNumber,
          idFrontDocument: frontUpload.public_id,
          idBackDocument: backUpload.public_id,
          storeName,
          storeProfile,
          storeEmail: email,
          storePhone: phone,
          mpesaPhone: phone,
          kraPin: kraPinNumber,
          kraPinDocument: kraUpload.public_id,
          applicationDate: now,
        },
      });

      const rawVerificationToken = generateSecureToken();
      const verificationCode = generateVerificationCode();
      const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await VerificationToken.deleteMany({ user: createdUser._id, purpose: 'verification' });
      await VerificationToken.deleteMany({ user: createdUser._id, purpose: 'verification-code' });
      await VerificationToken.create({
        user: createdUser._id,
        purpose: 'verification',
        tokenHash: hashToken(rawVerificationToken),
        expiresAt: verificationExpiresAt,
        method: 'email',
      });
      await VerificationToken.create({
        user: createdUser._id,
        purpose: 'verification-code',
        tokenHash: hashToken(verificationCode),
        expiresAt: verificationExpiresAt,
        method: 'email',
      });

      const verifyLink = `${getFrontendUrl()}/verify-email?token=${encodeURIComponent(rawVerificationToken)}&email=${encodeURIComponent(email)}`;
      let emailSent = true;
      try {
        const result = await sendVerificationCodeAndLinkEmail({
          to: email,
          name,
          otp: verificationCode,
          verifyLink,
          expiresInMinutes: 24 * 60,
        });
        emailSent = result?.success !== false;
      } catch (emailError) {
        emailSent = false;
        console.error('Seller verification email error:', emailError.message);
      }

      return res.status(201).json({
        success: true,
        message: emailSent
          ? 'Seller application submitted. Verify your email, then wait for administrator approval.'
          : 'Seller application submitted, but the verification email could not be sent. Use the resend verification option on the login page.',
        emailSent,
        user: safeUser(createdUser),
      });
    } catch (error) {
      if (createdUser?._id) {
        await Promise.allSettled([
          VerificationToken.deleteMany({ user: createdUser._id }),
          User.findByIdAndDelete(createdUser._id),
        ]);
      }
      await Promise.allSettled(
        uploadedDocuments.map((document) =>
          cloudinary.uploader.destroy(document.public_id, {
            resource_type: document.resource_type || 'image',
            type: 'authenticated',
          })
        )
      );

      if (error.code === 11000) {
        return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
      }
      console.error('Seller registration error:', error.message);
      return res.status(500).json({ success: false, message: 'Unable to submit the seller application. Please try again.' });
    }
  }
);

router.post('/register', async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      password,
      confirmPassword,
    } = req.body;

    const normalizedEmail = normalizeEmail(email);

    if (!name || !normalizedEmail || !password) {
      return res.status(400).json({
        message: 'Name, email and password are required.',
      });
    }

    if (
      confirmPassword !== undefined &&
      password !== confirmPassword
    ) {
      return res.status(400).json({
        message: 'Passwords do not match.',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: 'Password must be at least 6 characters.',
      });
    }

    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.status(409).json({
        message:
          'An account with this email already exists.',
      });
    }

    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      phone: phone ? String(phone).trim() : '',
      password,
      role: 'customer',
      sellerStatus: 'none',
      accountStatus: 'active',
      storeStatus: 'inactive',
      isVerified: false,
    });

    const rawVerificationToken =
      generateSecureToken();

    const verificationTokenHash =
      hashToken(rawVerificationToken);

    const verificationCode =
      generateVerificationCode();

    const verificationCodeHash =
      hashToken(verificationCode);

    const verificationExpiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000
    );

    /*
     * Remove previous verification credentials.
     *
     * These are intentionally separate deleteMany()
     * operations to avoid the Render/Mongoose CastError
     * encountered with $in on the purpose field.
     */
    await VerificationToken.deleteMany({
      user: user._id,
      purpose: 'verification',
    });

    await VerificationToken.deleteMany({
      user: user._id,
      purpose: 'verification-code',
    });

    /*
     * Store verification link token.
     */
    await VerificationToken.create({
      user: user._id,
      purpose: 'verification',
      tokenHash: verificationTokenHash,
      expiresAt: verificationExpiresAt,
      method: 'email',
    });

    /*
     * Store verification code.
     */
    await VerificationToken.create({
      user: user._id,
      purpose: 'verification-code',
      tokenHash: verificationCodeHash,
      expiresAt: verificationExpiresAt,
      method: 'email',
    });

    const verifyLink =
      `${getFrontendUrl()}/verify-email` +
      `?token=${encodeURIComponent(rawVerificationToken)}` +
      `&email=${encodeURIComponent(normalizedEmail)}`;

    try {
      await sendVerificationCodeAndLinkEmail({
        to: normalizedEmail,
        name: user.name,
        otp: verificationCode,
        verifyLink,
        expiresInMinutes: 24 * 60,
      });
    } catch (emailError) {
      console.error(
        'Verification email error:',
        emailError
      );
    }

    return res.status(201).json({
      message:
        'Verification code and link have been sent to your email. Please check your inbox and verify your account before continuing.',
      user: safeUser(user),

      /*
       * Kept temporarily to preserve your existing
       * registration response behavior.
       */
      verificationCode,
    });
  } catch (error) {
    console.error('Register error:', error);

    return res.status(500).json({
      message:
        'Unable to create your account right now.',
    });
  }
});

/* ============================================================
 * RESEND EMAIL VERIFICATION CODE
 *
 * POST /api/auth/resend-verification-code
 * ============================================================ */

router.post(
  '/resend-verification-code',
  async (req, res) => {
    let verificationCode = null;

    try {
      const { email } = req.body;

      const normalizedEmail =
        normalizeEmail(email);

      if (!normalizedEmail) {
        return res.status(400).json({
          message: 'Email is required.',
        });
      }

      const user = await User.findOne({
        email: normalizedEmail,
      });

      if (!user) {
        return res.status(404).json({
          message: 'User account not found.',
        });
      }

      if (user.isVerified) {
        return res.status(200).json({
          message: 'Your account is already verified.',
        });
      }

      const rawVerificationToken =
        generateSecureToken();

      const verificationTokenHash =
        hashToken(rawVerificationToken);

      verificationCode =
        generateVerificationCode();

      const verificationCodeHash =
        hashToken(verificationCode);

      const verificationExpiresAt = new Date(
        Date.now() + 24 * 60 * 60 * 1000
      );

      /*
       * Remove old verification link token.
       *
       * IMPORTANT:
       * Do not change these back to:
       *
       * purpose: {
       *   $in: ['verification', 'verification-code']
       * }
       *
       * because that was producing the Render CastError.
       */
      await VerificationToken.deleteMany({
        user: user._id,
        purpose: 'verification',
      });

      /*
       * Remove old verification code token.
       */
      await VerificationToken.deleteMany({
        user: user._id,
        purpose: 'verification-code',
      });

      /*
       * Create new verification link token.
       */
      await VerificationToken.create({
        user: user._id,
        purpose: 'verification',
        tokenHash: verificationTokenHash,
        expiresAt: verificationExpiresAt,
        method: 'email',
      });

      /*
       * Create new verification code token.
       */
      await VerificationToken.create({
        user: user._id,
        purpose: 'verification-code',
        tokenHash: verificationCodeHash,
        expiresAt: verificationExpiresAt,
        method: 'email',
      });

      const verifyLink =
        `${getFrontendUrl()}/verify-email` +
        `?token=${encodeURIComponent(rawVerificationToken)}` +
        `&email=${encodeURIComponent(normalizedEmail)}`;

      const emailResult =
        await sendVerificationCodeAndLinkEmail({
          to: normalizedEmail,
          name: user.name,
          otp: verificationCode,
          verifyLink,
          expiresInMinutes: 24 * 60,
        });

      const emailSent =
        emailResult?.success !== false;

      return res.status(200).json({
        message: emailSent
          ? 'Verification code sent successfully.'
          : 'The verification email could not be sent right now. Please try again in a moment.',
        emailSent,
      });
    } catch (error) {
      console.error(
        'Resend verification code error:',
        error
      );

      return res.status(200).json({
        message:
          'The verification email could not be sent right now. Please try again in a moment.',
        emailSent: false,
      });
    }
  }
);

/* ============================================================
 * LOGIN
 * POST /api/auth/login
 * ============================================================ */

router.post('/login', async (req, res) => {
  try {
    const {
      email,
      password,
    } = req.body;

    const normalizedEmail =
      normalizeEmail(email);

    if (!normalizedEmail || !password) {
      return res.status(400).json({
        message:
          'Email and password are required.',
      });
    }

    const user = await User.findOne({
      email: normalizedEmail,
    });

    if (!user) {
      return res.status(401).json({
        message:
          'Invalid email or password.',
      });
    }

    /*
     * Check account lock.
     */
    if (user.isLocked()) {
      return res.status(423).json({
        message:
          'Your account is temporarily locked. Please try again later.',
      });
    }

    const passwordMatches =
      await user.matchPassword(password);

    if (!passwordMatches) {
      user.loginAttempts =
        (user.loginAttempts || 0) + 1;

      /*
       * Lock after 5 failed attempts.
       */
      if (user.loginAttempts >= 5) {
        user.lockUntil =
          new Date(
            Date.now() + 15 * 60 * 1000
          );

        user.loginAttempts = 0;
      }

      await user.save();

      return res.status(401).json({
        message:
          'Invalid email or password.',
      });
    }

    /*
     * Successful login.
     */
    user.loginAttempts = 0;
    user.lockUntil = null;

    await user.save();

    return res.status(200).json({
      message: 'Login successful.',
      token: createJwt(user),
      user: safeUser(user),
    });
  } catch (error) {
    console.error(
      'Login error:',
      error
    );

    return res.status(500).json({
      message:
        'Unable to login right now.',
    });
  }
});

/* ============================================================
 * FORGOT PASSWORD
 *
 * POST /api/auth/forgot-password
 *
 * Sends:
 * - 6-digit code
 * - secure reset link
 * ============================================================ */

router.post(
  '/forgot-password',
  async (req, res) => {
    try {
      const {
        email,
      } = req.body;

      // Harden input: email must be a string to avoid NoSQL injection
      if (typeof email !== 'string') {
        return res.status(400).json({
          message: 'Email must be a string.',
        });
      }

      const normalizedEmail =
        normalizeEmail(email);

      if (!normalizedEmail) {
        return res.status(400).json({
          message: 'Email is required.',
        });
      }

      const user =
        await User.findOne({
          email: normalizedEmail,
        });

      /*
       * Do not reveal whether an email exists.
       */
      if (!user) {
        return res.status(200).json({
          message:
            'If an account exists for that email, a password reset code has been sent.',
        });
      }

      /*
       * Remove old password-reset tokens.
       */
      await VerificationToken.deleteMany({
        user: user._id,
        purpose: 'password-reset',
      });

      await VerificationToken.deleteMany({
        user: user._id,
        purpose: 'password-reset-code',
      });

      await VerificationToken.deleteMany({
        user: user._id,
        purpose: 'password-reset-verified',
      });

      /*
       * Generate secure link token.
       */
      const resetToken =
        generateSecureToken();

      const resetTokenHash =
        hashToken(resetToken);

      /*
       * Generate six-digit code.
       */
      const resetCode =
        generateResetCode();

      const resetCodeHash =
        hashToken(resetCode);

      const expiresAt =
        new Date(
          Date.now() +
            PASSWORD_RESET_MINUTES *
              60 *
              1000
        );

      /*
       * Store the reset CODE.
       */
      await VerificationToken.create({
        user: user._id,
        purpose: 'password-reset-code',
        tokenHash: resetCodeHash,
        expiresAt,
        attempts: 0,
        maxAttempts: 5,
        method: 'email',
      });

      /*
       * Store the secure LINK token.
       */
      await VerificationToken.create({
        user: user._id,
        purpose: 'password-reset',
        tokenHash: resetTokenHash,
        expiresAt,
        attempts: 0,
        maxAttempts: 5,
        method: 'email',
      });

      /*
       * Link sent in email.
       */
      const resetLink =
        `${getFrontendUrl()}/reset-password` +
        `?token=${encodeURIComponent(resetToken)}` +
        `&email=${encodeURIComponent(normalizedEmail)}`;

      await sendPasswordResetCodeAndLinkEmail({
        to: normalizedEmail,
        name: user.name,
        resetCode,
        resetLink,
        expiresInMinutes:
          PASSWORD_RESET_MINUTES,
      });

      return res.status(200).json({
        message:
          'If an account exists for that email, a password reset code has been sent.',
      });
    } catch (error) {
      console.error(
        'Forgot password error:',
        error
      );

      return res.status(500).json({
        message:
          'Unable to send the password reset code right now.',
      });
    }
  }
);

/* ============================================================
 * VERIFY PASSWORD RESET CODE
 *
 * POST /api/auth/verify-password-reset-code
 *
 * Frontend sends:
 * {
 *   email,
 *   code,
 *   token
 * }
 *
 * Returns:
 * {
 *   message,
 *   resetToken
 * }
 * ============================================================ */

router.post(
  '/verify-password-reset-code',
  async (req, res) => {
    try {
      const {
        email,
        code,
        token: linkToken,
      } = req.body;

      // Harden input types
      if (typeof email !== 'string') {
        return res.status(400).json({
          message: 'Email must be a string.',
        });
      }

      if (typeof code !== 'string') {
        return res.status(400).json({
          message: 'Reset code must be a string.',
        });
      }

      const normalizedEmail =
        normalizeEmail(email);

      const normalizedCode =
        String(code || '').trim();

      if (!normalizedEmail) {
        return res.status(400).json({
          message: 'Email is required.',
        });
      }

      if (
        !/^\d{6}$/.test(
          normalizedCode
        )
      ) {
        return res.status(400).json({
          message:
            'Please enter a valid 6-digit reset code.',
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

      /*
       * IMPORTANT:
       *
       * We intentionally DO NOT use:
       *
       * expiresAt: { $gt: new Date() }
       *
       * because that was causing your Render
       * CastError.
       */
      const codeHash =
        hashToken(normalizedCode);

      const verificationToken =
        await VerificationToken.findOne({
          user: user._id,
          purpose:
            'password-reset-code',
          tokenHash: codeHash,
        });

      if (!verificationToken) {
        return res.status(400).json({
          message:
            'Invalid or expired reset code.',
        });
      }

      /*
       * Check whether it has already been used.
       */
      if (verificationToken.usedAt) {
        return res.status(400).json({
          message:
            'This reset code has already been used.',
        });
      }

      /*
       * Check expiry in JavaScript.
       */
      if (
        !verificationToken.expiresAt ||
        verificationToken.expiresAt <=
          new Date()
      ) {
        return res.status(400).json({
          message:
            'This reset code has expired.',
        });
      }

      /*
       * Check attempts.
       */
      if (
        verificationToken.attempts >=
        verificationToken.maxAttempts
      ) {
        return res.status(429).json({
          message:
            'Too many attempts. Please request a new reset code.',
        });
      }

      /*
       * Mark code as used.
       */
      verificationToken.usedAt =
        new Date();

      await verificationToken.save();

      /*
       * Create a NEW short-lived verified reset token.
       */
      const verifiedResetToken =
        generateSecureToken();

      const verifiedResetTokenHash =
        hashToken(
          verifiedResetToken
        );

      const verifiedExpiresAt =
        new Date(
          Date.now() +
            15 * 60 * 1000
        );

      await VerificationToken.deleteMany({
        user: user._id,
        purpose:
          'password-reset-verified',
      });

      await VerificationToken.create({
        user: user._id,
        purpose:
          'password-reset-verified',
        tokenHash:
          verifiedResetTokenHash,
        expiresAt:
          verifiedExpiresAt,
        attempts: 0,
        maxAttempts: 5,
        method: 'email',
      });

      /*
       * If the user arrived through the secure
       * email link, validate it as well.
       */
      if (linkToken) {
        const linkHash =
          hashToken(
            String(linkToken)
          );

        const linkTokenRecord =
          await VerificationToken.findOne({
            user: user._id,
            purpose:
              'password-reset',
            tokenHash: linkHash,
          });

        if (linkTokenRecord) {
          if (
            linkTokenRecord.usedAt
          ) {
            return res.status(400).json({
              message:
                'This reset link has already been used.',
            });
          }

          if (
            !linkTokenRecord.expiresAt ||
            linkTokenRecord.expiresAt <=
              new Date()
          ) {
            return res.status(400).json({
              message:
                'This reset link has expired.',
            });
          }

          linkTokenRecord.usedAt =
            new Date();

          await linkTokenRecord.save();
        }
      }

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

/* ============================================================
 * RESET PASSWORD
 *
 * POST /api/auth/reset-password
 *
 * Frontend sends:
 * {
 *   token,
 *   password,
 *   confirmPassword
 * }
 * ============================================================ */

router.post(
  '/reset-password',
  async (req, res) => {
    try {
      const {
        token,
        password,
        confirmPassword,
      } = req.body;

      if (!token) {
        return res.status(400).json({
          message:
            'Password reset token is required.',
        });
      }

      if (typeof token !== 'string') {
        return res.status(400).json({
          message: 'Password reset token must be a string.',
        });
      }

      if (!password) {
        return res.status(400).json({
          message:
            'New password is required.',
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          message:
            'Password must be at least 6 characters.',
        });
      }

      if (
        confirmPassword !== undefined &&
        password !== confirmPassword
      ) {
        return res.status(400).json({
          message:
            'Passwords do not match.',
        });
      }

      const tokenHash =
        hashToken(
          String(token)
        );

      const verificationToken =
        await VerificationToken.findOne({
          purpose:
            'password-reset-verified',
          tokenHash,
        });

      if (!verificationToken) {
        return res.status(400).json({
          message:
            'Invalid or expired password reset token.',
        });
      }

      if (verificationToken.usedAt) {
        return res.status(400).json({
          message:
            'This password reset token has already been used.',
        });
      }

      /*
       * Again, check Date in JavaScript.
       */
      if (
        !verificationToken.expiresAt ||
        verificationToken.expiresAt <=
          new Date()
      ) {
        return res.status(400).json({
          message:
            'This password reset token has expired.',
        });
      }

      const user =
        await User.findById(
          verificationToken.user
        );

      if (!user) {
        return res.status(404).json({
          message:
            'User account could not be found.',
        });
      }

      /*
       * Assign the new password.
       *
       * User.js contains a pre-save hook that
       * automatically bcrypt-hashes the password.
       */
      user.password =
        password;

      /*
       * Reset login security counters.
       */
      user.loginAttempts = 0;
      user.lockUntil = null;

      await user.save();

      /*
       * Invalidate the reset token.
       */
      verificationToken.usedAt =
        new Date();

      await verificationToken.save();

      /*
       * Remove remaining reset credentials.
       */
      await VerificationToken.deleteMany({
        user: user._id,
        purpose: mongoose.trusted({
          $in: [
            'password-reset',
            'password-reset-code',
          ],
        }),
      });

      return res.status(200).json({
        message:
          'Password reset successfully. You can now log in with your new password.',
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

/* ============================================================
 * RESEND EMAIL VERIFICATION FOR THE SIGNED-IN ACCOUNT
 * POST /api/auth/resend-verification
 * ============================================================ */

router.post('/resend-verification', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Please sign in again to request verification.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }
    if (user.isVerified === true) {
      return res.status(200).json({ success: true, alreadyVerified: true, message: 'This email address is already verified.' });
    }

    const rawVerificationToken = generateSecureToken();
    const verificationCode = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await VerificationToken.deleteMany({ user: user._id, purpose: 'verification' });
    await VerificationToken.deleteMany({ user: user._id, purpose: 'verification-code' });
    await VerificationToken.create({
      user: user._id,
      purpose: 'verification',
      tokenHash: hashToken(rawVerificationToken),
      expiresAt,
      method: 'email',
    });
    await VerificationToken.create({
      user: user._id,
      purpose: 'verification-code',
      tokenHash: hashToken(verificationCode),
      expiresAt,
      method: 'email',
    });

    const verifyLink = `${getFrontendUrl()}/verify-email?token=${encodeURIComponent(rawVerificationToken)}&email=${encodeURIComponent(user.email)}`;
    const result = await sendVerificationCodeAndLinkEmail({
      to: user.email,
      name: user.name,
      otp: verificationCode,
      verifyLink,
      expiresInMinutes: 24 * 60,
    });

    if (!result || result.success === false) {
      await VerificationToken.deleteMany({ user: user._id, purpose: 'verification' });
      await VerificationToken.deleteMany({ user: user._id, purpose: 'verification-code' });
      return res.status(503).json({
        success: false,
        message: result?.message || 'The verification email could not be sent. Please try again later.',
      });
    }

    return res.status(200).json({
      success: true,
      message: `A new verification email has been sent to ${user.email}. Open that email and click “Verify My Email”. The link expires in 24 hours.`,
    });
  } catch (error) {
    console.error('Resend email verification error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to send a verification email right now.' });
  }
});

/* ============================================================
 * VERIFY EMAIL
 *
 * GET /api/auth/verify-email
 * ============================================================ */

router.get(
  '/verify-email',
  async (req, res) => {
    try {
      const {
        token,
        email,
      } = req.query;

      const normalizedEmail =
        normalizeEmail(email);

      if (!token || !normalizedEmail) {
        return res.status(400).json({
          message:
            'Verification token and email are required.',
        });
      }

      const user =
        await User.findOne({
          email: normalizedEmail,
        });

      if (!user) {
        return res.status(404).json({
          message:
            'User account not found.',
        });
      }

      const tokenHash =
        hashToken(
          String(token)
        );

      const verificationToken =
        await VerificationToken.findOne({
          user: user._id,
          purpose:
            'verification',
          tokenHash,
        });

      if (!verificationToken) {
        return res.status(400).json({
          message:
            'Invalid or expired verification link.',
        });
      }

      if (verificationToken.usedAt) {
        return res.status(400).json({
          message:
            'This verification link has already been used.',
        });
      }

      if (
        !verificationToken.expiresAt ||
        verificationToken.expiresAt <=
          new Date()
      ) {
        return res.status(400).json({
          message:
            'This verification link has expired.',
        });
      }

      user.isVerified = true;

      await user.save();

      verificationToken.usedAt =
        new Date();

      await verificationToken.save();

      await VerificationToken.deleteMany({
        user: user._id,
        purpose: 'verification-code',
      });

      return res.status(200).json({
        success: true,
        verified: true,
        message: 'Email verified successfully. Your account status is now Verified.',
        user: safeUser(user),
      });
    } catch (error) {
      console.error(
        'Email verification error:',
        error
      );

      return res.status(500).json({
        message:
          'Unable to verify your email right now.',
      });
    }
  }
);

/* ============================================================
 * VERIFY EMAIL CODE
 *
 * POST /api/auth/verify-email-code
 * ============================================================ */

router.post(
  '/verify-email-code',
  async (req, res) => {
    try {
      const {
        email,
        code,
      } = req.body;

      const normalizedEmail =
        normalizeEmail(email);

      if (!normalizedEmail || !code) {
        return res.status(400).json({
          message:
            'Email and verification code are required.',
        });
      }

      const user =
        await User.findOne({
          email: normalizedEmail,
        });

      if (!user) {
        return res.status(404).json({
          message:
            'User account not found.',
        });
      }

      const verificationCodeHash =
        hashToken(
          String(code).trim()
        );

      const verificationToken =
        await VerificationToken.findOne({
          user: user._id,
          purpose:
            'verification-code',
          tokenHash:
            verificationCodeHash,
        });

      if (!verificationToken) {
        return res.status(400).json({
          message:
            'Invalid or expired verification code.',
        });
      }

      if (verificationToken.usedAt) {
        return res.status(400).json({
          message:
            'This verification code has already been used.',
        });
      }

      if (
        !verificationToken.expiresAt ||
        verificationToken.expiresAt <=
          new Date()
      ) {
        return res.status(400).json({
          message:
            'This verification code has expired.',
        });
      }

      user.isVerified = true;

      await user.save();

      verificationToken.usedAt =
        new Date();

      await verificationToken.save();

      await VerificationToken.deleteMany({
        user: user._id,
        purpose: 'verification',
      });

      return res.status(200).json({
        success: true,
        verified: true,
        message: 'Email verified successfully. Your account status is now Verified. Please log in to continue.',
        user: safeUser(user),
      });
    } catch (error) {
      console.error(
        'Email verification code error:',
        error
      );

      return res.status(500).json({
        message:
          'Unable to verify your email right now.',
      });
    }
  }
);

/* ============================================================
 * HEALTH CHECK FOR AUTH ROUTES
 * ============================================================ */

router.get(
  '/me',
  async (req, res) => {
    try {
      const authHeader =
        req.headers.authorization;

      if (
        !authHeader ||
        !authHeader.startsWith('Bearer ')
      ) {
        return res.status(401).json({
          success: false,
          message:
            'Authentication required. Please log in again.',
        });
      }

      const token =
        authHeader.split(' ')[1];

      if (!token) {
        return res.status(401).json({
          success: false,
          message:
            'Authentication token is missing.',
        });
      }

      const decoded =
        jwt.verify(
          token,
          process.env.JWT_SECRET
        );

      const user =
        await User.findById(
          decoded.id
        ).select('-password');

      if (!user) {
        return res.status(401).json({
          success: false,
          message:
            'User account could not be found.',
        });
      }

      return res.status(200).json({
        success: true,
        user: safeUser(user),
      });
    } catch (error) {
      console.error(
        'Fetch current user error:',
        error
      );

      return res.status(401).json({
        success: false,
        message:
          'Your session has expired or the token is invalid.',
      });
    }
  }
);

router.get(
  '/health',
  (req, res) => {
    res.status(200).json({
      message:
        'Sylva Technologies authentication service is running.',
    });
  }
);

/* ============================================================
 * EXPORT
 * ============================================================ */

module.exports = router;
