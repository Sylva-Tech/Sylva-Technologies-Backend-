# Sylva Marketing Studio — multichannel setup

The main purpose of Sylva Marketing Studio is **customer reach**: prepare product campaigns once, adapt the message for each social platform, and distribute those campaigns across Sylva's official channels to help more customers discover products. The Studio must show each platform's real publishing status and must never report a post as published until the platform confirms it.

The current branch reuses the existing Facebook Page OAuth connection to discover a linked Instagram Professional account. It also adds a controlled Instagram image-publishing action for approved campaigns. This is not the same as full Instagram Reels/Stories/DM support, and it requires the Instagram permissions and account link to be present.

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

Use the existing Sylva Meta app and the official Sylva Technologies Facebook Page connection. The Instagram account must be Professional and linked to that Page. The Page OAuth flow requests optional `instagram_basic`, `instagram_content_publish`, `instagram_manage_messages`, and `pages_manage_metadata` permissions. Meta may require app review/advanced access before real customer accounts can use these permissions.

When the linked Instagram account ID and `instagram_content_publish` permission are both present, the channel status reports `publishing_ready`. An administrator can publish an approved campaign using:

`POST /api/marketing-studio/campaigns/:id/publish/instagram`

The current publishing slice supports a single image post or a Reel, using an approved campaign image/video asset or the product catalogue image for image posts. The image must be publicly reachable over HTTPS. It creates a media container and then publishes it through the Instagram Graph API; the returned Instagram media ID is stored in the campaign's publishing results. Reels, Stories, carousel publishing, scheduled Instagram delivery, and Instagram DMs/webhooks are not implemented yet. The admin must review the post and caption before approving and publishing.

Instagram messaging additionally requires the appropriate messaging permission, Page messaging task, Meta webhook subscriptions, and business/app requirements. Do not treat account discovery or publishing permission as proof that DMs are enabled.

## TikTok

Configure these Render backend environment variables (never expose them to the browser or commit their values):

- `TIKTOK_CLIENT_KEY`
- `TIKTOK_CLIENT_SECRET`
- `TIKTOK_REDIRECT_URI=https://api.sylvatechnologies.co.ke/api/marketing-tiktok/callback`
- `TIKTOK_TOKEN_ENCRYPTION_KEY`: unique 32-byte key; generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Register the exact HTTPS redirect URI above in TikTok Developer Portal under Login Kit. The backend requests `user.info.basic` and `video.publish`. The admin connects through the Marketing Studio TikTok card. OAuth state is signed, tokens are encrypted at rest, and the backend refreshes expiring access tokens when the admin channel status is checked.

The current TikTok integration covers account connection and secure token storage only. Direct publishing remains deliberately disabled until the creator-info/consent flow, upload and status workflows are implemented and TikTok has audited the app. TikTok's official Direct Post API requires a creator-info query and explicit consent; unaudited clients are restricted to private visibility until TikTok audits the app.

The creative editor can render a split-screen vertical product video and mix an audio file supplied by the administrator locally in the browser. The audio uploader does not grant music rights; use audio Sylva owns or is licensed to use.

## Safety defaults

- No paid advertising is launched.
- Facebook uses the existing native Page scheduling workflow. Instagram image publishing is an explicit administrator action after approval; it is not auto-scheduled.
- TikTok direct publishing is not enabled until its app review and creator-consent flow are implemented.
- No credentials or access tokens are returned by the channel-readiness endpoint.
- Webhook processing is signature-verified.
- WhatsApp free-form replies are limited to the active 24-hour customer-service window.
