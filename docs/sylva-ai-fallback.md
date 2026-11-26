# Sylva AI provider fallback

Sylva AI uses a three-stage provider chain. It tries the private local Qwen model first, a smaller private Qwen model second, and Cloudflare Workers AI only when both local models fail.

## Provider order

1. **Primary local model:** \`OLLAMA_BASE_URL\` with \`OLLAMA_MODEL\` (default \`qwen2.5:3b\`).
2. **Secondary local model:** the same \`OLLAMA_BASE_URL\` with \`OLLAMA_FALLBACK_MODEL\` (default \`qwen2.5:1.5b\`).
3. **Cloudflare Workers AI:** native account Run API using \`SYLVA_AI_FALLBACK_MODEL\` (default \`@cf/meta/llama-3.1-8b-instruct\`), but only when the fallback is explicitly enabled and credentials are configured.

Both Ollama models use the same Cloudflare Access service-token headers from \`OLLAMA_ACCESS_CLIENT_ID\` and \`OLLAMA_ACCESS_CLIENT_SECRET\`. The secondary Qwen model does not need a separate endpoint, API key, tunnel, or Access service token. It must be installed on the Ollama host that serves \`OLLAMA_BASE_URL\`.

When the primary Qwen request has a transient connection/provider failure, the backend opens a short in-process circuit (30 seconds by default). During cooldown, it skips the primary model and tries the secondary local model, then Cloudflare Workers AI if configured. The next request after cooldown probes the primary Qwen model again.

The same task prompt and caller-supplied parser/validator are used at every stage. Catalogue and product-content safety checks remain mandatory regardless of provider. Provider errors do not cause automatic publishing, product updates, order actions, or social posting.

## Render environment variables

Configure the private Ollama endpoint and both local model names. Set the base URL to the tunnel hostname only (no `/v1`); the backend calls Ollama's native `/api/chat` route and normalizes trailing slashes:

- \`OLLAMA_BASE_URL=https://ollama.sylvatechnologies.co.ke\`
- \`OLLAMA_MODEL=qwen2.5:3b\`
- \`OLLAMA_FALLBACK_MODEL=qwen2.5:1.5b\`
- \`OLLAMA_ACCESS_CLIENT_ID\` and \`OLLAMA_ACCESS_CLIENT_SECRET\` (Cloudflare Access service token)
- \`OLLAMA_TIMEOUT_MS=120000\`

Enable the final Cloudflare fallback only when the Workers AI account and token are ready:

- \`SYLVA_AI_FALLBACK_ENABLED=true\`
- \`CLOUDFLARE_ACCOUNT_ID\` (Cloudflare account ID)
- \`CLOUDFLARE_API_TOKEN\` (least-privilege API token with Workers AI permissions)
- \`SYLVA_AI_FALLBACK_MODEL=@cf/meta/llama-3.1-8b-instruct\`
- \`SYLVA_AI_PRIMARY_COOLDOWN_MS=30000\` (optional)
- \`SYLVA_AI_FALLBACK_MAX_TOKENS=2048\` (optional)

The Workers AI token is separate from the Cloudflare Access service token. Never put either credential in frontend environment variables or commit them to Git. Do not expose either credential in logs or API responses.

The backend enforces a minimum 120-second request timeout (configurable up to 300 seconds with `OLLAMA_TIMEOUT_MS`). Failed tunnel requests log the sanitized endpoint URL, model, timeout, HTTP status when available, and provider error detail; Cloudflare Access credentials are never logged.\n\nFor local development, keep \`OLLAMA_BASE_URL=http://127.0.0.1:11434\`. On Render, use the public hostname protected by Cloudflare Access; localhost inside Render points to the Render container, not the developer's computer.

## Cost and limits

The two Ollama stages use the user's own Ollama host and do not call a hosted inference provider. Cloudflare Workers AI is the final hosted fallback and may consume the account's free allocation or incur charges depending on the account plan and usage. Check current Cloudflare usage and pricing before enabling it. If avoiding all hosted inference charges is required, leave \`SYLVA_AI_FALLBACK_ENABLED=false\`; the two local Qwen models will still be tried.

## Rollout checklist

1. Pull both \`qwen2.5:3b\` and \`qwen2.5:1.5b\` on the Ollama host that serves the tunnel.
2. Set the Render Ollama base URL, both model names, and Cloudflare Access service-token credentials.
3. Add the Cloudflare account ID and Workers AI API token to Render secrets only if the final fallback should be active.
4. Set \`SYLVA_AI_FALLBACK_ENABLED=true\` only after verifying the Cloudflare Workers AI token and model.
5. Verify the administrator AI status endpoint reports the local fallback and Cloudflare fallback configuration correctly.
6. Test primary Qwen success, local Qwen fallback, Cloudflare fallback, and the all-providers-failed path.
7. Monitor backend provider diagnostics and Cloudflare Workers AI usage.
8. Keep the separate background AI worker disabled unless separately reviewed and enabled.
