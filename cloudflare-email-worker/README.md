# Sylva Technologies email routing Worker

This Worker is intended to be attached to Cloudflare Email Routing rules for company aliases. It forwards each incoming message to both the existing Outlook destination and the Resend inbound address so that Outlook continues receiving mail while Resend parses the message for the admin support inbox.

## Required Worker variables

- `OUTLOOK_DESTINATION`: the already-verified Outlook destination address used by Cloudflare Email Routing.
- `RESEND_INBOUND_ADDRESS`: the receiving address shown in Resend Dashboard → Emails → Receiving (the `@...resend.app` address).

## Required backend setting

In Render, set `RESEND_INBOUND_WEBHOOK_SECRET` to the signing secret for the Resend webhook you create.

## Safe rollout

1. Deploy the Worker first.
2. Add and verify the Resend inbound address as a Cloudflare destination if Cloudflare asks for verification.
3. In Resend, create an `email.received` webhook pointing to `https://sylva-technologies-backend.onrender.com/api/support-inbox/inbound/resend`.
4. Copy the webhook signing secret to Render as `RESEND_INBOUND_WEBHOOK_SECRET`.
5. Test the Worker with one alias and verify both Outlook and the admin inbox receive the message.
6. Only then change the other active Cloudflare routing rules from direct Outlook forwarding to this Worker. Do not delete or alter the domain MX records.

The Worker forwards each message twice. Cloudflare must allow the Resend inbound address as a destination. If either forward fails, inspect the Cloudflare Worker logs before changing more routing rules.
