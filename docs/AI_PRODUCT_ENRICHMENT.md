# Sylva AI product enrichment

## Automatic sync workflow

The backend starts `aiProductContentWorker` after MongoDB connects. The worker checks the private AliExpress catalogue queue every five seconds and claims one pending product at a time. Newly staged or synced products are queued automatically; unchanged generated drafts are retained, while changed source facts are re-queued using the product content source hash.

The worker runs only when `GEMINI_API_KEY` is configured. It uses `GEMINI_MODEL` when set, otherwise `gemini-3.5-flash-lite`.

## Web research

Product enrichment calls Gemini's `generateContent` API with the `google_search` grounding tool. The model is instructed to search the exact product/model, prefer the manufacturer's official product or support page, and use reputable technical sources only when the manufacturer page is unavailable. Grounding source URLs and search queries are stored with the draft and copied into the product's `contentGeneration.researchSources` metadata after approval.

Google Search grounding may incur Google AI API usage charges. Review current Gemini API pricing and the project's quotas before syncing large batches.

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
