# AliExpress DropShippers Product API evidence — 13 November 2026

Application under investigation: Sylva Technologies, existing App ID 40465. This note records the exact documentation text supplied from the signed-in AliExpress Open Platform console. It is first-party console evidence, not proof of successful API entitlement for this app.

## aliexpress.ds.product.get

Documentation page latest update: 2025-04-28 10:59:35.

Description: retrieves product details including SKU information, product descriptions, pricing and inventory. The page explicitly says price calculation depends on account data and a valid access token is mandatory for price consistency.

Required request parameters:
- ship_to_country (String): destination country.
- product_id (Number): AliExpress item ID.

Optional request parameters:
- target_currency (String).
- remove_personal_benefit (Boolean).
- target_language (String), with enumerated locale values including en_US, en_GB, de_DE, fr_FR, zh_CN, ja_JP, ar_SA and others.

Documented response includes:
- ae_item_base_info_dto: product ID, subject/title, detail/mobile detail, category, product status, currency, sales count, average rating and evaluation count.
- ae_item_sku_info_dtos: SKU ID, SKU attributes, stock, SKU price, offer sale price, currency, SKU images, barcode/EAN and wholesale price tiers.
- ae_item_properties: product attributes.
- ae_multimedia_info_dto: product image URLs and video metadata.
- package_info_dto: package dimensions and gross weight.
- ae_store_info: store identity and seller ratings.
- logistics_info_dto: destination country and delivery-time estimate.
- product_id_converter_result: main/sub product IDs.

Documented errors:
- 602: item unavailable for the requested country / legal restriction.
- 605: item ID not found.
- 404: system error.

The page's FAQ says a single-SKU product may have an empty sku_attr; the freight API should receive an empty string in that case. For US-targeted products, the FAQ says use sub_product_id rather than main_product_id. Product price may differ from the consumer website because page discounts may not apply to API pricing. Do not treat the sample's product or seller data as current live inventory.

## Transport and protocol — critical correction

The same first-party Product API page includes:
- Java: new IopClient("https://api-sg.aliexpress.com", appkey, appSecret), an IopRequest with API name aliexpress.ds.product.get, and client.execute(request, accessToken, Protocol.TOP).
- PHP: https://api-sg.aliexpress.com/sync as the request URL for this product API example; it explicitly distinguishes the system-level API request address from this API call address.

This establishes that the current DropShippers product method is documented as an IOP SDK invocation using Protocol.TOP, with the PHP example pointing to the /sync endpoint. It does not mean the deprecated legacy https://eco.taobao.com/router/rest endpoint or the older ALIEXPRESS_DS_APP_KEY credentials should be revived. The protocol is selected by the current method page and its IOP client example.

The method page does not expose the full wire-level TOP common-parameter/signature implementation in the pasted content. Do not hand-roll a signer from the deprecated TOP router or assume the existing OAuth token-signature routine is interchangeable. Use the documented IOP SDK/protocol implementation or verify an exact implementation against a harmless read-only request before enabling it.

## aliexpress.ds.feed.itemids.get

Documentation page latest update: 2025-04-16 15:32:32.

Description: fetch item IDs by feed name.

Request parameters:
- feed_name (String): required; page says obtain values from aliexpress.ds.feedname.get.
- page_size (Number): optional; range 0–200; default 200.
- search_id (String): optional pagination cursor; pass the value returned by the previous call.

Response:
- result.products: product IDs (example serializes as products.number).
- result.search_id: next-page cursor, valid for one minute.
- result.total: remaining item count.
- ret and rsp_msg: response status/message.

The pasted Java and PHP examples both call this method through the IOP client; PHP again specifies https://api-sg.aliexpress.com/sync. The Java example passes page_size, feed_name and search_id. A stray category_id appears in the example although it is not in the displayed request-parameter table; do not send it unless the complete method spec confirms it.

## Existing feed method and QPS data

