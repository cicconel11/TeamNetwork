---
title: "Enterprise-Managed Alumni Quota — False Negative Blocks Invite Creation"
category: patterns
tags:
  - enterprise
  - alumni-quota
  - multi-tenant
  - billing
  - sql-helpers
  - rpc
  - ui
  - divergent-enforcement
components:
  - enterprise-invites
  - alumni-quota
  - subscription-card
  - enterprise-alumni-stats
problem_type: quota-logic-false-negative
severity: critical
date: 2026-04-14
related_prs: [71, 72]
repo_area: brownfield-saas-multi-tenant
---

# Enterprise-Managed Alumni Quota — False Negative Blocks Invite Creation

## Problem

A paying enterprise customer (American Institute of Monterrey — `enterprise_id = ce1c7f0a-ba65-4828-a964-89d2e6e55fa0`) received **"Alumni quota reached for this plan. Upgrade your subscription to add more alumni."** when creating an alumni invite for their org `AIM General`. Their enterprise had 5,000 alumni capacity (`alumni_bucket_quantity = 2` × `2500`) with 0 used.

Enterprise-managed orgs intentionally carry `organization_subscriptions.alumni_bucket = 'none'` because capacity is pooled at the enterprise level via `enterprise_subscriptions.alumni_bucket_quantity × 2500`. Three SQL helpers (`can_add_alumni`, `assert_alumni_quota`, `get_alumni_quota`) checked only the per-org bucket column, saw `'none'` → limit 0, and blocked every invite. A parallel gap in the subscription API endpoint failed to branch on `status = 'enterprise_managed'`, so the org settings UI displayed `bucket: none` and an amber "billing not connected" warning instead of pooled quota. Separately, `get_enterprise_alumni_stats` was listed in `schema_migrations` as applied but its function body was missing, producing a 500 on the enterprise alumni stats page.

## Symptoms

- `POST /api/enterprise/[enterpriseId]/invites` → 400 "Alumni quota reached for this plan" despite pooled capacity = 5,000, used = 0.
- Org settings subscription card showed `bucket: none` and amber "billing not connected" warning for an enterprise-managed org.
- `GET /enterprise/[slug]/alumni` → 500 "Failed to load alumni stats" from browser; underlying cause was `ERROR: 42883: function public.get_enterprise_alumni_stats(uuid) does not exist`.
- No admin-cap or auth error — only the quota check failed.
- Reproducible for **any** enterprise-managed org regardless of actual enterprise capacity.

## Investigation

The initial assumption was that AIM had simply hit their quota. Inspecting `organization_subscriptions` showed `alumni_bucket = 'none'`, which `getAlumniLimit('none')` maps to 0 — that appeared to confirm a full or nonexistent quota. Only after cross-referencing `enterprise_subscriptions` did the mismatch surface: billing for enterprise-managed orgs lives on a different table entirely, so the per-org bucket is always `'none'` by design, not because capacity is exhausted. The bulk-import RPCs (`bulk_import_alumni_rich`, `bulk_import_linkedin_alumni`) were already enterprise-aware via `resolve_alumni_quota`, but the single-invite path (`can_add_alumni` → `assert_alumni_quota`) and the UI subscription endpoint had never been updated.

## Root Cause

Four divergent code paths enforced the same business rule — "does this org have alumni capacity?" — and only the bulk-import path had been updated to consult pooled enterprise capacity:

| Path                                  | Consulted enterprise pool? | Status before fix    |
|---------------------------------------|----------------------------|----------------------|
| `resolve_alumni_quota` (SQL helper)   | Yes                        | Correct              |
| `bulk_import_*` RPCs                  | Yes (via resolver)         | Correct              |
| `can_add_alumni` / `assert_alumni_quota` (SQL) | No                 | Bug — blocked invites |
| `get_alumni_quota` (SQL, for UI read) | No                         | Bug — wrong limit    |
| `subscription` API route              | No                         | Bug — wrong UI data  |
| `getAlumniCapacitySnapshot` (TS)      | Partial — keyed on `enterprise_id` only | Misrouted transitioning orgs |
| `isOrgEnterpriseManaged` (TS)         | Partial — `enterprise_id` only | Misrouted transitioning orgs |

Additionally: `supabase_migrations.schema_migrations` recorded `20260315000000` as applied, but `get_enterprise_alumni_stats(uuid)` was absent from `pg_proc`. The migration DDL had been rolled back silently at some point without removing the ledger row.

