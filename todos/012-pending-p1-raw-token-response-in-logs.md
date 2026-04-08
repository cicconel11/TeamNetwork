---
status: pending
priority: p1
issue_id: "012"
tags: [code-review, security, calendar, outlook, logging]
dependencies: []
---

# Sanitize Microsoft token exchange error body before logging

## Problem Statement

`src/lib/microsoft/oauth.ts` embeds the raw Microsoft token endpoint response body into the thrown Error message in two places. Microsoft's AADSTS error responses can include correlation IDs, echoed credential metadata, and tenant policy names. These end up in `console.error` calls visible in server logs. Anyone with log access sees the full Microsoft error payload for every failed token exchange or refresh.

## Findings

- `oauth.ts:108–109`: `const error = await tokenResponse.text(); throw new Error(\`Token exchange failed: ${error}\`);`
- `oauth.ts:316–317`: Same pattern in `refreshAndStoreMicrosoftToken`
- The callback route's error classification (safePatterns/configPatterns) correctly blocks these from reaching users, but the damage is in the logs
- Microsoft AADSTS errors for `invalid_client` can confirm client secret validity in fragments

## Proposed Solutions

### Option A — Log status + sanitized message only
```ts
const errorText = await tokenResponse.text();
console.error("[microsoft-oauth] Token exchange failed", {
  status: tokenResponse.status,
  error: errorText.slice(0, 200), // truncate, never embed full body
});
throw new Error("Token exchange failed");
```
**Pros:** Retains enough for debugging, removes sensitive payload from Error message.  
**Cons:** Slightly less detail in the thrown error.  
**Effort:** Trivial | **Risk:** None

### Option B — Parse and sanitize the AADSTS error code only
Extract just `error` and `error_codes` from the JSON body (never include `error_description` or raw text).  
**Pros:** Structured, useful for debugging.  
**Effort:** Small | **Risk:** None

### Recommended: Option B — structured logging with error code only
Log `error` and `error_codes` fields, never the description or raw body.

## Acceptance Criteria
- [ ] Raw Microsoft API response body is never embedded in thrown Error messages
- [ ] Logs still capture enough information to diagnose failures (status code, error code)
- [ ] No AADSTS error descriptions appear in server logs

## Work Log
- 2026-04-07: Identified by security-sentinel in PR #50 review (Finding C1)
