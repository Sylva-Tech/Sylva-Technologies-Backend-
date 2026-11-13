# AliExpress Open Platform integration

## Current implementation

Sylva uses the existing AliExpress Open Platform application (App ID 40465) and its IOP OAuth flow:

- OAuth authorization, token exchange and refresh use the IOP REST host `https://api-sg.aliexpress.com/rest`.
- App credentials and the exact registered callback are read only by the backend.
- Access and refresh tokens are encrypted at rest with AES-256-GCM.
- The buyer-account connection and the older Seller Center connection remain distinct authorization contexts.
- Admin status reports OAuth connectivity separately from supplier-catalogue API authorization.
- Supplier catalogue sync and supplier ordering are disabled until AliExpress confirms a currently supported API method and grants the required API permission to this existing app.

## Why catalogue calls are blocked

The legacy Dropshipping/TOP documentation is explicitly marked deprecated. The prior live request to the legacy TOP gateway returned `isv.appkey-not-exists`, while IOP OAuth token creation and refresh succeeded. These results establish that OAuth connectivity is working; they do not establish supplier-catalogue access.

The backend therefore fails closed for the old TOP transport. No environment flag, copied credentials, or extra TOP AppKey can reactivate it. Do not create a second AppKey. Do not configure `ALIEXPRESS_DS_APP_KEY` or `ALIEXPRESS_DS_APP_SECRET`; those variables are no longer part of the supported configuration.

The newer Open Platform documentation describes application categories, API permission groups and seller product-management APIs. A seller's own product-list endpoint is not automatically a marketplace supplier-catalogue search endpoint. Sylva must not substitute one for the other.

## Configure the existing app in AliExpress Open Platform

Sign in to the Open Platform using the account that owns the existing Sylva Technologies app. Do not create another app.

1. Open the existing app with App ID 40465 and verify its status is Online.
2. Confirm the callback URL exactly matches the backend value of `ALIEXPRESS_REDIRECT_URI` (currently the registered callback is `https://www.sylvatechnologies.co.ke/callback`; do not change it unless the app console and backend are updated together).
3. Open **App Overview → API Permission Group**.
4. Inspect each permission group and its API list. Record the exact group name, status, and method names relevant to:
   - public/supplier product search or recommended supplier feed;
   - supplier product detail, SKU, price and inventory;
   - shipping-to-country availability and shipping-cost quote.
5. Apply for the group that explicitly documents supplier/dropshipper catalogue access, if it is available. In the application reason, describe Sylva as a Kenya-focused ecommerce retailer that needs read-only supplier product discovery, product details, SKU/price/stock and Kenya shipping information for manual admin review. Do not request supplier order placement yet.
6. If no such permission group or method is listed, open an AliExpress support ticket against App ID 40465 and request written confirmation of the supported replacement for the deprecated TOP Dropshipping APIs, including the exact method names, REST host/path, signing/authentication requirements, required buyer authorization context, permission group, and whether Kenya is a supported ship-to country.
7. Do not change credentials or try the legacy TOP gateway while awaiting the answer.

AliExpress's documented permission workflow is to open App Overview, inspect API Permission Groups, open the relevant group to view its API list, and use Apply to request the permission. A group must be Active before the application can invoke its APIs.

## Backend environment

Keep the existing IOP credentials already issued for App ID 40465:

- `ALIEXPRESS_APP_KEY` — existing App Key from this app
- `ALIEXPRESS_APP_SECRET` — matching App Secret from this app
- `ALIEXPRESS_REDIRECT_URI` — exact callback registered in the app console
- `ALIEXPRESS_TOKEN_ENCRYPTION_KEY` — unique 32-byte hexadecimal key used to encrypt stored OAuth tokens

These are backend-only settings. Never put App Secret, access tokens, refresh tokens or authorization codes in Vite variables, frontend code, Git commits, screenshots or chat. Do not rotate or replace the existing App Key as part of this work.

The App Key and App Secret are obtained from the existing app's App Overview; they are not a second pair to be created for the legacy TOP gateway. The backend environment must use the exact existing pair.

## Backend behaviour until AliExpress confirms the API

- `GET /api/aliexpress/status` can report OAuth connection state, but `catalogSyncEnabled` remains false and `iopCatalogApiVerified` remains false.
- `POST /api/aliexpress/catalog/sync` returns HTTP 503 with `ALIEXPRESS_CATALOG_API_NOT_PROVISIONED`; it does not call the deprecated TOP gateway.
- Existing OAuth connect/refresh functionality remains available.
- Supplier order placement, supplier payments, cancellation/refund and automated supplier tracking remain disabled.

## Enablement checklist after AliExpress replies

Only after receiving written confirmation and the current API specification:

1. Verify the API is part of the current IOP platform and explicitly granted to App ID 40465.
2. Implement a dedicated IOP catalogue adapter using the exact documented host, path, signature, parameters and buyer authorization context.
3. Add unit tests for request signing, response parsing, pagination, country/currency handling and provider error mapping.
4. Run a read-only sync of 1–5 products into the private review queue; do not publish products automatically.
5. Verify Kenya shipping data and supplier price/SKU/stock accuracy.
6. Keep supplier order placement disabled until its API permission, payment flow, idempotency, cancellation/refund and tracking lifecycle are independently verified.

## Official references

- New Open Platform announcement: https://developer.alibaba.com/docs/doc.htm?articleId=121124&docType=1&treeId=556
- Open Platform API permission request process: https://developer.alibaba.com/docs/doc.htm?articleId=120676&docType=1&treeId=727
- Open Platform application categories: https://developer.alibaba.com/docs/doc.htm?articleId=120674&docType=1&treeId=727
- Deprecated legacy Dropshipping documentation: https://developer.alibaba.com/docs/doc.htm?articleId=120418&docType=1&treeId=762
