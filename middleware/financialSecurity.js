'use strict';

const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

/*
 * Financial endpoints can be restricted to requests that pass through
 * Cloudflare. Keep this disabled until the API custom domain is proxied
 * through Cloudflare and every payment provider callback uses that domain.
 * The secret is stored only in Render environment variables and Cloudflare
 * request-header rules; never put it in source control or the frontend.
 */
const cloudflareOriginGuard = (req, res, next) => {
  // Safaricom Daraja cannot attach our private Cloudflare origin header to
  // callbacks. Allow only this exact provider callback through the origin
  // guard; the callback handler still requires a matching pending CheckoutRequestID
  // and verifies the transaction directly with Safaricom before crediting a wallet.
  const requestPath = String(req.originalUrl || req.url || '').split('?')[0];

  // These public customer workflows are authorized by the high-entropy,
  // expiring delivery token itself. They must work when opened from email
  // without an account session or a private Cloudflare origin header.
  const isSecureDeliveryPreview =
    req.method === 'GET' &&
    /^\/api\/orders\/delivery-confirmation\/[^/]+$/.test(requestPath);
  const isSecureDeliverySubmission =
    req.method === 'POST' &&
    requestPath === '/api/orders/confirm-delivery';

  if (
    (req.method === 'POST' && requestPath === '/api/wallet/topup/stk/callback') ||
    isSecureDeliveryPreview ||
    isSecureDeliverySubmission
  ) {
    return next();
  }

  const expected = String(process.env.CLOUDFLARE_ORIGIN_SECRET || '');

  // Backward-compatible rollout: enforce only after the secret is configured.
  if (!expected) return next();

  const supplied = String(req.get('x-sylva-origin-key') || '');
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);

  const matches = expectedBuffer.length === suppliedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);

  if (!matches) {
    // Do not log supplied/expected secrets or reveal the guard configuration.
    console.warn('Financial origin guard rejected a request', {
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
    return res.status(403).json({
      success: false,
      message: 'This request could not be authorized.',
    });
  }

  return next();
};

/*
 * Edge controls in Cloudflare are the first layer; this application-level
 * limiter is a second layer. It is per-instance unless a shared store is
 * configured, so do not treat it as a replacement for Cloudflare rate rules.
 */
const financialRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many financial API requests. Please wait and try again.',
  },
  handler: (req, res, next, options) => {
    res.set('Retry-After', String(Math.ceil(options.windowMs / 1000)));
    res.status(options.statusCode).json(options.message);
  },
});

const noStoreFinancialResponses = (req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Content-Type-Options': 'nosniff',
  });
  next();
};

module.exports = {
  cloudflareOriginGuard,
  financialRateLimit,
  noStoreFinancialResponses,
};
