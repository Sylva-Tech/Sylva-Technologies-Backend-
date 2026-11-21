# Sylva Marketing Studio

The first foundation release provides an administrator-only campaign workflow.

## Included
- Campaign drafts linked to active, approved, in-stock catalogue products.
- Platform selections for Facebook, Instagram, TikTok and WhatsApp.
- Platform-specific captions, hashtags and calls to action.
- Submit-for-approval and administrator approval states.
- Persistent scheduling in the `Africa/Nairobi` timezone.
- A database-backed scheduler that moves due campaigns to `ready_to_publish`.
- Activity history and explicit publishing status.

## Safety boundary
The first release does not publish externally. Due campaigns are moved to `ready_to_publish` and wait for the official platform publishing integrations. No social account credentials are required or stored in this release. Poster/video generation and official publishing adapters are subsequent stages.

## API
All endpoints require an authenticated administrator:
- `GET /api/marketing-studio/overview`
- `GET /api/marketing-studio/products`
- `GET /api/marketing-studio/campaigns`
- `POST /api/marketing-studio/campaigns`
- `PATCH /api/marketing-studio/campaigns/:id`
- `POST /api/marketing-studio/campaigns/:id/submit`
- `POST /api/marketing-studio/campaigns/:id/approve`
- `POST /api/marketing-studio/campaigns/:id/reject`
- `POST /api/marketing-studio/campaigns/:id/schedule`
- `POST /api/marketing-studio/campaigns/:id/action`

Dates sent to the API must be ISO 8601 timestamps. The UI converts Kenya local date/time to an absolute timestamp before submission.
