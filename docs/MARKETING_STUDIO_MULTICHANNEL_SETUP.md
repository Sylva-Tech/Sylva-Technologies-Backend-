# Sylva Marketing Studio — multichannel setup

This feature branch adds the Marketing Studio channel-readiness endpoint and the first WhatsApp customer-inbox slice. It does **not** mean Instagram or TikTok are authorised or that all channels can publish.

## WhatsApp Cloud API

Configure these Render backend environment variables (never put their values in frontend code or GitHub):

- `WHATSAPP_PHONE_NUMBER_ID`: Phone Number ID from the WhatsApp Business Platform.
- `WHATSAPP_ACCESS_TOKEN`: System-user access token with the required WhatsApp messaging permissions.
- `WHATSAPP_VERIFY_TOKEN`: A strong random value you choose for webhook verification.
- `META_APP_SECRET`: Existing Meta app secret, used to verify webhook signatures.
- `META_GRAPH_API_VERSION`: Keep aligned with the supported version configured for the Meta app.

Set the Meta webhook callback URL to:

`https://api.sylvatechnologies.co.ke/api/marketing-inbox/webhook`

Use the exact same `WHATSAPP_VERIFY_TOKEN` in Meta's webhook verification screen, and subscribe the WhatsApp Business Account to the `messages` field. The endpoint verifies `X-Hub-Signature-256` against the raw request body before accepting events.

The admin inbox API is:

- `GET /api/marketing-inbox/conversations`
- `POST /api/marketing-inbox/conversations/:id/reply` with `{ "text": "..." }`
- `PATCH /api/marketing-inbox/conversations/:id/status` with `{ "status": "open" | "resolved" | "unread" }`

All inbox management endpoints require an authenticated Sylva administrator. Outbound free-form replies are blocked after the WhatsApp 24-hour customer-service window; an approved template workflow is still required for messages outside that window. Marketing broadcasts and automated replies are not enabled by this slice. Obtain customer opt-in before sending promotional messages.

## Instagram

Use the existing Meta app rather than creating another app by default. The Instagram account must be Professional and linked to the relevant Facebook Page. Configure the appropriate Instagram Graph API and Instagram messaging permissions, complete Meta app review/advanced access where required, and implement the account-specific OAuth and webhook subscriptions before enabling publishing or DMs. The readiness endpoint does not mark Instagram publishing as active.

## TikTok

Create/use a TikTok developer app and request the Content Posting API scopes required by the intended workflow. Complete TikTok app review and direct-posting approval. The creative editor can render a split-screen vertical product video and mix an audio file supplied by the administrator locally in the browser. The audio uploader does not grant music rights; use audio Sylva owns or is licensed to use. TikTok OAuth, upload/publish APIs, and posting status callbacks remain separate implementation work.

## Safety defaults

- No paid advertising is launched.
- No scheduled post is automatically sent to a new platform.
- No credentials or access tokens are returned by the channel-readiness endpoint.
- Webhook processing is signature-verified.
- WhatsApp free-form replies are limited to the active 24-hour customer-service window.
