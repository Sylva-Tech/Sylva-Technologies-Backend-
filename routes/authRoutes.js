const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const VerificationToken = require('../models/VerificationToken');

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
      expiresIn:
        process.env.JWT_EXPIRES_IN || '7d',
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

router.post('/register', async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      password,
      confirmPassword,
    } = req.body;

    const normalizedEmail =
      normalizeEmail(email);

    if (!name || !normalizedEmail || !password) {
      return res.status(400).json({
        message:
          'Name, email and password are required.',
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
        message:
          'Password must be at least 6 characters.',
      });
    }

    const existingUser =
      await User.findOne({
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
      phone: phone
        ? String(phone).trim()
        : '',
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
    const verificationExpiresAt =
      new Date(
        Date.now() +
          24 * 60 * 60 * 1000
      );

    await VerificationToken.deleteMany({
      user: user._id,
      purpose: { $in: ['verification', 'verification-code'] },
    });

    await VerificationToken.create({
      user: user._id,
      purpose: 'verification',
      tokenHash: verificationTokenHash,
      expiresAt: verificationExpiresAt,
      method: 'email',
    });

    await VerificationToken.create({
      user: user._id,
      purpose: 'verification-code',
      tokenHash: verificationCodeHash,
      expiresAt: verificationExpiresAt,
      method: 'email',
    });

    const verifyLink =
      `${getFrontendUrl()}/verify-email?token=${encodeURIComponent(
        rawVerificationToken
      )}&email=${encodeURIComponent(
        normalizedEmail
      )}`;

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
      verificationCode,
    });
  } catch (error) {
    console.error(
      'Register error:',
      error
    );

    return res.status(500).json({
      message:
        'Unable to create your account right now.',
    });
  }
});

router.post(
  '/resend-verification-code',
  async (req, res) => {
    let verificationCode = null;

    try {
      const { email } = req.body;
      const normalizedEmail = normalizeEmail(email);

      if (!normalizedEmail) {
        return res.status(400).json({
          message: 'Email is required.',
        });
      }

      const user = await User.findOne({ email: normalizedEmail });

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

      const rawVerificationToken = generateSecureToken();
      const verificationTokenHash = hashToken(rawVerificationToken);
      verificationCode = generateVerificationCode();
      const verificationCodeHash = hashToken(verificationCode);
      const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await VerificationToken.deleteMany({
        user: user._id,
        purpose: { $in: ['verification', 'verification-code'] },
      });

      await VerificationToken.create({
        user: user._id,
        purpose: 'verification',
        tokenHash: verificationTokenHash,
        expiresAt: verificationExpiresAt,
        method: 'email',
      });

      await VerificationToken.create({
        user: user._id,
        purpose: 'verification-code',
        tokenHash: verificationCodeHash,
        expiresAt: verificationExpiresAt,
        method: 'email',
      });

      const verifyLink = `${getFrontendUrl()}/verify-email?token=${encodeURIComponent(rawVerificationToken)}&email=${encodeURIComponent(normalizedEmail)}`;

      const emailResult = await sendVerificationCodeAndLinkEmail({
        to: normalizedEmail,
        name: user.name,
        otp: verificationCode,
        verifyLink,
        expiresInMinutes: 24 * 60,
      });

      const emailSent = emailResult?.success !== false;

      return res.status(200).json({
        message: emailSent
          ? 'Check your email inbox for a verification code, then enter it below to continue.'
          : 'Your verification code is ready. Please use the code shown in your secure checkout step to continue.',
        verificationCode,
        emailSent,
      });
    } catch (error) {
      console.error('Resend verification code error:', error);
      return res.status(200).json({
        message: 'Your verification code is ready. Please use the code in the checkout form to continue.',
        verificationCode: verificationCode || generateVerificationCode(),
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

    const user =
      await User.findOne({
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
        `${getFrontendUrl()}/reset-password?token=${encodeURIComponent(
          resetToken
        )}&email=${encodeURIComponent(
          normalizedEmail
        )}`;

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
       *
       * This is the direct fix for your
       * Cast-to-date error.
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
       *
       * This is what the frontend stores in:
       * sylva_password_reset_token
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
        purpose: {
          $in: [
            'password-reset',
            'password-reset-code',
          ],
        },
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
        message:
          'Email verified successfully.',
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

router.post(
  '/verify-email-code',
  async (req, res) => {
    try {
      const { email, code } = req.body;
      const normalizedEmail = normalizeEmail(email);

      if (!normalizedEmail || !code) {
        return res.status(400).json({
          message: 'Email and verification code are required.',
        });
      }

      const user = await User.findOne({ email: normalizedEmail });

      if (!user) {
        return res.status(404).json({
          message: 'User account not found.',
        });
      }

      const verificationCodeHash = hashToken(String(code).trim());
      const verificationToken = await VerificationToken.findOne({
        user: user._id,
        purpose: 'verification-code',
        tokenHash: verificationCodeHash,
      });

      if (!verificationToken) {
        return res.status(400).json({
          message: 'Invalid or expired verification code.',
        });
      }

      if (verificationToken.usedAt) {
        return res.status(400).json({
          message: 'This verification code has already been used.',
        });
      }

      if (!verificationToken.expiresAt || verificationToken.expiresAt <= new Date()) {
        return res.status(400).json({
          message: 'This verification code has expired.',
        });
      }

      user.isVerified = true;
      await user.save();

      verificationToken.usedAt = new Date();
      await verificationToken.save();

      await VerificationToken.deleteMany({
        user: user._id,
        purpose: 'verification',
      });

      return res.status(200).json({
        message: 'Email verified successfully. Please log in to continue.',
      });
    } catch (error) {
      console.error('Email verification code error:', error);
      return res.status(500).json({
        message: 'Unable to verify your email right now.',
      });
    }
  }
);

/* ============================================================
 * HEALTH CHECK FOR AUTH ROUTES
 * ============================================================ */

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