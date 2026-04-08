---
status: pending
priority: p2
issue_id: "017"
tags: [code-review, migration, calendar, outlook]
dependencies: []
---

# Rename migration to current timestamp — future-dated file risks ordering conflicts

## Problem Statement

`supabase/migrations/20260814000000_outlook_calendar_sync.sql` is dated August 2026 but today is April 2026. Any new migration created between now and August 2026 that references the new column names (e.g., `provider_email`, `external_event_id`) will run before this rename migration and fail. Inversely, any migration created before August that expects the old names will fail because this migration ran first. The PR description itself references `20260610000000` — the file was renamed but the docs weren't updated.

## Findings

- Migration file: `supabase/migrations/20260814000000_outlook_calendar_sync.sql` — dated 2026-08-14
- Today: 2026-04-07
- Last existing migration: `20260609000000_parents_add_fields_and_defaults.sql`
- PR description references `20260610000000` — mismatch with actual file

## Proposed Solutions

### Option A — Rename to current date timestamp (recommended)
Rename to `20260407000000_outlook_calendar_sync.sql` or `20260610000000_outlook_calendar_sync.sql` (next after last existing migration).  
```bash
git mv supabase/migrations/20260814000000_outlook_calendar_sync.sql \
       supabase/migrations/20260610000000_outlook_calendar_sync.sql
```
**Effort:** Trivial | **Risk:** None (file rename only)

### Option B — Leave as-is and document a migration freeze
Document that no new migrations touching these tables should be created until August 2026.  
**Effort:** None | **Risk:** High (process-dependent, no enforcement)

### Recommended: Option A — rename to 20260610000000

## Acceptance Criteria
- [ ] Migration file timestamp is chronologically correct relative to existing migrations
- [ ] No gap in the sequence that would allow intervening migrations to conflict
- [ ] PR description updated to reflect the correct filename

## Work Log
- 2026-04-07: Identified by architecture-strategist in PR #50 review (Issue 5)
