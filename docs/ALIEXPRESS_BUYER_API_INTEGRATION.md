# AliExpress buyer Dropshipping API integration

## What is implemented

The backend now has a separate buyer-account route mounted before the older Seller Center integration:

- `GET /api/aliexpress/status` reports whether the saved authorization is identified as `buyerApp`.
- `POST /api/aliexpress/catalog/sync` calls `aliexpress.ds.recommend.feed.get` using the encrypted buyer access token and saves returned items into the private `AliExpressCatalogProduct` review collection.
- The sync endpoint is admin-only, rate-limited, validates feed parameters, sanitizes supplier URLs, and never publishes products to the storefront.
- Expiring buyer tokens are refreshed server-side and re-encrypted before use.
- Seller Center OAuth sessions are rejected by the buyer API route and are never reused for Dropshipping calls.

## Important compatibility warning

AliExpress's official developer documentation labels the legacy Dropshipping guide deprecated. The documented TOP endpoint/method may still be callable for an existing application, but this repository cannot establish provider-side availability without a real request using the account's live authorization.

The UI must not imply that separate environment variables make a deprecated API available. The live provider previously returned `isv.appkey-not-exists` for the AppKey shown in App Overview, while IOP OAuth token creation/refresh returned code 0. Therefore the legacy catalogue call is gated by `ALIEXPRESS_LEGACY_DROPSHIP_API_CONFIRMED=true`, which must only be enabled after AliExpress confirms in writing that this app is provisioned for the legacy TOP gateway or supplies a supported replacement API. The default is disabled. A successful provider response proves only that specific read operation, not supplier order placement or payment.

## Supplier order boundary

Supplier order placement, payment, cancellation/refund and automated tracking synchronization are intentionally not enabled by this change. Before enabling those actions, verify current production support and test the full order/payment lifecycle. A retry must never create a second supplier purchase.

## Required environment

Keep the existing backend-only settings:

- `ALIEXPRESS_APP_KEY` — IOP OAuth application key
- `ALIEXPRESS_APP_SECRET` — IOP OAuth application secret
- `ALIEXPRESS_REDIRECT_URI`
- `ALIEXPRESS_TOKEN_ENCRYPTION_KEY`
- `ALIEXPRESS_DS_APP_KEY` — App Key provisioned for the legacy Dropshipping/TOP gateway
- `ALIEXPRESS_DS_APP_SECRET` — matching Dropshipping/TOP App Secret
- `ALIEXPRESS_LEGACY_DROPSHIP_API_CONFIRMED=false` — safety gate; only set to `true` after AliExpress confirms support/provisioning for App ID 40465

Never place secrets or access tokens in Vite/frontend variables or browser code. The DS/TOP variables are separate configuration slots so the gateway credentials can be managed independently from IOP OAuth. If AliExpress confirms that the same App Key and App Secret apply to both protocols, the same values may be entered in both pairs. Do not invent a second key or secret. The current provider response `isv.appkey-not-exists` means the TOP gateway does not recognize the key being sent; if the App Overview key is confirmed to be the correct key, the application may not be provisioned for that legacy gateway/method. The official legacy Dropshipping guide is marked deprecated; separate configuration does not make that API supported if AliExpress has withdrawn it.

## Admin verification

1. Ensure the account joined the AliExpress Dropshipping Center.
2. Connect the buyer account in the existing OAuth flow.
3. Confirm the stored platform is `buyerApp` in Supplier Centre.
4. Obtain written confirmation from AliExpress that App ID 40465 is provisioned for the legacy TOP Dropshipping API, or obtain the currently supported replacement API specification.
5. Only after confirmation, configure the matching server-side credentials and set `ALIEXPRESS_LEGACY_DROPSHIP_API_CONFIRMED=true`.
6. Run a small catalogue sync (page size 1–5).
7. Inspect the provider response and API access log in AliExpress Open Platform.
8. Confirm products appear in the private review queue only.

Official references:
- https://developer.alibaba.com/docs/doc.htm?articleId=120418&docType=1&treeId=762
- https://developer.alibaba.com/docs/api.htm?apiId=60452


## Authentication boundary note

The buyer catalogue router is mounted before the older OAuth routes. Admin JWT protection is therefore applied only to its own status and catalogue endpoints, not as router-wide middleware. This allows the browser's AliExpress OAuth callback to reach the callback handler without weakening admin protection on status or catalogue operations.

## Current provider blocker

The official documentation labels the legacy Dropshipping guide deprecated and says Dropshipping APIs are only for users who have joined the Dropshipping Center. The public feed method documentation still specifies the TOP gateway. Sylva's IOP OAuth logs show successful token creation/refresh, but the legacy gateway previously returned `isv.appkey-not-exists` for the AppKey displayed by App Overview. This is a provider-side compatibility/provisioning issue, not a reason to invent a second key.
