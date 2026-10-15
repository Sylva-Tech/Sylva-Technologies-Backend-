# Sylva Technologies — Financial API Security & Cloudflare Runbook

**Scope:** customer/seller wallets, platform/admin wallet, payout requests, M-Pesa STK callbacks, Paystack order payment/webhook flows, and future financial endpoints.

This is a defence-in-depth deployment guide, not a claim that a payment system is “unhackable.” Do not enable the Cloudflare origin-secret gate until the API custom hostname and every provider callback have been moved through Cloudflare and tested in sandbox.

## 1. Security controls in the backend

The financial API middleware added in `middleware/financialSecurity.js` provides:

- **Optional Cloudflare-to-origin shared-secret gate** using `X-Sylva-Origin-Key`, compared in constant time. The secret is only read from the backend environment.
- **Application-level request limiting** on `/api/wallet`, `/api/admin-wallet`, and `/api/orders` (120 requests per client IP per 15 minutes). Existing route-specific payout/financial limits remain in place.
- **No-store response headers** for financial endpoints so browsers and intermediary caches should not retain wallet balances or transaction responses.
- The middleware is mounted before body parsing, so rejected origin requests are stopped before JSON parsing and route handlers.

The app-level limiter uses in-memory state. It is useful as a second layer on one instance, but is not a shared/distributed limiter across multiple Render instances. Cloudflare edge rate rules are required for consistent internet-facing protection.

Existing financial flows also use verified-account/admin checks, amount validation, atomic conditional updates for payout reservations, duplicate settlement checks, and MongoDB sessions for paired wallet transfers in the wallet-hardening branch. Those controls still require automated regression tests and live sandbox verification before real funds are used.

## 2. Cloudflare: put the API behind a custom hostname

Use `api.sylvatechnologies.co.ke` as the public API hostname. Keep the website frontend on `www.sylvatechnologies.co.ke`.

1. Sign in to Cloudflare and select the `sylvatechnologies.co.ke` zone.
2. In Render, open the backend service **Sylva-Technologies-Backend** → **Settings** → **Custom Domains** and add `api.sylvatechnologies.co.ke`. Follow the exact DNS target Render displays.
3. In Cloudflare **DNS → Records**, create the CNAME record using the target shown by Render. Start with **DNS only** while Render issues/validates the certificate if Render requires that; then switch to **Proxied (orange cloud)** after the custom domain is verified.
4. In Cloudflare **SSL/TLS → Overview**, select **Full (strict)**. Do not use Flexible.
5. In **SSL/TLS → Edge Certificates**, enable **Always Use HTTPS** and **Automatic HTTPS Rewrites** if compatible with the site.
6. Test `https://api.sylvatechnologies.co.ke/api/health`. It should return the API health JSON over HTTPS.
7. Update the frontend's Vercel environment variable `VITE_API_BASE_URL` to `https://api.sylvatechnologies.co.ke/api`, redeploy the frontend, and verify login, product checkout, wallet reads, and seller dashboard calls.

**Important:** a Cloudflare proxy does not by itself stop direct access to the Render `.onrender.com` hostname. The origin-secret gate below protects financial/order routes after it is enabled. If Render offers an inbound IP allowlist or private networking for this service/plan, additionally restrict origin access. Do not assume Cloudflare IP allowlisting alone is possible on every Render plan.

## 3. Enable the origin-secret gate safely

Do this only after the API hostname is proxied through Cloudflare and all external callbacks have been changed to the API hostname.

### Generate a secret

Generate a unique random secret locally (PowerShell example):

```powershell
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 32
$rng.GetBytes($bytes)
$secret = [Convert]::ToBase64String($bytes)
$rng.Dispose()
$secret
```

Copy it directly into a password manager and the two configuration screens. Never commit it to GitHub, put it in React/Vite environment variables, include it in a URL, or share it in chat/screenshots.

### Store it in Render

In Render → backend service → **Environment**, add:

- Key: `CLOUDFLARE_ORIGIN_SECRET`
- Value: the generated random secret

Save and allow the service to redeploy. Do not enable this variable until the Cloudflare rule below is active; otherwise financial/order routes will return 403.

### Add the Cloudflare request-header rule

In Cloudflare, create a **Transform Rule → Modify Request Header** (the exact menu name can vary by dashboard/plan):

- Expression: hostname equals `api.sylvatechnologies.co.ke`
- Action: **Set static header**
- Header name: `X-Sylva-Origin-Key`
- Header value: the same random secret used in Render

Apply it only to the API hostname. Do not expose the secret in response headers. Cloudflare must send the header on the API request; the browser must never send or know it. Verify that a request directly to the Render origin without the header receives **403** for financial/order paths, while the proxied API hostname works.

**Provider callback dependency:** Safaricom and Paystack must call the Cloudflare-proxied API hostname so the header rule can add the secret. Update the callback/webhook URLs in the Daraja/Paystack dashboards and backend environment to the corresponding `https://api.sylvatechnologies.co.ke/...` paths used by the code. The STK callback path currently used by the project is `/api/wallet/topup/stk/callback`; the Paystack webhook path is `/api/orders/paystack/webhook`. Confirm these exact routes against the deployed code and provider dashboards before saving. Test sandbox deposits and Paystack payments after enabling the secret.

If any provider callback must continue to call the Render hostname directly, do **not** enable the gate yet: that callback will be rejected. Do not add an unauthenticated bypass for callbacks. Use a proxied callback URL or design a separate, provider-signature-verified callback path before enabling enforcement.

## 4. Cloudflare WAF and rate-limiting rules

Under **Security → WAF → Custom Rules** and **Security → WAF → Rate limiting rules** (availability/names vary by plan), add rules in this order:

