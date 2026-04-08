---
status: pending
priority: p1
issue_id: "013"
tags: [code-review, security, calendar, outlook, auth]
dependencies: []
---

# Fix open redirect / query param injection via attacker-controlled redirect param

## Problem Statement

The Microsoft (and Google) OAuth auth routes accept a `?redirect=` query parameter, base64-encode it into the OAuth state, and use it verbatim in the callback redirect. An attacker can craft a URL with `?redirect=/settings?calendar%3Dconnected%26injected=true` to spoof a success indicator, or inject arbitrary `error_message` content displayed in the UI. A full cross-domain redirect is blocked by `new URL()` but path-level injection is not.

## Findings

- `src/app/api/microsoft/auth/route.ts:20`: `const redirectPath = url.searchParams.get("redirect") || "/settings/notifications";`
- `src/app/api/microsoft/callback/route.ts:62`: `const settingsUrl = \`${getAppUrl()}${redirectPath}\`` — no validation of redirectPath
- The redirect value from state is used as the destination without stripping query params
- Same pattern exists in Google auth/callback routes

## Proposed Solutions

### Option A — Allowlist valid redirect paths (recommended)
```ts
const ALLOWED_REDIRECT_PATHS = [
  "/settings/notifications",
  "/settings",
  // add others as needed
];
function sanitizeRedirectPath(path: string): string {
  const base = path.split("?")[0]; // strip any query params from caller input
  return ALLOWED_REDIRECT_PATHS.includes(base) ? base : "/settings/notifications";
}
```
Strip query params from the caller-supplied value before embedding in state, and validate on decode.  
**Pros:** Simple, safe. Caller cannot inject query params.  
**Effort:** Small | **Risk:** Low

### Option B — Store redirect in signed HttpOnly cookie (most secure)
Replace the state redirect field with a server-side cookie containing the redirect path, signed with a secret.  
**Pros:** Redirect target never travels through the browser in the state param.  
**Cons:** More complex, requires cookie management.  
**Effort:** Medium | **Risk:** Low

### Option C — Strip query params only (quick fix)
Just `const redirectPath = rawPath.split("?")[0]` before embedding in state.  
**Pros:** Trivial.  
**Cons:** No allowlist — path can still be any internal path.  
**Effort:** Trivial | **Risk:** None (paths are same-origin only due to `getAppUrl()` prefix)

### Recommended: Option A
Allowlist the known redirect targets (there are only 2-3) and strip query params.

## Acceptance Criteria
- [ ] Query params in caller-supplied `redirect` value are stripped before embedding in state
- [ ] Redirect path is validated against an allowlist on decode
- [ ] Applied to both `/api/microsoft/auth` and `/api/google/auth`

## Work Log
- 2026-04-07: Identified by security-sentinel in PR #50 review (Finding H1)
