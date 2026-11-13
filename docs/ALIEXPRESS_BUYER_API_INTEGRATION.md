# AliExpress Open Platform integration

## Current implementation

Sylva uses the existing AliExpress Open Platform application (App ID 40465) and its IOP OAuth flow:

- OAuth authorization, token exchange and refresh use the IOP REST host `https://api-sg.aliexpress.com/rest`.
- App credentials and the exact registered callback are read only by the backend.
- Access and refresh tokens are encrypted at rest with AES-256-GCM.
- The buyer-account connection and the older Seller Center connection remain distinct authorization contexts.
- Admin status reports OAuth connectivity separately from supplier-catalogue API authorization.
- Supplier catalogue sync and supplier ordering are disabled until AliExpress confirms a currently supported API method and grants the required API permission to this existing app.

## Newly located DropShippers API Developer menu (13 November 2026)

The Open Platform console navigation for the existing account now visibly exposes **DropShippers API Developer** with these sections:

- **Quick Start** and **Authentication**.
- **Product API**: `aliexpress.ds.product.get`, `aliexpress.ds.feed.itemids.get`, and `aliexpress.ds.feedname.get`.
- **Payment**: `aliexpress.ds.member.benefit.get`.
- **Freight API**, **Order API**, **Search API**, **Webhook**, **FAQ**, **Appendix**, and **Changelog For DropShip API**.

This is a useful, concrete discovery and supersedes the earlier assumption that the Dropshipper documentation area was not visible. It does **not yet prove** that these methods are callable by App ID 40465: the screenshot shows the navigation/menu, not each method's full specification, assigned permission, request host/path, signature scheme, required parameters, or a successful live response. The menu displays a latest documentation update of 2024-03-29; confirm that the method pages still describe the currently supported production contract before enabling calls.

### Method-by-method integration plan

| Documentation entry | Intended Sylva use | Current implementation decision |
| --- | --- | --- |
| `aliexpress.ds.product.get` | Read product detail, SKU/variant and product attributes after a product ID is known | Candidate read-only detail method; do not call until its full current IOP request specification and App 40465 permission are verified |
| `aliexpress.ds.feed.itemids.get` | Discover product IDs from a feed | Candidate feed discovery method; verify feed identifiers, pagination, country/currency support and response shape |
| `aliexpress.ds.feedname.get` | List available feed names | Candidate feed metadata method; verify exact parameters and authorization |
| Search API section | Search supplier products by keyword/category | Inspect the section for exact method names; do not infer or substitute affiliate search methods |
| Freight API section | Quote delivery options/cost to Kenya (KE) | Inspect exact method and supported destination coverage before using shipping costs in checkout |
| Order API section | Create and query supplier orders, cancellation and tracking | Keep supplier ordering disabled until all create/query/cancel/refund/tracking and idempotency requirements are verified |
| `aliexpress.ds.member.benefit.get` (Payment section) | Retrieve member benefit/eligibility information, subject to its documented response | **Not a supplier payment/checkout method.** Do not use it to charge a supplier, fund an order, or move Sylva wallet balances |

The Payment section currently exposes only the member-benefit method in the menu provided. Sylva must keep its customer payment collection (M-Pesa/PayPal), platform admin wallet, seller KES/USD wallets, and supplier-side payment lifecycle separate. No supplier payment API has been established by this menu entry.

### Next documentation pages required before coding live calls

Open each visible method/section in the DropShippers API Developer navigation and capture its full page, especially:

1. **Authentication** and **Quick Start**: gateway/base URL, token type, signing algorithm, timestamp format, required headers/parameters, and whether the IOP buyerApp OAuth token from the existing app is accepted.
2. **Product API** pages for all three named methods: exact input schema, output schema, pagination, image URLs, SKU/stock/prices, country/currency/language fields, and error codes.
3. **Search API**: exact search method name and query/filter/page parameters.
4. **Freight API**: exact freight quote method, destination country/postcode requirements, currency and shipping-service response.
5. **Order API**: exact order creation, order detail, payment, cancellation/refund and tracking methods, plus idempotency and buyer authorization rules.
6. **Payment**: the complete `aliexpress.ds.member.benefit.get` specification and an explicit confirmation from AliExpress whether a separate supplier-payment API exists and is enabled for App ID 40465.
7. **Webhook**: event names, signature verification, retry policy and callback registration requirements.

