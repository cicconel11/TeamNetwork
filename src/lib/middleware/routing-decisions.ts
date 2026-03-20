// Extracted from src/middleware.ts for testability.
// NOTE: These are decision helpers only. The middleware in src/middleware.ts
// is one enforcement point; src/app/[orgSlug]/layout.tsx is a second
// (defense-in-depth). Changes here must be validated against both.

const PUBLIC_API_ROUTES = [
  "/api/stripe/webhook",
  "/api/stripe/webhook-connect",
  "/api/auth/validate-age", // Age gate validation during signup
  "/api/telemetry/error", // Error tracking from unauthenticated contexts
  // Friction feedback: handlers enforce allowlisted context/trigger + rate limits (see anonymous-friction.ts)
  "/api/feedback/submit",
  "/api/feedback/screenshot",
];

const PUBLIC_ROUTES = [
  "/",
  "/demos",
  "/auth/login",
  "/auth/signup",
  "/auth/callback",
  "/auth/error",
  "/auth/signout",
  "/terms",
  "/privacy",
  "/app/parents-join",
];

const AUTH_ONLY_ROUTES = ["/auth/login", "/auth/signup", "/auth/forgot-password"];

/** Returns true for API routes that bypass auth middleware entirely. */
export function shouldBypassAuth(pathname: string): boolean {
  return PUBLIC_API_ROUTES.includes(pathname);
}

/**
 * Returns true for dynamic public API routes (unauthenticated endpoints with
 * dynamic path segments). Currently: parent invite acceptance, called from
 * /app/parents-join before account exists.
 */
export function isPublicApiPattern(pathname: string): boolean {
  return (
    pathname.startsWith("/api/organizations/") &&
    pathname.endsWith("/parents/invite/accept")
  );
}

/**
 * Returns true for routes that are publicly accessible without authentication.
 * Includes all /auth/* sub-paths.
 */
export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route) || pathname.startsWith("/auth/");
}

/**
 * Returns true for routes that should redirect authenticated users to /app.
 * These are pages (login, signup, forgot-password) that make no sense when
 * already logged in.
 */
export function isAuthOnlyRoute(pathname: string): boolean {
  return AUTH_ONLY_ROUTES.includes(pathname);
}

/**
 * Returns the redirect path for a given membership status, or null if no
 * redirect is needed. Returns relative paths so callers can construct absolute
 * URLs with `new URL(redirect, request.url)`.
 */
export function getRedirectForMembershipStatus(
  status: string | null | undefined,
  orgSlug: string,
): string | null {
  if (status === "revoked") return `/app?error=access_revoked`;
  if (status === "pending") return `/app?pending=${orgSlug}`;
  return null;
}

/**
 * Returns true when the request host is the bare (non-www) domain that should
 * be canonicalized to www.myteamnetwork.com. Host is nullable because
 * request.headers.get("host") can return null.
 */
export function shouldRedirectToCanonicalHost(host: string | null): boolean {
  return host === "myteamnetwork.com";
}
