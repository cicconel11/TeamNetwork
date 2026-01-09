/**
 * Webhook-specific rate limiting.
 *
 * While Stripe controls webhook traffic, we add rate limiting as defense-in-depth
 * against compromised Stripe accounts or misconfiguration. This uses a more lenient
 * limit than regular API endpoints.
 */

type BucketState = {
  count: number;
  resetAt: number;
};

export type WebhookRateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
  headers: Record<string, string>;
};

type WebhookRateLimitOptions = {
  limit?: number;
  windowMs?: number;
};

// Default: 100 requests per minute per IP (lenient for webhooks)
const DEFAULT_LIMIT = 100;
const DEFAULT_WINDOW_MS = 60_000;
const CLEANUP_THRESHOLD = 5_000;

// In-memory store (same pattern as rate-limit.ts)
const store = new Map<string, BucketState>();

function cleanupExpired(now: number) {
  if (store.size < CLEANUP_THRESHOLD) return;
  for (const [key, state] of store) {
    if (state.resetAt <= now) {
      store.delete(key);
    }
  }
}

/**
 * Reset the rate limit store. Used for testing.
 */
export function resetWebhookRateLimitStore(): void {
  store.clear();
}

/**
 * Check rate limit for webhook requests by IP.
 */
export function checkWebhookRateLimit(
  ip: string,
  options: WebhookRateLimitOptions = {}
): WebhookRateLimitResult {
  const now = Date.now();
  cleanupExpired(now);
  const limit = options.limit ?? DEFAULT_LIMIT;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const key = `webhook:${ip}`;

  const current = store.get(key);

  // No existing bucket or bucket expired
  if (!current || current.resetAt <= now) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });

    return {
      ok: true,
      limit,
      remaining: limit - 1,
      resetAt,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
      headers: buildHeaders(limit, limit - 1, resetAt),
    };
  }

  // Check if over limit
  if (current.count >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));

    return {
      ok: false,
      limit,
      remaining: 0,
      resetAt: current.resetAt,
      retryAfterSeconds,
      headers: {
        ...buildHeaders(limit, 0, current.resetAt),
        "Retry-After": String(retryAfterSeconds),
      },
    };
  }

  // Increment counter
  const nextCount = current.count + 1;
  store.set(key, { ...current, count: nextCount });
  const remaining = Math.max(0, limit - nextCount);

  return {
    ok: true,
    limit,
    remaining,
    resetAt: current.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    headers: buildHeaders(limit, remaining, current.resetAt),
  };
}

function buildHeaders(limit: number, remaining: number, resetAt: number): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
  };
}

/**
 * Extract client IP from request headers.
 */
export function getWebhookClientIp(req: Request): string | null {
  const forwardedFor =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for") ||
    req.headers.get("x-vercel-forwarded-for") ||
    req.headers.get("true-client-ip") ||
    req.headers.get("x-real-ip");

  const forwardedCandidate = firstIpFromHeader(forwardedFor);
  if (forwardedCandidate) return forwardedCandidate;

  const forwardedHeader = req.headers.get("forwarded");
  const forwardedParsed = firstIpFromForwardedHeader(forwardedHeader);
  if (forwardedParsed) return forwardedParsed;

  return null;
}

function firstIpFromHeader(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const first = headerValue.split(",")[0]?.trim();
  if (!first) return null;
  return normalizeIp(first);
}

function firstIpFromForwardedHeader(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const match = headerValue.match(/(?:^|;|,)\s*for=([^;,\s]+)/i);
  if (!match) return null;
  const raw = match[1] ?? "";
  return normalizeIp(raw);
}

function normalizeIp(candidate: string): string | null {
  const trimmed = candidate.trim().replace(/^"|"$/g, "");
  if (!trimmed) return null;

  // Forwarded header may include obfuscated identifiers: for=_hidden
  if (trimmed.startsWith("_")) return null;

  // IPv6 can appear as "[2001:db8::1]:1234"
  if (trimmed.startsWith("[") && trimmed.includes("]")) {
    const inner = trimmed.slice(1, trimmed.indexOf("]"));
    return inner.trim() || null;
  }

  // IPv4 may include a port: "203.0.113.1:1234"
  const ipv4WithPort = trimmed.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (ipv4WithPort) return ipv4WithPort[1] ?? null;

  // Otherwise return as-is (covers plain IPv6 without brackets)
  return trimmed;
}
