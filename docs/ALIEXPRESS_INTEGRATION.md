# AliExpress integration setup

## Current implementation

- Admin-only connection status, connect, refresh and disconnect endpoints under `/api/aliexpress`.
- OAuth callback is served through the existing registered frontend URL: `https://www.sylvatechnologies.co.ke/callback`. The frontend callback page forwards the authorization response to the backend callback endpoint.
- OAuth state is random, hashed before persistence, one-time and expires after ten minutes.
- Access and refresh tokens are encrypted with AES-256-GCM before MongoDB persistence.
- Supplier ordering is deliberately disabled. No AliExpress supplier payment is initiated and no customer/seller wallet ledger is modified.
- Product search/import and supplier order placement must only be added after the AliExpress app console confirms the exact approved API methods for this application.

## Backend environment variables

Set these in the backend environment (Render) and local backend `.env`:

- `ALIEXPRESS_APP_KEY`: App Key from AliExpress Developer Console.
- `ALIEXPRESS_APP_SECRET`: App Secret. Never commit or send it in chat.
- `ALIEXPRESS_REDIRECT_URI=https://www.sylvatechnologies.co.ke/callback`: must exactly match the callback currently registered in the AliExpress app.
- `ALIEXPRESS_TOKEN_ENCRYPTION_KEY`: 32 random bytes encoded as 64 hexadecimal characters. Generate locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep it private and back it up securely; changing it makes previously encrypted tokens unreadable.
- `FRONTEND_URL=https://www.sylvatechnologies.co.ke`.

Do not use the frontend Vite environment for the App Secret or token encryption key.

## OAuth/API notes

The implementation uses the AliExpress Open Platform overseas OAuth authorization host and the documented signed `/auth/token/create` and `/auth/token/refresh` API paths. API requests are signed using HMAC-SHA256. Confirm that the app's current API permission includes the token methods before attempting a live authorization.

AliExpress documentation:
- Seller authorization: https://developer.alibaba.com/docs/doc.htm?articleId=120687&docType=1&treeId=727
- API endpoint: https://developer.alibaba.com/docs/doc.htm?articleId=120689&docType=1&treeId=727
- Signature algorithm: https://developer.alibaba.com/docs/doc.htm?articleId=120692&docType=1&treeId=727

## Local checks

Run `npm test` and `node --check app.js`, `node --check routes/aliexpressRoutes.js`, `node --check services/aliexpressService.js`, `node --check models/AliExpressConnection.js`, and `node --check models/AliExpressOAuthState.js` in the backend directory.

Do not deploy or enable supplier ordering until these checks pass and a real authorized test account has completed OAuth successfully.