The Open Platform console navigation lists aliexpress.ds.feedname.get, but its full request/response specification has not yet been supplied. The QPS page (latest update 2024-08-19) lists:
- aliexpress.ds.product.get: 500 QPS
- aliexpress.ds.feed.itemids.get: 3 QPS
- aliexpress.ds.feedname.get: 1000 QPS
- aliexpress.ds.category.get: 1000 QPS
- aliexpress.ds.recommend.feed.get: 1000 QPS
- aliexpress.ds.image.search: 15 QPS
- aliexpress.ds.freight.query: 350 QPS
- aliexpress.ds.address.get: 4 QPS
- aliexpress.ds.order.tracking.get: 100 QPS
- aliexpress.ds.order.create: 150 QPS
- aliexpress.trade.buy.placeorder: 150 QPS
- aliexpress.trade.ds.order.get: 1000 QPS

QPS is only a rate ceiling; it does not prove method access for App ID 40465. Sylva should apply conservative internal throttles and pagination controls, especially the 3 QPS feed-item method.

## Sylva implementation decision

1. Keep existing OAuth authorization/token storage and token refresh; use the existing buyerApp account and existing App ID 40465.
2. Build a separate current DropShippers IOP adapter for the documented /sync Protocol.TOP path; do not reuse the old eco.taobao router adapter or its separate legacy TOP credentials.
3. The first external test must be a single read-only aliexpress.ds.product.get call for a known public product ID, with ship_to_country=KE and a currency/language chosen from the method's supported options. Do not call it until the IOP SDK signing/transport envelope is verified.
4. Then test feed metadata (aliexpress.ds.feedname.get) and one feed-ID page (aliexpress.ds.feed.itemids.get) under a 3-QPS internal limit; store cursors with their one-minute expiry and do not assume page cursors persist.
5. Map the real product response into Sylva's private AliExpress review queue. Preserve product source as AliExpress and do not auto-publish, alter seller products, or change checkout/wallet accounting.
6. Supplier ordering, supplier payment, freight checkout and all write APIs remain disabled until their individual current method specs and lifecycle/permissions are verified.

## Unresolved verification

- Full aliexpress.ds.feedname.get page.
- Exact wire-level signing/common parameters for the current IOP client Protocol.TOP path, preferably from the matching SDK version/source.
- Whether App ID 40465's active AliExpress-dropship permission group grants each named method.
- A successful read-only API response using the existing buyerApp token.

No credentials, token values, environment variables, production settings, deployments, supplier orders, or payments were changed for this evidence update.


## aliexpress.ds.feedname.get — full first-party specification supplied (13 November 2026)

Documentation page latest update: 2025-03-03 10:02:58.

Description: fetch feed names for the DropShippers business. The page describes a feed name as a list of item IDs.

### Request

The displayed request-parameter table contains one optional parameter:
- `app_signature` (String, optional), described as “API signature”.

The Java and PHP examples both add `app_signature` with the placeholder value `your_feedname`. This is ambiguous: the table calls it an API signature, while the demo placeholder looks like a feed name. Do not infer that the parameter is a feed-name filter, do not pass a made-up value, and do not handcraft an app signature. First test the documented method with the parameter omitted, or verify the parameter semantics from the official IOP SDK / full method reference before supplying it.

### Response

The successful example returns:
- `aliexpress_ds_feedname_get_response.resp_result.resp_code`: numeric status (example 200).
- `resp_msg`: status text (example “Call succeeds”).
- `result.current_record_count`: number of records in this response.
- `result.promos.promo[]`: feed collection entries:
  - `promo_name`: feed name, e.g. `AEB_ ComputerAccessories_EG`.
  - `promo_desc`: feed description.
  - `product_num`: number of products in that feed.
- `request_id`: provider request identifier.

The example shows 176 current records and two sample promo entries. Those values are documentation examples, not a live result or a promise of Kenya-relevant feeds.

### Protocol and transport

