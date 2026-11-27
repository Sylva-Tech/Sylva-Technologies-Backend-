# Meta Facebook Page publishing

Sylva Marketing Studio connects only to the Facebook Page whose exact name is **Sylva Technologies**. It does not publish to personal profiles and does not guess a Page ID from the website footer's share link.

## Render environment

Set these on the backend service. Never put the app secret or encryption key in frontend variables or GitHub.

- `META_APP_ID`: the existing Sylva Meta app ID.
- `META_APP_SECRET`: the app secret from Meta App Settings.
- `META_REDIRECT_URI`: `https://api.sylvatechnologies.co.ke/api/meta/facebook/callback`.
- `META_GRAPH_API_VERSION`: `v27.0`.
- `META_TOKEN_ENCRYPTION_KEY`: a fresh 32-byte hexadecimal key (64 hex characters). Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `META_DATA_DELETION_STATUS_URL`: `https://api.sylvatechnologies.co.ke/api/meta/facebook/data-deletion`.

The encryption key must be retained safely. Losing it makes stored Page tokens unreadable and requires reconnecting the Page.

## Meta app settings

Configure the existing Meta app:

- Valid OAuth redirect URI: `https://api.sylvatechnologies.co.ke/api/meta/facebook/callback`.
- Data deletion callback URL: `https://api.sylvatechnologies.co.ke/api/meta/facebook/data-deletion`.
- Data deletion instructions URL: `https://www.sylvatechnologies.co.ke/privacy`.
- Request only `pages_show_list`, `pages_read_engagement`, and `pages_manage_posts` for this integration.

The administrator connecting the Page must have the Page's `CREATE_CONTENT` or `MANAGE` task. Sylva verifies the exact Page name and does not connect similarly named Pages.

## How publishing works

1. An active Sylva administrator starts OAuth from Admin > Marketing Studio.
2. The backend exchanges the authorization code, verifies the granted permissions, discovers the administrator's Pages and selects the exact Sylva Technologies Page.
3. Sylva encrypts the Page access token using AES-256-GCM before storing it in MongoDB. Tokens are never returned to the frontend or written to logs.
4. An approved campaign is scheduled directly through the Meta Page Feed, Photos or Videos endpoint with `published=false` and `scheduled_publish_time`. Meta performs the actual publication at the selected time; it does not depend on the Render free web service staying awake.
5. When the Marketing Studio campaign list is opened after the scheduled time, Sylva checks Meta's post status and stores the published status and permalink.
6. Cancelling a Facebook-scheduled campaign removes the scheduled post from Meta. Disconnecting the Page cancels pending Facebook schedules before deleting the locally stored Page token.

For safety, Facebook schedules are accepted only between 10 minutes and 75 days in the future. Instagram, TikTok and WhatsApp remain separate integrations and are marked as skipped until their own APIs are connected.

## Data deletion

Meta's signed `signed_request` is verified using the Meta app secret. Sylva removes the matching Page connection and token, attempts to cancel pending Facebook schedules, and stores a confirmation code plus a keyed HMAC-SHA-256 hash of the Meta user ID (not the raw ID). The status endpoint returns the deletion confirmation.

## Test checklist (Meta development mode)

- Configure the Render variables and the exact OAuth redirect URI above.
- Add the administrator who will connect the Page as an app role/tester while the Meta app is in development mode.
- Confirm the account can manage the official Sylva Technologies Page and has the `CREATE_CONTENT` task.
- Open Admin > Marketing Studio and connect Facebook. Confirm the UI shows **Sylva Technologies** and its Page ID.
- Create a campaign, upload an approved image or video if desired, submit it for approval, approve it, and schedule it at least 10 minutes in the future.
- Confirm the post appears in the Page's Scheduled Posts in Meta Business Suite.
- After the selected time, confirm it appears on the Page and the Sylva campaign shows **Published** with a working post link.
- Test cancellation before the scheduled time and verify the post disappears from Meta Scheduled Posts.
- Test the data deletion callback with Meta's test facility before submitting the app for review.

Do not submit for App Review until the deployed production callback, real Page connection, scheduled post, published-post status, disconnect and data-deletion behaviour have all been tested. Meta may separately require Business Verification and Advanced Access review.
