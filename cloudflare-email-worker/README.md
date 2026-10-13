# Sylva Technologies email routing Worker

This Cloudflare Email Worker delivers incoming company mail to the verified Outlook destination and posts the original RFC 822 message to the Sylva Technologies backend. The backend parses the email and saves it in both the support inbox and unified mailbox, so it appears in Sylva Mail.

## Worker variables and secrets

- `OUTLOOK_DESTINATION` (variable, optional): verified destination address. Defaults to `sylvatechnologies@outlook.com`.
- `BACKEND_INBOUND_URL` (variable, optional): defaults to `https://sylva-technologies-backend.onrender.com/api/support-inbox/inbound/cloudflare`.
- `CLOUDFLARE_EMAIL_WORKER_SECRET` (secret, required): shared secret used to authenticate Worker requests to the backend. Set the same value in Cloudflare Worker secrets and Render environment variables. Do not commit or share the value.

## Render backend configuration

In the Render service `Sylva-Technologies-Backend`, add:

- `CLOUDFLARE_EMAIL_WORKER_SECRET`: a long, random secret that you create. Use the exact same value in the Cloudflare Worker secret. Never paste it into GitHub or chat.

The backend route `POST /api/support-inbox/inbound/cloudflare` already validates this secret, parses the raw email, and stores the message in the support inbox and unified mailbox, including attachment metadata and small attachments.

## Deploy and test

1. In Cloudflare, open the `sylva-mail-router` Worker and replace its editor code with `src/index.js` from this folder (or connect this folder to a deployment workflow).
2. Add `CLOUDFLARE_EMAIL_WORKER_SECRET` as a **secret** in Worker settings. Use the same value in Render's environment variables.
3. Keep `OUTLOOK_DESTINATION` set to the already-verified `sylvatechnologies@outlook.com` address, or use the default.
4. Deploy the Worker and confirm it is Ready.
5. Keep the existing active Cloudflare routing rule pointing to this Worker.
6. Send one test email to `support@sylvatechnologies.co.ke`. Confirm it arrives in Outlook and appears in the website's Sylva Mail inbox.
7. Only after the test succeeds, point other desired aliases (sales, admin, orders, etc.) to the same Worker. Do not change domain MX records.

For safety, the Worker forwards to Outlook first. If the backend request fails, the Outlook delivery is not intentionally rolled back. Raw messages over 6 MiB are forwarded to Outlook but are not copied into Sylva Mail; check Worker logs for that case.