## Working Solution

### a) SQL — inline enterprise branch in the three single-invite helpers

Migration `20261014000000_fix_enterprise_managed_alumni_quota.sql` rewrites `can_add_alumni`, `get_alumni_quota`, and `assert_alumni_quota` to fetch `organizations.enterprise_id` and `organization_subscriptions.status` in one query, then branch before touching the per-org bucket.

```sql
-- from can_add_alumni (same pattern in get_alumni_quota)
SELECT os.alumni_bucket, os.status, o.enterprise_id
INTO v_bucket, v_status, v_enterprise_id
FROM public.organizations o
LEFT JOIN public.organization_subscriptions os
  ON os.organization_id = o.id
WHERE o.id = p_org_id
LIMIT 1;

IF v_status = 'enterprise_managed' AND v_enterprise_id IS NOT NULL THEN
  SELECT COALESCE(es.alumni_bucket_quantity, 0) * 2500
  INTO v_limit
  FROM public.enterprise_subscriptions es
  WHERE es.enterprise_id = v_enterprise_id
  LIMIT 1;

  SELECT COUNT(*)
  INTO v_count
  FROM public.alumni a
  JOIN public.organizations o2 ON o2.id = a.organization_id
  WHERE o2.enterprise_id = v_enterprise_id
    AND a.deleted_at IS NULL;

  RETURN v_count < COALESCE(v_limit, 0);
END IF;

-- fall through to per-org bucket logic for non-enterprise orgs
```

`assert_alumni_quota` delegates to `can_add_alumni`, so it inherits the fix. All three functions keep `SECURITY DEFINER` and `SET search_path = ''`.

### b) API — `enterprise_managed` fast-path in the subscription route

`src/app/api/organizations/[organizationId]/subscription/route.ts` now short-circuits before any Stripe call:

```typescript
if ((sub?.status as string | undefined) === "enterprise_managed") {
  const snap = await getAlumniCapacitySnapshot(organizationId, serviceSupabase);
  return buildQuotaResponse({
    bucket,
    alumniLimit: snap.alumniLimit,
    alumniCount: snap.currentAlumniCount,
    status: "enterprise_managed",
    isEnterpriseManaged: true,
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    currentPeriodEnd: null,
    includeStripeDetails: false,
  }, respond);
}
```

The response contract (`src/types/subscription.ts`) adds a non-optional `isEnterpriseManaged: boolean` field, so every consumer sees an explicit flag rather than inferring from status strings.

### c) UI — `SubscriptionCard` honours `isEnterpriseManaged`

```typescript
const isEnterpriseManaged =
  quota?.isEnterpriseManaged === true || quota?.status === "enterprise_managed";
```

When true: current-plan label shows "Enterprise pooled quota"; the "billing not connected" amber warning is gated on `!isEnterpriseManaged && !quota?.stripeSubscriptionId`; the alumni-plan Select, billing-interval Select, and Update button are `disabled`; a prose note explains that capacity is managed from the enterprise dashboard.

### d) Hardening — dual-condition enterprise check in app-side readers

`shouldUseEnterpriseAlumniQuota` in `src/lib/alumni-quota.ts` now requires both `enterprise_id` non-null AND `status === 'enterprise_managed'`:

```typescript
export function shouldUseEnterpriseAlumniQuota(
  enterpriseId: string | null | undefined,
  subscriptionStatus: string | null | undefined,
) {
  return Boolean(enterpriseId && subscriptionStatus === "enterprise_managed");
}
```

`isOrgEnterpriseManaged` and `getAlumniCapacitySnapshot` (in `src/lib/alumni/capacity.ts`) call this helper in parallel with the org fetch, so orgs that belong to an enterprise but are still `pending` or `active` are no longer mis-pooled.

### e) Bonus — restored `get_enterprise_alumni_stats` RPC

The function body was re-applied out-of-band via Supabase MCP (`apply_migration` with the DDL from `20260315000000_get_enterprise_alumni_stats.sql`). Live verification on AIM returns a valid payload (`total_count: 1, org_stats: [AIM General]`). `schema_migrations` already recorded the version, so no ledger update was needed.

### Verification

