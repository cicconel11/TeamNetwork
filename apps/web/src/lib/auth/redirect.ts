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
 * Builds the absolute redirect URL for Supabase resetPasswordForEmail.
 * The flow is: email link → /auth/callback?redirect=<encoded reset page> → reset page
 */
export function buildRecoveryRedirectTo(
  siteUrl: string,
  innerRedirect: string
): string {
  const safeRedirect = sanitizeRedirectPath(innerRedirect);
  const resetPage = `/auth/reset-password?redirect=${encodeURIComponent(safeRedirect)}`;
  const base = siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
  return `${base}/auth/callback?redirect=${encodeURIComponent(resetPage)}`;
}
