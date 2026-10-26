# Sylva Technologies Security Operations Checklist

This checklist complements application-level controls. A passing test suite is not a security certification.

## Database access
- [ ] In MongoDB Atlas, create a dedicated production database user for the backend only; do not use the Atlas account owner or an unrestricted admin user from the app.
- [ ] Grant only the database roles needed by the application on the Sylva production database.
- [ ] Restrict Atlas Network Access to the backend's stable outbound IPs where the hosting plan supports them. Do not leave broad public access enabled as a permanent shortcut.
- [ ] Keep the MongoDB URI only in the backend hosting provider's secret environment settings. Never place it in frontend variables, commits, logs, support messages, or screenshots.
- [ ] Enable automated backups / point-in-time recovery where available and periodically test a restore.

## Runtime secrets and accounts
- [ ] Use a unique, high-entropy JWT secret (at least 32 random bytes); rotate it if it was ever committed, logged, or shared.
- [ ] Keep Pesapal, M-Pesa, Resend, Cloudinary, and other provider secrets in backend-only secret settings.
- [ ] Enable MFA for GitHub, hosting, Cloudflare, MongoDB Atlas, and payment-provider dashboards.
- [ ] Review repository collaborators and remove unused accounts/tokens. Prefer least-privilege access and protected main branch rules.

## Cloudflare / edge protection
- [ ] Enable managed WAF rules and bot protection for the public API hostname.
- [ ] Add rate rules for /api/auth/*, /api/wallet/*, /api/admin-wallet/*, /api/orders/*, and identity-lookup endpoints. Tune limits to avoid blocking legitimate checkout and payment callbacks.
- [ ] Do not enable an origin-secret requirement for payment callbacks until each provider callback path has a tested, authenticated exception or equivalent provider verification.
- [ ] Ensure the API hostname is proxied and TLS mode is Full (strict), and that the origin cannot be reached through an unintended public hostname.

## Application / payment safety
- [ ] Keep administrator routes protected by both authentication and administrator authorization; keep seller routes scoped to products/orders owned by the authenticated seller.
- [ ] Verify every payment server-side with the payment provider. Never credit a wallet or mark an order paid based only on a browser redirect or client-supplied status.
- [ ] Test duplicate callbacks, duplicate verification, failed/cancelled payments, amount/currency mismatches, and idempotency before production payment changes.
- [ ] Review logs for secrets, passwords, access tokens, full identity documents, and payment credentials; redact sensitive data.
- [ ] Review npm audit results and update dependencies deliberately, with regression tests.

## Current code controls
- MongoDB operator/path-key rejection is applied before API route handlers.
- Mongoose sanitizeFilter and strictQuery are enabled.
- Helmet security headers, CORS allowlisting, general API rate limiting, login throttling, and financial endpoint controls are configured in the application.
- Request body limits are bounded while preserving the encrypted mailbox attachment workflow.
- The server refuses to start when the database URI is missing.

## Important limitation
No single middleware can guarantee that attackers can never reach data. Authorization bugs, stolen credentials, exposed secrets, unsafe database permissions, compromised hosting accounts, and business-logic flaws require separate controls and ongoing review.
