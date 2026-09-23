const express = require('express');
const User = require('../models/User');
const VerificationToken = require('../models/VerificationToken');
const { protect } = require('../middleware/authMiddleware');
const generateToken = require('../utils/generateToken');
const sellerUpload = require('../middleware/sellerUpload');
const uploadBufferToCloudinary = require('../utils/uploadToCloudinary');
const cloudinary = require('../config/cloudinary');
const { generateOtp, hashOtp, compareOtp } = require('../utils/otp');
const { sendVerificationEmail, sendPasswordResetEmail, sendVerificationLinkEmail, sendPasswordResetLinkEmail } = require('../services/emailService');
const { sendOtpSms } = require('../services/smsService');

const router = express.Router();

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 10);
const RESEND_COOLDOWN_MINUTES = Number(process.env.RESEND_COOLDOWN_MINUTES || 1);
const MAX_OTP_ATTEMPTS = Number(process.env.MAX_OTP_ATTEMPTS || 5);
const MAX_OTP_REQUESTS = Number(process.env.MAX_OTP_REQUESTS || 3);

const normalizeEmail = (value) => (value || '').toString().trim().toLowerCase();

const sanitizeUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  isVerified: user.isVerified,
  verificationMethod: user.verificationMethod,
  address: user.address || '',
  sellerStatus: user.sellerStatus || 'none',
  sellerProfile: {
    officialName: user.sellerProfile?.officialName || '',
    mpesaPhone: user.sellerProfile?.mpesaPhone || '',
    applicationDate: user.sellerProfile?.applicationDate || null,
    reviewedAt: user.sellerProfile?.reviewedAt || null,
    rejectionReason: user.sellerProfile?.rejectionReason || '',
  },
  createdAt: user.createdAt,
});

const getUserByEmailOrPhone = async (value) => {
  const normalized = (value || '').toString().trim();
  if (!normalized) return null;

  const query = /^\S+@\S+\.\S+$/.test(normalized)
    ? { email: normalizeEmail(normalized) }
    : { phone: normalized };

  return User.findOne(query);
};

const crypto = require('crypto');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const createSecureTokenRecord = async ({ user, purpose, expiresMinutes = 60 * 24, method = 'email' }) => {
  // remove previous used tokens for same purpose
  await VerificationToken.deleteMany({ user: user._id, purpose, usedAt: { $ne: null } });

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

  await VerificationToken.create({
    user: user._id,
    purpose,
    tokenHash,
    expiresAt,
    method,
  });

  return token;
};

