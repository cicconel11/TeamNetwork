"use client";

import { VALID_FEATURES, type ValidFeature } from "@/lib/schemas/analytics";

const FEATURE_SET = new Set<string>(VALID_FEATURES);

/**
 * Extract a normalized feature name from a pathname.
 * E.g. "/org-slug/members/123" → "members"
 */
export function extractFeature(pathname: string): ValidFeature {
  const segments = pathname.replace(/^\//, "").split("/");

  // Org-scoped routes: /<orgSlug>/<feature>/...
  if (segments.length >= 2) {
    const candidate = segments[1];
    // /settings/navigation is its own feature — check sub-route before
    // falling through to the generic "settings" match.
    if (candidate === "settings" && segments.length >= 3 && FEATURE_SET.has(segments[2])) {
      return segments[2] as ValidFeature;
    }
    if (FEATURE_SET.has(candidate)) return candidate as ValidFeature;
  }

  // Check if this is the org dashboard (exactly /<orgSlug>)
  if (segments.length === 1 && segments[0] !== "" && !["app", "auth", "settings", "privacy", "terms", "api"].includes(segments[0])) {
    return "dashboard";
  }

  // Settings pages
  if (segments.some((s) => s === "settings")) return "settings";

  return "other";
}
