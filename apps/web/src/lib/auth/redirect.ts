/**
 * Sanitizes a redirect path to prevent open-redirect attacks.
 * Returns a safe internal path or falls back to "/app".
 *
 * Defends against:
 * - Protocol-relative URLs (`//evil.com`)
 * - Absolute URLs with scheme (`https://evil.com`, `javascript://...`)
 * - Backslash injection (`/\evil.com` — `new URL` resolves to external host)
 * - Control character injection (null bytes, tabs that confuse URL parsers)
 */
function normalizeOrigin(siteUrl: string): string {
  return siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
}

export function sanitizeRedirectPath(raw: string | null): string {
  if (!raw) return "/app";

  const trimmed = raw.trim();

  if (!trimmed.startsWith("/")) return "/app";
  if (trimmed.startsWith("//")) return "/app";
  if (trimmed.includes("://")) return "/app";
  if (trimmed.includes("\\")) return "/app";
  if (/[\x00-\x1f]/.test(trimmed)) return "/app";

  return trimmed;
}

/**
 * Builds an auth page link, appending ?redirect= only when redirectTo differs from the default "/app".
 */
export function buildAuthLink(path: string, redirectTo: string): string {
  return redirectTo !== "/app" ? `${path}?redirect=${encodeURIComponent(redirectTo)}` : path;
}

export function buildAuthCallbackUrl(
  siteUrl: string,
  redirectTo: string,
  mode?: "login" | "signup"
): string {
  const url = new URL("/auth/callback", normalizeOrigin(siteUrl));
  url.searchParams.set("redirect", sanitizeRedirectPath(redirectTo));
  if (mode) {
    url.searchParams.set("mode", mode);
  }
  return url.toString();
}

/**
 * Builds the OAuth callback URL with age validation params embedded in the URL
 * (not in queryParams, which Google strips during OAuth round-trip).
 *
 * Includes mode=signup so error pages can route back to signup instead of login.
 */
export function buildOAuthSignupCallbackUrl(
  siteUrl: string,
  redirectTo: string,
  ageBracket: string,
  isMinor: boolean,
  ageToken: string
): string {
  const url = new URL(buildAuthCallbackUrl(siteUrl, redirectTo, "signup"));
  url.searchParams.set("age_bracket", ageBracket);
  url.searchParams.set("is_minor", String(isMinor));
  url.searchParams.set("age_token", ageToken);
  return url.toString();
}

/**
 * Builds the email signup confirmation callback URL.
 * Marks with mode=signup so error recovery routes back to signup, not login.
 */
export function buildEmailSignupCallbackUrl(siteUrl: string, redirectTo: string): string {
  return buildAuthCallbackUrl(siteUrl, redirectTo, "signup");
}

/**
 * Builds the absolute `redirectTo` URL for Supabase `resetPasswordForEmail`.
 *
 * Uses `/auth/confirm` + `token_hash` (see Supabase PKCE password docs). Email links must be
 * customized to append `&token_hash={{ .TokenHash }}&type=recovery` to this URL — otherwise
 * mobile users who open the link in a different browser than the one that requested the reset
 * hit PKCE exchange without a stored code_verifier and see "both auth code and code verifier...".
 */
export function buildRecoveryRedirectTo(
  siteUrl: string,
  innerRedirect: string
): string {
  const safeRedirect = sanitizeRedirectPath(innerRedirect);
  const resetPage =
    safeRedirect !== "/app"
      ? `/auth/reset-password?redirect=${encodeURIComponent(safeRedirect)}`
      : "/auth/reset-password";
  const base = normalizeOrigin(siteUrl);
  const nextEncoded = encodeURIComponent(resetPage);
  return `${base}/auth/confirm?next=${nextEncoded}`;
}

/**
 * Validates `next` after recovery email — only `/auth/reset-password` with an optional safe `redirect` query.
 */
export function sanitizeRecoveryNextParam(raw: string | null): string {
  if (!raw?.trim()) {
    return "/auth/reset-password";
  }

  let decoded = raw.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return "/auth/reset-password";
  }

  decoded = decoded.trim();
  if (!decoded.startsWith("/")) {
    return "/auth/reset-password";
  }

  const qIndex = decoded.indexOf("?");
  const pathname = qIndex === -1 ? decoded : decoded.slice(0, qIndex);
  const search = qIndex === -1 ? "" : decoded.slice(qIndex);

  if (pathname !== "/auth/reset-password") {
    return "/auth/reset-password";
  }

  if (!search) {
    return "/auth/reset-password";
  }

  const qs = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(qs);
  const redirect = params.get("redirect");
  if (!redirect) {
    return "/auth/reset-password";
  }

  const safe = sanitizeRedirectPath(redirect);
  return `/auth/reset-password?redirect=${encodeURIComponent(safe)}`;
}
