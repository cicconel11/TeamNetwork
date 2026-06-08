/**
 * Minor-aware analytics tracking policy.
 *
 * Mirrors the web policy (`apps/web/src/lib/analytics/policy.ts`) so the two
 * clients gate third-party analytics for minors identically. Apple Guideline
 * 5.1.4 and children's-privacy statutes require that we not run full-fidelity
 * third-party analytics on minors:
 *   - under_13  -> "none"            (no PostHog/Sentry at all)
 *   - 13_17     -> "page_view_only"  (screen views only, no behavioral events)
 *   - 18_plus   -> "full"
 *
 * Age bracket is read from the Supabase user_metadata written at signup
 * (`apps/mobile/app/(auth)/signup.tsx`).
 */

export type AgeBracket = "under_13" | "13_17" | "18_plus";
export type TrackingLevel = "none" | "page_view_only" | "full";

export function normalizeAgeBracket(value: unknown): AgeBracket | null {
  return value === "under_13" || value === "13_17" || value === "18_plus"
    ? value
    : null;
}

export function getAgeBracketFromUserMetadata(
  metadata: Record<string, unknown> | null | undefined,
): AgeBracket | null {
  return normalizeAgeBracket(metadata?.age_bracket);
}

/**
 * Resolve the tracking level for a given age bracket. An unknown bracket is
 * treated conservatively as a minor (page_view_only) rather than full — a user
 * with no recorded age must not get full third-party analytics by default.
 */
export function resolveTrackingLevel(
  ageBracket: AgeBracket | null | undefined,
): TrackingLevel {
  if (ageBracket === "under_13") return "none";
  if (ageBracket === "13_17") return "page_view_only";
  if (ageBracket === "18_plus") return "full";
  return "page_view_only";
}

/**
 * Whether a behavioral (custom) event may be sent at the given tracking level.
 * Screen views are handled separately (allowed at page_view_only); this guards
 * `track()` / `setUserProperties()` style behavioral signals.
 */
export function canTrackBehavioralEvent(level: TrackingLevel): boolean {
  return level === "full";
}
