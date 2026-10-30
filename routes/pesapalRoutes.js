const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { checkSandboxAuthentication } = require('../services/pesapalService');

const router = express.Router();

const sandboxCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many Pesapal connection tests. Please try again later.' },
});

// Admin-only diagnostic. It never returns credentials or the bearer token and
// does not create a charge, order, or wallet transaction.
router.get('/sandbox/auth-check', protect, adminOnly, sandboxCheckLimiter, async (req, res) => {
  try {
    const result = await checkSandboxAuthentication();
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('[Pesapal sandbox authentication]', {
      message: error.message,
      status: error.response?.status,
      providerError: error.response?.data?.error?.message || error.response?.data?.message,
    });

    return res.status(503).json({
      success: false,
      message: 'Pesapal sandbox authentication failed. Check the sandbox credentials and Render environment configuration.',
    });
  }
});

module.exports = router;
