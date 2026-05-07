export type { AgeBracket, OrgType } from "@/lib/analytics/types";
import type { AgeBracket, OrgType } from "@/lib/analytics/types";
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

export function normalizeOrgType(value: unknown): OrgType | null {
  return value === "educational" || value === "athletic" || value === "general"
    ? value
    : null;
}

export function resolveTrackingLevel(
  consented: boolean,
  ageBracket: AgeBracket | null | undefined,
  orgType: OrgType | null | undefined,
): TrackingLevel {
  if (!consented) return "none";
  if (ageBracket === "under_13") return "none";
  if (ageBracket === "13_17") return "page_view_only";
  if (orgType === "educational") return "page_view_only";
  return "full";
}

export function canTrackBehavioralEvent(
  trackingLevel: TrackingLevel,
  eventName: string,
): boolean {
  if (trackingLevel === "none") return false;
  if (trackingLevel === "page_view_only") {
    return eventName === "app_open" || eventName === "route_view";
  }
  return true;
}
