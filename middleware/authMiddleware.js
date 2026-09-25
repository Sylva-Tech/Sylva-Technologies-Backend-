const jwt = require('jsonwebtoken');
const User = require('../models/User');

/*
 * Protect authenticated routes.
 *
 * Requires:
 * - Valid Bearer token
 * - Valid JWT_SECRET
 * - Existing user account
 */
const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please log in again.',
    });
  }

  try {
    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication token is missing.',
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User account could not be found.',
      });
    }

    req.user = user;

    next();
  } catch (error) {
    console.error('Authentication error:', error.message);

    return res.status(401).json({
      success: false,
      message:
        'Your session has expired or the token is invalid.',
    });
  }
};

/*
 * Require administrator privileges.
 */
const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'Access denied. Admin privileges required.',
  });
};

/*
 * Require a verified account.
 */
const requireVerified = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
    });
  }

  if (!req.user.isVerified) {
    return res.status(403).json({
      success: false,
      message:
        'Verification required. Please verify your account before continuing.',
    });
  }

  next();
};

/*
 * Require an approved seller.
 *
 * Rules:
 * - Must be logged in
 * - Must have seller role
 * - Must have verified account
 * - Must have sellerStatus = approved
 */
const approvedSellerOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
    });
  }

  if (req.user.role !== 'seller') {
    return res.status(403).json({
      success: false,
      message: 'Seller account required.',
    });
  }

  if (!req.user.isVerified) {
    return res.status(403).json({
      success: false,
      message:
        'Please verify your account before managing products.',
    });
  }

  if (req.user.sellerStatus !== 'approved') {
    if (req.user.sellerStatus === 'rejected') {
      return res.status(403).json({
        success: false,
        message:
          'Your seller application has been rejected.',
      });
    }

    return res.status(403).json({
      success: false,
      message:
        'Your seller application is still under review.',
    });
  }

  next();
};

/*
 * Require either:
 * - An administrator
 * OR
 * - An approved seller
 *
 * Useful for shared management endpoints.
 */
const sellerOrAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
    });
  }

  /*
   * Admins have full access.
   */
  if (req.user.role === 'admin') {
    return next();
  }

  /*
   * Non-sellers are denied.
   */
  if (req.user.role !== 'seller') {
    return res.status(403).json({
      success: false,
      message:
        'Administrator or seller account required.',
    });
  }

  /*
   * Seller must be verified.
   */
  if (!req.user.isVerified) {
    return res.status(403).json({
      success: false,
      message:
        'Please verify your account before continuing.',
    });
  }

  /*
   * Seller must be approved.
   */
  if (req.user.sellerStatus !== 'approved') {
    return res.status(403).json({
      success: false,
      message:
        req.user.sellerStatus === 'rejected'
          ? 'Your seller application has been rejected.'
          : 'Your seller application is still under review.',
    });
  }

  next();
};

/*
 * Export middleware.
 */
module.exports = {
  protect,
  adminOnly,
  requireVerified,
  approvedSellerOnly,
  sellerOrAdmin,
};