# AliExpress DropShippers Authentication evidence

Date captured: 13 November 2026  
Application: existing Sylva Technologies app, App ID 40465  
Documentation surface: Open Platform → Developer Guide → DropShippers API Developer → Authentication

## What the Authentication page establishes

The OpenService Authentication documentation is indexed from this first-party page:

- https://openservice.aliexpress.com/doc/doc.htm?spm=a2o9m.11193487.0.0.372eee0cUB2sDo&nodeId=27493&docId=118729#/?docId=1590

The extracted documentation identifies the following authentication flow:

1. Authorization begins at `GET https://api-sg.aliexpress.com/oauth/authorize` with `response_type=code`, `force_auth=true`, the registered `redirect_uri`, and the app's `client_id` (App Key).
2. The authorization callback supplies a temporary `code`.
3. Exchange the code with `POST /auth/token/create`. The documented required parameter is `code`.
4. Refresh with `POST /auth/token/refresh`. The documented required parameter is `refresh_token`.
5. The documented token response includes `access_token`, `refresh_token`, `expires_in`, `refresh_expires_in`, `user_id`, `account_platform`, `seller_id`, `account`, and request/status metadata.
6. The guide's Java examples use the IOP client with the GOP protocol. Its PHP example explicitly uses `https://api-sg.aliexpress.com/rest` for system-level requests.

The indexed Authentication page is consistent with Sylva's existing OAuth authorization host, REST token endpoint paths, buyerApp account context, encrypted token storage, and refresh flow. The documentation does not require a second App Key.

## Important protocol boundary

This page documents **system authentication**, not the product catalogue API transport. It does not establish that the DropShippers product/feed/search/freight methods use the same `/rest` base, the same signing envelope, or the same token parameter. Do not infer a catalogue request contract from the OAuth token examples.

The extracted page also shows GOP protocol examples through AliExpress's IOP client. Sylva's current token exchange code uses a hand-built signed form POST. Before changing that already-working implementation, compare its exact request/response envelope with a fresh authorized token exchange and the current SDK/API specification. Do not change production credentials or reauthorize merely to test a speculative alternative.

## Engineering decision

- Keep the existing OAuth flow and encrypted token handling in place; OAuth is already connected for the existing app.
- Keep catalogue sync disabled until the Product API / Search API method pages specify the exact API host, path, protocol, signing, token field, request schema, response schema, and permission.
- First read-only test must use App ID 40465 and the already-authorized buyerApp account.
- Keep supplier order creation, supplier payment, cancellation/refund and automated ordering disabled until their separate method contracts and app entitlements are verified.
- Never log or commit authorization codes, access tokens, refresh tokens, App Secret values, or signed request URLs.

## Source and confidence

The underlying page URL is on `openservice.aliexpress.com`. Its content was retrieved through an indexed documentation mirror that attributes the examples and API descriptions to that exact AliExpress OpenService page. Treat the extracted authentication facts as documentation evidence; where the live console's page differs, the live first-party page controls.

This note intentionally does not claim that App ID 40465 is provisioned for any catalogue, freight, or order method.
