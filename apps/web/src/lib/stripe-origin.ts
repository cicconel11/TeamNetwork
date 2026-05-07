/**
 * Safe origin resolver for Stripe redirect URLs.
 *
 * Trims whitespace/newlines from NEXT_PUBLIC_SITE_URL, validates it is
 * a well-formed HTTP(S) URL, and falls back to the server-controlled
 * req.url origin so checkout never breaks due to a misconfigured env var.
 */
export function getStripeOrigin(reqUrl: string): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (envUrl) {
    // Try as-is (handles full URLs like https://example.com)
    const direct = safeHttpOrigin(envUrl);
    if (direct) return direct;

    // Only try https:// prefix for bare hostnames — skip if the value
    // already contains a scheme indicator (://, //) or a colon (port or
    // non-HTTP scheme like mailto:, javascript:, localhost:3000).
    if (!envUrl.includes("://") && !envUrl.startsWith("//") && !envUrl.includes(":")) {
      const withScheme = safeHttpOrigin(`https://${envUrl}`);
      if (withScheme) return withScheme;
    }
  }
  return new URL(reqUrl).origin;
}

function safeHttpOrigin(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    if (origin !== "null" && /^https?:\/\//.test(origin)) return origin;
  } catch { /* invalid URL */ }
  return null;
}
