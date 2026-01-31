import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { requireEnv, validateAuthTestMode, shouldLogAuth, shouldLogAuthFailures, hashForLogging } from "./lib/env";
import { getCorsHeadersForOrigin } from "./lib/security/cors";

// Validate AUTH_TEST_MODE at module load
validateAuthTestMode();

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

// Routes that don't require authentication
const publicRoutes = ["/", "/auth/login", "/auth/signup", "/auth/callback", "/auth/error", "/auth/signout", "/auth/forgot-password", "/auth/reset-password", "/terms", "/privacy"];

// Routes that should redirect to /app if user is already authenticated
const authOnlyRoutes = ["/", "/auth/login", "/auth/signup"];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const host = request.headers.get("host");
  const shouldLog = shouldLogAuth();
  const logFailures = shouldLogAuthFailures();

  // Bypass Stripe webhook so middleware does not block it
  if (pathname === "/api/stripe/webhook") {
    return NextResponse.next();
  }

  // Allow CORS preflight requests to pass through to route handlers
  if (request.method === "OPTIONS") {
    return NextResponse.next();
  }

  // Canonical host redirect: ensure cookies stay scoped to www domain
  if (host === "myteamnetwork.com") {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    url.host = "www.myteamnetwork.com";
    return NextResponse.redirect(url, { status: 308 });
  }

  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      domain: undefined,
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        if (shouldLog) {
          console.log("[AUTH-MW] setAll", {
            host,
            pathname,
            cookieCount: cookiesToSet.length,
            cookies: cookiesToSet.map(({ name, value, options }) => ({
              name,
              valueLen: value?.length ?? 0,
              options: {
                path: options.path ?? "/",
                domain: options.domain,
                secure: options.secure,
                sameSite: options.sameSite,
                maxAge: options.maxAge,
              },
            })),
          });
        }
        if (cookiesToSet.length === 0) {
          return;
        }
        cookiesToSet.forEach(({ name, value, options }) => {
          const cookieOptions: CookieOptions = {
            ...options,
            path: options.path ?? "/",
            domain: undefined,
          };
          request.cookies.set({ name, value, ...cookieOptions });
          response.cookies.set({ name, value, ...cookieOptions });

          // Legacy cleanup: Ensure we clear cookies on the root domain if they exist
          if (process.env.NODE_ENV === "production" && (value === "" || options.maxAge === 0)) {
            response.headers.append(
              "Set-Cookie",
              `${name}=; Path=/; Domain=.myteamnetwork.com; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`
            );
          }
        });
      },
    },
  });

  const cookiesAll = request.cookies.getAll();
  const hasAuthCookies = cookiesAll.some(
    (c) => c.name.startsWith("sb-") || c.name.includes("auth-token")
  );

  // Use getUser() instead of getSession() - getUser() validates JWT and refreshes tokens
  // This is required for OAuth sessions to work correctly
  const isTestMode = process.env.AUTH_TEST_MODE === "true";
  if (isTestMode && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_TEST_MODE cannot be enabled in production");
  }
  let user = null;
  let authError: Error | null = null;

  // Check for Authorization header (for mobile/API clients)
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

  if (isTestMode) {
    console.warn("[SECURITY] AUTH_TEST_MODE active - bypassing JWT validation", {
      pathname,
      hasAuthCookies,
      timestamp: new Date().toISOString(),
    });
    user = hasAuthCookies ? { id: "test-user" } as { id: string } : null;
  } else if (bearerToken) {
    // Validate bearer token for mobile/API clients
    const res = await supabase.auth.getUser(bearerToken);
    user = res.data.user;
    authError = res.error;
  } else {
    // Fall back to cookie-based auth for web clients
    const res = await supabase.auth.getUser();
    user = res.data.user;
    authError = res.error;
  }

  // For compatibility, create a session-like object
  const session = user ? { user, expires_at: null } : null;


  const sbCookies = cookiesAll.map((c) => c.name).filter((n) => n.startsWith("sb-"));

  // Always log auth failures in production for debugging user-specific issues
  const isAuthFailure = !user && hasAuthCookies;
  if (shouldLog || (isAuthFailure && logFailures)) {
    console.log("[AUTH-MW]", {
      host,
      pathname,
      origin: request.headers.get("origin"),
      referer: request.headers.get("referer"),
      userAgent: request.headers.get("user-agent")?.slice(0, 100),
      sbCookies,
      allCookieNames: cookiesAll.map((c) => c.name),
      hasAuthCookies,
      sessionUserHash: user ? hashForLogging(user.id) : null,
      sessionNull: !session,
      authError: authError ? { message: authError.message, name: authError.name } : null,
      isAuthFailure,
    });
    if (pathname.startsWith("/testing123")) {
      console.log("[AUTH-MW-testing123]", {
        pathname,
        sbCookies,
        sessionPresent: !!session,
        userHash: user ? hashForLogging(user.id) : null,
        authError: authError?.message || null,
      });
    }
  }

  const isPublicRoute =
    publicRoutes.some((route) => pathname === route) || pathname.startsWith("/auth/");

  if (isPublicRoute) {
    return response;
  }

  // API routes: keep JSON 401 instead of HTML redirect
  if (pathname.startsWith("/api/")) {
    if (!user) {
      const requestOrigin = request.headers.get("origin");
      return NextResponse.json(
        { error: "Unauthorized", message: "Authentication required" },
        { status: 401, headers: getCorsHeadersForOrigin(requestOrigin) }
      );
    }
    return response;
  }

  if (user && authOnlyRoutes.includes(pathname)) {
    return NextResponse.redirect(new URL("/app", request.url));
  }

  if (!user) {
    if (hasAuthCookies) {
      // Likely refresh in-flight; allow pass-through to avoid loops
      return response;
    }
    const redirectUrl = new URL("/auth/login", request.url);
    redirectUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Check for revoked access on org routes
  // Org routes are paths like /[orgSlug]/... but not /app/ or /auth/ or /api/ or /settings/
  const isOrgRoute = !pathname.startsWith("/app") &&
    !pathname.startsWith("/auth") &&
    !pathname.startsWith("/api") &&
    !pathname.startsWith("/settings") &&
    pathname !== "/" &&
    pathname.split("/").filter(Boolean).length >= 1;

  if (isOrgRoute && user) {
    const orgSlug = pathname.split("/")[1];

    // Only check if it looks like an org slug (not a system path)
    if (orgSlug && !["app", "auth", "api", "settings", "_next", "favicon.ico"].includes(orgSlug)) {
      try {
        // Get organization by slug
        const { data: org } = await supabase
          .from("organizations")
          .select("id")
          .eq("slug", orgSlug)
          .maybeSingle();

        if (org) {
          // Check user's membership status
          const { data: membership } = await supabase
            .from("user_organization_roles")
            .select("status")
            .eq("organization_id", org.id)
            .eq("user_id", user.id)
            .maybeSingle();

          if (membership?.status === "revoked") {
            // User's access has been revoked - redirect to app with error
            const redirectUrl = new URL("/app", request.url);
            redirectUrl.searchParams.set("error", "access_revoked");
            return NextResponse.redirect(redirectUrl);
          }

          if (membership?.status === "pending") {
            // User's membership is pending approval - redirect to app with pending message
            const redirectUrl = new URL("/app", request.url);
            redirectUrl.searchParams.set("pending", orgSlug);
            return NextResponse.redirect(redirectUrl);
          }
        }
      } catch (e) {
        // Log error but don't block the request
        if (shouldLog) {
          console.error("[AUTH-MW] Error checking membership status:", e);
        }
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
