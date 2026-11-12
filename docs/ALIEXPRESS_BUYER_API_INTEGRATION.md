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

The UI should therefore treat a successful provider response as proof only for that specific read operation. It is not proof that order placement or supplier payment is available.

## Supplier order boundary

Supplier order placement, payment, cancellation/refund and automated tracking synchronization are intentionally not enabled by this change. Before enabling those actions, verify current production support and test the full order/payment lifecycle. A retry must never create a second supplier purchase.

## Required environment

Keep the existing backend-only settings:

- `ALIEXPRESS_APP_KEY`
- `ALIEXPRESS_APP_SECRET`
- `ALIEXPRESS_REDIRECT_URI`
- `ALIEXPRESS_TOKEN_ENCRYPTION_KEY`

Never place secrets or access tokens in Vite/frontend variables or browser code.

## Admin verification

1. Ensure the account joined the AliExpress Dropshipping Center.
2. Connect the buyer account in the existing OAuth flow.
3. Confirm the stored platform is `buyerApp` in Supplier Centre.
4. Run a small catalogue sync (page size 1–5).
5. Inspect the provider response and API access log in AliExpress Open Platform.
6. Confirm products appear in the private review queue only.

Official references:
- https://developer.alibaba.com/docs/doc.htm?articleId=120418&docType=1&treeId=762
- https://developer.alibaba.com/docs/api.htm?apiId=60452
