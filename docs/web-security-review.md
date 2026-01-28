# Web App Security Review

**Date:** 2026-01-27
**Scope:** `apps/web/src/` (Next.js 14 web application)
**Source:** Automated codebase security review session `a1b43d62-dfc0-4eca-b992-e67dcda2e6f7`

## Summary

A security review of the TeamMeet web application identified 13 issues across the authentication middleware, API routes, Supabase client wrappers, payment system, role-based access control, input validation, and error handling layers. Four are CRITICAL (authentication bypass, open redirect, injection, missing rate limiting), two are HIGH (information leakage, missing API protections), and seven are MEDIUM (debug code, maintainability, defense-in-depth gaps).

---

## CRITICAL

### 1. `getSession()` used instead of `getUser()` for server-side auth

- **Severity:** CRITICAL
- **File:** `apps/web/src/lib/auth/roles.ts` -- lines 29, 72
- **Description:** `getSession()` reads the JWT from cookies without server-side validation. A tampered JWT could bypass role checks in `getOrgRole()` and `getOrgContext()`, allowing an attacker to impersonate any user or escalate their role.
- **Recommended Fix:** Replace all `getSession()` calls with `getUser()` in `getOrgRole()` and `getOrgContext()`. `getUser()` validates the JWT against Supabase's auth server and refreshes tokens as needed. The middleware already uses `getUser()` correctly -- this fix brings the role-checking utilities in line with that pattern.

### 2. Open redirect in OAuth callback

- **Severity:** CRITICAL
- **File:** `apps/web/src/app/auth/callback/route.ts` -- lines 12, 34
- **Description:** The `redirect` query parameter is used without validation. An attacker can craft a URL like `/auth/callback?code=xxx&redirect=https://evil.com` to redirect users to a malicious site after authentication, enabling phishing attacks.
- **Recommended Fix:** Validate the redirect parameter is a relative path that starts with `/`, does not start with `//`, and stays on the same origin. Example validation:
  ```typescript
  function isValidRedirect(redirect: string): boolean {
    return redirect.startsWith("/") && !redirect.startsWith("//") && !redirect.includes("://");
  }
  ```

### 3. CSS injection via unsanitized org color values

- **Severity:** CRITICAL
- **File:** `apps/web/src/app/[orgSlug]/layout.tsx` -- lines 136-156
- **Description:** Organization `primary_color` and `secondary_color` values from the database are interpolated directly into a `dangerouslySetInnerHTML` style tag without sanitization. A malicious org admin could inject arbitrary CSS (or potentially script via CSS expressions in older browsers) by storing a crafted value like `red; } body { display: none; } .evil {` in their color field.
- **Recommended Fix:** Validate colors match a strict hex pattern before interpolation:
  ```typescript
  const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  function sanitizeColor(color: string | null, fallback: string): string {
    if (color && HEX_COLOR_RE.test(color)) return color;
    return fallback;
  }
  ```

### 4. Signup endpoint has no rate limiting and no Zod validation

- **Severity:** CRITICAL
- **File:** `apps/web/src/app/api/auth/signup/route.ts`
- **Description:** The signup endpoint lacks rate limiting and Zod schema validation, unlike other API routes which use `checkRateLimit()` and `validateJson()`. This enables mass account creation, email bombing, and account enumeration via specific error messages that distinguish between "email already exists" and other failures.
- **Recommended Fix:**
  1. Add `checkRateLimit()` from `lib/security/rate-limit.ts` at the top of the handler.
  2. Use `validateJson()` with a Zod schema from `@teammeet/validation` to validate the request body.
  3. Return a generic error message for existing accounts (e.g., "If this email is not already registered, you will receive a confirmation email") instead of revealing whether the email exists.

---

## HIGH

### 5. Webhook error responses leak internal details

- **Severity:** HIGH
- **Files:**
  - `apps/web/src/app/api/stripe/webhook/route.ts` -- lines 789-791
  - `apps/web/src/app/api/stripe/start-checkout/route.ts` -- lines 145-148
- **Description:** Raw error messages are returned to the caller in catch blocks, exposing database error details, Stripe internals, and table names. An attacker probing the webhook endpoint could learn about the internal database schema and third-party integrations.
- **Recommended Fix:** Return generic error messages to the caller and log the detailed error server-side only:
  ```typescript
  catch (error) {
    console.error("[webhook] Internal error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
  ```

### 6. Calendar and Google OAuth routes have no rate limiting or UUID validation

- **Severity:** HIGH
- **Files:**
  - All files under `apps/web/src/app/api/google/`
  - All files under `apps/web/src/app/api/calendar/`
- **Description:** These API routes accept `organizationId` parameters without UUID format validation and do not apply rate limiting. An attacker could brute-force organization IDs or abuse the Google OAuth initiation endpoint.
- **Recommended Fix:**
  1. Add `checkRateLimit()` to all route handlers.
  2. Validate `organizationId` with `baseSchemas.uuid` from `@teammeet/validation` before using it in database queries.