- Java example: `IopClient("https://api-sg.aliexpress.com", appkey, appSecret)`, method `aliexpress.ds.feedname.get`, and `client.execute(request, accessToken, Protocol.TOP)`.
- PHP example: `https://api-sg.aliexpress.com/sync`, IOP request `aliexpress.ds.feedname.get`, then execute with the access token.

This is consistent with the Product API and Feed Item IDs pages: use the current IOP SDK / Protocol.TOP method contract and the documented `/sync` transport for the PHP example. It is not a reason to revive the old `eco.taobao.com/router/rest` gateway.

### Relationship to feed discovery

The method page's common issues say feed names can be obtained through `aliexpress.ds.recommend.feed.get`; the method itself is described as fetching feed names. Keep these methods distinct:
1. `aliexpress.ds.recommend.feed.get` is documented as a way to obtain recommended feed names.
2. `aliexpress.ds.feedname.get` returns the feed collection structure shown above.
3. `aliexpress.ds.feed.itemids.get` takes a `feed_name` and returns product IDs with a one-minute pagination cursor.
4. `aliexpress.ds.product.get` retrieves full detail for each selected product ID.

The FAQ says custom feed collections may require business-team customization, and a newly supplied feed name can take time to become effective. The category FAQ also warns that the category ID returned by Product API is a subcategory ID.

### Updated verification status

The full first-party specification for `aliexpress.ds.feedname.get` is now captured. The previous “full feedname page not supplied” item is resolved. Remaining blockers are unchanged:
- Verify the exact IOP SDK Protocol.TOP wire signing/common parameters and /sync transport implementation against a trusted SDK source.
- Verify App ID 40465's method-level entitlement for these DropShippers calls.
- Perform one harmless read-only product-detail request using the existing buyerApp token before enabling catalogue sync.
- Obtain the full current `aliexpress.ds.recommend.feed.get` specification before relying on it for recommended feed discovery.

No API call, token change, environment change, supplier order, payment, production change or deployment was performed as part of this documentation update.


## aliexpress.ds.recommend.feed.get — legacy documentation discovery (13 November 2026)

A documentation search for the exact method name surfaced an indexed Alibaba Open Platform/TOP reference for `aliexpress.ds.recommend.feed.get`. The reference is explicitly categorized under **“Dropshipping (deprecated)”** and specifies the legacy `https://eco.taobao.com/router/rest` gateway with TOP common parameters. It lists method parameters such as `country`, `target_currency`, `target_language`, `page_size`, `sort`, `page_no`, `category_id`, and `feed_name`.

This is useful historical evidence that the method existed, but it is **not** a current DropShippers IOP contract. Do not call it through the current `https://api-sg.aliexpress.com/sync` IOP adapter by copying these old parameters, and do not revive the deprecated `eco.taobao.com/router/rest` transport. The signed-in Open Platform search result supplied by the user still exposes only the `aliexpress.ds.feedname.get` document (API results: 0); its FAQ references `aliexpress.ds.recommend.feed.get`, but does not provide a current method specification.

Current decision:
- Keep `aliexpress.ds.recommend.feed.get` out of the production catalogue-sync path.
- Continue with the current first-party documented `aliexpress.ds.feedname.get` -> `aliexpress.ds.feed.itemids.get` -> `aliexpress.ds.product.get` path, after verifying the IOP SDK wire protocol and App ID method entitlement.
- Do not infer that the QPS listing (1000) proves method access.
- No live API request, credentials, production settings, supplier writes, deployment, or merge was performed from this discovery.


## Official general IOP signing and request-parameter evidence (13 November 2026)

The public AliExpress Open Platform Developer's Guide pages were checked against the current Product API examples:

