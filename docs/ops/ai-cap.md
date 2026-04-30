# Per-Org AI Spend Cap

Soft monthly cap on AI inference spend per org per calendar UTC month. The
system fails closed when pricing is not configured and blocks new calls once
recorded spend reaches the cap; a request already in flight can still overshoot
by its final token cost.

## Defaults

- `AI_SPEND_CAP_CENTS=2200` — $22 default. Override per-org via
  `organization_subscriptions.ai_monthly_cap_cents` (cents, integer).
- Period: `date_trunc('month', timezone('UTC', now()))`. No cron — first
  charge of new month auto-creates a fresh ledger row.

## Behavior

- Pre-call: `assertOrgUnderCap(orgId)` throws `AiCapReachedError` if
  `spendCents >= capCents`. Routes return HTTP 402 JSON
  `{ error: "ai_monthly_cap_reached", currentCents, capCents, periodEnd }`.
- Preflight pricing: metered surfaces call `assertModelPriceConfigured(model)`
  before vendor calls so missing `AI_PRICE_*` env configuration returns 503 or
  skips background work instead of producing unmetered usage.
- Post-call: `recordSpend({ orgId, model, inputTokens, outputTokens, surface })`
  prices tokens via env vars and atomically increments the ledger via the
  `charge_ai_spend` RPC. API/worker paths await this write before finalizing
  the operation where the platform lifecycle could otherwise drop a detached
  promise.
- Background workers (embedding cron, bio backfill) skip-and-log on cap;
  they never produce a 402 since there is no caller.

## Pricing env vars

Microdollars per token = `cents_per_mtok / 100`. Set per model family;
helper throws if a model has no env entry — caller must surface 503.

```
AI_SPEND_CAP_CENTS=2200

# Z.AI glm-5.1 (chat)
AI_PRICE_GLM_5_1_INPUT_PER_MTOK=600
AI_PRICE_GLM_5_1_OUTPUT_PER_MTOK=2200

# Z.AI glm-5v-turbo (vision/schedule extraction)
AI_PRICE_GLM_5V_INPUT_PER_MTOK=2000
AI_PRICE_GLM_5V_OUTPUT_PER_MTOK=6000

# Gemini embedding
AI_PRICE_GEMINI_EMBED_PER_MTOK=150
```

## Vendor price verification (TODO)

Reconcile placeholders above against current vendor pricing before launch
and on every quarterly review:

- [ ] Z.AI glm-5.1 input/output (https://docs.z.ai/pricing)
- [ ] Z.AI glm-5v vision input/output
- [ ] Gemini embedding (https://ai.google.dev/pricing)

## Raising an org's cap

Manual SQL only (no admin UI in v1):

```sql
UPDATE public.organization_subscriptions
   SET ai_monthly_cap_cents = 5000   -- $50
 WHERE organization_id = '<uuid>';
```

`NULL` falls back to `AI_SPEND_CAP_CENTS`.

## Admin endpoint

`GET /api/ai/<orgId>/spend` — returns `{ currentCents, capCents,
percentUsed, periodStart, periodEnd }`. Admin-only via `getAiOrgContext`.

## Risks

- In-flight/concurrent overshoot: requests reserve no estimated spend before
  provider calls. A single request or several concurrent requests can exceed the
  cap by their final token cost after passing the pre-call check. Acceptable for
  v1; pre-flight reservation with release/settlement is future work.
- Cap is USD-only; multi-currency not modeled in v1.
- Tools that bypass the central helpers (`response-composer`, `safety-gate`,
  `rag/grounding`, `schedule-extraction`, `bio-generator`, `embeddings`)
  will not record spend. Audit before merging any new direct
  `createOpenAIClient`/`createZaiClient` call.