---

## MEDIUM

### 7. Debug code and excessive logging in production

- **Severity:** MEDIUM
- **Files:**
  - `apps/web/src/middleware.ts` -- lines 162-170 (hardcoded `/testing123` debug path with extra logging)
  - `apps/web/src/app/auth/callback/route.ts` (9 `console.log` statements logging cookies and user IDs)
  - `apps/web/src/lib/supabase/client.ts` -- lines 28-30 (logs auth state changes in browser console)
- **Description:** Debug paths, verbose logging of authentication details, and client-side console output leak implementation details and user data. The `/testing123` path is particularly concerning as it exists in production code with no apparent feature flag.
- **Recommended Fix:**
  1. Remove the `/testing123` debug path or gate it behind an environment variable.
  2. Remove or reduce `console.log` statements in the auth callback to only log errors.
  3. Remove client-side auth state logging in the Supabase client wrapper.

### 8. Webhook handler is 793 lines in one function

- **Severity:** MEDIUM
- **File:** `apps/web/src/app/api/stripe/webhook/route.ts`
- **Description:** The entire Stripe webhook handler is a single 793-line function, making it difficult to review for security issues, test individual event handlers, and maintain. Complex payment logic in a monolithic function increases the risk of undetected bugs.
- **Recommended Fix:** Extract each event type handler into its own module under `lib/payments/webhook-handlers/`:
  ```
  lib/payments/webhook-handlers/
    checkout-session-completed.ts
    invoice-paid.ts
    customer-subscription-updated.ts
    ...
  ```

### 9. Duplicate org queries on members page

- **Severity:** MEDIUM
- **Files:**
  - `apps/web/src/app/[orgSlug]/members/page.tsx`
- **Description:** The members page re-fetches the organization by slug despite the org layout already having it in context. A separate query also fetches all members just to extract unique roles for a filter dropdown, wasting bandwidth and creating inconsistency windows.
- **Recommended Fix:**
  1. Pass org data from the layout context instead of re-fetching.
  2. Use `SELECT DISTINCT role` for the filter dropdown instead of fetching all members.

### 10. Members page has no page-level auth check

- **Severity:** MEDIUM
- **File:** `apps/web/src/app/[orgSlug]/members/page.tsx`
- **Description:** While the middleware checks authentication and org membership, the members page itself does not call `getOrgRole()` as a defense-in-depth measure. If middleware is ever bypassed (e.g., a misconfigured route matcher), the page would render without authorization checks.
- **Recommended Fix:** Add a `getOrgRole()` check at the top of the page component to verify the user has an appropriate role. This provides defense-in-depth on top of middleware.

### 11. Duplicate hCaptcha implementations

- **Severity:** MEDIUM
- **Files:**
  - `apps/web/src/app/api/auth/signup/route.ts` (inline captcha verification)
  - `apps/web/src/lib/security/captcha.ts` (shared utility)
- **Description:** The signup route has an inline captcha verification implementation that uses a different API URL configuration than the shared `verifyCaptcha()` utility. This duplication creates a maintenance risk where one implementation could be updated while the other is forgotten.
- **Recommended Fix:** Remove the inline implementation from the signup route and use the shared `lib/security/captcha.ts` utility everywhere.

### 12. In-memory rate limiting resets on cold starts

- **Severity:** MEDIUM
- **File:** `apps/web/src/lib/security/rate-limit.ts`
- **Description:** Rate limiting uses an in-memory store that resets whenever the serverless function cold-starts. On Vercel (or similar), this means rate limits are effectively reset every few minutes during low traffic, providing minimal protection for critical paths like signup, payment, and account deletion.
- **Recommended Fix:** For critical paths (signup, payment, deletion), consider using a persistent store such as Upstash Redis or Vercel KV. The in-memory approach can remain as a lightweight fallback for less sensitive endpoints.

### 13. Google OAuth state parameter is not signed

- **Severity:** MEDIUM
- **File:** `apps/web/src/app/api/google/auth/route.ts` -- lines 36-38
- **Description:** The OAuth state parameter is constructed as `userId:timestamp:base64(redirectPath)` without an HMAC signature. An attacker could forge a state value with an arbitrary user ID and redirect path, potentially tricking the callback into associating a Google account with the wrong user.
- **Recommended Fix:** Add an HMAC signature to the state parameter using a server-side secret:
  ```typescript
  import { createHmac } from "crypto";

  const payload = `${user.id}:${timestamp}:${encodedRedirect}`;
  const signature = createHmac("sha256", process.env.STATE_SIGNING_SECRET!)
    .update(payload)
    .digest("hex");
  const state = `${payload}:${signature}`;
  ```
  Verify the signature in the callback before trusting any state values.