Do not paste secrets, access/refresh tokens, authorization codes, or signed request URLs into screenshots or tickets. Once these pages are available, record their exact specs here and implement only the verified methods in a dedicated IOP Dropship adapter. Keep catalogue sync in the private review queue and keep supplier ordering/payment disabled until separately proven.

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
5. **Do not click Apply for AliExpress-dropship while it is already Active.** AliExpress defines Active as available to the app by default or already applied.
6. If the **AliExpress-dropship** row/name does not open, use the documented alternative: open the Open Platform **API Reference** from the documentation navigation (or the console's API Reference/API List), search the exact API method names, and record each method's category, gateway, authentication type and permission requirement. Do not treat the non-responsive row as evidence that the permission is missing.
7. If API Reference also fails to load, use the Open Platform **Support Center / feedback** route from the console or documentation and submit the request below. Include App ID 40465 and a screenshot of the Active group row, but never include the App Secret, access token, refresh token or authorization code.
8. Request written confirmation of the currently supported IOP replacement for the deprecated TOP Dropshipping APIs. Ask AliExpress to identify the exact read-only supplier catalogue search/feed, product detail, SKU/price/stock and Kenya shipping methods; the exact REST host/path; signing/authentication requirements; buyer authorization context; required permission group; and whether App ID 40465 is provisioned for those methods.
9. Do not change credentials, create another AppKey, or try the legacy TOP gateway while awaiting the answer.

**Permission assignment for Sylva:** the existing `AliExpress-dropship` group is already Active, so no additional group application is indicated by the status. No individual API method can safely be assigned in backend code until the API Reference or AliExpress support confirms its exact current method name and permission mapping. The legacy Dropshipping pages are explicitly deprecated and are not a valid source for assigning a new IOP method.

AliExpress's documented permission workflow says Active means the group is available to the app by default or has been applied; the group name normally opens its API list, and API Reference is the documented alternative. Apply is for a group that requires a separate request—not an already Active group.

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


## Independent API research update (13 November 2026)

This section records public technical evidence gathered independently of AliExpress support. It is deliberately separated from provider-confirmed capability.

### Evidence matrix

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Official AliExpress/Alibaba API reference for `aliexpress.ds.product.get` | The method exists in the public AE-Dropshipper catalogue and its displayed request gateway is `https://eco.taobao.com/router/rest`, with TOP parameters such as `method`, `session`, `v` and `sign`. | It does not establish that this deprecated TOP route is supported for App ID 40465. |
| Official legacy Dropshipping guide | The documentation tree is explicitly labelled **Dropshipping (deprecated)**. | It cannot be treated as a current IOP REST contract. |
| Official IOP developer guide | The overseas IOP REST base is `https://api-sg.aliexpress.com/rest`; the IOP request signing model is path-prefixed HMAC-SHA256. | It does not list the new DropShippers menu's product/feed/search methods as IOP REST paths. |
| Third-party 2026/2025 implementation notes | A separate implementation reports `aliexpress.ds.text.search`, `aliexpress.ds.image.search`, and `aliexpress.ds.product.get` using `https://api-sg.aliexpress.com/sync` and TOP-style method parameters/signing. | It is not an AliExpress source and cannot prove current provider support, method entitlement, or compatibility with this app's OAuth tokens. |

### Important protocol distinction

Do not confuse these three URLs/protocols:

- IOP OAuth and REST base: `https://api-sg.aliexpress.com/rest`.
- Third-party reported Dropship sync endpoint: `https://api-sg.aliexpress.com/sync` (unverified for Sylva; do not call from production).
- Legacy documented TOP router: `https://eco.taobao.com/router/rest` (deprecated and previously returned `isv.appkey-not-exists` for the attempted Sylva request).

A method name appearing in the console navigation, a valid OAuth token, or a third-party implementation is not proof that the method is enabled for App ID 40465.

### Candidate read-only methods discovered

The third-party implementation describes:

- `aliexpress.ds.text.search`: keyword search with `keyword`, `countryCode`, `currency`, `local`, optional `page_size`, `page_index` and `sort`.
- `aliexpress.ds.image.search`: image-based search using multipart image bytes.
- `aliexpress.ds.product.get`: product detail lookup by product ID and ship-to country.

The console navigation separately showed:

- `aliexpress.ds.product.get`
- `aliexpress.ds.feed.itemids.get`
- `aliexpress.ds.feedname.get`
- Search API, Freight API, Order API, Payment and Webhook sections.

The console's visible navigation and third-party notes do not supply the full authoritative request schema for the new feed methods. In particular, do not infer that `feed.itemids.get` and `feedname.get` use the same protocol as the third-party `/sync` implementation.

### Next engineering action

Use the API test facility in the existing AliExpress app console (App ID 40465) against the exact method shown in the new DropShippers API Developer documentation. The first test should be read-only and should capture:

1. The exact API method name and documentation page.
2. The endpoint URL/path shown by that page.
3. The exact required parameter names and signature method.
4. The API test result, including provider error code and request ID (redact tokens, signatures and secrets).
5. The permission group shown for the method.

If the console test succeeds, implement that exact contract in a dedicated adapter and add mocked signing/response tests. If the API test returns an entitlement error, retain the current fail-closed state and use the provider error code to identify the missing permission. Do not switch to the third-party `/sync` protocol or the deprecated TOP router as a workaround.

### Research references

- Official AE-Dropshipper method listing and legacy TOP gateway: https://developer.alibaba.com/docs/api.htm?apiId=60452
- Official deprecated Dropshipping guide: https://developer.alibaba.com/docs/doc.htm?articleId=120418&docType=1&treeId=762
- Official IOP endpoint documentation: https://developer.alibaba.com/docs/doc.htm?articleId=120689&docType=1&treeId=727
- Third-party Dropship API implementation notes (non-authoritative): https://github.com/wuTims/shopping-assistant/blob/main/docs/aliexpress-api.md
- Third-party IOP/TOP protocol distinction notes (non-authoritative): https://github.com/minijy/aliexpress-open-platform-skill/blob/main/references/onboarding-auth.md


## New DropShippers API QPS page supplied by the application owner (13 November 2026)

The Sylva owner supplied the contents of the **openservice.aliexpress.com → Developer Guide → DropShippers API Developer → Quick Start → API QPS** page. The page reports a latest update of **2024-08-19 18:03:47** and explicitly lists these method quotas:

| Method | Published QPS |
| --- | ---: |
| `aliexpress.ds.product.get` | 500 |
| `aliexpress.trade.buy.placeorder` | 150 |
| `aliexpress.ds.order.create` | 150 |
| `aliexpress.trade.ds.order.get` | 1,000 |
| `aliexpress.ds.freight.query` | 350 |
| `aliexpress.ds.image.search` | 15 |
| `aliexpress.ds.order.tracking.get` | 100 |
| `aliexpress.ds.address.get` | 4 |
| `aliexpress.ds.category.get` | 1,000 |
| `aliexpress.ds.feed.itemids.get` | 3 |
| `aliexpress.ds.feedname.get` | 1,000 |
| `aliexpress.ds.recommend.feed.get` | 1,000 |

The QPS page is useful first-party evidence that AliExpress's DropShippers Developer Guide advertises these method names and published quotas. It is stronger than an undocumented third-party method list. It is not, by itself, a request specification or proof that App ID 40465 has per-method authorization.

### Updated interpretation: do not conflate documentation sections

There are at least two documentation surfaces that must be kept distinct:

1. The **openservice DropShippers API Developer** guide visible to the owner, with Authentication, Product API, Payment, Freight API, Order API, Search API, Webhook and the QPS inventory above.
2. The separately indexed older Alibaba TOP API reference, whose legacy Dropshipping section is marked deprecated and whose `aliexpress.ds.product.get` page documents the old `eco.taobao.com/router/rest` gateway.

The older TOP reference must not be used to assume that the newer DropShippers guide uses the same gateway, request format, signing rules or authorization token semantics. Conversely, the QPS list alone does not prove that the newer guide uses IOP `/rest` or a specific `/sync` route.

### Candidate API integration inventory (from the owner's QPS page)

Catalogue discovery:
- `aliexpress.ds.feedname.get` (feed names)
- `aliexpress.ds.feed.itemids.get` (feed item IDs)
- `aliexpress.ds.recommend.feed.get` (recommended feed)
- `aliexpress.ds.category.get` (categories)
- `aliexpress.ds.image.search` (image search)
- `aliexpress.ds.product.get` (product details)

Shipping and order lifecycle (not to be activated yet):
- `aliexpress.ds.freight.query`
- `aliexpress.ds.address.get`
- `aliexpress.ds.order.create`
- `aliexpress.trade.buy.placeorder`
- `aliexpress.trade.ds.order.get`
- `aliexpress.ds.order.tracking.get`

The published quotas must be enforced per method if/when the API is enabled. In particular, feed item ID retrieval is limited to 3 QPS and address retrieval to 4 QPS according to the supplied page. Use conservative throttling below those published ceilings and retry only idempotent reads with bounded backoff.

### What is still needed to implement a real catalogue client

Read the **Authentication** page and individual **Product API**, **Search API** and **Freight API** method pages in the same openservice guide. Capture their exact:
- Base URL and path / gateway.
- Signature algorithm, canonical parameter ordering, encoding and timestamp format.
- Whether the access token is passed as `session`, `access_token`, or another field.
- Exact input fields and required nested JSON parameter names.
- Response envelope, pagination, product SKU/image/price structure and error format.
- Whether the API test console can invoke each method for App ID 40465.

Implement the read-only catalogue path first, using the existing OAuth identity and encrypted token storage. Add per-method QPS throttles and contract fixtures. Keep the existing fail-closed behavior until the exact method passes a read-only call with the existing App ID 40465. Do not create a new AppKey, do not call a third-party protocol guess, and do not activate order placement/payment methods.

### First-party reference supplied by the owner

- AliExpress Open Service: https://openservice.aliexpress.com/
- Developer Guide → DropShippers API Developer → Quick Start → API QPS (latest update displayed: 2024-08-19 18:03:47).


## Current Product API contract update (13 November 2026)

The signed-in Open Platform console's current DropShippers Product API pages have now been inspected. See [ALIEXPRESS_DROPSHIPPERS_PRODUCT_API_EVIDENCE.md](./ALIEXPRESS_DROPSHIPPERS_PRODUCT_API_EVIDENCE.md) for the complete field inventory and evidence.

Important correction to the earlier research summary: the current DropShippers method page itself demonstrates an IOP client call with Protocol.TOP. Its Java sample initializes IopClient at https://api-sg.aliexpress.com and calls aliexpress.ds.product.get with the existing OAuth access token; its PHP sample specifies https://api-sg.aliexpress.com/sync for the method request. This is distinct from the old deprecated eco.taobao.com/router/rest transport and must not be conflated with it.

The product method requires ship_to_country and product_id, and returns base product data, SKU/stock/prices, attributes, images, package information, store ratings and logistics estimates. The feed-item method requires feed_name, allows page_size up to 200, and returns a search_id cursor valid for one minute. The feed-name method is listed in the console but its complete method page remains to be inspected.

Implementation remains gated on verifying the exact current IOP SDK Protocol.TOP wire signing/common parameters and one harmless read-only call using the existing App ID 40465 and buyerApp token. Do not use the old eco.taobao router, do not restore separate legacy TOP credentials, and do not enable supplier order/payment writes. Existing customer M-Pesa/PayPal and seller/admin wallet flows are untouched.
