---
title: Per-user pricing for new orgs (volume tiers)
created: 2026-05-01
status: active
owner: matt
---

# Per-user pricing for new organizations

## Problem frame

Today TeamNetwork bills organizations using six **flat bucket** alumni tiers
plus a fixed $15/mo base for active members. The marketing site has been
updated to advertise **per-user volume pricing**: one rate per active member,
one rate per alumni, with the rate dropping at quantity thresholds. The bucket
model in code, schema, and Stripe Prices contradicts the public pricing
narrative.

We need to switch *new organization signups* to per-user volume pricing while
**leaving existing paying organizations on their current Stripe subscriptions
untouched**.

## Origin

Direct user request on 2026-05-01. Source of truth for rates is
`apps/web/src/components/marketing/PricingSection.tsx` (landing page) and
the screenshots the user shared:

- Active members (volume — all heads at the rate of the bucket their total falls in):
  - 1–100 actives: $0.15/mo each
  - 101–500 actives: $0.10/mo each
  - 501+ actives: $0.05/mo each
- Alumni (volume):
  - 1–500 alumni: $0.36/mo each
  - 501–2,500 alumni: $0.25/mo each
  - 2,501–10,000 alumni: $0.18/mo each
  - 10,000+ alumni: contact sales
- Yearly = 10× monthly (≈17% discount)
- Existing orgs grandfathered on legacy bucket pricing.

## Scope

### In scope

1. New pricing module (`packages/core/src/pricing/per-user.ts`) with volume tier math.
2. Stripe Price objects (one active, one alumni, monthly + yearly = 4 total) with `tiers_mode: "volume"`.
3. New env vars for the four price IDs.
4. DB schema: `organization_subscriptions.pricing_model` + seat count columns.
5. Migration: tag all existing orgs `pricing_model = "legacy_bucket"`.
6. `/api/stripe/create-org-checkout` route — new flow for `pricing_model = "per_user"` with seat-count quantities.
7. Stripe webhook updates (`subscription.updated`, `customer.subscription.created`) — handle per-user line items, persist seat counts.
8. Mobile create-org form — replace alumni bucket picker with **two number inputs** (estimated active members, estimated alumni) + live calculator.
9. Web create-org form — same as mobile.
10. Validation schemas in `@teammeet/validation` — new `createOrgSchema` accepts `activeSeats` + `alumniSeats` for per-user, retains old shape for legacy.
11. Settings UI for admins to update seat counts post-checkout (web + mobile).
12. Read-only display in org settings: which pricing model the org is on.
13. Landing-page CTA flow continues to land on create-org with new fields.

### Out of scope (deferred)

- Automatic seat sync from `user_organization_roles` table (manual update for v1).
- Migrating existing legacy orgs to per-user pricing.
- Donations pricing (Stripe Connect platform fee — unchanged).
- New tier above 10,000 alumni (still sales-led).
- Trial period changes — keep current 30-day trial gating rules.
- Currency support beyond USD.

### Scope boundaries (non-goals)

- Do not edit any subscription that has `pricing_model = "legacy_bucket"`.
- Do not change Stripe Price IDs already in production env.
- Do not delete bucket-based pricing code — legacy orgs still use it.

## Key decisions

### D1: Volume tiers, not graduated.

Confirmed by landing page calculator (200 actives × $0.10 = $20, all 200 at the
$0.10 rate because 200 falls in 101–500). Stripe `tiers_mode: "volume"` matches.

### D2: Seat count declared at checkout, admin-editable later.

V1 trades automatic syncing for shipping speed. Admin enters estimated counts
in create-org form, those become Stripe `subscription_item.quantity`. Settings
page lets admin bump quantities later. **Trust model:** admins are
incentivized to keep counts accurate to grant access; no enforcement RLS yet.

### D3: Two parallel pricing models in code.

`pricing_model` column distinguishes. Webhook + checkout + settings branch on
it. Legacy code path stays intact for grandfathered orgs.

### D4: 10,000+ alumni still sales-led.

Reuses existing `isSalesLedBucket` pattern. Add equivalent for per-user:
`alumniSeats > 10_000` → sales-led path, no Stripe checkout.

### D5: Trial preserved.

Current trial rules (`getOrgFreeTrialRequestError`) carry over. Trial gates on
monthly + below sales-led threshold. Per-user trial uses same Stripe
`trial_period_days: 30` mechanism.

### D6: Yearly = 10× monthly per-rate.

