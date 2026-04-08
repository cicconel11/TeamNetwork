---
status: pending
priority: p1
issue_id: "010"
tags: [code-review, calendar, outlook, bug]
dependencies: []
---

# Fix oauthStatus query param mismatch — Outlook "connected" banner never fires

## Problem Statement

After a successful Outlook OAuth flow, the callback route writes `?calendar=connected` to the redirect URL, but the `useOutlookCalendarSync` hook reads `searchParams.get("outlook_calendar")`. These never match — `oauthStatus` is always `null`, so the post-connect success state is never shown. The Google hook reads `"calendar"` and works correctly.

## Findings

- `src/app/api/microsoft/callback/route.ts:142` — sets `successUrl.searchParams.set("calendar", "connected")`
- `src/hooks/useOutlookCalendarSync.ts:81` — reads `searchParams.get("outlook_calendar")` ← wrong key
- Google hook at `src/hooks/useGoogleCalendarSync.ts:81` reads `searchParams.get("calendar")` — matches correctly

## Proposed Solutions

### Option A — Change hook to read `"calendar"` (matches route, no route change needed)
```ts
const oauthStatus = searchParams.get("calendar");
```
**Pros:** 1-line fix, matches existing route behavior.  
**Cons:** Both providers share the same query param — can't distinguish which connected in the URL.  
**Effort:** Trivial | **Risk:** None

### Option B — Change route to write `"outlook_calendar"` (differentiates providers)
```ts
successUrl.searchParams.set("outlook_calendar", "connected");
```
**Pros:** Provider-specific params enable distinct UX per provider.  
**Cons:** Requires route change; Google uses `"calendar"` so convention is inconsistent.  
**Effort:** Trivial | **Risk:** None

### Recommended: Option A
The two hooks are separate components and the redirect target always loads the correct provider's panel. Provider-specific params add no real value here.

## Acceptance Criteria
- [ ] After completing Outlook OAuth, the success state is shown in the UI
- [ ] `searchParams.get(...)` in `useOutlookCalendarSync` matches what the callback route sets
- [ ] Google hook behavior unchanged

## Work Log
- 2026-04-07: Identified by code-simplicity-reviewer in PR #50 review
