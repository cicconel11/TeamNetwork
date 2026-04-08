---
status: pending
priority: p2
issue_id: "016"
tags: [code-review, calendar, google, architecture, data-integrity]
dependencies: []
---

# Add .eq("provider","google") filter to handleDeleteSync in google/calendar-sync.ts

## Problem Statement

`src/lib/google/calendar-sync.ts:handleDeleteSync` queries `event_calendar_entries` for an event without filtering by provider. With only Google this was harmless. Now that both Google and Outlook entries exist for the same event, the query returns both. For Outlook entries, `getValidAccessToken` (Google-only) returns null and skips them — correct behavior by accident. Any future consolidation of the token-fetch layer would silently cross-contaminate. More concretely: the manual sync route does not call Outlook delete propagation, so Outlook entries for deleted events are never cleaned up via the manual sync path.

## Findings

- `src/lib/google/calendar-sync.ts:543–548` — `handleDeleteSync` queries `event_calendar_entries` with only `event_id` filter
- No `.eq("provider", "google")` filter
- `src/app/api/calendar/sync/route.ts` (POST) calls only `syncEventToUsers` (Google) for delete operations — Outlook `event_calendar_entries` for deleted events accumulate as stale rows

## Proposed Solutions

### Option A — Add provider filter (recommended, 1-line fix)
```ts
.eq("provider", "google")
```
Add to the `handleDeleteSync` query in `google/calendar-sync.ts`.  
**Effort:** Trivial | **Risk:** None

### Option B — Add Outlook delete propagation to manual sync route
Also call `syncOutlookEventToUsers(supabase, orgId, eventId, "delete")` in the POST handler of `/api/calendar/sync/route.ts` for pending/failed Outlook delete entries.  
**Effort:** Small | **Risk:** Low

### Recommended: Both A and B — filter is correct regardless, and Outlook deletes should be cleaned up

## Acceptance Criteria
- [ ] `handleDeleteSync` only operates on Google `event_calendar_entries` rows
- [ ] Manual sync (POST /api/calendar/sync) propagates Outlook deletes for events that were deleted
- [ ] Existing Google Calendar delete sync tests pass

## Work Log
- 2026-04-07: Identified by architecture-strategist in PR #50 review (Issue 1)