### A. Managed protections

- Enable Cloudflare Managed Rules for common web exploits.
- Enable Bot Fight Mode if available and monitor false positives.
- Set the zone to HTTPS-only.
- Do not place payment callbacks behind an interactive browser challenge; Safaricom/Paystack servers cannot solve browser challenges.

### B. Rate-limit high-risk mutation endpoints

Create separate rules for these path prefixes; scope to hostname `api.sylvatechnologies.co.ke` and HTTP method `POST`, `PATCH`, or `DELETE` as appropriate. Start with conservative limits and monitor legitimate traffic:

| Endpoint | Suggested starting limit | Action |
|---|---:|---|
| `/api/wallet/payout-request` | 5 requests / 15 min / IP | Block for the remainder of the window |
| `/api/wallet/payout-request-usd` | 5 requests / 15 min / IP | Block |
| `/api/admin-wallet/transfer-out` | 8 requests / 15 min / IP | Block and alert |
| `/api/admin-wallet/transfer-in` | 8 requests / 15 min / IP | Block |
| `/api/admin-wallet/withdrawals` | 8 requests / 15 min / IP | Block and alert |
| `/api/admin-wallet/withdrawals/*` | 8 requests / 15 min / IP | Block and alert |
| `/api/wallet/admin/payouts/*` | 8 requests / 15 min / IP | Block and alert |
| `/api/orders/paystack/webhook` | Use a higher threshold appropriate to real order volume | Rate-limit only after monitoring; never challenge |
| `/api/wallet/topup/stk/callback` | Use a higher threshold appropriate to real callback retries | Rate-limit only after monitoring; never challenge |

**Free-plan limitation:** Cloudflare currently allows one rate-limiting rule on the Free plan. Do not create the separate rules above if your dashboard only allows one. Instead, create one consolidated rule matching the most critical payout/transfer paths with a conservative shared threshold, and rely on the backend's per-instance limiter for the broader financial API. The Free-plan rate-limit expression/counting fields are more limited than paid plans, so use the dashboard expression builder to confirm which path conditions are available. Rate-limit features and counting characteristics depend on plan. These are starting values, not universal production limits. Avoid a blanket “Managed Challenge” for all POST requests: it can break checkout, wallet actions, and provider callbacks. Configure monitoring for repeated blocks or spikes.

## 5. Cloudflare settings that are not substitutes for backend security

- **CORS is not authentication.** Non-browser clients can call an API regardless of CORS.
- **A hidden URL is not protection.** Keep `protect`, `adminOnly`, account verification and role checks on every private route.
- **Cloudflare proxying is not payment verification.** Keep verifying Paystack signatures/raw body and verify M-Pesa callbacks against a pending request, expected amount, account and unique receipt/reference before crediting a wallet.
- **Do not trust frontend balances, user IDs, role fields, payment status or transaction IDs alone.** Re-read the account and validate state in MongoDB.
- **Do not store payment secrets in frontend/Vercel `VITE_*` variables.** Provider credentials belong only in Render backend environment variables.
- **Never log full secrets, authorization headers, full bank details, ID/KRA documents, or complete payment payloads.**

## 6. Render and MongoDB settings

1. Keep `JWT_SECRET`, Daraja consumer secret/passkey, Paystack secret key, `CLOUDFLARE_ORIGIN_SECRET`, database credentials and email API keys in Render **Environment** only.
2. Rotate any credential ever pasted into a public issue, source file, screenshot, or chat. Use provider dashboards to revoke old values.
3. Use separate Daraja sandbox and production credentials; keep `MPESA_ENV=sandbox` until Safaricom has approved production.
4. Use a least-privilege MongoDB Atlas database user for this app, require TLS, enable network access restrictions where feasible, and keep backups/point-in-time recovery appropriate to the business.
5. Protect the GitHub organization/account with MFA/passkeys, remove unused collaborators/tokens, review Dependabot/security alerts, and require review before merging financial code.
6. Configure Render alerts/log review. Audit financial actions with actor ID, action, amount/currency, transaction reference, timestamp, outcome and request ID—but never sensitive credentials or full payout destination details.
7. For multi-instance scaling, move rate limiting to a shared store (e.g. Redis) and keep Cloudflare edge limits as the outer layer.

## 7. Financial logic and release checklist

Before real funds are enabled, verify and test:

- [ ] A customer cannot call admin wallet routes, and a seller cannot read another account's wallet or change their own role/balance.
- [ ] A suspended/banned or unverified account cannot withdraw or transfer funds.
- [ ] Two simultaneous payout requests cannot reserve the same balance or create multiple pending requests.
- [ ] A payout decision can only process a pending transaction once; duplicate approval/rejection attempts fail without changing balances.
- [ ] Platform-to-user and user-to-platform transfers debit and credit both ledgers atomically, and concurrent transfers cannot overdraw the platform wallet.
- [ ] Duplicate M-Pesa callbacks, repeated Paystack webhooks, incorrect amounts, incorrect currency, unknown references and failed payments never credit a wallet twice.
- [ ] A client cannot change amount, destination, role, status, currency or recipient ID to bypass server validation.
- [ ] A direct Render-origin request without `X-Sylva-Origin-Key` is rejected after the gate is enabled.
- [ ] Legitimate checkout, login, wallet read, sandbox STK Push callback, Paystack webhook and admin payout review still work through Cloudflare.
- [ ] Backup/restore and transaction reconciliation procedures are documented and tested.

Run the repository tests and perform end-to-end sandbox tests before merging/deploying. The code-level rate limiter is not a substitute for the Cloudflare edge rule, and these changes do not constitute an independent penetration test or financial compliance certification.
