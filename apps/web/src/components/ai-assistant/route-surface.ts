import type { AiSurface } from "@/lib/schemas/ai-assistant";

// Each prefix includes the leading slash to match the regex capture group.
// Unmapped routes (jobs, discussions, forms, chat, announcements, media,
// competition, records, workouts, feed) intentionally fall through to
// "general" — no dedicated surface exists for them yet.
const SURFACE_PREFIXES: ReadonlyArray<readonly [string, AiSurface]> = [
  ["/members", "members"],
  ["/alumni", "members"],
  ["/parents", "members"],
  ["/mentorship", "members"],
  ["/events", "events"],
  ["/calendar", "events"],
  ["/philanthropy", "analytics"],
  ["/donations", "analytics"],
  ["/expenses", "analytics"],
  ["/analytics", "analytics"],
];

/**
 * Derive AI surface from pathname. Extracts the second path segment
 * (the feature segment after /{orgSlug}/) and maps it to a surface.
 */
export function routeToSurface(pathname: string): AiSurface {
  // Capture group 1: the feature segment including its leading slash.
  // Supports both "/{orgSlug}/feature" and "/enterprise/{slug}/feature".
  const match =
    pathname.match(/^\/enterprise\/[^/]+(\/[^/?#]*)/) ??
    pathname.match(/^\/[^/]+(\/[^/?#]*)/);
  const segment = match?.[1] ?? "";
  for (const [prefix, surface] of SURFACE_PREFIXES) {
    if (segment === prefix || segment.startsWith(prefix + "/")) {
      return surface;
    }
  }
  return "general";
}