- `SELECT public.can_add_alumni('f5454a82-c46c-422a-80a1-71f43193b48e'::uuid)` → `true` (AIM General)
- `SELECT public.get_enterprise_alumni_stats('ce1c7f0a-ba65-4828-a964-89d2e6e55fa0'::uuid)` → valid payload, no error
- `node --test tests/routes/enterprise/invites.test.ts` → 25/25 pass (new success-path assertion included)
- `node --test tests/enterprise/enterprise-managed-alumni-quota-migration.test.ts` → 4/4 pass
- `npm run test` → 4145/4146 pass (1 unrelated pre-existing flake in `middleware-routing.test.ts` — passes standalone)

## Prevention

### Pattern recognition

- Divergent enforcement paths for the same business rule are the root smell. Any grep hit for `alumni_count`, `quota_limit`, `can_add_alumni`, or `enterprise_id IS NOT NULL` in a file that does **not** import `resolve_alumni_quota`, `getAlumniCapacitySnapshot`, or `shouldUseEnterpriseAlumniQuota` is a red flag.
- In PR review: "Is there another path that reaches this same outcome?" If yes, both must call the same helper.
- Treat new invite, import, or capacity-check code paths as requiring a checklist: _confirmed quota gate uses canonical helper, not re-implemented._

### Architectural

- Sealed module: `resolve_alumni_quota` (SQL), `getAlumniCapacitySnapshot` and `shouldUseEnterpriseAlumniQuota` (TS) are the only correct ways to answer "does this org have alumni capacity?". Document in `CLAUDE.md` under _Key Architectural Patterns_.
- No SQL function may compare alumni counts against a limit without delegating to `resolve_alumni_quota`.
- No TS file may inspect `enterprise_id` alone in quota-adjacent code — status must also be checked via the helper.

### Tests

- Integration test: enterprise org with `alumni_bucket_quantity > 0`, 0 used → `can_add_alumni` returns `true`, `assert_alumni_quota` does not raise, single-invite endpoint succeeds.
- Mirror the same scenario for the bulk-import RPC path to confirm parity with the single-invite path.
- Negative test: org with `enterprise_id` set but subscription `status = 'pending'` → must fall back to per-org bucket logic, not pool.
- Consistency test: `can_add_alumni(org)` and UI `getAlumniCapacitySnapshot(org).remainingCapacity > 0` must always agree.

### Operational

- Log a structured warning when `assert_alumni_quota` raises for an enterprise org — include `org_id`, `enterprise_id`, resolved `quota_limit`, resolved `quota_count` so anomalies surface immediately.
- Dashboard query: join `enterprise_subscriptions` × `enterprise_alumni_counts`; alert when any enterprise with `quota_count / quota_limit < 0.9` logs a quota-blocked invite in the last 24h.

### Schema / migration

- Add a post-migration smoke test (CI after `supabase db push`) that asserts critical RPCs exist in `pg_proc`: `resolve_alumni_quota`, `get_enterprise_alumni_stats`, `can_add_alumni`, `assert_alumni_quota`, `get_alumni_quota`.
- Maintain `tests/migrations/critical-rpcs.test.ts` as a name-list; any missing function fails CI. This would have caught the silent `get_enterprise_alumni_stats` drop.
- `docs/db/schema-audit.md` should track RPC name, owning migration, last-verified date; update as part of migration PR checklist.

## Related

- **PR #71** — `fix(invites): use enterprise alumni quota for managed orgs` (the SQL-layer fix).
- **PR #72** — `fix(enterprise): treat enterprise-managed orgs as pooled in billing UI` (the API + UI + app-side hardening fix documented here).
- **PR #58** — `fix(enterprise): treat enterprise_managed as active subscription status` (earlier related fix).
- **PR #61** — `fix(invites): fix 16 critical issues with enterprise invites system` (adjacent hardening wave).
- Migration `20260628000000_extract_resolve_alumni_quota.sql` — canonical shared helper; bulk-import RPCs already used it. Single-invite path should have too.
- Migration `20260621000000_fix_alumni_bucket_quota_drift.sql` — earlier fix in this space; established the bucket-limit table but did not address enterprise pooling.
- Migration `20261014000000_fix_enterprise_managed_alumni_quota.sql` — the SQL fix landed here.
- `docs/solutions/patterns/recent-hardening-patterns.md` — sibling pattern doc covering advisory-lock quota races; same cross-cutting-correctness theme.
- `docs/db/schema-audit.md` — inventory for `organization_subscriptions`, `enterprise_subscriptions`, `resolve_alumni_quota`.
- `docs/REPRO.md` — documents the alumni count divergence between `alumni` table and `user_organization_roles`, which the quota system must account for.
