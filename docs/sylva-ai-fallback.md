# Sylva AI provider fallback

Sylva AI uses the private Ollama endpoint as its primary provider and Cloudflare Workers AI as an optional secondary provider.

## Provider order

1. Primary: `OLLAMA_BASE_URL` with `OLLAMA_MODEL` (currently `qwen2.5:3b`), authenticated through Cloudflare Access service-token headers.
2. Secondary: Cloudflare Workers AI OpenAI-compatible chat completions endpoint, using `@cf/meta/llama-3.1-8b-instruct` by default.
3. When Ollama fails, the backend opens a short in-process circuit (30 seconds by default). Requests during the cooldown use the fallback immediately. The next request after the cooldown probes Ollama again, so Qwen automatically becomes primary when it recovers.

The same task prompt and parser/validator are used for both providers. Catalogue and product-content safety checks remain mandatory regardless of provider. Provider errors do not cause automatic publishing, product updates, order actions, or social posting.

## Render environment variables

Keep the existing private Ollama variables:

- `OLLAMA_BASE_URL=https://ollama.sylvatechnologies.co.ke`
- `OLLAMA_MODEL=qwen2.5:3b`
- `OLLAMA_ACCESS_CLIENT_ID` and `OLLAMA_ACCESS_CLIENT_SECRET` (Cloudflare Access service token)
- `OLLAMA_TIMEOUT_MS=90000`

Add the optional fallback settings:

- `SYLVA_AI_FALLBACK_ENABLED=true`
- `CLOUDFLARE_ACCOUNT_ID` (Cloudflare account ID)
- `CLOUDFLARE_API_TOKEN` (API token with Workers AI Read permission)
- `SYLVA_AI_FALLBACK_MODEL=@cf/meta/llama-3.1-8b-instruct`
- `SYLVA_AI_PRIMARY_COOLDOWN_MS=30000` (optional)
- `SYLVA_AI_FALLBACK_MAX_TOKENS=2048` (optional)

The Workers AI token is separate from the Cloudflare Access service token. Never put either credential in frontend environment variables or commit them to Git.

## Cost and limits

Workers AI is available on Cloudflare Free and Paid Workers plans. The Free allocation is 10,000 Neurons per day; on the Free plan, requests stop when the daily allocation is exhausted. Paid usage above the free allocation is billed. Check current Cloudflare pricing and usage before enabling this in production. This is a limited fallback, not unlimited free inference.

The default Llama 3.1 8B model supports Cloudflare Workers AI JSON Mode, required for structured Sylva outputs.

## Rollout

1. Add the Cloudflare account ID and a least-privilege Workers AI API token to Render.
2. Enable the fallback flag only after confirming the token and model can answer a test request.
3. Test both provider paths and the shared content validators.
4. Monitor Workers AI Neuron usage and backend provider errors.
5. Keep the background AI worker disabled unless separately reviewed and enabled.
