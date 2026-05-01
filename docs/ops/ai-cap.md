# Per-Org AI Spend Cap

Soft monthly cap on AI inference spend per org per calendar UTC month. Blocks
new chat requests with HTTP 402 once recorded spend reaches the cap; a request
already in flight can still overshoot by its final token cost. Pricing is
**fail-open**: unknown models log once and price at 0 (preferred over 503ing
real users on a config typo).

## Defaults

- `AI_SPEND_CAP_CENTS=2200` — $22 default. Override per-org via
  `organization_subscriptions.ai_monthly_cap_cents` (cents, integer).
- Period: `date_trunc('month', timezone('UTC', now()))`. No cron — first
  charge of new month auto-creates a fresh ledger row.

## Behavior

- Pre-call gate: surfaces call `checkAiSpend(orgId, { bypass })`. Throws
  `AiCapReachedError` (HTTP 402 `{ error: "ai_monthly_cap_reached", currentCents, capCents, periodEnd }`)
  if `spendCents >= capCents`.
- Post-call charge: `chargeAiSpend({ orgId, model, inputTokens, outputTokens, bypass })`
  prices tokens, atomically increments the ledger, and returns post-state — all
  via the single `charge_and_check_ai_spend` RPC.
- Background workers (embedding cron, bio backfill) skip-and-log on cap; they
  never produce a 402 since there is no caller.

## Pricing

Single env var with in-code defaults that match production:

```
AI_PRICES_JSON='{"glm-5v":{"in":2000,"out":6000},"glm-5":{"in":600,"out":2200},"embed":{"in":150,"out":0}}'
```

- Keys matched case-insensitively by substring against the model name.
- `in` / `out` are cents per million tokens.
- Missing or malformed env → defaults used.
- Unknown model → log once `[ai_spend] unknown model "<x>"`, price at 0, no
  ledger write. Set up a log alert on this string.

## Raising an org's cap

```sql
UPDATE public.organization_subscriptions
   SET ai_monthly_cap_cents = 5000   -- $50
 WHERE organization_id = '<uuid>';
```

`NULL` falls back to `AI_SPEND_CAP_CENTS`.

## Admin endpoint

`GET /api/ai/<orgId>/spend` — returns `{ currentCents, capCents,
percentUsed, periodStart, periodEnd }`. Admin-only via `getAiOrgContext`.

## Dev-admin bypass

Users whose email appears in `DEV_ADMIN_EMAILS` (comma-separated) skip the
spend cap entirely: no 402, no ledger write. Bypass is wired through
`AiOrgContext.aiSpendBypass` and threaded into every `chargeAiSpend` /
`checkAiSpend` call site.

## Risks

- In-flight/concurrent overshoot: requests reserve no estimated spend before
  provider calls. A single request or several concurrent requests can exceed
  the cap by their final token cost after passing the pre-call check.
- Cap is USD-only; multi-currency not modeled.
- Unknown-model spend goes unbilled until pricing JSON is updated. Mitigate
  with the log alert above.
