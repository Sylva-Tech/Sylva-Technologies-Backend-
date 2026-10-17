# Sylva Technologies Backend

Production-ready Node.js/Express/MongoDB API for the Sylva Technologies e-commerce application.

## Features
- Secure customer registration and login
- Email/SMS-based verification flow
- JWT authentication with protected routes
- Password reset flow
- Verified-only checkout
- Order creation, customer history, and admin status updates
- Email templates for verification, password reset, order confirmation, and admin notifications
- Rate limiting, Helmet hardening, CORS, and centralized error handling

## Requirements
- Node.js 18+
- MongoDB Atlas or local MongoDB instance
- SMTP email credentials
- Optional SMS provider configuration

## Installation
1. Open the backend folder.
2. Copy `.env.example` to `.env`.
3. Fill in your values.
4. Install dependencies:

```bash
npm install
```

## Environment variables
Required values include:

```env
PORT=5000
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/sylva_technologies
JWT_SECRET=replace_with_secure_secret
JWT_EXPIRES_IN=7d
CLIENT_URL=http://localhost:5173
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=you@example.com
EMAIL_PASSWORD=your_password
EMAIL_FROM=you@example.com
ADMIN_EMAIL=admin@sylvatechnologies.com
SMS_PROVIDER=twilio
SMS_API_KEY=your_api_key
SMS_USERNAME=your_username
SMS_SENDER_ID=SYLVA
OTP_EXPIRY_MINUTES=10
RESEND_COOLDOWN_MINUTES=1
MAX_OTP_ATTEMPTS=5
MAX_OTP_REQUESTS=3
```

## Sylva Mail encryption

Sylva Mail encrypts message subjects, bodies, HTML content, support replies, and stored attachments at rest using AES-256-GCM. The master key is configured through `MAIL_ATTACHMENT_ENCRYPTION_KEY`; message content uses a purpose-specific key derived from that master key. The key is not stored in MongoDB or committed to Git.

Generate a new key locally with Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add the generated 64-character hexadecimal value as `MAIL_ATTACHMENT_ENCRYPTION_KEY` in the Render backend environment. Keep the same key across deployments, restrict access to it, and keep a secure backup. Losing or changing the key without a planned re-encryption process makes encrypted message content and attachments unreadable. Never paste the real key into source control, chat, or logs.

After deploying the backend with the key configured, open **Admin → Sylva Mail** and run **Encrypt legacy messages** and **Encrypt legacy attachments** repeatedly until both migrations report zero remaining records. Take a database backup first. New message bodies and locally stored attachments are encrypted before being persisted. Inbound provider attachments are imported into encrypted storage before download links are returned to the browser.

This is encryption at rest, not end-to-end encryption: outbound email is sent to the email provider in order to deliver it, and recipients' mail systems can process the message in plaintext. End-to-end encryption requires a separate recipient-key and client-side encryption design.

## Run locally
```bash
npm run dev
```

Production:
```bash
npm start
```

## API summary
- `POST /api/auth/register`
- `POST /api/auth/verify`
- `POST /api/auth/resend-verification`
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/products`
- `GET /api/products/:id`
- `GET /api/products/slug/:slug`
- `GET /api/orders/my-orders`
- `POST /api/orders`
- `GET /api/orders/:id`
- `GET /api/orders` (admin)
- `PUT /api/orders/:id/status` (admin)

## Auth flow
- Customer registers with name, email, phone, password, confirm password, and verification preference.
- The backend validates duplicates and creates the user as unverified.
- A 6-digit OTP is generated and sent via email or SMS.
- The customer verifies before checkout is allowed.
- Login is blocked for unverified accounts.

## Order flow
1. Customer logs in and must be verified.
2. Product catalog is fetched from `/api/products`.
3. Customer creates order via `/api/orders`.
4. Price is recalculated from current product records and snapshotted into the order.
5. Confirmation email is sent to the customer.
6. Admin is notified via email for the new order.
7. Admin updates status using `/api/orders/:id/status`.

## Admin functionality
Admin users must be authenticated and authorized through the backend. Role verification happens on the server; the frontend should not be trusted for administration.

## Testing
Run `npm test` for the message/attachment encryption round-trip and tamper-detection tests. The CI workflow also syntax-checks backend JavaScript. Full runtime flow tests require a reachable MongoDB instance and correctly configured email/SMS credentials. When the database is available, the following flow should be verified:
- Registration
- Email/SMS verification
- Login
- Unverified login rejection
- Forgot/reset password
- Profile retrieval
- Product listing
- Order creation
- Order email notifications
- Admin status changes

## Notes
- Secrets are stored in `.env` and ignored by Git.
- The app intentionally keeps API responses in a consistent `{ success, message, data }` envelope.
- SMS support is abstracted and will work when `SMS_PROVIDER` and related env vars are configured.


## International seller USD wallet (PayPal)

- International sellers have a separate USD wallet ledger; it is not combined with the KES wallet.
- Set `PAYPAL_MODE=sandbox` for initial testing. The default API host is PayPal sandbox unless `PAYPAL_MODE=live` is explicitly configured.
- Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `FRONTEND_URL` in the Render environment. Never commit real credentials.
- PayPal deposit flow: the backend creates the order and a pending ledger entry; after the seller returns from PayPal, the backend captures the order, verifies the owner, completed capture, USD currency and exact amount, then credits the USD balance idempotently.
- USD withdrawal requests are reserved from available USD and added to the admin payout queue. They are **not automatic PayPal payouts**; an administrator must send the external payout and only then mark it paid.
- Current checkout/payment confirmation is KES-only. For international sellers, net seller earnings are settled into USD after the platform commission is calculated in the order currency. Set `WALLET_KES_PER_USD` to a finance-approved KES-per-USD rate before accepting/settling international seller orders. If the rate is absent or invalid, the backend intentionally does not guess or credit a converted amount.
- Seller identity status is marked verified only when an administrator approves the seller after reviewing the required ID-front, ID-back and tax-document uploads. This is manual review, not an automatic third-party identity-provider integration.
- Do not switch PayPal to live mode until sandbox deposits, duplicate-capture attempts, payout reservation/rejection, and transaction history have been tested.

