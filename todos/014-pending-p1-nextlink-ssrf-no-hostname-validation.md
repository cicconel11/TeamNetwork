---
status: pending
priority: p1
issue_id: "014"
tags: [code-review, security, calendar, outlook, ssrf]
dependencies: []
---

# Validate @odata.nextLink hostname before following — SSRF risk

## Problem Statement

`src/lib/calendar/outlookSync.ts` follows the `@odata.nextLink` pagination URL verbatim with no hostname validation. In production, Microsoft always returns `graph.microsoft.com` nextLinks. But if a crafted or compromised response returns a nextLink pointing to an internal address (e.g. `http://169.254.169.254/latest/meta-data/` on cloud infrastructure), the application will follow it with the user's Bearer token in the `Authorization` header.

## Findings

- `outlookSync.ts:78–80`: `url = data["@odata.nextLink"];` — explicit comment says "use verbatim (never reconstruct)"
- The `fetcher` dependency injection makes this testable, but the production `fetch` path has no guard
- The Bearer token in the Authorization header would be sent to any URL the nextLink points to

## Proposed Solutions

### Option A — Validate prefix before following (recommended)
```ts
const nextLink = data["@odata.nextLink"];
if (nextLink) {
  if (!nextLink.startsWith("https://graph.microsoft.com/")) {
    console.error("[outlook-sync] Unexpected nextLink host, stopping pagination", nextLink.slice(0, 100));
    break;
  }
  url = nextLink;
}
```
**Pros:** 3-line fix, closes SSRF vector entirely.  
**Effort:** Trivial | **Risk:** None (legitimate Microsoft nextLinks always use graph.microsoft.com)

### Option B — Parse and reconstruct the URL
Parse the nextLink, validate the host, and reconstruct from known-good parts.  
**Pros:** More robust.  
**Cons:** Breaks the "never reconstruct" design intent; unnecessary complexity.  
**Effort:** Small | **Risk:** Low

### Recommended: Option A — prefix check before following

## Acceptance Criteria
- [ ] `@odata.nextLink` is validated to start with `https://graph.microsoft.com/` before being followed
- [ ] Non-graph URLs log an error and stop pagination (do not throw — partial sync is better than no sync)
- [ ] Existing pagination tests still pass

## Work Log
- 2026-04-07: Identified by security-sentinel in PR #50 review (Finding H3)