router.post(
  '/seller/register',
  (req, res, next) => {
    sellerUpload.fields([
      { name: 'idFront', maxCount: 1 },
      { name: 'idBack', maxCount: 1 },
      { name: 'kraPin', maxCount: 1 },
    ])(req, res, (error) => {
      if (error) {
        return res.status(400).json({
          success: false,
          message: error.message || 'Unable to upload seller documents.',
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
        password,
        confirmPassword,
        privacyPolicyAccepted,
        termsAndConditionsAccepted,
      } = req.body;

      const files = req.files || {};

      const idFrontFile = files.idFront?.[0];
      const idBackFile = files.idBack?.[0];
      const kraPinFile = files.kraPin?.[0];

      if (!officialName || !email || !mpesaPhone || !password) {
        return res.status(400).json({
          success: false,
          message:
            'Official/business name, email, M-Pesa phone and password are required.',
        });
      }

      if (officialName.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid official or business name.',
        });
      }

      if (!/^\S+@\S+\.\S+$/.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid email address.',
        });
      }

      if (!/^[+\d][\d\s().-]{6,}$/.test(mpesaPhone)) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid M-Pesa phone number.',
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 6 characters.',
        });
      }

      if (confirmPassword !== password) {
        return res.status(400).json({
          success: false,
          message: 'Passwords do not match.',
        });
      }

      if (privacyPolicyAccepted !== 'true' || termsAndConditionsAccepted !== 'true') {
        return res.status(400).json({
          success: false,
          message:
            'You must agree to the Privacy Policy and Terms & Conditions before registering as a seller.',
        });
      }

      if (!idFrontFile || !idBackFile || !kraPinFile) {
        return res.status(400).json({
          success: false,
          message:
            'ID front, ID back and KRA PIN documents are all required.',
        });
      }

      const normalizedEmail = normalizeEmail(email);
      const normalizedPhone = mpesaPhone.trim();

      const existingEmail = await User.findOne({
        email: normalizedEmail,
      });

      if (existingEmail) {
        return res.status(409).json({
          success: false,
          message:
            'An account with this email already exists. Please log in to your existing account.',
        });
      }

      const existingPhone = await User.findOne({
        phone: normalizedPhone,
      });

      if (existingPhone) {
        return res.status(409).json({
          success: false,
          message:
            'An account with this phone number already exists. Please log in to your existing account.',
        });
      }

      // Upload seller verification documents privately to Cloudinary.
      const idFrontUpload = await uploadBufferToCloudinary(idFrontFile.buffer);
      uploadedFiles.push(idFrontUpload);

      const idBackUpload = await uploadBufferToCloudinary(idBackFile.buffer);
      uploadedFiles.push(idBackUpload);

      const kraPinUpload = await uploadBufferToCloudinary(kraPinFile.buffer);
      uploadedFiles.push(kraPinUpload);

      const user = await User.create({
        name: officialName.trim(),
        email: normalizedEmail,
        phone: normalizedPhone,
        password,
        role: 'seller',
        sellerStatus: 'pending',

        sellerProfile: {
          officialName: officialName.trim(),
          mpesaPhone: normalizedPhone,

          // Private Cloudinary asset references.
          idFrontDocument: idFrontUpload.public_id,
          idBackDocument: idBackUpload.public_id,
          kraPinDocument: kraPinUpload.public_id,

          applicationDate: new Date(),
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

      const verificationToken = await createSecureTokenRecord({
        user,
        purpose: 'verification',
        expiresMinutes: 60 * 24,
      });

      const frontendUrl =
        process.env.FRONTEND_URL ||
        process.env.VITE_API_BASE_URL ||
        '';

      const verifyLink = `${frontendUrl.replace(
        /\/$/,
        ''
      )}/verify-email?token=${verificationToken}`;

      await sendVerificationLinkEmail({
        to: user.email,
        name: user.name,
        verifyLink,
        expiresInMinutes: 60 * 24,
      });

      const token = generateToken(user._id);

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
      console.error('Seller registration error:', error);

      // Remove uploaded documents if database registration fails.
      for (const uploadedFile of uploadedFiles) {
        try {
          await cloudinary.uploader.destroy(uploadedFile.public_id, {
            type: 'authenticated',
            resource_type: uploadedFile.resource_type || 'image',
          });
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

router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password, confirmPassword, consentAccepted, verificationMethod = 'email' } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password are required.' });
    }

    if (name.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'Please enter your full name.' });
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    if (!phone || !/^[+\d][\d\s().-]{6,}$/.test(phone)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid phone number.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    if (consentAccepted !== true) {
      return res.status(400).json({
        success: false,
        message: 'You must agree to the Privacy Policy and Terms & Conditions before creating an account.',
      });
    }

    if (!['email', 'sms'].includes(verificationMethod)) {
      return res.status(400).json({ success: false, message: 'Please select a valid verification method.' });
    }

    const existingEmail = await User.findOne({ email: normalizeEmail(email) });
    if (existingEmail) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }

    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      return res.status(409).json({ success: false, message: 'Phone number already registered.' });
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizeEmail(email),
      phone: phone.trim(),
      password,
      verificationMethod,
      consent: { privacyPolicy: true, termsAndConditions: true, acceptedAt: new Date() },
      isVerified: false,
    });

    // create secure verification token and send link/email
    const verificationToken = await createSecureTokenRecord({ user, purpose: 'verification', expiresMinutes: 60 * 24 });
    const frontendUrl = process.env.FRONTEND_URL || process.env.VITE_API_BASE_URL || '';
    const verifyLink = `${frontendUrl.replace(/\/$/, '')}/verify-email?token=${verificationToken}`;
    await sendVerificationLinkEmail({ to: user.email, name: user.name, verifyLink, expiresInMinutes: 60 * 24 });

    const token = generateToken(user._id);
    return res.status(201).json({
      success: true,
      message: 'Registration successful. Verification email sent.',
      data: {
        user: sanitizeUser(user),
        verificationPending: true,
        token,
      },
    });
  } catch (error) {
    console.error('Registration error:', error.message);
    return res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const { email, phone, otp } = req.body;

    const identifier = email || phone;
    if (!identifier || !otp) {
      return res.status(400).json({ success: false, message: 'Email/phone and verification code are required.' });
    }

    const user = await getUserByEmailOrPhone(identifier);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User account not found.' });
    }

    if (user.isVerified) {
      return res.status(200).json({ success: true, message: 'Account already verified.' });
    }

    // allow verification via token in query or body
    const tokenValue = otp || req.body.token || req.query.token;
    if (!tokenValue) {
      return res.status(400).json({ success: false, message: 'Verification token or code is required.' });
    }

    const tokenHash = hashToken(tokenValue);
    const record = await VerificationToken.findOne({
      user: user._id,
      purpose: 'verification',
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    }).sort({ expiresAt: -1 });

    if (!record) {
      return res.status(400).json({ success: false, message: 'Verification token expired or invalid.' });
    }

    user.isVerified = true;
    user.verificationMethod = user.verificationMethod || 'email';
    await user.save();

    record.usedAt = new Date();
    await record.save();
    await VerificationToken.deleteMany({ user: user._id, purpose: 'verification', usedAt: { $ne: null } });

    return res.status(200).json({
      success: true,
      message: 'Verification successful. Your account is now verified.',
      data: { user: sanitizeUser(user) },
    });
  } catch (error) {
    console.error('Verification error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to verify account right now.' });
  }
});

