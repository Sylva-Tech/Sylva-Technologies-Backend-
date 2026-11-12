# AliExpress integration

## Connection configuration

Configure these values in the backend hosting environment. Never put the app secret or token encryption key in the frontend:

- `ALIEXPRESS_APP_KEY`
- `ALIEXPRESS_APP_SECRET`
- `ALIEXPRESS_REDIRECT_URI`
- `ALIEXPRESS_TOKEN_ENCRYPTION_KEY` — 64 hexadecimal characters (32 random bytes)
- `FRONTEND_URL`

The redirect URI must exactly match the callback URL registered in the AliExpress application console. If the registered callback is the frontend route, use the site's `/callback` URL; that page forwards the OAuth response to `/api/aliexpress/callback`.

Access and refresh tokens are encrypted with AES-256-GCM before they are stored. The admin UI never receives token values.

## Supplier feed synchronisation

The integration currently calls the documented Dropshipper recommendation-feed method:

- Method: `aliexpress.ds.recommend.feed.get`
- Required feed field: `feed_name`
- Other feed inputs: `country`, `target_currency`, `target_language`, `page_size`, `page_no`, and optional `category_id`
- Maximum page size: 50
- TOP request signature: `sign_method=hmac` (HMAC-MD5), with all request parameters sorted and concatenated as specified by the TOP signature guide.
- Response products are upserted into `AliExpressCatalogProduct`, keyed by the AliExpress product ID.

The default feed name is `DS bestseller`; it is a documented example, not a guarantee that every application has permission to use that feed.

The admin endpoint is `POST /api/aliexpress/catalog/sync`. The review list is `GET /api/aliexpress/catalog/products`.

**Safety boundary:** synchronised items are held in a private review collection. They are not automatically inserted into the public Sylva product catalogue, assigned a retail price, or published. Supplier ordering is still disabled.

## AliExpress account and permission requirements

OAuth connection alone does not prove that catalogue APIs are enabled. The AliExpress Open Platform documentation says API permission groups must be Active or separately requested. The Dropshipping documentation also states that Dropshipping APIs are limited to accounts enrolled in the Dropshipping Center.

The published Dropshipping integration guide is marked deprecated. Before relying on live product sync, verify in the AliExpress application console that the app has an active permission for `aliexpress.ds.recommend.feed.get` and that the authorising account is eligible for the Dropshipping Center. If AliExpress rejects the method, the admin page displays the provider error; do not work around this with undocumented scraping or a different account's credentials.

Official references:

- Seller OAuth flow: https://developer.alibaba.com/docs/doc.htm?articleId=120687&docType=1&treeId=727
- API permission groups: https://developer.alibaba.com/docs/doc.htm?articleId=120676&docType=1&treeId=727
- Dropshipping recommendation feed API: https://developer.alibaba.com/docs/api.htm?apiId=60366
- TOP signature algorithm: https://developer.alibaba.com/docs/doc.htm?articleId=122464&docType=1&treeId=846
- Dropshipping integration guide (marked deprecated): https://developer.alibaba.com/docs/doc.htm?articleId=120418&docType=1&treeId=762