Each Stripe Price ID is its own object; yearly tiers store the yearly cents
directly. Calculator math: yearly = `monthlyRate * 10` for display.

## Pricing math

```ts
// packages/core/src/pricing/per-user.ts

export type SeatRate = { upTo: number | null; unitAmount: number }; // cents

export const ACTIVE_TIERS_MONTHLY: SeatRate[] = [
  { upTo: 100,  unitAmount: 15 },  // $0.15
  { upTo: 500,  unitAmount: 10 },  // $0.10
  { upTo: null, unitAmount: 5 },   // $0.05 — 501+
];

export const ALUMNI_TIERS_MONTHLY: SeatRate[] = [
  { upTo: 500,    unitAmount: 36 }, // $0.36
  { upTo: 2500,   unitAmount: 25 }, // $0.25
  { upTo: 10_000, unitAmount: 18 }, // $0.18
  // > 10_000 = sales-led, no row here.
];

export const ACTIVE_TIERS_YEARLY = ACTIVE_TIERS_MONTHLY.map(t => ({ ...t, unitAmount: t.unitAmount * 10 }));
export const ALUMNI_TIERS_YEARLY = ALUMNI_TIERS_MONTHLY.map(t => ({ ...t, unitAmount: t.unitAmount * 10 }));

export const SALES_LED_ALUMNI_THRESHOLD = 10_000;

export function pickRate(tiers: SeatRate[], qty: number): number {
  for (const t of tiers) if (t.upTo === null || qty <= t.upTo) return t.unitAmount;
  return tiers[tiers.length - 1].unitAmount;
}

export function calcMonthlyCents(actives: number, alumni: number): number {
  const a = actives * pickRate(ACTIVE_TIERS_MONTHLY, actives);
  const al = alumni > 0 ? alumni * pickRate(ALUMNI_TIERS_MONTHLY, alumni) : 0;
  return a + al;
}

// Yearly equivalent uses *_YEARLY tier rates.
```

## Database changes

### Migration: `20260501000000_add_per_user_pricing.sql`

```sql
-- New pricing model column
alter table public.organization_subscriptions
  add column pricing_model text not null default 'legacy_bucket'
    check (pricing_model in ('legacy_bucket','per_user'));

-- Seat counts (NULL when legacy)
alter table public.organization_subscriptions
  add column active_seat_count integer,
  add column alumni_seat_count integer;

-- Stripe per-user subscription item ids (one per line item, NULL when legacy)
alter table public.organization_subscriptions
  add column stripe_active_item_id text,
  add column stripe_alumni_item_id text;

-- All existing rows are legacy_bucket by default — explicit anchor:
update public.organization_subscriptions
  set pricing_model = 'legacy_bucket'
  where pricing_model is null;

-- For per_user rows, seat counts must be set
alter table public.organization_subscriptions
  add constraint per_user_seats_check
  check (
    pricing_model = 'legacy_bucket'
    or (active_seat_count is not null and active_seat_count >= 0
        and alumni_seat_count is not null and alumni_seat_count >= 0)
  );
```

## Stripe setup (manual prerequisites)

User creates 4 new Price objects in Stripe Dashboard with `tiers_mode = "volume"`:

| Env var | Product | Interval | Tiers |
|---|---|---|---|
| `STRIPE_PRICE_ACTIVE_MONTHLY` | Active Members | month | 1–100 @ $0.15, 101–500 @ $0.10, 501+ @ $0.05 |
| `STRIPE_PRICE_ACTIVE_YEARLY`  | Active Members | year  | 1–100 @ $1.50, 101–500 @ $1.00, 501+ @ $0.50 |
| `STRIPE_PRICE_ALUMNI_MONTHLY` | Alumni Access  | month | 1–500 @ $0.36, 501–2500 @ $0.25, 2501–10000 @ $0.18 |
| `STRIPE_PRICE_ALUMNI_YEARLY`  | Alumni Access  | year  | 1–500 @ $3.60, 501–2500 @ $2.50, 2501–10000 @ $1.80 |

Each price is `tiers_mode: "volume"`, `billing_scheme: "tiered"`, `usage_type: "licensed"`.

Validation in `next.config.mjs` adds the four new env vars.

## Implementation units

### U1: Pricing module + tests

**Files:**
- Create `packages/core/src/pricing/per-user.ts`
- Create `packages/core/src/pricing/__tests__/per-user.test.ts`
- Modify `packages/core/src/index.ts` (export new module)

**Patterns to follow:** existing `packages/core/src/pricing/index.ts`.

