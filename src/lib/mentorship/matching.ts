import {
  graduationGapMultiplier,
  MENTORSHIP_REASON_ORDER,
  type BuiltInReasonCode,
  type MentorshipReasonCode,
  type MentorshipWeights,
  type CustomAttributeDef,
  rarityMultiplier,
  resolveMentorshipConfig,
} from "@/lib/mentorship/matching-weights";
import {
  extractMenteeSignals,
  extractMentorSignals,
  intersectNormalized,
  type MenteeInput,
  type MenteeSignals,
  type MentorInput,
  type MentorSignals,
} from "@/lib/mentorship/matching-signals";

export interface MentorshipSignal {
  code: MentorshipReasonCode;
  weight: number;
  value?: string | number;
}

export interface MentorMatch {
  mentorUserId: string;
  score: number;
  signals: MentorshipSignal[];
  excluded?: false;
}

export interface RarityStats {
  totalMentors: number;
  industryCounts: ReadonlyMap<string, number>;
  roleFamilyCounts: ReadonlyMap<string, number>;
  companyCounts: ReadonlyMap<string, number>;
  topicCounts: ReadonlyMap<string, number>;
  sportCounts: ReadonlyMap<string, number>;
  positionCounts: ReadonlyMap<string, number>;
  /** Custom attribute key → value → count across all mentors */
  customAttributeCounts: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

export interface ScoreOptions {
  weights?: MentorshipWeights;
  orgSettings?: unknown;
  rarityStats?: RarityStats;
  /** user_ids of mentors already paired (any non-terminal status) with this mentee */
  excludeMentorUserIds?: Iterable<string>;
}

export function buildRarityStats(mentors: readonly MentorSignals[]): RarityStats {
  const industry = new Map<string, number>();
  const roleFamily = new Map<string, number>();
  const company = new Map<string, number>();
  const topic = new Map<string, number>();
  const sport = new Map<string, number>();
  const position = new Map<string, number>();
  const customAttr = new Map<string, Map<string, number>>();

  for (const m of mentors) {
    for (const value of m.industries ?? []) {
      industry.set(value, (industry.get(value) ?? 0) + 1);
    }
    for (const value of m.roleFamilies ?? []) {
      roleFamily.set(value, (roleFamily.get(value) ?? 0) + 1);
    }
    if (m.currentCompanyNorm) {
      company.set(m.currentCompanyNorm, (company.get(m.currentCompanyNorm) ?? 0) + 1);
    }
    for (const t of m.topics ?? []) topic.set(t, (topic.get(t) ?? 0) + 1);
    for (const s of m.sports ?? []) sport.set(s, (sport.get(s) ?? 0) + 1);
    for (const p of m.positions ?? []) position.set(p, (position.get(p) ?? 0) + 1);
    for (const [key, values] of Object.entries(m.customAttributes ?? {})) {
      let keyMap = customAttr.get(key);
      if (!keyMap) {
        keyMap = new Map();
        customAttr.set(key, keyMap);
      }
      for (const v of values) {
        keyMap.set(v, (keyMap.get(v) ?? 0) + 1);
      }
    }
  }

  return {
    totalMentors: mentors.length,
    industryCounts: industry,
    roleFamilyCounts: roleFamily,
    companyCounts: company,
    topicCounts: topic,
    sportCounts: sport,
    positionCounts: position,
    customAttributeCounts: customAttr,
  };
}

function signalSortKey(code: MentorshipReasonCode): number {
  const builtInIdx = MENTORSHIP_REASON_ORDER.indexOf(code as BuiltInReasonCode);
  // Built-in codes sort by their defined order; custom codes sort after all built-in
  return builtInIdx >= 0 ? builtInIdx : MENTORSHIP_REASON_ORDER.length;
}

function orderSignals(signals: MentorshipSignal[]): MentorshipSignal[] {
  return [...signals].sort((a, b) => {
    const aKey = signalSortKey(a.code);
    const bKey = signalSortKey(b.code);
    if (aKey !== bKey) return aKey - bKey;
    // Custom codes: sort alphabetically
    return a.code.localeCompare(b.code);
  });
}

export function scoreMentorForMentee(
  mentee: MenteeSignals,
  mentor: MentorSignals,
  weights: MentorshipWeights,
  rarity: RarityStats | null,
  customAttributeDefs?: readonly CustomAttributeDef[]
): MentorMatch | null {
  // Hard filter: same tenant
  if (mentor.orgId !== mentee.orgId) return null;

  // Hard filter: mentor self-match
  if (mentor.userId === mentee.userId) return null;

  // Hard filter: capacity / accepting
  if (!mentor.isActive) return null;
  if (!mentor.acceptingNew) return null;
  if (mentor.currentMenteeCount >= mentor.maxMentees) return null;

  const requiredAttributes = new Set(mentee.requiredMentorAttributes);
  const sportOverlap = intersectNormalized(mentor.sports, mentee.preferredSports);
  const positionOverlap = intersectNormalized(mentor.positions, mentee.preferredPositions);
  const industryOverlap = intersectNormalized(mentor.industries, mentee.preferredIndustries);
  const roleFamilyOverlap = intersectNormalized(mentor.roleFamilies, mentee.preferredRoleFamilies);
  const industryMatch = industryOverlap.length > 0;
  const roleFamilyMatch = roleFamilyOverlap.length > 0;
  const cityMatch = Boolean(
    mentor.currentCityNorm &&
    mentee.currentCityNorm &&
    mentor.currentCityNorm === mentee.currentCityNorm
  );

  if (requiredAttributes.has("same_sport") && mentee.preferredSports.length > 0 && sportOverlap.length === 0) {
    return null;
  }
  if (
    requiredAttributes.has("same_position") &&
    mentee.preferredPositions.length > 0 &&
    positionOverlap.length === 0
  ) {
    return null;
  }
  if (
    requiredAttributes.has("same_industry") &&
    mentee.preferredIndustries.length > 0 &&
    !industryMatch
  ) {
    return null;
  }
  if (
    requiredAttributes.has("same_role_family") &&
    mentee.preferredRoleFamilies.length > 0 &&
    !roleFamilyMatch
  ) {
    return null;
  }
  if (requiredAttributes.has("local") && mentee.currentCityNorm && !cityMatch) {
    return null;
  }

  const signals: MentorshipSignal[] = [];
  const total = rarity?.totalMentors ?? 0;

  // shared_sport
  if (sportOverlap.length > 0) {
    let bestMultiplier = 1;
    for (const sport of sportOverlap) {
      const mult = rarityMultiplier(rarity?.sportCounts.get(sport), total);
      if (mult > bestMultiplier) bestMultiplier = mult;
    }
    signals.push({
      code: "shared_sport",
      weight: Math.round(weights.shared_sport * bestMultiplier),
      value: sportOverlap.join(","),
    });
  }

  // shared_position
  if (positionOverlap.length > 0) {
    let bestMultiplier = 1;
    for (const position of positionOverlap) {
      const mult = rarityMultiplier(rarity?.positionCounts.get(position), total);
      if (mult > bestMultiplier) bestMultiplier = mult;
    }
    signals.push({
      code: "shared_position",
      weight: Math.round(weights.shared_position * bestMultiplier),
      value: positionOverlap.join(","),
    });
  }

  // shared_topics — mentor topics ∩ mentee focusAreas
  const topicOverlap = intersectNormalized(mentor.topics, mentee.focusAreas);
  if (topicOverlap.length > 0) {
    // Use rarest overlapping topic for rarity multiplier; weight scales with overlap count (capped at 3)
    let bestMultiplier = 1;
    for (const t of topicOverlap) {
      const m = rarityMultiplier(rarity?.topicCounts.get(t), total);
      if (m > bestMultiplier) bestMultiplier = m;
    }
    const overlapFactor = Math.min(topicOverlap.length, 3) / 1; // 1..3
    const weight = Math.round(
      weights.shared_topics * bestMultiplier * (0.6 + 0.2 * overlapFactor)
      // 1 overlap -> 0.8; 2 -> 1.0; 3 -> 1.2
    );
    signals.push({
      code: "shared_topics",
      weight,
      value: topicOverlap.join(","),
    });
  }

  // shared_industry
  if (industryOverlap.length > 0) {
    let bestMultiplier = 1;
    for (const value of industryOverlap) {
      const mult = rarityMultiplier(rarity?.industryCounts.get(value), total);
      if (mult > bestMultiplier) bestMultiplier = mult;
    }
    signals.push({
      code: "shared_industry",
      weight: Math.round(weights.shared_industry * bestMultiplier),
      value: industryOverlap.join(","),
    });
  }

  // shared_role_family
  if (roleFamilyOverlap.length > 0) {
    let bestMultiplier = 1;
    for (const value of roleFamilyOverlap) {
      const mult = rarityMultiplier(rarity?.roleFamilyCounts.get(value), total);
      if (mult > bestMultiplier) bestMultiplier = mult;
    }
    signals.push({
      code: "shared_role_family",
      weight: Math.round(weights.shared_role_family * bestMultiplier),
      value: roleFamilyOverlap.join(","),
    });
  }

  // graduation_gap_fit
  if (mentee.graduationYear !== null && mentor.graduationYear !== null) {
    const gap = mentee.graduationYear - mentor.graduationYear; // mentor usually earlier (positive)
    const mult = graduationGapMultiplier(gap);
    if (mult > 0) {
      signals.push({
        code: "graduation_gap_fit",
        weight: Math.round(weights.graduation_gap_fit * mult),
        value: gap,
      });
    }
  }

  // shared_city
  if (cityMatch) {
    signals.push({
      code: "shared_city",
      weight: weights.shared_city,
      value: mentor.currentCity ?? mentee.currentCity ?? undefined,
    });
  }

  // shared_company
  if (
    mentor.currentCompanyNorm &&
    mentee.currentCompanyNorm &&
    mentor.currentCompanyNorm === mentee.currentCompanyNorm
  ) {
    const mult = rarityMultiplier(rarity?.companyCounts.get(mentor.currentCompanyNorm), total);
    signals.push({
      code: "shared_company",
      weight: Math.round(weights.shared_company * mult),
      value: mentor.currentCompany ?? undefined,
    });
  }

  // Custom attributes — iterate org-defined defs (not stored keys) to avoid
  // scoring orphaned attributes from deleted defs
  if (customAttributeDefs) {
    for (const def of customAttributeDefs) {
      if (def.type === "text") continue; // display-only
      const customWeightKey = `custom:${def.key}` as const;
      const baseWeight = weights[customWeightKey] ?? def.weight ?? 0;
      if (baseWeight <= 0) continue;

      const mentorValues = mentor.customAttributes[def.key];
      const menteeValues = mentee.customAttributes[def.key];
      if (!mentorValues?.length || !menteeValues?.length) continue;

      if (def.type === "select") {
        // Exact match on first value
        const match = mentorValues[0] && menteeValues.includes(mentorValues[0]);
        if (match) {
          const attrCounts = rarity?.customAttributeCounts.get(def.key);
          const mult = rarityMultiplier(attrCounts?.get(mentorValues[0]), total);
          signals.push({
            code: customWeightKey,
            weight: Math.round(baseWeight * mult),
            value: `${def.label}:${mentorValues[0]}`,
          });
        }
      } else if (def.type === "multiselect") {
        // Set intersection with overlap scaling (same as shared_topics)
        const overlap = intersectNormalized(mentorValues, menteeValues);
        if (overlap.length > 0) {
          const attrCounts = rarity?.customAttributeCounts.get(def.key);
          let bestMult = 1;
          for (const v of overlap) {
            const m = rarityMultiplier(attrCounts?.get(v), total);
            if (m > bestMult) bestMult = m;
          }
          const overlapFactor = Math.min(overlap.length, 3);
          const weight = Math.round(
            baseWeight * bestMult * (0.6 + 0.2 * overlapFactor)
          );
          signals.push({
            code: customWeightKey,
            weight,
            value: `${def.label}:${overlap.join(",")}`,
          });
        }
      }
    }
  }

  if (signals.length === 0) return null;

  const score = signals.reduce((sum, s) => sum + s.weight, 0);

  return {
    mentorUserId: mentor.userId,
    score,
    signals: orderSignals(signals),
  };
}

/**
 * Rank mentors for a mentee. Deterministic: score desc, then mentorUserId asc.
 * Hard filters applied before scoring. Candidates with zero qualifying signals dropped.
 */
export function rankMentorsForMentee(
  menteeInput: MenteeInput,
  mentorInputs: readonly MentorInput[],
  options: ScoreOptions = {}
): MentorMatch[] {
  const config = resolveMentorshipConfig(options.orgSettings);
  const weights = options.weights ?? config.weights;
  const customDefs = config.customAttributeDefs;

  const mentee = extractMenteeSignals(menteeInput);
  // Org-isolation: drop any mentor not in mentee's org BEFORE rarity stats so
  // cross-tenant counts do not influence ranking.
  const mentors = mentorInputs
    .map(extractMentorSignals)
    .filter((m) => m.orgId === mentee.orgId);
  const rarity = options.rarityStats ?? buildRarityStats(mentors);
  const excluded = new Set(options.excludeMentorUserIds ?? []);

  const matches: MentorMatch[] = [];
  for (const mentor of mentors) {
    if (excluded.has(mentor.userId)) continue;
    const match = scoreMentorForMentee(mentee, mentor, weights, rarity, customDefs);
    if (match) matches.push(match);
  }

  // Stable deterministic sort: score desc, then mentorUserId asc
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.mentorUserId.localeCompare(b.mentorUserId);
  });

  return matches;
}

export type {
  MenteeInput,
  MentorInput,
  MentorSignals,
  MenteeSignals,
} from "@/lib/mentorship/matching-signals";
export type {
  MentorshipReasonCode,
  BuiltInReasonCode,
  CustomReasonCode,
  MentorshipWeights,
  BuiltInMentorshipWeights,
  CustomAttributeDef,
  ResolvedMentorshipConfig,
} from "@/lib/mentorship/matching-weights";
