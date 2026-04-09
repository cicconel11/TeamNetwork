import { createHash } from "crypto";
import { normalizeAiMessage } from "@/lib/ai/message-normalization";

// ---------------------------------------------------------------------------
// Surface constants and TTLs
// ---------------------------------------------------------------------------

export const CACHE_SURFACES = ["general", "members", "analytics", "events"] as const;
export type CacheSurface = (typeof CACHE_SURFACES)[number];

/**
 * Manual cache-contract version.
 *
 * Bump this whenever a change would alter the safety or meaning of cached
 * responses, such as prompt-contract updates, cache-key logic changes, or
 * freshness policy changes that should invalidate existing rows.
 */
export const CACHE_CONTRACT_VERSION = 3 as const;
export const CACHE_VERSION = CACHE_CONTRACT_VERSION;
export const CACHE_KEY_SALT = `ai-semantic-cache:v${CACHE_CONTRACT_VERSION}`;

/** Surface-specific TTLs (hours) — shorter for data-heavy surfaces */
export const CACHE_TTL_HOURS: Record<CacheSurface, number> = {
  general: 12,
  members: 4,
  analytics: 2,
  events: 4,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EligibilityInput {
  message: string;
  threadId?: string;
  surface: CacheSurface;
  bypassCache?: boolean;
}

export type CacheIneligibleReason =
  | "unsupported_surface"
  | "has_thread_context"
  | "contains_temporal_marker"
  | "contains_personalization"
  | "requires_live_org_context"
  | "implies_write_or_tool"
  | "bypass_requested"
  | "message_too_short"
  | "message_too_long";

export type CacheEligibility =
  | { eligible: true; reason: "cacheable" }
  | { eligible: false; reason: CacheIneligibleReason };

export interface SemanticCacheKeyParts {
  normalizedPrompt: string;
  promptHash: string;
  permissionScopeKey: string;
  cacheVersion: number;
  cacheSalt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MIN_MESSAGE_LENGTH = 5;
const MAX_MESSAGE_LENGTH = 2000;

const TEMPORAL_MARKERS = [
  "today",
  "latest",
  "current",
  "current date",
  "current time",
  "upcoming",
  "recent",
  "this week",
  "this month",
  "right now",
  "new",
  "recently",
  "last",
  "yesterday",
  "tomorrow",
  "now",
  "what date is it",
  "what time is it",
  "what day is it",
];

const PERSONALIZATION_MARKERS = ["my", "mine", "i am", "i'm", "me", "myself"];

const LIVE_CONTEXT_MARKERS = [
  "member",
  "members",
  "alumni",
  "parent",
  "parents",
  "event",
  "events",
  "announcement",
  "announcements",
  "donation",
  "donations",
  "stat",
  "stats",
  "count",
  "counts",
  "total",
  "totals",
  "roster",
  "attendance",
  "knowledge",
  "faq",
  "policy",
  "policies",
  "discussion",
  "discussions",
  "forum",
  "thread",
  "threads",
  "job",
  "jobs",
  "posting",
  "postings",
  "hiring",
  "career",
  "careers",
  "position",
  "positions",
];

const WRITE_OR_TOOL_MARKERS = [
  "create",
  "delete",
  "remove",
  "update",
  "edit",
  "change",
  "add",
  "send",
  "post",
  "write",
  "compose",
  "draft",
  "reply",
  "respond",
  "comment",
  "submit",
  "pay",
  "donate",
  "schedule",
  "cancel",
];

function containsWordBoundary(text: string, markers: string[]): boolean {
  return markers.some((marker) => {
    // Escape special regex characters in the marker
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "i");
    return pattern.test(text);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalize a user prompt for cache key generation.
 * Does NOT apply stemming, lemmatization, stopword removal, or synonym collapsing.
 */
export function normalizePrompt(message: string): string {
  return normalizeAiMessage(message);
}

/** SHA-256 hex hash of a normalized prompt string, salted by cache contract. */
export function hashPrompt(
  normalizedPrompt: string,
  salt: string = CACHE_KEY_SALT
): string {
  return createHash("sha256")
    .update(`${salt}:${normalizedPrompt}`, "utf8")
    .digest("hex");
}

/**
 * Derives a permission scope key for cache isolation by role.
 *
 * v1: uses `sha256(orgId + ":" + role)` for admin-only scoping.
 *
 * Future multi-role support: include sorted roles array and feature flags
 * in the hashed payload (e.g., `orgId + ":" + sortedRoles.join(",") + ":" + sortedFlags.join(",")`).
 */
export function buildPermissionScopeKey(orgId: string, role: string): string {
  return createHash("sha256")
    .update(`${orgId}:${role}`, "utf8")
    .digest("hex");
}

/**
 * Build the full cache key contract from the request + auth context.
 * Both lookup and write paths should consume this helper so versioning and
 * key derivation stay synchronized.
 */
export function buildSemanticCacheKeyParts(params: {
  message: string;
  orgId: string;
  role: string;
}): SemanticCacheKeyParts {
  const normalizedPrompt = normalizePrompt(params.message);

  return {
    normalizedPrompt,
    promptHash: hashPrompt(normalizedPrompt),
    permissionScopeKey: buildPermissionScopeKey(params.orgId, params.role),
    cacheVersion: CACHE_VERSION,
    cacheSalt: CACHE_KEY_SALT,
  };
}

/** Determine whether a request is eligible for semantic caching. */
export function checkCacheEligibility(
  params: EligibilityInput
): CacheEligibility {
  const { message, threadId, bypassCache, surface } = params;

  if (bypassCache) {
    return { eligible: false, reason: "bypass_requested" };
  }

  if (surface !== "general") {
    return { eligible: false, reason: "unsupported_surface" };
  }

  // v1 only caches standalone first-turn prompts
  if (threadId !== undefined) {
    return { eligible: false, reason: "has_thread_context" };
  }

  if (message.length < MIN_MESSAGE_LENGTH) {
    return { eligible: false, reason: "message_too_short" };
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return { eligible: false, reason: "message_too_long" };
  }

  const normalized = normalizePrompt(message);

  if (containsWordBoundary(normalized, TEMPORAL_MARKERS)) {
    return { eligible: false, reason: "contains_temporal_marker" };
  }

  if (containsWordBoundary(normalized, PERSONALIZATION_MARKERS)) {
    return { eligible: false, reason: "contains_personalization" };
  }

  if (containsWordBoundary(normalized, LIVE_CONTEXT_MARKERS)) {
    return { eligible: false, reason: "requires_live_org_context" };
  }

  if (containsWordBoundary(normalized, WRITE_OR_TOOL_MARKERS)) {
    return { eligible: false, reason: "implies_write_or_tool" };
  }

  return { eligible: true, reason: "cacheable" };
}

/** Returns an ISO timestamp string for `expires_at` based on surface-specific TTL. */
export function getCacheExpiresAt(surface: CacheSurface): string {
  const ttlMs = CACHE_TTL_HOURS[surface] * 60 * 60 * 1000;
  return new Date(Date.now() + ttlMs).toISOString();
}
