---
status: pending
priority: p2
issue_id: "019"
tags: [code-review, performance, migration, calendar, outlook]
dependencies: ["017"]
---

# Add composite indexes on provider column to migration

## Problem Statement

The Outlook migration adds a `provider` column to `user_calendar_connections` and `event_calendar_entries` and changes every hot-path query to filter on `(user_id, provider)` or `(event_id, user_id, provider)`. No composite indexes covering `provider` are added. Existing single-column indexes on `user_id` and `event_id` are used but require in-memory rescanning for the `provider` filter on every qualifying row. As event_calendar_entries grows (one row per event per user per provider), this becomes a progressively expensive table scan.

## Findings

- `getMicrosoftConnection`: `.eq("user_id").eq("provider","outlook")` — uses user_id index, rescans for provider
- `getEligibleUsersForOutlookSync`: `.in("user_id", userIds).eq("provider","outlook")` — index not useful for IN + extra column
- `handleOutlookDeleteSync`: `.eq("event_id").eq("provider","outlook")` — rescans for provider
- GET `/api/calendar/sync`: fetches ALL event_calendar_entries for user with no provider filter, counts in JS
- The unique constraints `(user_id, provider)` and `(event_id, user_id, provider)` implicitly create B-tree indexes but may not be used for IN queries

## Proposed Solutions

### Option A — Add indexes to migration (recommended)
```sql
CREATE INDEX IF NOT EXISTS idx_user_cal_connections_user_provider
  ON public.user_calendar_connections(user_id, provider);

CREATE INDEX IF NOT EXISTS idx_event_cal_entries_event_user_provider
  ON public.event_calendar_entries(event_id, user_id, provider);

CREATE INDEX IF NOT EXISTS idx_event_cal_entries_user_provider_status
  ON public.event_calendar_entries(user_id, provider, sync_status);
```
The third index directly serves both the GET status count query and the POST "find unsynced entries" filter.  
**Effort:** Small | **Risk:** None (additive indexes, no data change)

### Option B — Replace JS status counting with Postgres GROUP BY
In GET `/api/calendar/sync`:
```ts
const { data: stats } = await serviceClient
  .rpc("get_calendar_sync_stats", { p_user_id: user.id });
```
Where the RPC does `SELECT sync_status, COUNT(*) GROUP BY sync_status`.  
**Effort:** Small | **Risk:** Low

### Recommended: Both A and B

## Acceptance Criteria
- [ ] Composite indexes added to migration covering `(user_id, provider)` and `(event_id, user_id, provider)` 
- [ ] GET /api/calendar/sync uses aggregate query, not full JS scan
- [ ] `EXPLAIN ANALYZE` on key sync queries shows index usage

## Work Log
- 2026-04-07: Identified by performance-oracle in PR #50 review (Issue 3 and Opportunity 4)
