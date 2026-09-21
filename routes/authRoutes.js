const express = require('express');
const User = require('../models/User');
const VerificationToken = require('../models/VerificationToken');
const { protect } = require('../middleware/authMiddleware');
const generateToken = require('../utils/generateToken');
const { generateOtp, hashOtp, compareOtp } = require('../utils/otp');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/emailService');
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

const sendOtpToUser = async (user, purpose) => {
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
  const tokenHash = hashOtp(otp);

  await VerificationToken.deleteMany({
    user: user._id,
    purpose,
    usedAt: null,
  });

  await VerificationToken.create({
    user: user._id,
    purpose,
    tokenHash,
    expiresAt,
    method: user.verificationMethod || 'email',
  });

  if (purpose === 'verification') {
    if (user.verificationMethod === 'sms' && user.phone) {
      const smsResult = await sendOtpSms({ to: user.phone, otp, purpose: 'verification' });
      if (!smsResult.success) {
        console.warn('Verification SMS failed:', smsResult.message);
      }
      return { otp, sentVia: 'sms', smsResult };
    }

    const emailResult = await sendVerificationEmail({
      to: user.email,
      name: user.name,
      otp,
      expiresInMinutes: OTP_EXPIRY_MINUTES,
    });

    return { otp, sentVia: 'email', emailResult };
  }

  if (user.verificationMethod === 'sms' && user.phone) {
    const smsResult = await sendOtpSms({ to: user.phone, otp, purpose: 'password-reset' });
    if (!smsResult.success) {
      console.warn('Password reset SMS failed:', smsResult.message);
    }
    return { otp, sentVia: 'sms', smsResult };
  }

  const emailResult = await sendPasswordResetEmail({
    to: user.email,
    name: user.name,
    otp,
    expiresInMinutes: OTP_EXPIRY_MINUTES,
  });

  return { otp, sentVia: 'email', emailResult };
};

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

    const { otp } = await sendOtpToUser(user, 'verification');

    const token = generateToken(user._id);
    return res.status(201).json({
      success: true,
      message: 'Registration successful. Verification code sent.',
      data: {
        user: sanitizeUser(user),
        otp,
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

    const record = await VerificationToken.findOne({
      user: user._id,
      purpose: 'verification',
      usedAt: null,
      expiresAt: { $gt: new Date() },
    }).sort({ expiresAt: -1 });

    if (!record) {
      return res.status(400).json({ success: false, message: 'Verification code expired or not found.' });
    }

    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      await VerificationToken.deleteMany({ user: user._id, purpose: 'verification' });
      return res.status(429).json({ success: false, message: 'Too many invalid attempts. Please request a new code.' });
    }

    const valid = compareOtp({ providedOtp: otp, storedHash: record.tokenHash });
    if (!valid) {
      record.attempts += 1;
      await record.save();
      return res.status(400).json({ success: false, message: 'Invalid verification code.' });
    }

    user.isVerified = true;
    user.verificationMethod = user.verificationMethod || 'email';
    await user.save();

    record.usedAt = new Date();
    await record.save();
    await VerificationToken.deleteMany({ user: user._id, purpose: 'verification', usedAt: { $ne: null } });

    return res.status(200).json({
      success: true,
      message: 'Verification successful. Your account is now active.',
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

    const { otp } = await sendOtpToUser(user, 'verification');
    return res.status(200).json({
      success: true,
      message: 'Verification code resent successfully.',
      data: { otp },
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

    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Verification required. Please verify your account before logging in.',
      });
    }

    const token = generateToken(user._id);
    return res.json({
      success: true,
      message: 'Login successful.',
      data: {
        user: sanitizeUser(user),
        token,
      },
    });
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
    if (!user) {
      return res.status(404).json({ success: false, message: 'User account not found.' });
    }

    const { otp } = await sendOtpToUser(user, 'password-reset');
    return res.status(200).json({
      success: true,
      message: 'Password reset code sent successfully.',
      data: { otp },
    });
  } catch (error) {
    console.error('Forgot password error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to process reset request right now.' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, phone, otp, password, confirmPassword } = req.body;
    const identifier = email || phone;

    if (!identifier || !otp || !password) {
      return res.status(400).json({ success: false, message: 'Email/phone, OTP and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    const user = await getUserByEmailOrPhone(identifier);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User account not found.' });
    }

    const record = await VerificationToken.findOne({
      user: user._id,
      purpose: 'password-reset',
      usedAt: null,
      expiresAt: { $gt: new Date() },
    }).sort({ expiresAt: -1 });

    if (!record) {
      return res.status(400).json({ success: false, message: 'Password reset code expired or invalid.' });
    }

    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      await VerificationToken.deleteMany({ user: user._id, purpose: 'password-reset' });
      return res.status(429).json({ success: false, message: 'Too many invalid attempts. Please request a new reset code.' });
    }

    if (!compareOtp({ providedOtp: otp, storedHash: record.tokenHash })) {
      record.attempts += 1;
      await record.save();
      return res.status(400).json({ success: false, message: 'Invalid reset code.' });
    }

    user.password = password;
    user.loginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    record.usedAt = new Date();
    await record.save();
    await VerificationToken.deleteMany({ user: user._id, purpose: 'password-reset', usedAt: { $ne: null } });

    return res.status(200).json({
      success: true,
      message: 'Password reset successful.',
    });
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
