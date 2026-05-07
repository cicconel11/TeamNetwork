/* ------------------------------------------------------------------ */
/*  Reason codes                                                      */
/* ------------------------------------------------------------------ */

export type BuiltInReasonCode =
  | "shared_topics"
  | "shared_industry"
  | "shared_role_family"
  | "shared_sport"
  | "shared_position"
  | "graduation_gap_fit"
  | "shared_city"
  | "shared_company";

export type CustomReasonCode = `custom:${string}`;

export type MentorshipReasonCode = BuiltInReasonCode | CustomReasonCode;

/* ------------------------------------------------------------------ */
/*  Weights                                                           */
/* ------------------------------------------------------------------ */

export interface BuiltInMentorshipWeights {
  shared_topics: number;
  shared_industry: number;
  shared_role_family: number;
  shared_sport: number;
  shared_position: number;
  graduation_gap_fit: number;
  shared_city: number;
  shared_company: number;
}

export type MentorshipWeights = BuiltInMentorshipWeights & {
  [key: `custom:${string}`]: number;
};

export const DEFAULT_MENTORSHIP_WEIGHTS: BuiltInMentorshipWeights = {
  shared_topics: 24,
  shared_industry: 22,
  shared_role_family: 16,
  shared_sport: 28,
  shared_position: 18,
  graduation_gap_fit: 12,
  shared_city: 4,
  shared_company: 6,
};

export const MENTORSHIP_REASON_ORDER: BuiltInReasonCode[] = [
  "shared_sport",
  "shared_position",
  "shared_topics",
  "shared_industry",
  "shared_role_family",
  "graduation_gap_fit",
  "shared_company",
  "shared_city",
];

/* ------------------------------------------------------------------ */
/*  Custom attribute definitions                                      */
/* ------------------------------------------------------------------ */

export interface CustomAttributeDef {
  readonly key: string;
  readonly label: string;
  readonly type: "select" | "multiselect" | "text";
  readonly options?: ReadonlyArray<{ label: string; value: string }>;
  readonly weight: number;
  readonly required?: boolean;
  readonly mentorVisible?: boolean;
  readonly menteeVisible?: boolean;
  readonly sortOrder?: number;
}

/* ------------------------------------------------------------------ */
/*  Resolved config                                                   */
/* ------------------------------------------------------------------ */

export interface ResolvedMentorshipConfig {
  weights: MentorshipWeights;
  customAttributeDefs: readonly CustomAttributeDef[];
}

/**
 * Merge org-level override from `organizations.settings.mentorship_weights` onto defaults,
 * including custom attribute weights from `mentorship_custom_attribute_defs`.
 */
export function resolveMentorshipConfig(
  orgSettings: unknown
): ResolvedMentorshipConfig {
  const builtIn: BuiltInMentorshipWeights = { ...DEFAULT_MENTORSHIP_WEIGHTS };

  if (!orgSettings || typeof orgSettings !== "object") {
    return { weights: builtIn as MentorshipWeights, customAttributeDefs: [] };
  }

  const settings = orgSettings as Record<string, unknown>;

  // Merge built-in weight overrides
  const override = settings.mentorship_weights;
  if (override && typeof override === "object") {
    const overrideRecord = override as Record<string, unknown>;
    for (const key of Object.keys(builtIn) as Array<keyof BuiltInMentorshipWeights>) {
      const candidate = overrideRecord[key];
      if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 && candidate <= 100) {
        builtIn[key] = candidate;
      }
    }
  }

  // Parse custom attribute defs
  const rawDefs = settings.mentorship_custom_attribute_defs;
  const customDefs: CustomAttributeDef[] = [];
  const weights = builtIn as MentorshipWeights;

  if (Array.isArray(rawDefs)) {
    for (const def of rawDefs) {
      if (!def || typeof def !== "object") continue;
      const d = def as Record<string, unknown>;
      const key = d.key;
      const label = d.label;
      const type = d.type;
      if (typeof key !== "string" || typeof label !== "string") continue;
      if (type !== "select" && type !== "multiselect" && type !== "text") continue;
      if (!/^[a-z][a-z0-9_]{0,30}$/.test(key)) continue;

      const weight = typeof d.weight === "number" && Number.isFinite(d.weight) && d.weight >= 0 && d.weight <= 100
        ? d.weight
        : 0;

      const parsedDef: CustomAttributeDef = {
        key,
        label,
        type: type as "select" | "multiselect" | "text",
        options: Array.isArray(d.options)
          ? (d.options as Array<Record<string, unknown>>)
              .filter((o) => typeof o?.label === "string" && typeof o?.value === "string")
              .map((o) => ({ label: o.label as string, value: o.value as string }))
          : undefined,
        weight,
        required: typeof d.required === "boolean" ? d.required : undefined,
        mentorVisible: typeof d.mentorVisible === "boolean" ? d.mentorVisible : undefined,
        menteeVisible: typeof d.menteeVisible === "boolean" ? d.menteeVisible : undefined,
        sortOrder: typeof d.sortOrder === "number" ? d.sortOrder : undefined,
      };

      customDefs.push(parsedDef);

      // Also merge custom weight override if provided in mentorship_weights
      const customWeightKey = `custom:${key}` as const;
      const customWeightOverride = override && typeof override === "object"
        ? (override as Record<string, unknown>)[customWeightKey]
        : undefined;
      weights[customWeightKey] = typeof customWeightOverride === "number" && Number.isFinite(customWeightOverride) && customWeightOverride >= 0
        ? customWeightOverride
        : weight;
    }
  }

  return { weights, customAttributeDefs: customDefs };
}

/**
 * Legacy compatibility wrapper — returns only the weights portion.
 */
export function resolveMentorshipWeights(
  orgSettings: unknown
): MentorshipWeights {
  return resolveMentorshipConfig(orgSettings).weights;
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
  if (gapYears <= 0) return 0;
  if (gapYears < 3) return 0.33;
  if (gapYears <= 10) return 1.0;
  if (gapYears <= 15) return 0.5;
  return 0;
}
