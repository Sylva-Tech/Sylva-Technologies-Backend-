# AliExpress Dropshipping Order and Catalogue Search API integration notes

This document records the official DropShippers API contracts supplied for Sylva's existing AliExpress app (App ID 40465). Credentials and access tokens must remain in Render/server-side encrypted storage.

## Read-only order lookup: `aliexpress.trade.ds.order.get`

- Purpose: query an AliExpress order belonging to the connected account.
- Required business parameter: `single_order_query`, a JSON string such as `{"order_id":"10000001"}`.
- The order ID is the AliExpress order ID, not Sylva's local order ID.
- Useful response fields include `order_status`, `logistics_status`, `gmt_create`, `order_paidtime_string`, `user_order_amount`, `order_amount`, `child_order_list`, and store information.
- The legacy `logistics_info_list.logistics_no` and `logistics_service` fields are marked as no longer maintained. Use the dedicated tracking method below.
- AliExpress notes that a newly created order may take several seconds to synchronize; query after at least 10 seconds.
- A response with `isv.insufficient-permission` means the app/account lacks permission; do not treat OAuth connection alone as proof of method entitlement.

## Read-only tracking lookup: `aliexpress.ds.order.tracking.get`

- Purpose: retrieve tracking lines for an AliExpress order.
- Required business parameters: `ae_order_id` (the AliExpress order ID returned by order creation) and `language` (for example `en_US`).
- Response may contain tracking number (`mail_no`), carrier (`carrier_name`), estimated arrival timestamp (`eta_time_stamps`), tracking events (`detail_node_list.detail_node[]` with `time_stamp`, `tracking_name`, and `tracking_detail_desc`), and package items.
- `TRACKING DATA NOT FOUND` / code `1001` is a provider response, not proof that the order is invalid; retry later according to a bounded polling policy.

## Read-only keyword search: `aliexpress.ds.text.search`

- Purpose: search the Dropshipper catalogue by keyword.
- Required parameters: `keyWord`, `local` (for example `en_US`), `countryCode` (two-letter ship-to country), and `currency` (for example `USD`).
- Optional parameters: `categoryId`, `sortBy` (`min_price|orders|comments` plus `asc|desc`), `pageSize`, `pageIndex`, `searchExtend`, and `selectionName`.
- Supported documented `searchExtend.searchKey` values include `free_ship_to`, `item_tag`, `seller_level`, `ship_from`, `seller_online`, and `hot_area`.
- Endpoint: `POST /api/aliexpress/search/text` (admin-only). Send the documented parameter names in the JSON request body. Defaults are `local=en_US`, `countryCode=KE`, `currency=USD`, `sortBy=orders,desc`, `pageSize=20`, and `pageIndex=1`.
- The response normalizes supplier product IDs, titles, image/product URLs, prices, currency, discount, orders and ratings. It is search-only; results are not imported or published.

## Read-only image search: `aliexpress.ds.image.searchV2`

- Purpose: find same or similar catalogue products from an image.
- The method accepts one JSON-string business parameter named `param0`; its object can contain `search_type` (`same|similar`), `image_base64`, `currency`, `lang`, `sort_type` (`price|orders|best`), `sort_order` (`asc|desc`), and `ship_to`.
- Endpoint: `POST /api/aliexpress/search/image` (admin-only). Supply `image_base64` as raw base64 or a PNG/JPEG/WebP data URL, maximum 5 MB. Defaults are `search_type=similar`, `currency=USD`, `lang=en`, `sort_type=best`, `sort_order=desc`, and `ship_to=KE`.
- Response products and pagination are normalized, including similarity score and next-row cursor when provided. The next cursor is returned as `pagination.nextStartRowKey`; pass it only if/when AliExpress documents the corresponding continuation parameter for this method.
- Image bytes are sent server-to-server to AliExpress and are not persisted by these endpoints.

## Read-only member benefit lookup: `aliexpress.ds.member.benefit.get`

- Purpose: query benefits available to the connected AliExpress Dropshipper member account.
- The supplied documentation shows no required business parameters.
- The response can contain `result[]` entries with `code`, `title`, `canApply`, and `canBenefit`.
- Boolean-like values may be returned as strings (for example, `"true"`).
- The supplied example includes an `auto-pay` benefit. This only reports whether the account can apply for / already has that benefit; it does not initiate payment, charge a payment method, or authorize Sylva to pay for supplier orders.
- Endpoint: `GET /api/aliexpress/payment/benefits` (admin-only; read-only).

## Supplier order creation: `aliexpress.ds.order.create` — intentionally disabled

The official contract accepts `param_place_order_request4_open_api_d_t_o` with `logistics_address` and `product_items`. Optional `ds_extend_request` may contain payment settings such as `pay_currency` and `try_to_pay`; `try_to_pay=true` is only allowed after the AliExpress account is authorized as a Dropshipper. The request supports `out_order_id` as a recommended idempotency key (24-hour validity).

**Safety gate:** Sylva must not submit supplier purchases or automatic payments yet. The API method entitlement, buyer/Dropshipper authorization, live freight quote and destination availability, final supplier price, address validation, idempotent retry/reconciliation, cancellation handling, payment lifecycle, and tracking lifecycle have not all been verified against the existing app/account. The backend allowlist therefore continues to reject `aliexpress.ds.order.create`.

## Request protocol and secrets

The current backend adapter sends IOP Protocol.TOP requests to `https://api-sg.aliexpress.com/sync`, using the encrypted connected-account access token as the `session` common parameter. Never place App Secret, access tokens, customer addresses, or full provider payloads in logs, source control, frontend code, or API responses.

The adapter permits only these read-only methods:
- `aliexpress.ds.product.get`
- `aliexpress.ds.feedname.get`
- `aliexpress.ds.feed.itemids.get`
- `aliexpress.trade.ds.order.get`
- `aliexpress.ds.order.tracking.get`
- `aliexpress.ds.member.benefit.get`
- `aliexpress.ds.text.search`
- `aliexpress.ds.image.searchV2`

**Payment and publishing safety:** catalogue search is not supplier order placement. Search results remain admin-side search results and do not create Sylva products, publish storefront listings, charge a payment method, or enable supplier ordering. Live App ID 40465 method entitlement must be confirmed by a successful call against the connected buyerApp account.
