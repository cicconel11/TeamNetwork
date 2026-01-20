# Plan: Fix Mobile Billing API Authentication

## Status: Phase 2 - Bearer Token Authentication

### What We've Done (Phase 1 - Completed)
✅ Fixed CORS preflight by allowing OPTIONS requests to pass through middleware
✅ Added CORS headers to middleware's 401 responses
✅ Added Bearer token validation support to middleware

### Current Problem (Phase 2)
Mobile app receives **401 Unauthorized** when calling `/api/organizations/{id}/subscription`

**Root Cause:** Middleware validates the Bearer token correctly, but the route handler's `requireAdmin()` function uses `createClient()` which **only supports cookie-based auth**. When the route handler tries to get the user, it finds no cookies and returns null, resulting in 401.

```
Mobile Request → Middleware (✅ validates Bearer token) → Route Handler (❌ can't see Bearer token, only checks cookies) → 401 Unauthorized
```

## Solution: Create Unified Supabase Client Factory

Create a new helper that supports **both cookie-based auth (web) and Bearer token auth (mobile)**, mirroring the pattern already proven in middleware.

### Implementation Steps

#### Step 1: Create New Supabase Client Helper
**File:** `apps/web/src/lib/supabase/request.ts` (new file)

This helper checks for Bearer tokens first, then falls back to cookies:

```typescript
import { createServerClient } from "@supabase/ssr";
import { requireEnv } from "../env";

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

/**
 * Creates a Supabase client that supports both cookie-based auth (web)
 * and Bearer token auth (mobile).
 */
export async function createClientFromRequest(request: Request) {
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.substring(7)
    : null;

  // For Bearer token requests, skip cookie management
  if (bearerToken) {
    return createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() { return []; },
        setAll() { /* no-op */ },
      },
    });
  }

  // Fall back to cookie-based auth (same as existing createClient)
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      domain: undefined,
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, { ...options, path: options.path ?? "/", domain: undefined });
          });
        } catch {
          // Ignore - Server Component context
        }
      },
    },
  });
}

/**
 * Helper to get authenticated user from request (cookies or Bearer token)
 */
export async function getUserFromRequest(request: Request) {
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.substring(7)
    : null;

  const supabase = await createClientFromRequest(request);

  // For Bearer tokens, must pass token explicitly to getUser()
  if (bearerToken) {
    return supabase.auth.getUser(bearerToken);
  }

  // For cookies, call without arguments
  return supabase.auth.getUser();
}
```

#### Step 2: Update Subscription Route Handler
**File:** `apps/web/src/app/api/organizations/[organizationId]/subscription/route.ts`

**Add import at top (after line 14):**
```typescript
import { createClientFromRequest, getUserFromRequest } from "@/lib/supabase/request";
```

**Replace `requireAdmin()` function (lines 184-218):**
```typescript
async function requireAdmin(req: Request, orgId: string, rateLimitLabel: string) {
  const supabase = await createClientFromRequest(req);
  const { data: { user } } = await getUserFromRequest(req);

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: rateLimitLabel,
    limitPerIp: 60,
    limitPerUser: 40,
  });

  if (!rateLimit.ok) {
    return { error: buildRateLimitResponse(rateLimit) };
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: { ...rateLimit.headers, ...corsHeaders } });

  if (!user) {
    return { error: respond({ error: "Unauthorized" }, 401) };
  }

  const { data: role } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (role?.role !== "admin") {
    return { error: respond({ error: "Forbidden" }, 403) };
  }

  return { supabase, user, respond, rateLimit };
}
```

### Why This Approach?

1. **Mirrors middleware pattern** - Uses the exact same Bearer token extraction and validation logic
2. **No breaking changes** - Web app continues using cookies, mobile uses Bearer tokens seamlessly
3. **Reusable** - Other admin API routes can easily adopt this pattern
4. **Maintainable** - Centralizes auth logic in one place
5. **Secure** - Uses Supabase's built-in auth validation (no manual JWT parsing)

### Files Modified

- `apps/web/src/lib/supabase/request.ts` - **NEW FILE** - Unified client factory
- `apps/web/src/app/api/organizations/[organizationId]/subscription/route.ts` - Import new helper and update `requireAdmin()` (lines 14, 184-218)

### No Changes Needed

- `apps/web/src/middleware.ts` - Already supports Bearer tokens (completed in Phase 1)
- `apps/mobile/src/hooks/useSubscription.ts` - Already sends Bearer tokens correctly

## Verification

1. Restart Next.js dev server: `cd apps/web && bun dev`
2. Restart Expo: `cd apps/mobile && bun expo start`
3. Navigate to an org's settings screen in mobile app
4. Verify subscription data loads without 401 errors
5. Verify "Manage Billing" button works
6. Test web app subscription management still works (cookie auth)

## Future Work (Optional)

Other admin API routes that could benefit from Bearer token support:
- `apps/web/src/app/api/organizations/[organizationId]/route.ts` (PATCH, DELETE)
- `apps/web/src/app/api/organizations/[organizationId]/branding/route.ts`
- `apps/web/src/app/api/organizations/[organizationId]/start-checkout/route.ts`

Each can migrate by importing and using `createClientFromRequest()` + `getUserFromRequest()`.
