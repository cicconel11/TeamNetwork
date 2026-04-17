export type MentorshipReasonCode =
  | "shared_topics"
  | "shared_industry"
  | "shared_role_family"
  | "graduation_gap_fit"
  | "shared_city"
  | "shared_company";

export interface MentorshipWeights {
  shared_topics: number;
  shared_industry: number;
  shared_role_family: number;
  graduation_gap_fit: number;
  shared_city: number;
  shared_company: number;
}

export const DEFAULT_MENTORSHIP_WEIGHTS: MentorshipWeights = {
  shared_topics: 24,
  shared_industry: 22,
  shared_role_family: 16,
  graduation_gap_fit: 12,
  shared_city: 4,
  shared_company: 6,
};

export const MENTORSHIP_REASON_ORDER: MentorshipReasonCode[] = [
  "shared_topics",
  "shared_industry",
  "shared_role_family",
  "graduation_gap_fit",
  "shared_company",
  "shared_city",
];

/**
 * Merge org-level override from `organizations.settings.mentorship_weights` onto defaults.
 * Non-numeric / negative values are ignored (fall back to default).
 */
export function resolveMentorshipWeights(
  orgSettings: unknown
): MentorshipWeights {
  if (!orgSettings || typeof orgSettings !== "object") {
    return { ...DEFAULT_MENTORSHIP_WEIGHTS };
  }

  const settings = orgSettings as Record<string, unknown>;
  const override = settings.mentorship_weights;
  if (!override || typeof override !== "object") {
    return { ...DEFAULT_MENTORSHIP_WEIGHTS };
  }

  const overrideRecord = override as Record<string, unknown>;
  const merged: MentorshipWeights = { ...DEFAULT_MENTORSHIP_WEIGHTS };

  for (const key of Object.keys(merged) as Array<keyof MentorshipWeights>) {
    const candidate = overrideRecord[key];
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) {
      merged[key] = candidate;
    }
  }

  return merged;
}

/**
 * Rarity multiplier (copied shape from falkordb/scoring.ts).
 * Uncommon signals outweigh common ones at same overlap.
 */
export function rarityMultiplier(count: number | undefined, totalPeople: number): number {
  if (!count || totalPeople <= 0) return 1;
  const share = count / totalPeople;
  if (share <= 0.1) return 1.5;
  if (share <= 0.25) return 1.25;
  if (share <= 0.5) return 1.0;
  return 0.75;
}

/**
 * Graduation-gap fit. gapYears = menteeYear - mentorYear (positive = mentor ahead).
 * Mentor should be 3-10 years ahead for best fit.
 * Negative gap (mentor younger than mentee) -> 0. Gap <3 penalized; >15 penalized.
 * Returns multiplier 0..1 applied to graduation_gap_fit weight.
 */
export function graduationGapMultiplier(gapYears: number | null): number {
  if (gapYears === null || !Number.isFinite(gapYears)) return 0;
  // Mentor must graduate before mentee (positive gap).
  if (gapYears <= 0) return 0;
  if (gapYears < 3) return 0.33;
  if (gapYears <= 10) return 1.0;
  if (gapYears <= 15) return 0.5;
  return 0;
}
