import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Surface constants and TTLs
// ---------------------------------------------------------------------------

export const CACHE_SURFACES = ["general", "members", "analytics", "events"] as const;
export type CacheSurface = (typeof CACHE_SURFACES)[number];

export const CACHE_VERSION = 1 as const;

/** Surface-specific TTLs (hours) — shorter for data-heavy surfaces */
export const CACHE_TTL_HOURS: Record<CacheSurface, number> = {
  general: 24,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MIN_MESSAGE_LENGTH = 5;
const MAX_MESSAGE_LENGTH = 2000;

const TEMPORAL_MARKERS = [
  "today",
  "latest",
  "current",
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
  return message
    .normalize("NFC")
    .toLowerCase()
    // Strip zero-width characters
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    // Collapse multiple whitespace to single space
    .replace(/\s+/g, " ")
    .trim();
}

/** SHA-256 hex hash of a normalized prompt string. */
export function hashPrompt(normalizedPrompt: string): string {
  return createHash("sha256").update(normalizedPrompt, "utf8").digest("hex");
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
