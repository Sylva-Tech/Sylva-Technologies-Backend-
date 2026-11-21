# Sylva Video Creator

## What this release does

The first Sylva-native video workflow is local-first and does not call a paid video provider.

1. An authenticated administrator selects an active, approved, in-stock catalogue product in Marketing Studio.
2. The backend retrieves current product facts and sends a constrained creative brief to the existing Ollama endpoint (OLLAMA_BASE_URL, OLLAMA_MODEL).
3. Sylva AI returns a short storyboard, scene overlays, a voiceover script, a caption and hashtags.
4. The administrator reviews the storyboard and renders a vertical 1080 × 1920 WebM video in the browser using the catalogue product image, typography and simple motion.
5. The video is downloaded to the administrator's computer. The voiceover script can be copied and recorded separately.

## API

POST /api/marketing-studio/videos/script

Protected by the existing Marketing Studio protect and adminOnly middleware and a dedicated rate limit.

Example request:

```json
{ "productId": "approved-product-object-id", "platform": "instagram", "style": "clean-premium", "durationSeconds": 20 }
```

The API only accepts a product that is active, approved and in stock. Product claims are grounded in the selected product record. The AI must not invent specifications, discounts, delivery promises, reviews, warranties or scarcity.

## Environment

This reuses the existing Sylva AI configuration. No new provider keys, subscriptions, paid APIs or extra environment variables are required:

- OLLAMA_BASE_URL
- OLLAMA_MODEL (defaults to qwen2.5:3b)
- OLLAMA_TIMEOUT_MS (optional; defaults to 90 seconds)

The backend host must already be able to reach the configured Ollama endpoint. If the existing endpoint uses Cloudflare Access service tokens, retain the backend's established network/authentication configuration; do not expose an unauthenticated Ollama endpoint publicly.

## Current limitations (intentional)

- The renderer exports browser-native WebM, not MP4.
- The first release is a motion-graphics product video, not generated live-action footage or a talking human presenter.
- The video has no embedded voice track. Sylva generates a voiceover script for separately recorded narration.
- The rendered file is downloaded locally; it is not uploaded to the campaign, scheduled or automatically published.
- Facebook, Instagram, TikTok and WhatsApp publishing still requires official platform app permissions, connected business accounts and an explicit approval/publishing workflow.
- Use only catalogue images and assets Sylva has rights to use. Review all generated copy and product claims before publishing.

## Privacy and cost

The browser renderer uses the administrator's device. Storyboard generation uses the existing self-hosted Ollama model. No video provider is called, no paid credits are consumed, and no third-party media assets are fetched by the renderer other than the product image already stored in the catalogue.