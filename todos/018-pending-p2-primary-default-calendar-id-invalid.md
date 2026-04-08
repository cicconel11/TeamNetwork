---
status: pending
priority: p2
issue_id: "018"
tags: [code-review, calendar, outlook, typescript, bug]
dependencies: []
---

# Fix "primary" default calendar ID — invalid for Microsoft Graph API

## Problem Statement

`src/lib/microsoft/calendar-sync.ts` uses `"primary"` as the default calendar ID fallback in multiple places. `"primary"` is a Google Calendar concept — it is not a valid Microsoft Graph calendar ID. Graph expects a real GUID. If a user's `targetCalendarId` is not set, server-side sync will call Graph with `/me/calendars/primary/events` which returns a 404. The client-side `loadCalendars` in the hook normalizes to the real default calendar ID, but this only helps for browser-initiated syncs, not server-side fan-out.

## Findings

- `src/lib/microsoft/calendar-sync.ts:47` — `calendarId: string = "primary"` default parameter
- `src/lib/microsoft/calendar-sync.ts:363` — `const targetCalendarId = connection?.targetCalendarId || "primary"`
- `src/lib/microsoft/calendar-sync.ts:385` — same fallback
- The hook's `loadCalendars` normalizes `isDefault` calendars but `targetCalendarId` in the DB may be empty for newly connected users
- Graph API: `POST /me/calendars/primary/events` → 404 Not Found

## Proposed Solutions

### Option A — Fetch default calendar ID from Graph if targetCalendarId is unset
Before creating/updating an event, if `targetCalendarId` is falsy, call `GET /me/calendars?$filter=isDefaultCalendar eq true` and use the resulting ID. Cache it in `user_calendar_connections.target_calendar_id`.  
**Pros:** Correct Graph behavior for all users.  
**Effort:** Medium | **Risk:** Low

### Option B — Require targetCalendarId to be set before sync, skip user if not set
```ts
if (!connection.targetCalendarId) {
  // Log and skip this user — they need to select a calendar in settings
  return;
}
```
**Pros:** Simpler, no extra Graph call.  
**Cons:** Users who connected but never explicitly selected a calendar won't sync.  
**Effort:** Small | **Risk:** Low

### Option C — Use `/me/events` (default calendar) instead of `/me/calendars/{id}/events`
Microsoft Graph's `/me/events` endpoint writes to the user's default calendar without needing a calendar ID.  
**Pros:** Eliminates the calendar ID requirement entirely for the default case.  
**Cons:** User cannot select a non-default target calendar.  
**Effort:** Small | **Risk:** Low

### Recommended: Option C for create (use /me/events), Option A for explicit target
Use `/me/events` when no explicit `targetCalendarId` is set. When one is explicitly chosen, use `/me/calendars/{id}/events`.

## Acceptance Criteria
- [ ] Server-side sync never sends `"primary"` as a calendar ID to Microsoft Graph
- [ ] Users who haven't explicitly selected a target calendar still sync to their default Outlook calendar
- [ ] Test covers the fallback behavior

## Work Log
- 2026-04-07: Identified by kieran-typescript-reviewer in PR #50 review (Issue 6)
