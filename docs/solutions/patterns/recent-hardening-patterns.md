---
title: "Recent Hardening Patterns — Enterprise, Auth, Calendar, FERPA"
category: patterns
tags: [security, multi-tenant, fail-closed, idempotency, race-conditions, rls, enterprise, ferpa, oauth, hydration]
components: [enterprise-invites, auth, calendar, audit-log, ferpa]
problem_type: patterns
date: 2026-04-13
related_prs: [54, 55, 57, 58, 59, 60, 61, 63, 66]
repo_area: brownfield-saas-multi-tenant
---

# Recent Hardening Patterns — Enterprise, Auth, Calendar, FERPA

A cluster of recent PRs (#54–#66) reveals a coherent hardening push across TeamNetwork's multi-tenant surface. The dominant theme is **fail-closed by default**: org config query errors that previously fell back to permissive feature defaults now return 500, and middleware RPC failures now redirect to an error page rather than silently proceeding. **Advisory locks** replace application-level rate limiting as the correctness boundary for quota races (admin cap, alumni quota) where concurrent requests could both pass a pre-check before either committed. **Idempotency and bounded queries** appear throughout — bulk invite concurrency capped at 5, all list endpoints paginated, unbounded selects narrowed. **RLS paired with middleware double-enforcement** (PR #54's locked-thread insert policy, SECURITY DEFINER search-path hardening) reflects a trust-no-single-layer stance. **Soft-delete discipline** was enforced retroactively on philanthropy queries that leaked deleted records. FERPA work introduced deliberate **CASCADE vs SET NULL** choices for `auth.admin.deleteUser` FK constraints — owned data cascades, audit logs go to SET NULL to preserve the record. **OAuth identity continuity** prevents duplicate accounts on same-email multi-provider signups. React **hydration safety** is addressed structurally: UTC-anchored date math plus `mounted` guards eliminate server/client timestamp divergence.

## Patterns

### 1. Race-condition-safe admin cap / quota on enterprise invites

**Problem:** Concurrent bulk invite requests could each read the same admin count simultaneously, allowing the 12-admin enterprise cap to be bypassed.

**Root cause:** The app used a COUNT-then-INSERT pattern across separate transactions. Two requests racing at the same millisecond both observed `count = 11`, both passed the cap check, and both inserted — ending at 13 admins. There was no serialization between the check and the write.

**Fix:** The `create_enterprise_invite` stored function in `supabase/migrations/20260413110000_enterprise_invite_advisory_lock.sql` acquires a transaction-scoped advisory lock keyed by enterprise ID before running the count:

```sql
PERFORM pg_advisory_xact_lock(hashtext(p_enterprise_id::text));
-- now safe: count-check + insert are atomic per enterprise
IF v_admin_count >= 12 THEN
  RAISE EXCEPTION 'Enterprise admin limit reached';
END IF;
```

The lock is placed **after** auth/authz checks (to avoid contention from unauthorized callers) and is released automatically at transaction end. The application layer in `src/app/api/enterprise/[enterpriseId]/invites/route.ts` still does a pre-check for a fast-path 400 response, but correctness is enforced by the RPC.

### 2. Fail-closed auth on org config queries

**Problem:** Four API routes granted broader permissions than intended whenever an org config query errored, because a `null` result silently fell back to liberal feature defaults.

**Root cause:** The original pattern was `(org as any)?.[roleColumn] || featureDefaults[feature]`. When the query returned an error, `org` was `null`, the short-circuit produced `featureDefaults`, and the route proceeded with permissive role lists — fail-open behavior.

**Fix:** A shared helper `getAllowedOrgRoles()` in `src/lib/auth/org-role-config.ts` throws on any query error rather than returning a default. Each consumer wraps the call in a try/catch and returns 500:

```typescript
// src/lib/auth/org-role-config.ts
if (error) {
  throw new Error(`[${context}] Failed to fetch org config: ${message}`);
}
```

```typescript
// e.g. src/app/api/media/upload-intent/route.ts
try {
  allowedRoles = await getAllowedOrgRoles(supabase, body.orgId, roleColumn, "media/upload-intent");
} catch {
  return NextResponse.json({ error: "Failed to verify permissions" }, { status: 500 });
}
```

The same fail-closed discipline applies to middleware RPC fallback paths (`src/middleware.ts`), which now redirect to `/app?error=org_access_check_failed` on query failure instead of logging and continuing.

### 3. FERPA-grade account deletion

**Problem:** Calling `auth.admin.deleteUser()` for any user threw FK constraint violations, making FERPA-mandated account deletion impossible.

**Root cause:** Six tables had bare `REFERENCES ... NO ACTION` (or implicit RESTRICT) on `user_id` or `actor_user_id` columns. When Postgres tried to delete the `auth.users` row, it found referencing rows and aborted. The fix had to distinguish *user-owned data* (can be deleted with the user) from *audit logs* (must survive deletion for compliance).

**Fix:** Migration `supabase/migrations/20261012000000_fix_fks_for_user_deletion.sql` applies two patterns:

```sql
-- User-owned data → CASCADE
ALTER TABLE public.academic_schedules
  DROP CONSTRAINT academic_schedules_user_id_fkey,
  ADD CONSTRAINT academic_schedules_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- Audit logs → SET NULL (drop NOT NULL first)
ALTER TABLE public.enterprise_audit_logs
  ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE public.enterprise_audit_logs
  DROP CONSTRAINT enterprise_audit_logs_actor_user_id_fkey,
  ADD CONSTRAINT enterprise_audit_logs_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
```

Tables receiving CASCADE: `academic_schedules`, `schedule_files`. Tables receiving SET NULL: `ai_indexing_exclusions.excluded_by`, `enterprise_audit_logs.actor_user_id`, `dev_admin_audit_logs.admin_user_id`, `form_submissions.user_id`.

### 4. Enterprise invite token leakage

**Problem:** The GET `/invites` endpoint previously returned full invite rows including the `token` field to any enterprise admin, and unbounded result sets made mass harvesting trivial.

**Root cause:** The original query used `.select("*")` on the `enterprise_invites` table, and no pagination was applied. Any admin with a valid JWT could retrieve all tokens for an entire enterprise in one request.

**Fix:** In `src/app/api/enterprise/[enterpriseId]/invites/route.ts`, the select is now an explicit column list that includes `token` only where legitimately needed (this is an admin-only endpoint, so token exposure is intentional and documented), combined with cursor-based pagination capped at 100 rows:

```typescript
.select("id, organization_id, role, created_at, expires_at, code, token, uses_remaining, revoked_at")
.limit(limit + 1)  // limit is min(requested, 100)
```

The audit comment in the file explicitly notes that token exposure here is admin-intentional; the principle is that `select *` is banned on invite tables — any future query must enumerate columns so the decision to include `token` is explicit and reviewable.

### 5. React hydration mismatch from middleware-driven redirects on `[orgSlug]` routes

**Problem:** The calendar page threw React hydration errors (#418, #422) because server-rendered HTML differed from the client's first paint.

**Root cause:** `new Date()` produces UTC on the Node server but local-timezone time in the browser. Components using it to compute the current month cursor, "today" highlight keys, or current availability hour would produce different values across server and client, causing React to discard server HTML and re-render from scratch.

**Fix** (in `src/components/calendar/CalendarMonthView.tsx`, `UnifiedEventFeed.tsx`, `TeamAvailabilityRows.tsx`, `PersonalAvailabilityAgenda.tsx`): Replace all `new Date()`-derived display state with two patterns:

1. **Deterministic keys:** Use `Date.UTC()` or `toUtcDateKey()` for cell/group keys so server and client compute the same string.
2. **Mounted guard for "today" highlighting:** Suppress any timezone-local value during SSR and apply it only after mount:

```typescript
const mounted = useHasMounted();
const todayKey = mounted ? toDateKeyInTimeZone(new Date(), timeZone) : null;
```

The rule: anything derived from "now" in local timezone must be computed client-side only; structural keys (grid cells, event grouping) must use UTC or org-timezone deterministically via `Intl.DateTimeFormat`.

### 6. OAuth identity continuity for same-email multi-provider signups

**Problem:** Signing in with a second OAuth provider (e.g., Microsoft after Google) created a new `auth.users` UUID, leaving the user with no org memberships despite having joined with their previous identity.

**Root cause:** Supabase creates one `auth.users` row per OAuth provider when the Dashboard's "Merge existing accounts by email" setting is not enabled. Since `user_organization_roles` is keyed by `user_id` UUID, the new UUID had no rows.

**Fix:** Three-layer approach.

1. **One-time backfill** in `supabase/migrations/20261008000000_merge_duplicate_oauth_accounts.sql`: copies `user_organization_roles` rows across all `auth.users` UUIDs sharing the same email. Idempotent via `ON CONFLICT DO NOTHING`.

2. **Defensive runtime merge** in `src/app/auth/callback/route.ts`: on every OAuth sign-in, if the account is newer than 60 seconds (new account heuristic), query for other UUIDs with the same email and upsert their memberships to the new UUID. Errors are caught and logged but never block sign-in.

3. **Dashboard setting:** Enable "Merge existing accounts by email" to prevent future duplicates at the Supabase level.

### 7. Discussion locked-thread constraint at DB level

**Problem:** App-layer guards on reply submission could be bypassed (e.g., by a stale client or direct API call), allowing replies to be posted on locked threads.

**Root cause:** The `discussion_replies_insert` RLS policy only checked `author_id = auth.uid()` and org membership — it did not verify the parent thread's `is_locked` status. The lock was enforced only in the React UI, which is not a security boundary.

**Fix:** Migration `supabase/migrations/20260704000002_lock_discussion_replies.sql` recreates the insert policy with an `EXISTS` subquery on the parent thread:

```sql
CREATE POLICY "discussion_replies_insert" ON public.discussion_replies
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND has_active_role(organization_id, array['admin','active_member','alumni'])
    AND EXISTS (
      SELECT 1 FROM public.discussion_threads
      WHERE id = discussion_replies.thread_id
        AND organization_id = discussion_replies.organization_id
        AND deleted_at IS NULL
        AND is_locked = false
    )
  );
```

The database now rejects any insert to a locked thread regardless of how the request arrives, making the app-layer guard a UX convenience rather than a security control.

### 8. Soft-delete discipline

**Problem:** Philanthropy and donations pages surfaced soft-deleted event records in the UI and inflated stat counts.

**Root cause:** Queries against the `events` table omitted `.is("deleted_at", null)`. The soft-delete contract — all reads filter `deleted_at IS NULL` — was not enforced. Additionally, `.select("*")` returned all columns unnecessarily, and no row limit was set.

**Fix** (applied in `src/app/[orgSlug]/philanthropy/page.tsx` via PR #60):

```typescript
// Before (leaks deleted rows):
.from("events").select("*").eq("organization_id", org.id)

// After (correct):
.from("events")
  .select("id, title, start_date")  // narrow to needed columns
  .eq("organization_id", org.id)
  .is("deleted_at", null)           // mandatory soft-delete filter
  .limit(500)
```

The standing rule: **every** query against a table with a `deleted_at` column must include `.is("deleted_at", null)`. PR #60's test file `tests/philanthropy-soft-delete.test.ts` uses source-code auditing to assert the filter is present — the pattern to follow for adding coverage to other tables.

### 9. Bounded concurrency on bulk RPC

**Problem:** Bulk invite creation dispatched up to 100 simultaneous Supabase RPC calls, risking Supabase connection pool exhaustion.

**Root cause:** The original implementation called `Promise.all(invites.map(...rpc...))` with no concurrency cap. A 100-row CSV upload would open 100 parallel database connections at once — well above the Supabase pooler's per-client limits, causing timeouts or queue stalls for all other requests.

**Fix** in `src/app/api/enterprise/[enterpriseId]/invites/bulk/route.ts`: process RPC calls in sequential batches of 5:

```typescript
const CONCURRENCY = 5;
const results: PromiseSettledResult<unknown>[] = [];
for (let i = 0; i < validInvites.length; i += CONCURRENCY) {
  const batch = validInvites.slice(i, i + CONCURRENCY);
  const batchResults = await Promise.allSettled(
    batch.map((invite) => supabase.rpc("create_enterprise_invite", { ... }))
  );
  results.push(...batchResults);
}
```

`Promise.allSettled` is used within each batch so a single RPC failure does not abort the rest. The advisory lock in the RPC serializes concurrent calls per enterprise at the DB level anyway, so the cap of 5 concurrent connections is appropriate — reducing connection pressure without being so conservative it makes bulk uploads unacceptably slow.

## Prevention

### Checklist — before merging PR that touches auth / multi-tenant / payments

- Confirm every query on soft-deleted tables includes `.is("deleted_at", null)`; search for the table name without the filter as a red flag
- Review all new RLS policies for fail-closed default: policies must DENY on error or missing context, never fall through to allow
- Audit every `select()` call — no wildcard `select("*")` on tables containing `hashed_password`, `secret`, `access_token`, `refresh_token`, or stripe key columns; enumerate columns explicitly
- Verify any new payment path generates and persists an idempotency key before the first Stripe API call; check `payment_attempts` upsert uses the unique constraint
- Confirm all auth decisions (role checks, org membership, session validity) occur server-side in middleware or Server Components; no auth state derived from client-readable cookies or localStorage
- Validate all user input at the API boundary with a Zod schema from `src/lib/schemas/`; reject before any DB call
- Check that invariants enforced in DB (CHECK constraints, unique constraints) are not solely guarded at the app layer; app guards are defense-in-depth only
- Confirm FK relationships touching `users` or `org_members` on deletion use explicit CASCADE or SET NULL matching compliance intent — no accidental orphan rows and no unintended hard deletes
- Verify any new bulk operation (bulk invite, bulk role change, bulk RPC) has a concurrency bound and does not fire unbounded parallel Supabase calls
- Confirm every new public or org-scoped API route has a rate limit applied via `src/lib/security/`
- Test the error path: simulate a Supabase failure mid-operation and assert the response is a safe denial, not a partial success or data leak
- Check that any new `[orgSlug]` route validates org membership in middleware or layout before rendering org-scoped data

### Test patterns to add

- `race condition: concurrent payment attempts with same idempotency key return identical checkout URL and create exactly one payment_attempts row`
- `soft-delete leak: querying members after soft-delete returns zero rows even when deleted_at filter is omitted from a secondary join path`
- `fail-closed: simulate Supabase getUser() throwing a network error mid-request and assert response is 401/403, never 200 with partial data`
- `token column exclusion: any query returning org_members or users rows must not include access_token, refresh_token, or secret fields in the serialized API response`
- `FK cascade: deleting a user triggers CASCADE removal of child rows in org_members and SET NULL on authored content foreign keys without leaving orphan references`
- `idempotency dedup: replaying the same Stripe webhook event_id twice results in exactly one processed record in stripe_events and no duplicate side effects`
- `boundary test: simultaneous role promotions at the admin cap (N, N+1, N+2 concurrent requests) result in at most N admins with no over-cap commits succeeding`

## Related Documentation

### In-repo docs

**`docs/solutions/`**
- `docs/solutions/security-issues/rag-system-hardening.md` — Hardening plan for the AI FAQ/RAG system covering security, correctness, and performance issues

**`docs/agent/`**
- `docs/agent/assistant.md` — Architecture overview of the org-scoped admin AI assistant (threading, streaming, caching, tools)
- `docs/agent/ai-data-flow.md` — Privacy and compliance documentation for AI data flow
- `docs/agent/ai-intent-plan.md` — Code map for AI intent routing and surface inference (turn execution policy, context loading)
- `docs/agent/chat-pipeline-codemap.md` — Full lifecycle code map for AI chat request handling (rate limiting through audit logging)
- `docs/agent/intent-type-taxonomy.md` — Taxonomy of intent types and surfaces the AI classifier recognizes
- `docs/agent/semantic-cache-codemap.md` — Code map for the exact-match semantic cache (eligibility, TTL, invalidation, cron purge)
- `docs/agent/threads-codemap.md` — CRUD code map for AI conversation threads and messages (RLS-enforced, soft-delete)
- `docs/agent/ui-panel-codemap.md` — Code map for the admin slide-out chat panel (streaming SSE, local state)
- `docs/agent/falkor-people-graph.md` — Architecture of the Falkor org-scoped people graph powering `suggest_connections`
- `docs/agent/falkor-connection-suggestions.md` — Flow diagram for connection-suggestion routing through the members surface

**`docs/db/`**
- `docs/db/schema-audit.md` — Audit of the Supabase/PostgreSQL schema with known issues and field-level notes

**`docs/` (top-level)**
- `docs/stripe-donations.md` — Testing guide for the Stripe Connect donations flow (funds route directly to org's connected account)
- `docs/stripe-production-setup.md` — Production Stripe configuration expected by the app and required env vars
- `docs/FERPA_COMPLIANCE.md` — FERPA compliance guide for education-record handling
- `docs/COPPA_COMPLIANCE.md` — COPPA compliance guide for services collecting data from users under 13
- `docs/Data_Inventory.md` — Catalog of PII and education-adjacent data stored by TeamNetwork
- `docs/Incident_Response_Runbook.md` — Incident response runbook (v1.0)
- `docs/TESTING.md` — Testing patterns and analysis for the codebase
- `docs/REPRO.md` — Bug reproduction guide and debug mode instructions
- `docs/audit-setup.md` — Audit tooling setup and current status
- `docs/dev-admin-feature.md` — Dev-admin feature documentation
- `docs/linkedin-setup.md` — LinkedIn OAuth integration setup guide
- `docs/alumni-user-manual.md` — End-user manual for alumni members

### Key source files for the patterns

- `src/middleware.ts` — Request interception, auth, org membership validation
- `src/app/[orgSlug]/layout.tsx` — Org context provider; final org-existence gate
- `src/lib/auth/roles.ts` — `getOrgContext()`, `isOrgAdmin()`; role-based access utilities
- `src/lib/auth/org-role-config.ts` — `getAllowedOrgRoles()` fail-closed helper
- `src/lib/security/validation.ts` — Zod schemas, `sanitizeIlikeInput()`; input validation
- `src/lib/payments/idempotency.ts` — Payment deduplication (Payment Idempotency pattern)
- `src/lib/payments/stripe-events.ts` — Stripe webhook event deduplication
- `src/lib/schemas/index.ts` — Central Zod validation schemas for all domains
- `src/lib/schedule-security/allowlist.ts` — Schedule domain allowlist (SSRF protection)
- `src/lib/schedule-security/safe-fetch.ts` — Safe fetch wrapper for external schedule URLs
- `src/lib/schedule-security/verifyAndEnroll.ts` — Domain verification and enrollment logic
- `src/app/api/enterprise/[enterpriseId]/invites/route.ts` — Explicit-column select, pagination
- `src/app/api/enterprise/[enterpriseId]/invites/bulk/route.ts` — Bounded concurrency pattern
- `src/app/auth/callback/route.ts` — OAuth identity continuity defensive merge

### Recent PRs

- **#54** — fix(db): enforce locked thread constraint on discussion replies
- **#55** — fix(calendar): resolve React hydration errors and harden middleware
- **#57** — fix(enterprise): invite role cast, dashboard fixes, and scalability hardening
- **#58** — fix(enterprise): treat enterprise_managed as active subscription status
- **#59** — fix(enterprise): enforce admin cap on adoption, fix error codes, add pagination
- **#60** — fix: fail-closed auth on org config queries, philanthropy soft-delete
- **#61** — fix(invites): fix 16 critical issues with enterprise invites system
- **#63** — fix(calendar): preserve view state when navigating to/from event details
- **#66** — feat: FERPA compliance — full implementation
