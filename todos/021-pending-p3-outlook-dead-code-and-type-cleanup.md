---
status: pending
priority: p3
issue_id: "021"
tags: [code-review, calendar, outlook, typescript, cleanup]
dependencies: []
---

# Clean up dead code and type issues in Outlook sync

## Problem Statement

Several small issues identified in the code review: dead backward-compat code that was never needed, duplicate type definitions, unnecessary hook aliases, and an unbounded 429 retry. Each is individually small but together they represent ~50 LOC of noise and 3 real type-safety gaps.

## Findings

### Dead code
- `src/app/api/microsoft/callback/route.ts:18–40` — "old format" parseState branch (2-part state) never existed in production for Microsoft (brand new integration)
- `src/lib/calendar/feedSync.ts` — `isGoogleFeedProvider` and `isOutlookFeedProvider` are exported but nothing outside the file imports them

### Unnecessary wrappers
- `src/hooks/useOutlookCalendarSync.ts:214–216` — `reconnect = useCallback(() => connect(), [connect])` is a pointless alias for `connect`
- `src/lib/microsoft/oauth.ts:60–69` — `encryptToken`/`decryptToken` wrappers only called within the same file

### Duplicate types
- `CalendarConnection` interface defined in both `useOutlookCalendarSync.ts` and `OutlookCalendarSyncPanel.tsx`
- `OutlookCalendar` type defined in both `useOutlookCalendarSync.ts` and `TeamOutlookCalendarConnect.tsx`

### Type safety gaps
- `src/lib/microsoft/graph-fetch.ts:53–58` — 429 retry is unbounded recursion; should cap at 3 retries with exponential backoff
- `src/lib/microsoft/calendar-sync.ts:135` — `status: string | null` too loose; should be `MicrosoftConnectionStatus | null`
- `src/lib/google/oauth.ts:updateConnectionStatus` — type doesn't include `reconnect_required` (DB now accepts it)

### Shared extraction opportunities
- `defaultCheckAdminRole` copied verbatim in `outlookSync.ts` and `googleSync.ts` — move to `syncHelpers.ts`
- `setFeedError` copied verbatim in both — move to `syncHelpers.ts`

### Comment cleanup
- `src/app/api/calendar/sync/route.ts:75` — comment references dropped column name `google_calendar_id`

## Proposed Solution

Batch all of these into a single cleanup PR after the main Outlook sync merges:
1. Remove dead `parseState` backward-compat branch from Microsoft callback (Google callback can keep it)
2. Remove `isGoogleFeedProvider`/`isOutlookFeedProvider` exports; inline comparisons
3. Remove `reconnect` alias from both hooks; update call sites to use `connect`
4. Remove `encryptToken`/`decryptToken` wrappers from `microsoft/oauth.ts`; call `sharedEncrypt/Decrypt` directly
5. Export `CalendarConnection` and `OutlookCalendar` from hooks; remove local redefinitions in components
6. Cap `graphFetch` 429 retry at 3 with exponential backoff, passing `retryCount` through
7. Update `updateConnectionStatus` in `google/oauth.ts` to include `reconnect_required`
8. Move `defaultCheckAdminRole` and `setFeedError` to `syncHelpers.ts`
9. Fix stale comment in `sync/route.ts:75`

**Effort:** Small (1-2 hours) | **Risk:** Low

## Acceptance Criteria
- [ ] No unused exports in feedSync.ts
- [ ] No duplicate type definitions for CalendarConnection or OutlookCalendar
- [ ] graphFetch 429 retry has a depth limit
- [ ] updateConnectionStatus in google/oauth.ts accepts reconnect_required
- [ ] All tests pass after cleanup

## Work Log
- 2026-04-07: Identified by code-simplicity-reviewer and kieran-typescript-reviewer in PR #50 review
