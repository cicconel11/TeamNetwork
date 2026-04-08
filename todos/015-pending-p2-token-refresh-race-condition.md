---
status: pending
priority: p2
issue_id: "015"
tags: [code-review, calendar, outlook, concurrency, data-integrity]
dependencies: []
---

# Add per-user advisory lock around Microsoft token refresh to prevent rotation poisoning

## Problem Statement

Microsoft invalidates a refresh token after first use. If two concurrent requests both find the same user's access token expired and both call `refreshAndStoreMicrosoftToken`, the second call gets `invalid_grant` (the refresh token was already consumed by the first) and sets the connection to `reconnect_required` — forcing the user to re-authenticate unnecessarily. This is especially likely during fan-out sync where multiple org event syncs fire simultaneously for the same user.

## Findings

- `src/lib/microsoft/oauth.ts:refreshAndStoreMicrosoftToken` — no locking, no optimistic concurrency
- `src/lib/microsoft/calendar-sync.ts:syncOutlookEventToUsers` — serial `for...await` today, but if parallelized (recommended) this becomes an immediate race
- Institutional learnings doc (`docs/solutions/security-issues/rag-system-hardening.md`) flagged this exact pattern: read-modify-write on shared state without locking
- Same issue exists in Google's `refreshAndStoreToken` but is less acute because Google doesn't rotate refresh tokens

## Proposed Solutions

### Option A — PostgreSQL advisory lock per user (recommended)
```ts
// Wrap token refresh in advisory lock
const lockId = hashStringToInt64(userId + ":microsoft-token-refresh");
await supabase.rpc("pg_advisory_xact_lock", { key: lockId });
// now safe to read/refresh/write
```
Or use a Supabase RPC that wraps the lock + refresh in a single transaction.  
**Pros:** Database-level, works across serverless instances.  
**Effort:** Medium | **Risk:** Low

### Option B — Optimistic concurrency with token version column
Add `token_version INTEGER DEFAULT 0` to `user_calendar_connections`. The UPDATE only proceeds if `token_version = $current_version`. On conflict, re-read and skip refresh (the concurrent caller already refreshed).  
```sql
UPDATE user_calendar_connections 
SET access_token_encrypted = $new, refresh_token_encrypted = $new_refresh, token_version = token_version + 1
WHERE user_id = $uid AND provider = 'outlook' AND token_version = $current_version
```
**Pros:** No lock contention.  
**Effort:** Medium (requires migration) | **Risk:** Low

### Option C — SELECT FOR UPDATE on the row before refresh
```ts
// In a transaction:
const conn = await supabase.rpc("lock_and_get_connection", { user_id: userId, provider: "outlook" });
// refresh using conn.refresh_token, write back in same transaction
```
**Pros:** Simple, atomic.  
**Cons:** Requires an RPC to avoid multiple round-trips.  
**Effort:** Medium | **Risk:** Low

### Recommended: Option C — SELECT FOR UPDATE via RPC

## Acceptance Criteria
- [ ] Concurrent token refreshes for the same user+provider do not corrupt the stored refresh token
- [ ] A user who triggers concurrent syncs does not end up in `reconnect_required` state
- [ ] Fix applies to both Google (`refreshAndStoreToken`) and Microsoft (`refreshAndStoreMicrosoftToken`)

## Work Log
- 2026-04-07: Identified by security-sentinel (H4) and learnings-researcher in PR #50 review
