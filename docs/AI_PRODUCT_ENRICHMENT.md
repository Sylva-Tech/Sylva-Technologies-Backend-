# Sylva AI product enrichment

## Automatic sync workflow

The backend starts `aiProductContentWorker` after MongoDB connects. The worker checks the private AliExpress catalogue queue every 15 seconds by default (configurable with `GEMINI_WORKER_INTERVAL_MS`, bounded to 10–60 seconds) and claims one pending product at a time. Newly staged or synced products are queued automatically; unchanged generated drafts are retained, while changed source facts are re-queued using the product content source hash.

The worker runs only when `GEMINI_API_KEY` is configured. It uses `GEMINI_MODEL` when set, otherwise `gemini-3.5-flash-lite`.

## Web research

Product enrichment calls Gemini's `generateContent` API with the `google_search` grounding tool. The model is instructed to search the exact product/model, prefer the manufacturer's official product or support page, and use reputable technical sources only when the manufacturer page is unavailable. Grounding source URLs and search queries are stored with the draft and copied into the product's `contentGeneration.researchSources` metadata after approval.

Google Search grounding may incur Google AI API usage charges. Review current Gemini API pricing and the project's quotas before syncing large batches.

## Quota protection and recovery

A persistent MongoDB-backed circuit breaker protects the whole Gemini product-content provider. When Gemini returns HTTP 429 with an explicit quota, billing, daily-limit or spending-limit message, the service pauses automatic and manual content generation for 24 hours by default. This is intentionally different from a temporary per-minute rate limit, which follows normal bounded retry handling. The pause survives Render restarts and prevents each queued product from independently consuming retries. Products remain pending; quota exhaustion does not mark them as permanently failed.

The admin endpoint `/api/aliexpress/catalog/ai/status` reports `providerStatus`, `pauseReason`, `pausedAt`, `resumeAt`, the cooldown and queue counts. Set `GEMINI_QUOTA_COOLDOWN_MINUTES` to a value from 15 to 1440 if a different cooldown is appropriate. After checking and restoring Google AI Studio quota/billing, an administrator can POST `{ "confirm": true }` to `/api/aliexpress/catalog/ai/resume` to clear the pause and release queued drafts immediately. The resume action is admin-authenticated and requires explicit confirmation.

## Generated content

The draft can contain:
- Verified brand and model number when supported by exact-model research
- Structured name/value specifications
- Key features, short description and full HTML description
- SEO title, meta description, marketing tags and social caption
- Warnings, suggestions, missing information and research citations

The product's source attributes remain available as evidence. AI-generated specifications are merged into the public specification map at approval, with AI values taking precedence for duplicate labels.

## Returns, warranties and publishing safeguards

AI must not invent or modify return periods, refund promises, warranty terms, delivery promises, or Sylva's legal/store policy. The product draft uses a fixed notice directing customers to the published Sylva Returns & Refunds policy. Product-specific warranty or return commitments require verified source data and administrator review.

AI has no authority to set prices, exchange rates, stock, categories, product visibility, approval status, supplier orders, payments, wallets or other financial data. Products remain private until an administrator approves them through the existing review workflow.

## Operational checks

- Confirm `GEMINI_API_KEY` is present in the Render backend environment.
- Check the admin AliExpress AI status endpoint for `webResearchEnabled` and `automaticEnrichmentAfterSync`.
- Review draft `researchSources`, `specifications` and `warnings` before approving a product.
- A product can still be reviewed if web research returns no source; in that case `researchStatus` is `no_sources_found` and unsupported specifications must remain omitted.


## Multi-provider AI catalogue workspace

The protected admin workspace is available at `/admin/catalogue-ai`. Its backend endpoints are mounted under `/api/catalogue-ai`:
- `GET /status` reports provider configuration without exposing secrets.
- `GET /products` returns a limited admin product list for selecting an existing listing.
- `POST /generate` accepts `CREATE`, `SYNC_CLEANUP` or `REFINE_EDIT` and returns a draft only.
- `POST /products/:id/apply` requires `confirm: true` and applies only descriptive and SEO fields.

Qwen 2.5 7B is preferred when `OLLAMA_BASE_URL` is configured. The endpoint must be reachable from the Render service; `http://localhost:11434` on a developer PC is not reachable from Render. If Ollama is unavailable or returns invalid content, Gemini is used as fallback. Gemini fallback uses Google Search grounding. The Ollama prompt is explicitly told that it has no web-search grounding and must use only supplied product facts.

Configure `OLLAMA_BASE_URL`, `OLLAMA_MODEL=qwen2.5:7b`, and optionally `OLLAMA_TIMEOUT_MS` in the backend environment. Keep `GEMINI_API_KEY` configured for fallback. The frontend displays whether each provider is configured, not its secret or endpoint.

Generated content remains a draft until an administrator reviews it. Applying a draft changes only description, short description, key features, specifications, SEO title, SEO description and marketing tags. It does not change price, stock, SKU, product code, category assignment, images, ownership, approval status, visibility, order state, payments or supplier fulfilment. Delivery, warranty and returns text is preserved as provided and is not independently authorised by the AI.