**Test scenarios:**
- 1 active, 0 alumni → $0.15
- 100 actives → 100 × $0.15 = $15.00
- 101 actives → 101 × $0.10 = $10.10 (volume kicks in)
- 500 actives → $50.00; 501 actives → 501 × $0.05 = $25.05
- 750 alumni → 750 × $0.25 = $187.50
- 200 actives + 750 alumni → $20.00 + $187.50 = $207.50 (matches landing calc)
- 0 actives + 0 alumni → $0
- alumni > 10_000 → returns null (sales-led)
- Yearly = 10× monthly across all combinations

**Verification:** `bun run --filter @teammeet/core test` (or root `bun test`).

**Execution note:** test-first. Math correctness gates everything downstream.

### U2: Validation schemas

**Files:**
- Modify `packages/validation/src/index.ts` — add `createOrgPerUserSchema`, keep `createOrgSchema` (legacy bucket)
- Modify `apps/mobile/__tests__/lib/create-org-schema.test.ts` — add per-user cases

**Schema shape:**
```ts
createOrgPerUserSchema = z.object({
  name: safeString(120),
  slug: baseSchemas.slug,
  description: optionalSafeString(800),
  primaryColor: baseSchemas.hexColor.optional(),
  billingInterval: z.enum(["month", "year"]),
  pricingModel: z.literal("per_user"),
  activeSeats: z.number().int().min(1).max(100_000),
  alumniSeats: z.number().int().min(0).max(50_000),
  withTrial: z.boolean().optional(),
  idempotencyKey: baseSchemas.idempotencyKey.optional(),
  paymentAttemptId: baseSchemas.uuid.optional(),
  source: z.enum(["mobile","web"]).optional(),
});
```

**Verification:** schema tests pass; rejects negative seat counts, rejects > caps.

### U3: DB migration + types regen

**Files:**
- Create `supabase/migrations/20260501000000_add_per_user_pricing.sql`
- Regen `apps/web/src/types/database.ts` via `supabase gen types`
- Regen mobile types if separate

**Verification:** migration applies on local supabase; constraint rejects per_user row missing seat counts.

### U4: New env vars + Stripe price helpers

**Files:**
- Modify `apps/web/next.config.mjs` — add 4 new env vars to validation list
- Modify `apps/web/src/lib/stripe.ts` — add `getPerUserPriceIds(interval)` returning `{ activePriceId, alumniPriceId }`
- Modify `apps/web/.env.example`

**Verification:** typecheck; `bun dev` boots without env errors when new vars present (or `SKIP_STRIPE_VALIDATION=true`).

### U5: Update `/api/stripe/create-org-checkout` route

**Files:**
- Modify `apps/web/src/app/api/stripe/create-org-checkout/route.ts`
- Add tests `apps/web/tests/create-org-checkout-per-user.test.ts`

**Approach:**
- Schema accepts both legacy (`alumniBucket`) and per-user (`pricingModel: "per_user"`, `activeSeats`, `alumniSeats`) bodies
- Branch early: if per-user, call new path
- Per-user path:
  - Reject if `alumniSeats > 10_000` → sales-led
  - Build line items: `[{ price: activePriceId, quantity: activeSeats }, { price: alumniPriceId, quantity: alumniSeats } /* omit if 0 */]`
  - Persist `pricing_model = 'per_user'`, `active_seat_count`, `alumni_seat_count` on org_subscriptions row
  - Same idempotency, payment-attempts, fingerprint flow
  - Trial gating: same rules as legacy (monthly only, non-sales-led)

**Verification:** new tests cover happy path, sales-led path, validation rejection, idempotency, mobile source URL.

### U6: Stripe webhook updates

**Files:**
- Modify `apps/web/src/app/api/stripe/webhook/route.ts`
- Or wherever subscription.created handler lives (search `customer.subscription.created`)

**Approach:**
- On subscription create/update for per-user metadata, persist `stripe_active_item_id`, `stripe_alumni_item_id`, current `quantity` on each line into `active_seat_count`/`alumni_seat_count`.
- Idempotent — webhook can fire multiple times.

**Verification:** payment idempotency tests still pass; new test simulates per-user subscription event.

### U7: Mobile create-org form

**Files:**
- Modify `apps/mobile/app/(app)/(drawer)/create-org.tsx`