- **Calling parameters** (document ID 120691, updated 2022-01-26): every IOP API request includes `app_key`, `timestamp`, `sign_method` and `sign`; `access_token` is conditional on the API's authorization requirements. The timestamp may be UTC ISO-8601 or epoch milliseconds, with a maximum 7,200-second clock difference.
- **Signature algorithm** (document ID 120692, updated 2022-02-25): sort text parameters by ASCII parameter name, concatenate each name and value, prefix the API name/path, then calculate HMAC-SHA256 with the app secret and encode the digest as uppercase hexadecimal.
- **API endpoint URLs** (document ID 120689): the general overseas IOP REST environment is `https://api-sg.aliexpress.com/rest`.
- **Requests and responses** (document ID 120690): the general REST request includes the API path and sends common/business parameters in the request path, request parameters or JSON POST body.

Official references:
- https://developer.alibaba.com/docs/doc.htm?articleId=120691&docType=1&treeId=727
- https://developer.alibaba.com/docs/doc.htm?articleId=120692&docType=1&treeId=727
- https://developer.alibaba.com/docs/doc.htm?articleId=120689&docType=1&treeId=727
- https://developer.alibaba.com/docs/doc.htm?articleId=120690&docType=1&treeId=727

### Critical boundary: generic IOP REST is not yet a verified Protocol.TOP /sync wire contract

These public guide pages establish the **general IOP REST** request parameters and HMAC-SHA256 signature model. The current DropShippers Product API page supplied from the signed-in console separately demonstrates `IopClient.execute(request, accessToken, Protocol.TOP)` and the PHP `/sync` endpoint. The general guide does not explicitly state that its REST common-parameter list and path-prefixed signer are byte-for-byte the implementation used by the SDK's `Protocol.TOP` mode.

Therefore, Sylva must not simply transplant the general `/rest` request signer onto `/sync` or assume the TOP mode's system parameter names. The exact generated SDK implementation for App ID 40465 (or an authoritative Protocol.TOP sample) is still required to confirm:
- the exact common parameters and whether the token field is `access_token`, `session` or another name;
- the exact timestamp representation and `sign_method` value for Protocol.TOP;
- whether the signature input prefixes the method name, path or another identifier;
- whether any additional protocol/version/format parameters are mandatory;
- the precise request encoding and response envelope for the DropShippers methods.

### Backend verification changes

The backend verification branch removes the unreachable legacy catalogue request implementation and both obsolete sync-route bodies. The old `eco.taobao.com/router/rest` URL, HMAC-MD5 signer, separate `ALIEXPRESS_DS_APP_KEY` / `ALIEXPRESS_DS_APP_SECRET` path and deprecated `aliexpress.ds.recommend.feed.get` call are no longer executable catalogue code. OAuth token exchange/refresh remains on the existing `/rest` path and retains its current signing and encrypted-token storage.

The buyerApp Supplier Centre status now reports separate flags for:
- protocol/wire contract verification;
- method entitlement verification for App ID 40465;
- successful read-only product test.

All three remain false, and catalogue sync remains blocked with `ALIEXPRESS_CATALOG_API_NOT_VERIFIED`. Legacy credential environment variables cannot enable it. No live AliExpress catalogue call has been made by this code change. Supplier order placement, supplier payment, fulfilment writes, customer checkout and Sylva wallet accounting remain unchanged.


## Generated official IOP Java SDK inspected (owner-uploaded SDK ZIP, 13 November 2026)

The generated AliExpress IOP Java SDK source JAR supplied for the existing application was inspected. Relevant source files:

- `com/global/iop/api/TopExecutor.java`
- `com/global/iop/api/BaseExecutor.java`
- `com/global/iop/util/IopUtils.java`
- `com/global/iop/util/IopHashMap.java`
- `com/global/iop/util/RequestContext.java`
- `com/global/iop/util/Constants.java`
- `com/aliexpress/open/request/AliexpressDsProductGetRequest.java`
- `com/aliexpress/open/response/AliexpressDsProductGetResponse.java`
- `com/aliexpress/open/domain/AliexpressDsProductGetAeItemQueryResultDTO.java`
- `com/aliexpress/open/domain/AliexpressDsProductGetAeItemBaseInfoDTO.java`
- `com/aliexpress/open/request/AliexpressDsFeednameGetRequest.java`
- `com/aliexpress/open/request/AliexpressDsFeedItemidsGetRequest.java`

