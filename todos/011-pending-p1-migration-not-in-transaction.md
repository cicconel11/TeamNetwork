---
status: pending
priority: p1
issue_id: "011"
tags: [code-review, migration, data-integrity, calendar, outlook]
dependencies: []
---

# Wrap Outlook migration in a transaction — partial failure leaves DB in broken state

## Problem Statement

`supabase/migrations/20260814000000_outlook_calendar_sync.sql` renames columns, drops unique constraints, and adds new composite constraints — all outside a transaction. If any statement fails mid-migration (e.g., the `ADD CONSTRAINT UNIQUE (user_id, provider)` fails because a duplicate row exists), the DB is left partially migrated: `provider` column added, old `user_calendar_connections_user_id_key` constraint dropped, but no replacement constraint. Two concurrent OAuth callbacks for the same Google user could then create duplicate rows.

## Findings

- Migration has no `BEGIN;` / `COMMIT;` wrapper
- Critical sequence: drop old UNIQUE → add new UNIQUE (user_id, provider). If ADD fails, table has no uniqueness constraint at all
- `ADD CONSTRAINT` statements are not idempotent — if the migration is re-run after a partial failure, they will fail with "constraint already exists"
- DDL is transactional in PostgreSQL — the entire migration can and should be a single atomic unit

## Proposed Solutions

### Option A — Wrap everything in BEGIN/COMMIT
```sql
BEGIN;
-- all existing statements
COMMIT;
```
**Pros:** Atomic — either all statements succeed or none do. Standard PostgreSQL DDL migration pattern.  
**Cons:** Long-running DDL inside a transaction holds ACCESS EXCLUSIVE locks longer.  
**Effort:** Small | **Risk:** Low

### Option B — Make ADD CONSTRAINT idempotent with DO $$ blocks
Wrap each `ADD CONSTRAINT` in:
```sql
DO $$ BEGIN
  ALTER TABLE ... ADD CONSTRAINT ...;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```
**Pros:** Idempotent re-runs without full transaction.  
**Cons:** Does not fix the partial-failure atomicity problem — just makes re-runs safer.  
**Effort:** Small | **Risk:** Low

### Recommended: Option A + Option B combined
Wrap in transaction AND make constraint additions idempotent. Defense in depth.

## Acceptance Criteria
- [ ] Migration file is wrapped in `BEGIN; ... COMMIT;`
- [ ] `ADD CONSTRAINT` statements are idempotent (safe to re-run)
- [ ] Migration tested against a DB with existing Google Calendar users

## Work Log
- 2026-04-07: Identified by data-integrity-guardian in PR #50 review
