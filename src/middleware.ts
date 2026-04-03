import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { requireEnv, validateAuthTestMode, shouldLogAuth, shouldLogAuthFailures, hashForLogging } from "./lib/env";
import { createMiddlewareAuditEntry, fireAndForgetDevAdminAudit, isDevAdminEmail, redactEmail } from "./lib/auth/dev-admin";
import { validateSiteUrl } from "./lib/supabase/config";
import {
  shouldBypassAuth,
  isPublicApiPattern as isPublicApiPatternCheck,
  isPublicRoute as isPublicRouteCheck,
  isAuthOnlyRoute,
  isOrgRoute,
  getRedirectForMembershipStatus,
  shouldRedirectToCanonicalHost,
} from "./lib/middleware/routing-decisions";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "./i18n/config";
import type { SupportedLocale } from "./i18n/config";

// Validate at module load
validateAuthTestMode();

/** Sync the NEXT_LOCALE cookie from DB language preferences (user override → org default → 'en'). */
function syncLocaleCookie(
  request: NextRequest,
  response: NextResponse,
  userLangOverride: string | null | undefined,
  orgDefaultLang: string | null | undefined,
) {
  const effective = (
    SUPPORTED_LOCALES.includes(userLangOverride as SupportedLocale) ? userLangOverride :
    SUPPORTED_LOCALES.includes(orgDefaultLang as SupportedLocale) ? orgDefaultLang :
    DEFAULT_LOCALE
  ) as string;

  const current = request.cookies.get("NEXT_LOCALE")?.value;
  if (effective !== current) {
    // Set on the request so downstream server components (getRequestConfig)
    // see the updated locale in THIS request, not one request late.
    request.cookies.set("NEXT_LOCALE", effective);
    // Set on the response to persist the cookie for future requests.
    response.cookies.set("NEXT_LOCALE", effective, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
}

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

// Enterprise public routes that don't require enterprise membership
const enterprisePublicSlugs = ["pricing", "features"];

function fireMiddlewareAudit(params: {
  userId: string;
  userEmail: string;
  action: "view_org" | "view_enterprise";
  targetSlug: string;
  pathname: string;
  method: string;
  request: NextRequest;
}) {
  const entry = createMiddlewareAuditEntry({
    userId: params.userId,
    userEmail: params.userEmail,
    action: params.action,
    targetSlug: params.targetSlug,
    pathname: params.pathname,
    method: params.method,
    headers: params.request.headers,
  });

  if (!entry) return;
  void fireAndForgetDevAdminAudit(entry);
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const host = request.headers.get("host");
  const shouldLog = shouldLogAuth();
  const logFailures = shouldLogAuthFailures();

  // Browser/devtools probes should bypass auth and org logic entirely.
  if (pathname.startsWith("/.well-known/")) {
    return NextResponse.next();
  }

  // Bypass routes that should never be blocked by auth middleware
  if (shouldBypassAuth(pathname)) {
    return NextResponse.next();
  }

  // Dynamic public API routes (unauthenticated endpoints with dynamic path segments)
  if (isPublicApiPatternCheck(pathname)) {
    return NextResponse.next();
  }

  // Canonical host redirect: ensure cookies stay scoped to www domain
  if (shouldRedirectToCanonicalHost(host)) {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    url.host = "www.myteamnetwork.com";
    return NextResponse.redirect(url, { status: 308 });
  }

  try {
    validateSiteUrl();
  } catch (e) {
    console.error("[MW] Site URL validation failed:", (e as Error).message);
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
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
  if (isTestMode) {
    console.warn("[SECURITY] AUTH_TEST_MODE active - bypassing JWT validation", {
      pathname,
      hasAuthCookies,
      timestamp: new Date().toISOString(),
    });
    user = hasAuthCookies ? { id: "test-user" } as { id: string } : null;
  } else {
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

  // Redirect authenticated users away from auth-only pages
  if (user && isAuthOnlyRoute(pathname)) {
    return NextResponse.redirect(new URL("/app", request.url));
  }

  if (isPublicRouteCheck(pathname)) {
    return response;
  }

  // API routes: keep JSON 401 instead of HTML redirect
  if (pathname.startsWith("/api/")) {
    if (!user) {
      // Blackbaud OAuth callback: redirect to login instead of JSON 401
      // so the handler's session-expired recovery flow can work.
      // This runs AFTER canonical-host redirect to preserve www cookie scoping.
      if (pathname === "/api/blackbaud/callback") {
        const redirectUrl = new URL("/auth/login", request.url);
        redirectUrl.searchParams.set("error", "session_expired");
        redirectUrl.searchParams.set("redirect", pathname + request.nextUrl.search);
        return NextResponse.redirect(redirectUrl);
      }
      return NextResponse.json(
        { error: "Unauthorized", message: "Authentication required" },
        { status: 401 }
      );
    }
    return response;
  }

  if (!user) {
    const redirectUrl = new URL("/auth/login", request.url);
    const fullPath = pathname + request.nextUrl.search;
    redirectUrl.searchParams.set("redirect", fullPath);
    const redirectResponse = NextResponse.redirect(redirectUrl);

    if (hasAuthCookies) {
      // SECURITY FIX: Clear stale/invalid auth cookies instead of allowing pass-through
      // This prevents unauthorized access while avoiding redirect loops (cookies cleared = no loop)
      if (logFailures) {
        console.log("[AUTH-MW] Clearing stale auth cookies and redirecting to login", {
          pathname,
          sbCookies,
        });
      }
      // Clear all Supabase auth cookies
      cookiesAll
        .filter((c) => c.name.startsWith("sb-") || c.name.includes("auth-token"))
        .forEach((c) => {
          redirectResponse.cookies.set(c.name, "", {
            path: "/",
            maxAge: 0,
            expires: new Date(0),
          });
          // Also clear on root domain in production
          if (process.env.NODE_ENV === "production") {
            redirectResponse.headers.append(
              "Set-Cookie",
              `${c.name}=; Path=/; Domain=.myteamnetwork.com; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`
            );
          }
        });
    }

    return redirectResponse;
  }

  // Handle enterprise routes
  if (pathname.startsWith("/enterprise/")) {
    const enterpriseSlugMatch = pathname.match(/^\/enterprise\/([^\/]+)/);
    if (enterpriseSlugMatch) {
      const enterpriseSlug = enterpriseSlugMatch[1];

      // Skip for public enterprise paths that don't need membership validation
      if (enterprisePublicSlugs.includes(enterpriseSlug)) {
        return response;
      }

      // Check if user is dev-admin - if so, skip enterprise membership checks entirely
      const userEmail = "email" in user ? (user.email as string | null | undefined) : undefined;
      const userIsDevAdmin = isDevAdminEmail(userEmail);

      if (!userIsDevAdmin) {
        try {
          // Get enterprise by slug
          const { data: enterprise } = await supabase
            .from("enterprises")
            .select("id")
            .eq("slug", enterpriseSlug)
            .maybeSingle();

          if (!enterprise) {
            return NextResponse.redirect(new URL("/app?error=enterprise_not_found", request.url));
          }

          // Check user has role in enterprise
          const { data: role } = await supabase
            .from("user_enterprise_roles")
            .select("role")
            .eq("enterprise_id", enterprise.id)
            .eq("user_id", user.id)
            .maybeSingle();

          if (!role) {
            return NextResponse.redirect(new URL("/app?error=no_enterprise_access", request.url));
          }

          // Add enterprise info to headers for downstream use
          response.headers.set("x-enterprise-id", enterprise.id);
          response.headers.set("x-enterprise-role", role.role);
        } catch (e) {
          // Log error but redirect to app with error
          if (shouldLog) {
            console.error("[AUTH-MW] Error checking enterprise access:", e);
          }
          return NextResponse.redirect(new URL("/app?error=enterprise_error", request.url));
        }
      } else {
        // Audit dev-admin bypass
        fireMiddlewareAudit({
          userId: user.id,
          userEmail: userEmail ?? "",
          action: "view_enterprise",
          targetSlug: enterpriseSlug,
          pathname,
          method: request.method,
          request,
        });
        if (shouldLog) {
          console.log("[AUTH-MW] Dev-admin bypassing enterprise membership check", {
            email: userEmail ? redactEmail(userEmail) : null,
            enterpriseSlug,
            pathname,
          });
        }
      }
    }
  }

  // ── Locale tracking (populated during org/user checks below) ──
  let userLangOverride: string | null | undefined;
  let orgDefaultLang: string | null | undefined;

  // Check for revoked access on org routes
  if (isOrgRoute(pathname) && user) {
    const orgSlug = pathname.split("/")[1];
    if (orgSlug) {
      // Check if user is dev-admin - if so, skip membership checks entirely
      const userEmail = "email" in user ? (user.email as string | null | undefined) : undefined;
      const userIsDevAdmin = isDevAdminEmail(userEmail);

      if (!userIsDevAdmin) {
        // Only check membership for non-dev-admins
        try {
          // Use RPC to fetch org + membership in a single round-trip (Phase 1.1 performance)
          const { data: ctx, error: rpcError } = await supabase.rpc(
            "get_org_context_by_slug",
            { p_slug: orgSlug }
          );

          let membershipStatus: string | null | undefined;

          if (rpcError) {
            // RPC failed — fall back to sequential queries so users are not blocked
            if (shouldLog) {
              console.error("[AUTH-MW] get_org_context_by_slug RPC failed, falling back:", rpcError);
            }

            const { data: org } = await supabase
              .from("organizations")
              .select("id")
              .eq("slug", orgSlug)
              .maybeSingle();

            if (org) {
              const { data: membership } = await supabase
                .from("user_organization_roles")
                .select("status")
                .eq("organization_id", org.id)
                .eq("user_id", user.id)
                .maybeSingle();

              membershipStatus = membership?.status;
            }
          } else if (ctx?.found) {
            membershipStatus = ctx.membership?.status;
            // Capture language fields from RPC for locale cookie sync (no extra query)
            orgDefaultLang = ctx.organization?.default_language ?? null;
            userLangOverride = ctx.membership?.language_override ?? null;
          }
          // If !ctx?.found the org doesn't exist — layout.tsx handles the 404 gate

          const membershipRedirect = getRedirectForMembershipStatus(membershipStatus, orgSlug);
          if (membershipRedirect) {
            return NextResponse.redirect(new URL(membershipRedirect, request.url));
          }
        } catch (e) {
          // Log error but don't block the request
          if (shouldLog) {
            console.error("[AUTH-MW] Error checking membership status:", e);
          }
        }
      } else {
        // Dev-admin bypasses membership checks but still needs language data
        try {
          const { data: ctx } = await supabase.rpc("get_org_context_by_slug", { p_slug: orgSlug });
          if (ctx?.found) {
            orgDefaultLang = ctx.organization?.default_language ?? null;
            userLangOverride = ctx.membership?.language_override ?? null;
          }
        } catch {
          // Non-critical
        }

        // Audit dev-admin bypass
        fireMiddlewareAudit({
          userId: user.id,
          userEmail: userEmail ?? "",
          action: "view_org",
          targetSlug: orgSlug,
          pathname,
          method: request.method,
          request,
        });
        if (shouldLog) {
          console.log("[AUTH-MW] Dev-admin bypassing membership check", {
            email: userEmail ? redactEmail(userEmail) : null,
            orgSlug,
            pathname,
          });
        }
      }
    }
  }

  // ── Locale cookie sync ──
  // For org routes, language fields were already captured from the RPC above.
  // For non-org routes, always query the user's language preference so the
  // cookie stays in sync with DB changes (e.g. after saving on /settings/language).
  if (user) {
    if (!isOrgRoute(pathname)) {
      try {
        const { data: userData } = await supabase
          .from("users")
          .select("language_override")
          .eq("id", user.id)
          .maybeSingle();
        userLangOverride = userData?.language_override ?? null;

        // When user chose "org default" (override is null), resolve their
        // primary org's default_language so non-org pages render correctly.
        if (!userLangOverride) {
          const { data: membership } = await supabase
            .from("user_organization_roles")
            .select("organization_id")
            .eq("user_id", user.id)
            .eq("status", "active")
            .is("deleted_at", null)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();

          if (membership?.organization_id) {
            const { data: org } = await supabase
              .from("organizations")
              .select("default_language")
              .eq("id", membership.organization_id)
              .maybeSingle();
            orgDefaultLang = org?.default_language ?? null;
          }
        }
      } catch {
        // Non-critical — fall through to default locale
      }
    }

    syncLocaleCookie(request, response, userLangOverride, orgDefaultLang);
  }

  response.headers.set("x-pathname", pathname);
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
