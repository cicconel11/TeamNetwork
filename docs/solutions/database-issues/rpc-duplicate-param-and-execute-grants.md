---
title: Postgres RPC duplicate-param collision and PUBLIC execute-grant leak
date: 2026-04-18
problem_type: database_issue
component:
  - mentorship
  - supabase_migrations
severity: high
tags:
  - postgres
  - rpc
  - privileges
  - migration
  - name-collision
  - security-definer
status: resolved
---

# Postgres RPC duplicate-param collision and PUBLIC execute-grant leak

## Symptom

Two distinct failures surfaced while applying mentorship Phase 2 / 2.5 migrations to remote Supabase project `rytsziwekhtjdqzzpdso`:

1. `apply_migration` of `20261018000000_mentorship_phase2.sql` failed with:
   ```
   ERROR: 42P13: parameter name "pair_id" used more than once
   ```
   `accept_mentorship_proposal(pair_id uuid, admin_override boolean)` declared `pair_id` as a parameter AND as a column in `RETURNS TABLE(pair_id uuid, ...)`. Postgres rejects the overlap even though the RETURNS TABLE columns are outputs.

2. After `apply_migration` of `20261018100000_admin_propose_pair_rpc.sql`, `pg_proc.proacl` for `admin_propose_pair` showed:
   ```
   {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
   ```
   The explicit `grant execute ... to service_role` was additive on top of Postgres's default `PUBLIC EXECUTE`, so `anon` and `authenticated` inherited execute rights — a privilege leak on a SECURITY DEFINER function designed for service-role-only use.

## Root Cause

### Issue 1 — parameter/output namespace collision

`RETURNS TABLE(col ...)` columns and `IN` parameters share the same name scope inside the function body. Postgres's `42P13` guard fires at CREATE time if any two identifiers collide. The migration had `pair_id` in both roles, so the function never got created on remote (despite apparently working in local dev where the prior function may have existed with a different signature).

### Issue 2 — additive GRANT without prior REVOKE

Postgres grants `EXECUTE` to `PUBLIC` by default on every new function. `GRANT EXECUTE ... TO service_role` adds to that ACL; it does not replace it. Supabase's `authenticated` and `anon` roles inherit `PUBLIC`, so they silently gained the right to call `admin_propose_pair` — an RPC that uses a GUC trust-gate (`app.mentorship_trusted_caller`) to bypass the `mentorship_pairs_enforce_transition` trigger. Any authenticated user could have proposed pairs with arbitrary `match_score`/`match_signals` bypassing the trigger's admin-only enforcement.

## Solution

### Fix 1 — rename the output column, alias the table

`supabase/migrations/20261018000000_mentorship_phase2.sql`:

```sql
create or replace function public.accept_mentorship_proposal(
  pair_id uuid,
  admin_override boolean default false
)
returns table(
  result_pair_id uuid,          -- was: pair_id (collided with input param)
  mentor_user_id uuid,
  mentee_user_id uuid,
  organization_id uuid,
  status text,
  accepted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair public.mentorship_pairs%rowtype;
  ...
begin
  ...
  select * into v_pair
    from public.mentorship_pairs mp
   where mp.id = accept_mentorship_proposal.pair_id   -- qualify param
     and mp.deleted_at is null
   for update;
  ...
end;
$$;
```

Input parameter name `pair_id` preserved so the TypeScript caller at `src/app/api/organizations/[organizationId]/mentorship/pairs/[pairId]/route.ts:125` does not change:

```ts
supabase.rpc("accept_mentorship_proposal", { pair_id: pairId, admin_override: ... })
```

Route only reads `row.accepted_at` and `row.status` — renaming the output column to `result_pair_id` is a no-op for consumers.

### Fix 2 — revoke PUBLIC before granting service_role

`supabase/migrations/20261018100000_admin_propose_pair_rpc.sql` tail:

```sql
revoke all on function public.admin_propose_pair(uuid, uuid, uuid, numeric, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_propose_pair(uuid, uuid, uuid, numeric, jsonb, uuid)
  to service_role;
```

Final `proacl` on remote:
```
{postgres=X/postgres, service_role=X/postgres}
```

### Verification SQL

```sql
-- collision fixed: function exists with renamed output column
select pg_get_function_result(p.oid)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'accept_mentorship_proposal';
-- returns: TABLE(result_pair_id uuid, mentor_user_id uuid, ...)

-- grant leak sealed
select proacl from pg_proc
 where proname = 'admin_propose_pair' and pronamespace = 'public'::regnamespace;
-- returns: {postgres=X/postgres,service_role=X/postgres}

-- no orphan scoreless proposals from prior buggy path
select count(*) from public.mentorship_pairs
 where status = 'proposed' and match_score is null and deleted_at is null;
-- returns: 0
```

## Related Documentation

- `docs/db/rls-playbook.md` — RLS + function privilege patterns
- `docs/db/schema-audit.md` — schema drift + known-issue log
- `docs/solutions/security-issues/rag-system-hardening.md` — prior org-scope leak precedent
- `supabase/migrations/20260211010000_revoke_public_analytics_functions.sql` — revoke-then-grant pattern precedent
- Phase 2 plan: `docs/plans/2026-04-17-003-feat-mentorship-phase-3-ai-assistant-plan.md`
- `tests/mentorship-admin-propose-pair-migration.test.ts` — SQL grep contract tests (pins service_role-only grant, unique_violation handler)

## Prevention & Best Practices

### 1. Parameter naming convention

- Prefix all function input params with `p_`: `p_pair_id`, `p_organization_id`.
- Prefix `RETURNS TABLE` columns with `result_` or `out_` when they shadow any likely input name.
- When you must reference a param that shares a name with a column, qualify with `function_name.param_name` (`accept_mentorship_proposal.pair_id`).
- Always alias tables in the function body (`from mentorship_pairs mp`) so `mp.id` vs `accept_mentorship_proposal.pair_id` is unambiguous.

### 2. Revoke-before-grant discipline

Every new SECURITY DEFINER function in a migration MUST end with:

```sql
revoke all on function <fn>(<argtypes>) from public, anon, authenticated;
grant execute on function <fn>(<argtypes>) to <intended_role>;
```

Never rely on `GRANT EXECUTE TO service_role` alone — it leaves PUBLIC intact.

### 3. CI lint rule

Add a repo test that scans `supabase/migrations/*.sql` for `create .* function` blocks and asserts a matching `revoke all on function` appears for the same signature within the same file. Fails the build on drift.

### 4. ACL snapshot diff in post-migration smoke

After every migration apply, snapshot `pg_proc.proacl` for new/changed functions and diff against the intended grant set. Alert if `anon` or `authenticated` appears on any SECURITY DEFINER function not explicitly marked as user-callable.

### 5. Test assertions (already in place)

`tests/mentorship-admin-propose-pair-migration.test.ts` grep-pins:
- `grant execute on function public.admin_propose_pair(...) to service_role;`
- absence of `to authenticated, service_role;`
- `when unique_violation then` concurrency handler
- `role = 'active_member'` self-service predicate

Extend this pattern for every privileged RPC.

### 6. Supabase branch dry-run

Before applying a privileged migration to production, apply to a Supabase preview branch and run `pg_get_functiondef` + `proacl` inspection. Catches both Issue 1 (function doesn't create) and Issue 2 (PUBLIC leak) before prod.

### 7. Enum + usage split

Unrelated but hit in same apply run: `ALTER TYPE ... ADD VALUE` cannot share a transaction with usage of the new value. Split into two migration calls when both appear.
