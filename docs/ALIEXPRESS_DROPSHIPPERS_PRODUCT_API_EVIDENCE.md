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
