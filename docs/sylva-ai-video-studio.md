# Sylva AI Video Studio — product requirements and safe implementation plan

## Product goal

Add an on-demand video creation workspace to Sylva Marketing Studio. An administrator should be able to select an eligible Sylva catalogue product, generate a short promotional video when needed, review it, regenerate scenes or narration, approve it, and attach it to a campaign. Generation requests should be accepted at any time; video rendering itself is an asynchronous job and must show honest queued, processing, ready, failed, and cancelled states.

The product must not claim that a video is guaranteed to go viral, attract likes, earn revenue, or qualify for monetization. Those outcomes depend on audience response, platform rules, account eligibility, originality, rights, and distribution.

## Creative quality requirements

- Natural-looking human presenters with realistic facial movement, eye contact, posture, gestures, lighting, skin texture, and believable lip synchronization.
- Natural human-sounding narration with controllable accent, pace, tone, pauses, and pronunciation. Avoid robotic cadence and repetitive stock scripts.
- Product demonstrations must use the selected product's verified images, specifications, price, stock, and product URL. Never invent features, certifications, warranty claims, discounts, reviews, or availability.
- Prefer real product footage/images and clearly staged demonstrations. Generated scenes must not depict a different model or imply a feature that the product does not have.
- Support short vertical 9:16, square 1:1, and landscape 16:9 exports, with platform-specific safe areas, captions, and audio levels.
- Generate editable scene plans, script, voiceover, subtitles, thumbnail, and final video as separate reviewable assets.
- Provide multiple creative directions (presenter-led demo, unboxing-style showcase, problem/solution, and feature explainer) without copying another creator's video or style too closely.
- Make the content useful and entertaining: a clear opening hook, concise product benefit, evidence-based demonstration, transparent price/offer, and clear call to action.

## On-demand workflow

1. Admin selects an active, approved, in-stock product and chooses the target platform, duration, aspect ratio, language/voice, and creative direction.
2. Sylva AI creates a fact-grounded script and storyboard from the product record.
3. Admin reviews product claims, script, presenter, voice, and scene plan before rendering.
4. A configured video provider renders the job asynchronously; webhook/polling updates its state.
5. Sylva stores the finished asset in durable object storage, validates its MIME type, duration, dimensions, size, and audio track, and creates a thumbnail and caption file.
6. Admin previews the video, edits the script/scenes, or regenerates selected scenes.
7. Admin explicitly approves the final asset and attaches it to a campaign.
8. Campaign approval and the official platform publishing workflow remain separate gates.

## Provider architecture

Use a provider adapter interface rather than binding campaign code to one vendor. The selected provider must support commercial use for the selected plan, realistic human generation or licensed presenter assets, output ownership/licensing clarity, API-based asynchronous jobs, secure callbacks, and a documented retention policy.

Keep provider credentials only in Render secrets. Encrypt any per-account provider tokens at rest. Never put API keys in frontend code, Git, browser storage, logs, or generated prompt text. Add provider timeouts, bounded retries, idempotency keys, job quotas, cost limits, cancellation, and admin audit history.

Do not silently fall back to an unapproved provider or send private product/customer data to an external model. Show the provider and estimated cost before a paid render, and require an administrator to confirm spend.

## Human likeness, consent, and transparency

- Use licensed synthetic presenters, stock actors with commercial releases, or a real person who has given documented permission.
- Never clone a real person's face or voice without explicit, recorded consent and the rights required by the provider.
- Do not impersonate celebrities, influencers, customers, employees, or public figures.
- Do not create fabricated customer testimonials, fake unboxing reactions, fake endorsements, or synthetic before/after evidence.
- Preserve provider provenance and add AI-generated/synthetic-media disclosure where the platform, law, or context requires it. Do not remove provenance or watermarks when removal would violate provider terms.
- Avoid misleading lip-sync or edits that make a person appear to say something they did not consent to say.

## Monetization and audience quality

Design for platform monetization eligibility and customer trust, not engagement manipulation:
- Produce original, varied videos with meaningful product education or entertainment; avoid mass-produced near-duplicates and low-effort template spam.
- Use music, fonts, stock footage, voice, and presenter assets with documented commercial rights for the intended platforms and territories.
- Do not use copyrighted songs, logos, creator footage, or customer images unless Sylva has the necessary rights and permissions.
- Do not buy likes, views, followers, comments, or use bots/engagement pods.
- Do not promise monetization approval or revenue. Provide a pre-publish checklist for each platform's current originality, disclosure, account, music, and monetization requirements.
- Track campaign metrics only through official platform APIs and clearly distinguish views, watch time, clicks, likes, and attributed sales.

## Job states and data model expectations

Suggested states: draft, awaiting_review, queued, processing, ready_for_review, approved, attached_to_campaign, failed, cancelled, expired.

Each job should record:
- Admin creator and selected product ID plus a read-only product snapshot.
- Prompt/template version, script, storyboard, voice/presenter asset identifiers and rights metadata.
- Provider/job identifiers, request idempotency key, timestamps, cost estimate/actual cost, safe failure code.
- Asset object keys, checksums, MIME type, dimensions, duration, captions, thumbnail and retention/expiry.
- Review decisions, approvals, edits and regeneration history.

A render completing successfully does not mean the asset is approved or published. Do not auto-publish generated videos.

## Rollout

1. Confirm the chosen video provider, commercial rights, pricing, realistic-human quality, and API access.
2. Build the admin video workspace and provider-neutral job model/API.
3. Add one provider adapter with queued rendering, callback verification, storage and cost limits.
4. Add review/edit/regenerate and attach-to-campaign controls.
5. Validate export specs and licensing for Facebook, Instagram, TikTok and WhatsApp Business.
6. Connect the existing official publishing adapters only after each platform account and permission has been approved.

## Current status

The current Marketing Studio release has campaign creation, eligible product selection, approvals and Kenya-time scheduling. It does not yet generate video files or publish social posts. This document defines the implementation target; it does not imply a video provider or social account is already connected.
