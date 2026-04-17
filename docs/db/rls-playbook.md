# RLS Playbook

Evergreen patterns for Supabase Row-Level Security in this codebase. Per-fix history lives in migration files and `git log` — this doc is for patterns, not changelog.

> Origin: this file was `rls-and-schema-fixes.md`, a post-mortem of the Dec 2025 schema-fix batch. It has been rewritten as a playbook so it stays useful after the next wave of migrations.

---

## 1. Performance Patterns

Source: [Supabase RLS performance guide](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv) and the Supabase Performance Advisor.

### 1.1 Wrap `auth.*` in a SELECT subquery

`auth.uid()` and `auth.role()` called directly in `USING` / `WITH CHECK` are re-evaluated per row. Wrapping in `(select …)` lets Postgres compute once per statement.

```sql
-- Bad: re-evaluated per row
using (user_id = auth.uid())

-- Good: evaluated once, cached in initPlan
using (user_id = (select auth.uid()))
```

### 1.2 Add explicit filters even when RLS enforces them

RLS runs *after* the planner chooses an access path. Adding `.eq('user_id', userId)` in the client query lets Postgres use the index before RLS runs.

### 1.3 Attach `TO authenticated` (or `TO anon`) to every policy

A policy without a `TO` clause is evaluated for every role, including ones that can never match. Free performance.

```sql
create policy "admins can update" on events
  for update to authenticated
  using (is_org_admin(org_id));
```

### 1.4 Use SECURITY DEFINER helpers for expensive joins

Our helpers (`is_org_admin`, `is_org_member`, `has_active_role`, `is_chat_group_member`, …) are `SECURITY DEFINER` + `STABLE`. They bypass RLS internally and Postgres caches their result within a statement. Always prefer these over inline `EXISTS (select 1 from user_organization_roles …)` subqueries in policies.

### 1.5 Mark helper functions `STABLE` (not `VOLATILE`)

`STABLE` unlocks initPlan caching inside a single statement. `VOLATILE` forces re-execution.

### 1.6 Avoid `FOR ALL` when a separate `FOR SELECT` exists

`FOR ALL` implies `SELECT`, which reintroduces the "multiple permissive policies for the same command" warning ([lint 0006](https://supabase.com/docs/guides/database/database-advisors?lint=0006_multiple_permissive_policies)). Prefer explicit `FOR INSERT` / `FOR UPDATE` / `FOR DELETE` for writes.

### 1.7 Index every column referenced by a policy

If a policy says `using (org_id = ...)`, `org_id` must be indexed. Missing indexes on RLS-referenced columns are the single largest performance regression source at scale.

---

## 2. Structural Patterns

### 2.1 SECURITY DEFINER lives outside the API-exposed schema

`public` is reachable over PostgREST. SECURITY DEFINER functions in `public` can be invoked by any authenticated client unless explicitly revoked. Move privileged helpers to a private schema (e.g. `security`) and grant `EXECUTE` only to the roles that need them. Source: [Securing your API](https://supabase.com/docs/guides/api/securing-your-api).

> **Current gap.** Several helpers in this repo still live in `public`. Audit + migration is a deferred follow-up — do not block on it when adding new helpers, but add new ones in a private schema when feasible.

### 2.2 Consolidate multi-role permissive policies

If a table has four policies (admin-select, member-select, alumni-select, parent-select) for the same command, Postgres ORs them — same net effect as one consolidated policy, with more planner overhead. Prefer:

```sql
create policy "org readers" on announcements
  for select to authenticated
  using (
    is_org_admin(org_id)
    or has_active_role(org_id, array['active_member','alumni','parent'])
  );
```

### 2.3 Soft delete filtering belongs in RLS or WHERE, not both

`deleted_at IS NULL` should be enforced by either:
- The RLS policy (`using (deleted_at is null and …)`), OR
- A consistently-applied WHERE clause at every callsite.

Double-enforcement is fine defensively; missing both is not. Default to RLS enforcement for tables with soft-delete as a privacy boundary (donations, members, alumni).

### 2.4 Revoke PUBLIC on privileged RPCs

SECURITY DEFINER functions are callable by `PUBLIC` unless revoked. Grant explicitly to `authenticated` (or narrower) after revoking.

```sql
revoke all on function public.do_privileged_thing(uuid) from public;
grant execute on function public.do_privileged_thing(uuid) to authenticated;
```

Recent examples: graduation RPC admin guard migration, PUBLIC revocation on graduation RPCs (`20261017000000_graduation_rpc_admin_guard.sql`).

---

## 3. Testing RLS

The project's direct route tests (`tests/routes/`) exercise RLS *transitively* through API handlers. They are necessary but not sufficient — they do not assert behavior of anonymous callers or cross-org leakage at the SQL layer.

Gap: there is no direct SQL-level RLS suite. Options when adding one:

- **pgTAP** — mature, Postgres-native, heavier setup.
- **Atlas RLS testing** — [docs](https://atlasgo.io/faq/testing-rls), requires adopting Atlas as a migration tool (not the plan).
- **Lightweight route tests with multiple auth fixtures** — already achievable with `tests/utils/authMock.ts`. Lowest friction; recommended starting point.

---

## 4. Helper Function Registry

| Function | Purpose | Used In |
|---|---|---|
| `is_org_admin(org_id)` | Admin check | Most write policies |
| `is_org_member(org_id)` | Any active member (incl. alumni/parent) | Most read policies |
| `has_active_role(org_id, roles[])` | Narrower role allowlist | Per-feature gating |
| `is_enterprise_admin(ent_id)` | Enterprise owner/billing/org admin | Enterprise tables |
| `is_enterprise_member(ent_id)` | Any enterprise role | Enterprise read tables |
| `is_chat_group_member(group_id)` | Non-removed group member | Chat RLS |
| `is_chat_group_moderator(group_id)` | Group admin/moderator | Chat moderation |
| `is_chat_group_creator(group_id)` | `created_by` match on chat_groups | Chat ownership |
| `check_analytics_rate_limit(...)` | Atomic window upsert | Analytics rate-limit |

All are `SECURITY DEFINER` + `STABLE`. Adding new helpers: follow the same signature style, document them here.

---

## 5. How This Doc Stays Current

- When a migration introduces a new pattern (e.g. first use of partial-index RLS, first cross-enterprise helper), add a subsection here.
- When a migration retires a pattern, note the retirement — do not delete the section, since old migrations may still reference it.
- Per-migration narrative belongs in commit messages and in SQL comments inside the migration file. This doc is for reusable patterns only.
