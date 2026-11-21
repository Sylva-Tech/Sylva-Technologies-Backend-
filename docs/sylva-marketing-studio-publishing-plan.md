# Sylva Marketing Studio — publishing integration plan

## Current production capability

The current release supports campaign drafts, product selection, platform-specific campaign content, administrator approval, scheduling in `Africa/Nairobi`, and a persistent due-campaign scheduler.

A scheduled campaign currently transitions to `ready_to_publish`. This is a queue hand-off only: it is **not** a successful social post and must never be shown as published. External publishing remains disabled until the relevant official platform integration is configured, authorized, tested, and enabled.

## Target workflow

1. Build a campaign from an active, approved, in-stock Sylva catalogue product.
2. Prepare channel-specific copy and media assets.
3. Require administrator review and explicit approval.
4. Schedule in Kenya time or publish immediately after approval.
5. At the due time, claim each platform delivery independently using an idempotency key.
6. Validate current connection status, media requirements, platform permissions, content and audience consent.
7. Send through the official platform API.
8. Persist the platform response ID and delivery state; retry only retryable failures with bounded exponential backoff.
9. Reconcile asynchronous processing through platform status endpoints/webhooks where available.
10. Refresh the dashboard automatically and show per-platform results, timestamps and actionable errors.

A multi-platform campaign must not be marked fully published just because one channel succeeded. Track each platform independently and derive the overall campaign status from those results.

## Official integration requirements

### Facebook Pages

Use the official Meta Graph API Page publishing endpoint. The Page must be selected by an authorized administrator and the app must have the required Page access token and permissions, including `pages_manage_posts`, `pages_read_engagement` and `pages_show_list`, with the user holding the Page's `CREATE_CONTENT` task.

Documentation: https://developers.facebook.com/docs/graph-api/reference/page/feed/

### Instagram

Use the official Instagram Content Publishing API for an Instagram Professional (Business or Creator) account. The account must be linked to the required Facebook Page when using the Facebook Login route, and the app must receive the appropriate publishing permissions such as `instagram_content_publish`. Personal/consumer Instagram accounts are not eligible for this publishing flow.

Documentation: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api/

### TikTok

Use TikTok's official Content Posting API. The target creator must authorize the app with the approved publishing scope (for example, `video.publish`), the creator's current posting constraints must be queried, and the app must respect the creator's selected privacy settings. TikTok states that posts from unaudited clients are restricted to private viewing until the client passes its audit. The app must not promise public posting before approval.

Documentation:
- https://developers.tiktok.com/docs/en/content-posting-api-get-started
- https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post

### WhatsApp Business

Use the official WhatsApp Business Platform Cloud API, not personal WhatsApp automation. Marketing broadcasts require a valid business setup, recipient opt-in, approved message templates where required, rate/quality controls, and opt-out handling. A product campaign must not be sent to scraped, purchased, or non-consenting phone numbers.

Documentation: https://developers.facebook.com/documentation/business-messaging/whatsapp/overview

## Security and reliability requirements

- Store OAuth access/refresh tokens encrypted at rest; never return tokens or app secrets from API responses or logs.
- Prefer per-account connection records and least-privilege scopes over shared hard-coded credentials.
- Keep provider secrets in the deployment secret manager/environment, never in Git.
- Verify OAuth state, redirect URIs, webhook signatures and token expiry/refresh responses.
- Use idempotency keys and atomic database claims to prevent duplicate posts when workers restart or run on multiple instances.
- Use bounded retries, backoff, dead-letter/error states and an administrator retry action.
- Store only platform IDs, safe status metadata and redacted error summaries.
- Require explicit audience consent for WhatsApp recipients and preserve unsubscribe/opt-out state.
- Keep approval as a hard gate. Editing approved content, media or target platforms must invalidate approval and require re-approval.
- Never mark a post as published until the provider returns a successful publish identifier or a subsequent provider status confirms publication.

## Configuration and launch checklist

Do not enable publishing merely because an environment variable exists. Each channel must pass an explicit connection/health check and a controlled test publish to an account/page owned by Sylva.

- [ ] Meta developer app configured and reviewed for required Page/Instagram permissions.
- [ ] Facebook Page and eligible Instagram Professional account connected through OAuth.
- [ ] TikTok Content Posting API product and publishing scope approved; app audit completed before promising public visibility.
- [ ] WhatsApp Business account, sender number, templates, opt-in audience and opt-out handling verified.
- [ ] Durable media hosting configured with public, platform-fetchable HTTPS URLs and file validation.
- [ ] Token encryption key and OAuth/webhook secrets configured in Render.
- [ ] Worker concurrency, idempotency, retries and monitoring verified.
- [ ] Test each platform independently before enabling production scheduling.

## Rollout stages

1. **Foundation (merged):** admin campaign workflow and Kenya-time scheduler.
2. **Dashboard reliability:** automatic refresh so campaign state and delivery results update without manual reload.
3. **Connections:** OAuth/account linking, encrypted token storage, health checks and disconnect/revoke handling.
4. **Publishing adapters:** one official provider adapter at a time, with per-platform results and idempotent delivery.
5. **Creative production:** Sylva AI poster/video generation and asset review; only approved assets may be scheduled.
6. **Analytics:** provider metrics, click tracking and campaign reporting.

This plan intentionally separates campaign scheduling from platform delivery. No fake connected state, simulated success, or automatic WhatsApp bulk send is permitted.