**Changes:**
- Step 2 replaces alumni-bucket grid with two `<TextInput keyboardType="number-pad">` for `activeSeats` and `alumniSeats`
- Live calculator below: `200 actives × $0.10 = $20.00`, `750 alumni × $0.25 = $187.50`, total
- Yearly toggle uses yearly rates
- 10,000+ alumni → "Contact sales" inline (same UX as 5000+ today)
- POST body uses new schema (`pricingModel: "per_user"`, seat counts)

**Verification:** manual smoke — entering 200/750 yields $207.50 matching landing page; submission opens Stripe Checkout via Linking.openURL.

### U8: Web create-org form

**Files:**
- Modify `apps/web/src/app/app/create-org/page.tsx` (or wherever it lives)

**Changes:** same as U7 in web idiom (existing component patterns + Tailwind).

**Verification:** Playwright/manual.

### U9: Settings UI — show pricing model + edit seats

**Files:**
- Modify `apps/web/src/app/[orgSlug]/settings/billing/page.tsx` (or equivalent)
- Modify `apps/mobile/app/(app)/(drawer)/[orgSlug]/settings.tsx`

**Changes:**
- Display: "Pricing: Per-user (200 actives, 750 alumni)" or "Legacy bucket (251–500 alumni)"
- For per-user: "Update seat counts" button → modal with two inputs → POSTs to new `/api/stripe/update-seats` route
- Legacy orgs: no edit, just display

**Verification:** seats update reflects in Stripe dashboard + DB; legacy org settings unchanged.

### U10: New API route `/api/stripe/update-seats`

**Files:**
- Create `apps/web/src/app/api/stripe/update-seats/route.ts`

**Approach:**
- POST `{ activeSeats, alumniSeats }`, requires admin role
- Reject if `pricing_model !== 'per_user'`
- Calls `stripe.subscriptionItems.update(itemId, { quantity })` for each
- Persists new counts in `organization_subscriptions`
- Rate-limited

**Verification:** tests cover auth, non-admin reject, legacy-bucket reject, success.

### U11: Landing-page CTA wiring

**Files:**
- Modify `apps/web/src/components/marketing/PricingSection.tsx` "Get Started" CTA

**Changes:** CTA can prefill seat counts via query params (`?actives=200&alumni=750`) so the create-org page hydrates with the calculator's values.

**Verification:** click CTA → create-org form pre-filled.

## Migration plan (rollout)

1. Ship U1–U6 behind no UI surface (new code only callable via per-user schema; UI not yet sending it).
2. Run DB migration on prod.
3. Create Stripe Prices in dashboard, set env vars in Vercel.
4. Smoke-test per-user checkout in staging by manually crafting payload.
5. Ship U7+U8 simultaneously (mobile + web UI).
6. Ship U9+U10 (admin seat editing).
7. Ship U11 (landing-page CTA prefill).

Existing orgs untouched throughout. No data migration. Rollback: revert UI commits — legacy bucket flow remains intact in code.

## Risks

- **R1: Stripe Price misconfiguration.** If volume tiers entered wrong in Stripe dashboard, customers billed wrong amount. Mitigation: cross-check tier table against landing page; smoke-test with a real $0.50 minimum charge.
- **R2: Webhook race.** Subscription created webhook may arrive before the seat counts are persisted. Mitigation: webhook reads quantity from Stripe payload itself, not from DB row.
- **R3: Two pricing models in code = forever-tech-debt.** Mitigation: clearly separate modules, doc the boundary, plan sunset of legacy after migration of grandfathered orgs (not in this plan).
- **R4: Trial economics.** Free trial costs more under per-user with large rosters. Mitigation: existing trial caps (monthly only, non-sales-led) limit exposure.

## Verification (Definition of Done)

- [ ] U1 tests pass — pricing math matches landing calc
- [ ] U2 schemas reject invalid bodies; valid bodies parse
- [ ] U3 migration applies; legacy rows tagged correctly
- [ ] U4 env vars validated at boot
- [ ] U5 route accepts both schemas; idempotent
- [ ] U6 webhook persists seat counts and item ids
- [ ] U7 mobile form: 200/750 → $207.50/mo; checkout opens
- [ ] U8 web form: same numbers, same total
- [ ] U9 settings shows pricing model
- [ ] U10 admin seat update reflects in Stripe + DB
- [ ] U11 landing CTA prefills form
- [ ] Existing org subscriptions in production: no Stripe API calls hit them, no DB rows mutated
- [ ] Typecheck + lint clean
- [ ] Manual: create one new org via mobile, one via web, verify Stripe charges correct amount
