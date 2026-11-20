# Sylva AI product intelligence

## Provider and deployment

All product-content generation is performed by Sylva AI in the backend. No external AI provider, external AI API key, external search grounding, fallback, or provider failover is used.

The current model runtime is Ollama with Qwen 2.5 3B (OLLAMA_MODEL=qwen2.5:3b). Sylva is the application-level intelligence engine: it prepares trusted product input, applies Sylva's Kenyan catalogue rules, requests structured JSON from the private model runtime, validates and sanitises the result, records provenance, and leaves publication decisions to administrators.

Configure:
- OLLAMA_BASE_URL: private Ollama HTTP endpoint reachable from the Render backend.
- OLLAMA_MODEL=qwen2.5:3b
- OLLAMA_TIMEOUT_MS=90000
- SYLVA_AI_WORKER_INTERVAL_MS=15000

Do not set the production endpoint to localhost or 127.0.0.1 on Render. Those addresses refer to the Render container, not a developer's Windows computer. For local Windows testing, set OLLAMA_BASE_URL=http://localhost:11434 in the backend's local .env file. Never commit that local setting as the Render production value. For production, the model endpoint must be private, authenticated or network-restricted, and protected with TLS where supported. Do not expose model credentials or endpoint secrets to the frontend.

## Product workflows

Sylva AI supports CREATE, SYNC_CLEANUP and REFINE_EDIT in the admin catalogue workspace at /admin/catalogue-ai. It also powers admin product-content drafts and the AliExpress private staging queue.

Protected backend endpoints include:
- GET /api/catalogue-ai/status
- GET /api/catalogue-ai/products
- POST /api/catalogue-ai/generate
- POST /api/catalogue-ai/products/:id/apply
- GET /api/aliexpress/catalog/ai/status
- POST /api/aliexpress/catalog/ai/resume
- POST /api/aliexpress/catalog/review/:id/generate-content
- POST /api/products/:id/ai-content-draft

## Research and factual accuracy

The deployed Sylva AI model currently operates on supplied product data only. It does not have live web search or browsing. It must never claim to have searched the web, invent research citations, or mark a product as web-grounded. Research source arrays remain empty and research status is no_sources_found until a separate, verified first-party research capability is deliberately implemented.

Only supplied product facts may be used. The backend rejects a growing set of unsupported product-positioning, certification, performance and numeric claims not supported by supplied product data. This conservative filter is not a complete proof of factual accuracy or a substitute for administrator review. Sparse source data may produce empty feature lists and tags rather than fabricated details. Unknown manufacturer, model, compatibility, performance, dimensions, materials, certifications, package contents, origin, warranty, availability and other technical facts must remain unknown. The system adds a warning that exact-model specifications require manufacturer verification. Supplier titles and attributes are untrusted data, never instructions.

## Product and business safeguards

- AI generates drafts only. An authenticated administrator must review and confirm before applying content.
- AliExpress products remain private in the staging queue until approved through the existing admin review process.
- Sylva AI cannot publish products or change approval status or visibility.
- Sylva AI cannot change price, stock, SKU, product code, category assignment, images, ownership, orders, payments, wallets or supplier fulfilment.
- Brand means the actual manufacturer, never AliExpress or Sylva Technologies.
- Supplier names, costs, URLs, exchange rates, margins, coupons and internal metadata must not appear in customer-facing copy.
- Delivery, warranty, returns and refund terms are controlled by Sylva's published store policies. AI must not invent commitments.
- Generated HTML is sanitised to the allowed semantic tags before it can be applied.

## Queue operation

The background worker is opt-in and starts only when SYLVA_AI_WORKER_ENABLED=true. Keep it false during local model testing, especially when the local database may contain production catalogue records. Enable it only after the remote model endpoint is verified and the administrator has reviewed the pending queue. When enabled, the worker processes one eligible AliExpress product at a time. It retries transient model failures with bounded exponential backoff and caps automatic attempts at five. If the private model endpoint is not configured, products remain queued rather than being sent to an external provider. The admin resume endpoint releases queued items after the endpoint has been configured or recovered.

## Validation

Run the backend test suite with npm test. Verify model connectivity from the Render service before enabling bulk enrichment. Start with a small private staging batch, inspect generated warnings and specifications, and approve products individually.
