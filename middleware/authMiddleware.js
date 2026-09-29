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
 * Get the appropriate restriction message for a seller.
 */
const getSellerRestrictionMessage = (user) => {
  if (user.accountStatus === 'suspended') {
    return (
      user.suspensionReason ||
      'Your seller account is currently suspended.'
    );
  }

  if (user.accountStatus === 'banned') {
    return (
      user.banReason ||
      'Your seller account is currently banned.'
    );
  }

  return null;
};

/*
 * Require an active approved seller.
 *
 * Seller lifecycle:
 *
 * pending   -> cannot manage products
 * rejected  -> cannot manage products
 * approved  -> can manage products
 *
 * Account status:
 *
 * active     -> allowed
 * warning    -> allowed
 * suspended  -> blocked
 * banned     -> blocked
 *
 * IMPORTANT:
 * Suspended and banned sellers are still allowed to LOG IN.
 * This middleware only blocks seller operations.
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

  /*
   * Seller application must be approved.
   */
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

  /*
   * Account-level restrictions.
   *
   * WARNING is intentionally allowed.
   */
  if (
    req.user.accountStatus === 'suspended' ||
    req.user.accountStatus === 'banned'
  ) {
    const restrictionMessage =
      getSellerRestrictionMessage(req.user);

    return res.status(403).json({
      success: false,
      restricted: true,
      accountStatus: req.user.accountStatus,
      message: restrictionMessage,
    });
  }

  /*
   * Only active and warning sellers can operate.
   */
  if (
    req.user.accountStatus !== 'active' &&
    req.user.accountStatus !== 'warning'
  ) {
    return res.status(403).json({
      success: false,
      restricted: true,
      accountStatus: req.user.accountStatus,
      message:
        'Your seller account is not currently active.',
    });
  }

  next();
};

/*
 * Require either:
 * - An administrator
 * OR
 * - An active approved seller
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

  /*
   * WARNING does NOT restrict seller operations.
   */
  if (
    req.user.accountStatus === 'suspended' ||
    req.user.accountStatus === 'banned'
  ) {
    const restrictionMessage =
      getSellerRestrictionMessage(req.user);

    return res.status(403).json({
      success: false,
      restricted: true,
      accountStatus: req.user.accountStatus,
      message: restrictionMessage,
    });
  }

  /*
   * Only active and warning sellers can operate.
   */
  if (
    req.user.accountStatus !== 'active' &&
    req.user.accountStatus !== 'warning'
  ) {
    return res.status(403).json({
      success: false,
      restricted: true,
      accountStatus: req.user.accountStatus,
      message:
        'Your seller account is not currently active.',
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