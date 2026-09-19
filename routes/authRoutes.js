const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const generateToken = require('../utils/generateToken');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password, consentAccepted } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required.' });
    }

    if (name.trim().length < 2) {
      return res.status(400).json({ message: 'Please enter your full name.' });
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    if (phone && !/^[+\d][\d\s().-]{6,}$/.test(phone)) {
      return res.status(400).json({ message: 'Please enter a valid phone number.' });
    }

    if (consentAccepted !== true) {
      return res.status(400).json({ message: 'You must agree to the Privacy Policy and Terms & Conditions before creating an account.' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists.' });
    }

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      phone,
      password,
      consent: { privacyPolicy: true, termsAndConditions: true, acceptedAt: new Date() },
    });

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      token: generateToken(user._id),
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Registration failed.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      token: generateToken(user._id),
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Login failed.' });
  }
});

router.get('/me', protect, async (req, res) => {
  res.json({
    _id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    phone: req.user.phone,
    role: req.user.role,
    address: req.user.address,
  });
});

module.exports = router;