router.post('/verify-email', (req, res) => res.redirect(307, '/verify'));

router.post('/resend-verification', async (req, res) => {
  try {
    const { email, phone } = req.body;
    const identifier = email || phone;

    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Email or phone is required.' });
    }

    const user = await getUserByEmailOrPhone(identifier);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User account not found.' });
    }

    if (user.isVerified) {
      return res.status(200).json({ success: true, message: 'Your account is already verified.' });
    }

    const cooldown = user.otpCooldownUntil ? new Date(user.otpCooldownUntil) : null;
    if (cooldown && cooldown > new Date()) {
      const remainingSeconds = Math.ceil((cooldown - new Date()) / 1000);
      return res.status(429).json({ success: false, message: `Please wait ${remainingSeconds} seconds before requesting a new code.` });
    }

    const activeRequestCount = await VerificationToken.countDocuments({
      user: user._id,
      purpose: 'verification',
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    if (activeRequestCount >= MAX_OTP_REQUESTS) {
      return res.status(429).json({ success: false, message: 'Too many verification requests. Please try again later.' });
    }

    user.otpCooldownUntil = new Date(Date.now() + RESEND_COOLDOWN_MINUTES * 60 * 1000);
    await user.save();

    const verificationToken = await createSecureTokenRecord({ user, purpose: 'verification', expiresMinutes: 60 * 24 });
    const frontendUrl = process.env.FRONTEND_URL || process.env.VITE_API_BASE_URL || '';
    const verifyLink = `${frontendUrl.replace(/\/$/, '')}/verify-email?token=${verificationToken}`;
    await sendVerificationLinkEmail({ to: user.email, name: user.name, verifyLink, expiresInMinutes: 60 * 24 });

    return res.status(200).json({
      success: true,
      message: 'Verification email resent successfully. Please check your inbox.',
    });
  } catch (error) {
    console.error('Resend verification error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to resend verification code.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, phone, password } = req.body;
    const identifier = email || phone;

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Email/phone and password are required.' });
    }

    const user = await getUserByEmailOrPhone(identifier);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    if (user.isLocked && user.isLocked()) {
      return res.status(423).json({ success: false, message: 'Your account is temporarily locked. Please try again later.' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      if (user.loginAttempts >= 5) {
        user.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
        user.loginAttempts = 0;
      }
      await user.save();
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    user.loginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    const token = generateToken(user._id);

    // always allow login even if not verified; include flag
    const responsePayload = {
      success: true,
      message: 'Login successful.',
      data: {
        user: sanitizeUser(user),
        token,
        emailVerified: !!user.isVerified,
      },
    };

    // If not verified, ensure frontend can resend verification
    if (!user.isVerified) {
      // create a short lived verification token if none exists
      const existing = await VerificationToken.findOne({ user: user._id, purpose: 'verification', usedAt: null, expiresAt: { $gt: new Date() } }).sort({ expiresAt: -1 });
      if (!existing) {
        const verificationToken = await createSecureTokenRecord({ user, purpose: 'verification', expiresMinutes: 60 * 24 });
        const frontendUrl = process.env.FRONTEND_URL || process.env.VITE_API_BASE_URL || '';
        const verifyLink = `${frontendUrl.replace(/\/$/, '')}/verify-email?token=${verificationToken}`;
        // send verification link but do not expose token in response
        await sendVerificationLinkEmail({ to: user.email, name: user.name, verifyLink, expiresInMinutes: 60 * 24 });
      }
      responsePayload.message = 'Login successful. Email verification is pending.';
    }

    return res.json(responsePayload);
  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({ success: false, message: 'Login failed.' });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email, phone } = req.body;
    const identifier = email || phone;

    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Email or phone is required.' });
    }

    const user = await getUserByEmailOrPhone(identifier);
    // Always return generic response to avoid user enumeration
    if (!user) {
      return res.status(200).json({ success: true, message: 'If an account exists for this email address, a password reset link has been sent.' });
    }

    const resetToken = await createSecureTokenRecord({ user, purpose: 'password-reset', expiresMinutes: 60 });
    const frontendUrl = process.env.FRONTEND_URL || process.env.VITE_API_BASE_URL || '';
    const resetLink = `${frontendUrl.replace(/\/$/, '')}/reset-password?token=${resetToken}`;
    await sendPasswordResetLinkEmail({ to: user.email, name: user.name, resetLink, expiresInMinutes: 60 });

    return res.status(200).json({ success: true, message: 'If an account exists for this email address, a password reset link has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to process reset request right now.' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body;

    if (!token || !password) {
      return res.status(400).json({ success: false, message: 'Token and new password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    const tokenHash = hashToken(token);
    const record = await VerificationToken.findOne({ purpose: 'password-reset', tokenHash, usedAt: null, expiresAt: { $gt: new Date() } });
    if (!record) {
      return res.status(400).json({ success: false, message: 'Password reset token expired or invalid.' });
    }

    const user = await User.findById(record.user);
    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid password reset request.' });
    }

    user.password = password;
    user.loginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    record.usedAt = new Date();
    await record.save();
    await VerificationToken.deleteMany({ user: user._id, purpose: 'password-reset', usedAt: { $ne: null } });

    return res.status(200).json({ success: true, message: 'Password reset successful.' });
  } catch (error) {
    console.error('Reset password error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to reset password right now.' });
  }
});

router.post('/logout', (req, res) => {
  return res.status(200).json({ success: true, message: 'Logged out successfully.' });
});

router.get('/me', protect, async (req, res) => {
  return res.json({
    success: true,
    data: sanitizeUser(req.user),
  });
});

module.exports = router;
