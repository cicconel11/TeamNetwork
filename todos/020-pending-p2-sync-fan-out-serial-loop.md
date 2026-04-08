---
status: pending
priority: p2
issue_id: "020"
tags: [code-review, performance, calendar, outlook, scalability]
dependencies: []
---

# Parallelize Outlook (and Google) sync fan-out loop — serial N×5 DB round-trips

## Problem Statement

`syncOutlookEventToUsers` iterates eligible users with a sequential `for...await` loop. Each iteration makes ~5 serial DB round-trips + 1 Graph API call. At P50 latencies (20ms DB, 150ms Graph), a 50-user org takes ~12.5 seconds per event sync. This is called inline in the HTTP request handler, causing the endpoint to hang for that duration. At 200 users it exceeds typical serverless timeouts. The Google equivalent has the same issue.

## Findings

- `src/lib/microsoft/calendar-sync.ts:341` — sequential `for (const userId of eligibleUserIds)` with `await` inside
- Each iteration: getMicrosoftValidAccessToken (1-2 DB reads) + getMicrosoftConnection (1 extra DB read) + read existing entry + Graph API call + upsert entry = 5 sequential operations
- The double-fetch issue (`getMicrosoftValidAccessToken` then `getMicrosoftConnection` separately) compounds this
- Same pattern in `src/lib/google/calendar-sync.ts:454`
- Estimated: 50 users → ~12.5s; 200 users → ~50s (timeout); 500 users → guaranteed failure

## Proposed Solutions

### Option A — Promise.allSettled with concurrency cap (recommended)
```ts
async function runWithConcurrency<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  limit = 10
) {
  const chunks = [];
  for (let i = 0; i < items.length; i += limit) chunks.push(items.slice(i, i + limit));
  for (const chunk of chunks) await Promise.allSettled(chunk.map(fn));
}
await runWithConcurrency(eligibleUserIds, (userId) => syncOutlookEventForUser(...), 10);
```
**Pros:** 10× speedup for large orgs. Self-contained per-user work, safe to parallelize.  
**Cons:** Increases concurrent DB connections and Graph API requests.  
**Effort:** Small | **Risk:** Low

### Option B — Background queue job
Move fan-out sync to a Supabase Edge Function cron + queue table for orgs with >50 connected users.  
**Pros:** Decouples from HTTP request lifecycle.  
**Cons:** Significant infrastructure change; needed eventually but overkill now.  
**Effort:** Large | **Risk:** Medium

### Option C — Fix double-fetch first (prerequisite optimization)
Before parallelizing, eliminate the redundant `getMicrosoftConnection` call in `syncOutlookEventForUser`. This halves DB round-trips without any concurrency change.  
**Effort:** Small | **Risk:** None

### Recommended: Option C first (quick win), then Option A

## Acceptance Criteria
- [ ] `syncOutlookEventForUser` makes at most one `getMicrosoftConnection` call per user
- [ ] Fan-out loop uses concurrent execution with a cap of ~10 simultaneous users
- [ ] Applied to both Google and Outlook fan-out functions
- [ ] Test verifies all users are synced even when individual ones fail

## Work Log
- 2026-04-07: Identified by performance-oracle in PR #50 review (Issues 1 and 2)
