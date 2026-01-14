import { NextResponse, type NextRequest } from "next/server";

type RequestLike = Request | NextRequest;

type BucketState = {
  count: number;
  resetAt: number;
};

type ConsumeResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
  reason: string;
  headers: Record<string, string>;
};

type RateLimitConfig = {
  limitPerIp?: number;
  limitPerUser?: number;
  windowMs?: number;
  pathOverride?: string;
  userId?: string | null;
  feature?: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __rateLimitStore: Map<string, BucketState> | undefined;
}

const store = globalThis.__rateLimitStore ?? new Map<string, BucketState>();
globalThis.__rateLimitStore = store;
const DEFAULT_WINDOW_MS = 60_000; // 1 minute windows keep retry feedback tight
const DEFAULT_IP_LIMIT = 60; // 60 req/min/IP
const DEFAULT_USER_LIMIT = 45; // 45 req/min/user
const CLEANUP_THRESHOLD = 5_000;
const STORE_MAX_SIZE = 10_000;
const CLEANUP_SCAN_LIMIT = 1_000;

function cleanupExpired(now: number) {
  if (store.size < CLEANUP_THRESHOLD) return;
  let scanned = 0;
  for (const [key, state] of store) {
    if (state.resetAt <= now) {
      store.delete(key);
    }
    scanned += 1;
    if (scanned >= CLEANUP_SCAN_LIMIT) break;
  }
}

function enforceStoreLimit() {
  if (store.size <= STORE_MAX_SIZE) return;
  const overflow = store.size - STORE_MAX_SIZE;
  const targetEvictions = Math.max(overflow, Math.ceil(STORE_MAX_SIZE * 0.1));
  let evicted = 0;
  for (const key of store.keys()) {
    store.delete(key);
    evicted += 1;
    if (evicted >= targetEvictions) break;
  }
}

function deriveClientIp(request: RequestLike): string | null {
  const headers = request.headers;

  // Cloudflare (most reliable when using CF)
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  // Vercel/standard proxy
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  // True-Client-IP (some CDNs)
  const trueClientIp = headers.get("true-client-ip");
  if (trueClientIp) return trueClientIp.trim();

  // x-real-ip (nginx)
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  // NextRequest.ip fallback
  const maybeNextRequest = request as Request & { ip?: string | null };
  if (typeof maybeNextRequest.ip === "string" && maybeNextRequest.ip) {
    return maybeNextRequest.ip;
  }

  return null;
}

function consume(key: string, limit: number, windowMs: number, now: number): ConsumeResult {
  cleanupExpired(now);
  const current = store.get(key);

  if (!current || current.resetAt <= now) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    enforceStoreLimit();
    return {
      ok: true,
      limit,
      remaining: Math.max(limit - 1, 0),
      resetAt,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  // Refresh LRU position
  store.delete(key);
  store.set(key, current);

  if (current.count >= limit) {
    return {
      ok: false,
      limit,
      remaining: 0,
      resetAt: current.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  const nextCount = current.count + 1;
  store.set(key, { ...current, count: nextCount });
  enforceStoreLimit();

  return {
    ok: true,
    limit,
    remaining: Math.max(limit - nextCount, 0),
    resetAt: current.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

export function checkRateLimit(request: RequestLike, config: RateLimitConfig = {}): RateLimitResult {
  const now = Date.now();
  const path = config.pathOverride || new URL(request.url).pathname;
  const windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;
  const maxPerIp = config.limitPerIp ?? DEFAULT_IP_LIMIT;
  const maxPerUser = config.limitPerUser ?? DEFAULT_USER_LIMIT;
  const ip = deriveClientIp(request) || "unknown";
  const userId = config.userId?.trim() || null;
  const feature = config.feature || "this endpoint";

  const results: Array<ConsumeResult & { scope: "ip" | "user" }> = [];

  if (maxPerIp > 0) {
    results.push({
      scope: "ip",
      ...consume(`ip:${path}:${ip}`, maxPerIp, windowMs, now),
    });
  }

  if (userId && maxPerUser > 0) {
    results.push({
      scope: "user",
      ...consume(`user:${path}:${userId}`, maxPerUser, windowMs, now),
    });
  }

  const failure = results.find((result) => !result.ok);
  const limit = Math.min(...results.map((r) => r.limit));
  const remaining = Math.min(...results.map((r) => r.remaining));
  const resetAt = Math.min(...results.map((r) => r.resetAt));
  const retryAfterSeconds = Math.max(...results.map((r) => r.retryAfterSeconds));

  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(Math.max(remaining, 0)),
    "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
  };

  if (failure) {
    headers["Retry-After"] = String(failure.retryAfterSeconds);
    return {
      ok: false,
      limit,
      remaining: 0,
      resetAt: failure.resetAt,
      retryAfterSeconds: failure.retryAfterSeconds,
      reason: `Too many requests to ${feature}. Please retry after ${failure.retryAfterSeconds}s.`,
      headers,
    };
  }

  return {
    ok: true,
    limit,
    remaining,
    resetAt,
    retryAfterSeconds,
    reason: "",
    headers,
  };
}

export function buildRateLimitResponse(result: RateLimitResult) {
  return NextResponse.json(
    {
      error: "Too many requests",
      message: result.reason,
      retryAfterSeconds: result.retryAfterSeconds,
    },
    {
      status: 429,
      headers: result.headers,
    },
  );
}
