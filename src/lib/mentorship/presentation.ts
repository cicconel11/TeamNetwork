export interface MentorshipPairSummary {
  id: string;
  mentor_user_id: string;
  mentee_user_id: string;
  status?: string;
}

export function getMentorshipSectionOrder(params: {
  hasPairs: boolean;
  isAdmin: boolean;
}): "pairs-first" | "directory-first" {
  return params.hasPairs && !params.isAdmin ? "pairs-first" : "directory-first";
}

export function getVisibleMentorshipPairs<T extends MentorshipPairSummary>(
  pairs: T[],
  deletedPairIds: readonly string[]
): T[] {
  if (deletedPairIds.length === 0) return pairs;
  const deleted = new Set(deletedPairIds);
  return pairs.filter((pair) => !deleted.has(pair.id));
}

export function isUserInMentorshipPair(
  pair: MentorshipPairSummary,
  currentUserId?: string
): boolean {
  if (!currentUserId) return false;
  return (
    pair.mentee_user_id === currentUserId || pair.mentor_user_id === currentUserId
  );
}

export function canLogMentorshipActivity(params: {
  role: string | null | undefined;
  status: string | null | undefined;
}): boolean {
  return (
    params.status === "active" &&
    (params.role === "admin" || params.role === "active_member")
  );
}

export function getMentorshipStatusTranslationKey(status: string): string {
  switch (status) {
    case "completed":
      return "statusCompleted";
    case "paused":
      return "statusPaused";
    default:
      return "statusActive";
  }
}

const REASON_LABELS: Record<string, string> = {
  shared_sport: "Shared sport",
  shared_position: "Shared position",
  shared_topics: "Shared topics",
  shared_industry: "Shared industry",
  shared_role_family: "Shared role family",
  graduation_gap_fit: "Graduation gap fit",
  shared_city: "Shared city",
  shared_company: "Shared company",
};

/**
 * Human-readable label for a mentorship reason code.
 * Returns the code itself (title-cased) for unknown codes so new codes
 * added to `matching-weights.ts` never silently disappear.
 */
export function formatMentorshipReasonLabel(code: string): string {
  return REASON_LABELS[code] ?? code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Human-readable explanation sentence for a single match signal.
 * Custom attributes (codes like "custom:sport") use the value field
 * which contains "Label:matchedValue" (e.g., "Sport:Lacrosse").
 */
export function formatMatchExplanation(
  signal: { code: string; value?: string | number }
): string {
  const { code, value } = signal;

  // Custom attribute — value is "Label:matchedValue(s)"
  if (code.startsWith("custom:") && typeof value === "string") {
    const colonIdx = value.indexOf(":");
    if (colonIdx > 0) {
      const label = value.slice(0, colonIdx);
      const matched = value.slice(colonIdx + 1);
      const values = matched.split(",").filter(Boolean);
      if (values.length === 1) return `Shared ${label.toLowerCase()}: ${values[0]}`;
      return `Shared ${label.toLowerCase()}: ${values.join(", ")}`;
    }
    return `Shared: ${value}`;
  }

  // Built-in signals
  switch (code) {
    case "shared_topics": {
      const topics = typeof value === "string" ? value.split(",").filter(Boolean) : [];
      if (topics.length === 1) return `Shared topic: ${topics[0]}`;
      if (topics.length > 1) return `Shared topics: ${topics.join(", ")}`;
      return "Shared topics";
    }
    case "shared_industry":
      return typeof value === "string" ? `Same industry: ${value}` : "Same industry";
    case "shared_role_family":
      return typeof value === "string" ? `Same career path: ${value}` : "Same career path";
    case "graduation_gap_fit":
      return typeof value === "number" ? `${value} years ahead in career` : "Good career gap";
    case "shared_city":
      return typeof value === "string" ? `Same city: ${value}` : "Same city";
    case "shared_company":
      return typeof value === "string" ? `Same company: ${value}` : "Same company";
    default:
      return formatMentorshipReasonLabel(code);
  }
}

export type MatchQualityTier = "strong" | "good" | "possible";

/**
 * Map a raw score to a qualitative tier.
 * Thresholds are percentage of theoretical max score.
 */
export function getMatchQualityTier(
  score: number,
  theoreticalMax: number
): MatchQualityTier | null {
  if (theoreticalMax <= 0) return null;
  const pct = score / theoreticalMax;
  if (pct >= 0.75) return "strong";
  if (pct >= 0.50) return "good";
  if (pct >= 0.25) return "possible";
  return null; // below threshold — hide from results
}
