# AliExpress Dropshipping Order API integration notes

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

## Supplier order creation: `aliexpress.ds.order.create` — intentionally disabled

The official contract accepts `param_place_order_request4_open_api_d_t_o` with `logistics_address` and `product_items`. Optional `ds_extend_request` may contain payment settings such as `pay_currency` and `try_to_pay`; `try_to_pay=true` is only allowed after the AliExpress account is authorized as a Dropshipper. The request supports `out_order_id` as a recommended idempotency key (24-hour validity).

**Safety gate:** Sylva must not submit supplier purchases or automatic payments yet. The API method entitlement, buyer/Dropshipper authorization, live freight quote and destination availability, final supplier price, address validation, idempotent retry/reconciliation, cancellation handling, payment lifecycle, and tracking lifecycle have not all been verified against the existing app/account. The backend allowlist therefore continues to reject `aliexpress.ds.order.create`. Do not enable it merely because the documentation exists.

Before enabling supplier ordering, implement and test all of the following:
1. Persist an immutable supplier-order attempt linked to the Sylva order and unique `out_order_id`; reject duplicate attempts and ambiguous retries.
2. Recalculate supplier price and freight immediately before purchase; validate currency and stock.
3. Validate the complete recipient address, including country code, province, city, phone, and any country-specific tax/identity fields.
4. Require an explicit, auditable admin/fulfilment authorization before any paid supplier placement. Keep automatic payment disabled until separately approved.
5. Reconcile `order_list.number[]` to the local attempt and query order status after the provider synchronization delay.
6. Handle partial shipment, cancellation, risk control, payment processing, completed and failed states without releasing Sylva escrow or marking customer delivery complete prematurely.
7. Poll tracking with bounded backoff and store provider events idempotently. Tracking data is not customer delivery confirmation.
8. Add mocked tests for provider success/failure, insufficient permissions, duplicate requests, timeouts, and partial responses; then run live read-only tests before any purchase test.

## Request protocol and secrets

The current backend adapter sends IOP Protocol.TOP requests to `https://api-sg.aliexpress.com/sync`, using the encrypted connected-account access token as the `session` common parameter. Never place App Secret, access tokens, customer addresses, or full provider payloads in logs, source control, frontend code, or API responses.

The adapter now permits only these read-only methods:
- `aliexpress.ds.product.get`
- `aliexpress.ds.feedname.get`
- `aliexpress.ds.feed.itemids.get`
- `aliexpress.trade.ds.order.get`
- `aliexpress.ds.order.tracking.get`

The supplier write method `aliexpress.ds.order.create` remains blocked.


## Read-only member benefit lookup: `aliexpress.ds.member.benefit.get`

- Purpose: query benefits available to the connected AliExpress Dropshipper member account.
- The supplied documentation shows no required business parameters.
- The response can contain `result[]` entries with `code`, `title`, `canApply`, and `canBenefit`.
- Boolean-like values may be returned as strings (for example, `"true"`).
- The supplied example includes an `auto-pay` benefit. This only reports whether the account can apply for / already has that benefit; it does not initiate payment, charge a payment method, or authorize Sylva to pay for supplier orders.
- Endpoint: `GET /api/aliexpress/payment/benefits` (admin-only; read-only).
- Method entitlement must be verified against the existing AliExpress App ID 40465 and connected buyerApp account with a live call. OAuth success alone is not proof of permission.

**Payment safety gate:** the member-benefit method is informational only. It does not enable automatic supplier payment. Supplier order creation and `try_to_pay` remain blocked until AliExpress confirms the account's Dropshipper authorization, payment permissions, payment method and complete order/payment lifecycle.