### Exact Protocol.TOP contract from TopExecutor

The SDK constructs these common parameters:

- `app_key`: existing application App Key
- `v`: `2.0`
- `timestamp`: Java `Date(timestamp)`, serialized by `IopHashMap` as Unix epoch milliseconds
- `method`: API method name
- `format`: `json`
- `session`: OAuth access token (not `access_token`)
- `partner_id`: `iop-sdk-java-20181207`
- `sign_method`: `sha256`
- `simplify`: `true` by default

The SDK forms the request URL as `<serverUrl>/sync?method=<apiName>`, then appends the encoded common parameters to the URL. Since `method` is also one of the common parameters, the generated SDK URL contains the method parameter twice. Business parameters are sent as an `application/x-www-form-urlencoded` POST body.

The signature is HMAC-SHA256 with the app secret, uppercase hexadecimal output. `IopUtils.signApiRequest("", allParams, null, appSecret, "sha256")` sorts the keys in the merged common + business parameter map, concatenates each key and value, and signs the concatenated string. There is no API-name/path prefix in this TOP signer. The `sign` field itself is added only after the signature is calculated and is therefore not part of the signed map.

The Node adapter now mirrors these generated SDK rules, but intentionally retains normal TLS certificate validation. The Java SDK's legacy `WebUtils` has SSL and hostname verification bypasses enabled by default; Sylva does not copy that unsafe behavior.

### Generated Product API method contract

The generated `AliexpressDsProductGetRequest` confirms these fields:
- Required in the current documentation: `ship_to_country`, `product_id`
- Optional generated fields: `target_currency`, `target_language`, `remove_personal_benefit`
- Additional generated fields not shown in the supplied current method parameter table: `biz_model`, `province_code`, `city_code`. Sylva does not send these undocumented optional fields.

The generated response confirms `result.ae_item_base_info_dto`, `result.ae_item_sku_info_dtos`, `result.ae_multimedia_info_dto`, logistics, package and store fields. The base DTO identifies `product_id`, `subject`, `currency_code`, `category_id`, `product_status_type`, `avg_evaluation_rating` and `evaluation_count`.

The generated Feed API request classes confirm:
- `aliexpress.ds.feedname.get` has the optional `app_signature` field.
- `aliexpress.ds.feed.itemids.get` has `page_size`, `category_id`, `feed_name` and `search_id`. The generated SDK therefore includes optional `category_id` even though the supplied current parameter table did not list it. Sylva will not send it unless needed and confirmed by the current method contract.

### Backend implementation and safety boundary

The buyerApp backend now has an admin-only `POST /api/aliexpress/catalog/test-product` endpoint. It:
- accepts a numeric product ID and ship-to country (default `KE`);
- refreshes the existing encrypted buyerApp token when it is missing or near expiry;
- calls only `aliexpress.ds.product.get` through the SDK-matched `/sync` TOP adapter;
- validates the product response envelope and extracts a minimal product summary;
- persists the time, product ID and title of a successful read-only verification;
- never imports, publishes, purchases or places an order.

The adapter allowlists only these read-only method names: `aliexpress.ds.product.get`, `aliexpress.ds.feedname.get` and `aliexpress.ds.feed.itemids.get`. Supplier write methods are rejected before network access. The current diagnostic endpoint invokes only product detail.

The Supplier Centre status now reports the wire contract as verified from the generated SDK, separately from App ID method entitlement and a successful live product test. Catalogue sync remains disabled until feed discovery, pagination and private review-queue import are separately verified. Supplier ordering remains disabled. No live API request is represented as successful by CI tests; a real read-only request still must be run against App ID 40465 and a valid product ID.
