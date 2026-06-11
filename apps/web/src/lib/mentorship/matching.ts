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
import { industryFromFieldOfStudy } from "@/lib/mentorship/goals-extraction";

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

  // career_trajectory — the mentor has WALKED THE PATH the mentee wants. Credits
  // aspiration coverage that comes from the mentor's PAST/other roles, beyond
  // what the current-snapshot signals (shared_industry / shared_role_family)
  // already credit. Subtracting the current-role hits keeps this strictly
  // additive — no double-counting with those signals.
  {
    const currentIndustryHits = new Set(industryOverlap);
    const currentRoleFamilyHits = new Set(roleFamilyOverlap);
    const trajIndustryHits = intersectNormalized(
      mentor.trajectoryIndustries,
      mentee.preferredIndustries
    ).filter((v) => !currentIndustryHits.has(v));
    const trajRoleFamilyHits = intersectNormalized(
      mentor.trajectoryRoleFamilies,
      mentee.preferredRoleFamilies
    ).filter((v) => !currentRoleFamilyHits.has(v));
    const trajHits = [...trajIndustryHits, ...trajRoleFamilyHits];

    if (trajHits.length > 0) {
      let bestMultiplier = 1;
      for (const v of trajIndustryHits) {
        const m = rarityMultiplier(rarity?.industryCounts.get(v), total);
        if (m > bestMultiplier) bestMultiplier = m;
      }
      for (const v of trajRoleFamilyHits) {
        const m = rarityMultiplier(rarity?.roleFamilyCounts.get(v), total);
        if (m > bestMultiplier) bestMultiplier = m;
      }
      // Reward covering more of the mentee's stated goals (0.6..1.0).
      const goalCount =
        mentee.preferredIndustries.length + mentee.preferredRoleFamilies.length;
      const coverage =
        goalCount > 0 ? 0.6 + 0.4 * Math.min(trajHits.length / goalCount, 1) : 0.6;
      signals.push({
        code: "career_trajectory",
        weight: Math.round(weights.career_trajectory * bestMultiplier * coverage),
        value: trajHits.join(","),
      });
    }
  }

  // shared_school — same school (full weight) or, failing that, same field of
  // study (half weight). No same-school signal existed before enrichment.
  {
    const schoolOverlap = intersectNormalized(mentor.schoolsNorm, mentee.schoolsNorm);
    if (schoolOverlap.length > 0) {
      signals.push({
        code: "shared_school",
        weight: weights.shared_school,
        value: schoolOverlap.join(","),
      });
    } else {
      const fieldOverlap = intersectNormalized(
        mentor.fieldsOfStudyNorm,
        mentee.fieldsOfStudyNorm
      );
      if (fieldOverlap.length > 0) {
        signals.push({
          code: "shared_school",
          weight: Math.round(weights.shared_school * 0.5),
          value: fieldOverlap.join(","),
        });
      }
    }
  }

  // aspirational_skill — mentor has skills the mentee wants to develop. Overlap
  // scaling mirrors shared_topics (1 -> 0.8, 2 -> 1.0, 3+ -> 1.2). No rarity
  // bucket: the LinkedIn skill vocabulary is too noisy to weight by frequency.
  // Values already credited by shared_topics are excluded so the same word
  // ("operations") can't score — and display — twice.
  {
    const creditedTopics = new Set(topicOverlap);
    const skillOverlap = intersectNormalized(
      mentor.skillsNorm,
      mentee.desiredSkillsNorm,
    ).filter((value) => !creditedTopics.has(value));
    if (skillOverlap.length > 0) {
      const overlapFactor = Math.min(skillOverlap.length, 3);
      signals.push({
        code: "aspirational_skill",
        weight: Math.round(weights.aspirational_skill * (0.6 + 0.2 * overlapFactor)),
        value: skillOverlap.join(","),
      });
    }
  }

  // past_employer_overlap — worked at the same companies over time. The shared
  // CURRENT employer is excluded so this never double-counts shared_company.
  {
    const sharedCurrentCompany =
      mentor.currentCompanyNorm &&
      mentee.currentCompanyNorm &&
      mentor.currentCompanyNorm === mentee.currentCompanyNorm
        ? mentor.currentCompanyNorm
        : null;
    const employerOverlap = intersectNormalized(
      mentor.allCompaniesNorm,
      mentee.companiesNorm
    ).filter((c) => c !== sharedCurrentCompany);
    if (employerOverlap.length > 0) {
      let bestMultiplier = 1;
      for (const c of employerOverlap) {
        const m = rarityMultiplier(rarity?.companyCounts.get(c), total);
        if (m > bestMultiplier) bestMultiplier = m;
      }
      signals.push({
        code: "past_employer_overlap",
        weight: Math.round(weights.past_employer_overlap * bestMultiplier),
        value: employerOverlap.join(","),
      });
    }
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

/**
 * Re-order ranked matches to spread recommendations across mentors instead of
 * sending every student to the same top-scoring mentor. A utilization penalty
 * demotes mentors who are already near capacity; an optional in-round
 * assignment count (for batch run-rounds) compounds it so one mentor isn't
 * picked repeatedly within a single round.
 *
 * Purely an ordering layer — the displayed `score` is preserved (admins still
 * see true match quality); only the order changes. Keeps `rankMentorsForMentee`
 * itself pure so the AI tool and existing tests are unaffected.
 */
export function loadBalanceMatches(
  matches: readonly MentorMatch[],
  mentorInputs: readonly MentorInput[],
  options: { penaltyStrength?: number; inRoundAssigned?: ReadonlyMap<string, number> } = {}
): MentorMatch[] {
  const penaltyStrength = options.penaltyStrength ?? 0.4;
  const capacity = new Map<string, { current: number; max: number }>();
  for (const m of mentorInputs) {
    capacity.set(m.userId, {
      current: m.currentMenteeCount ?? 0,
      max: Math.max(1, m.maxMentees ?? 3),
    });
  }

  const utilizationOf = (mentorUserId: string): number => {
    const cap = capacity.get(mentorUserId);
    if (!cap) return 0;
    const assigned = options.inRoundAssigned?.get(mentorUserId) ?? 0;
    const util = (cap.current + assigned) / cap.max;
    return util < 0 ? 0 : util > 1 ? 1 : util;
  };

  return [...matches]
    .map((match) => {
      const utilization = utilizationOf(match.mentorUserId);
      return {
        match,
        utilization,
        adjusted: match.score * (1 - penaltyStrength * utilization),
      };
    })
    .sort((a, b) => {
      if (b.adjusted !== a.adjusted) return b.adjusted - a.adjusted;
      // Prefer the less-loaded mentor when adjusted scores tie.
      if (a.utilization !== b.utilization) return a.utilization - b.utilization;
      return a.match.mentorUserId.localeCompare(b.match.mentorUserId);
    })
    .map((entry) => entry.match);
}

/**
 * Like {@link rankMentorsForMentee}, but guarantees the caller sees at least
 * `minResults` candidates even for a data-thin mentee who produces no real
 * overlap signals. When the scored ranking falls short, capacity-eligible
 * mentors are appended with a single synthetic `fallback_general` signal,
 * ranked deterministically by graduation-gap fit → likely-industry-of-major →
 * most open capacity → user id. The admin pairing surface uses this so the
 * board is never empty; auto-proposal keeps using the strict scored ranking.
 *
 * Fallback is skipped when the mentee specified required mentor attributes —
 * honoring those hard requirements matters more than padding the list.
 */
export function rankMentorsForMenteeWithFallback(
  menteeInput: MenteeInput,
  mentorInputs: readonly MentorInput[],
  options: ScoreOptions & { minResults?: number } = {}
): { matches: MentorMatch[]; usedFallback: boolean } {
  const minResults = options.minResults ?? 5;
  const base = rankMentorsForMentee(menteeInput, mentorInputs, options);
  if (base.length >= minResults) return { matches: base, usedFallback: false };

  const mentee = extractMenteeSignals(menteeInput);
  if (mentee.requiredMentorAttributes.length > 0) {
    return { matches: base, usedFallback: false };
  }

  const excluded = new Set(options.excludeMentorUserIds ?? []);
  const alreadyMatched = new Set(base.map((m) => m.mentorUserId));

  // The student's likely target industries: from any stated preferences plus
  // those implied by their field(s) of study.
  const targetIndustries = new Set<string>(mentee.preferredIndustries);
  for (const field of mentee.fieldsOfStudyNorm) {
    const ind = industryFromFieldOfStudy(field);
    if (ind) targetIndustries.add(ind);
  }

  const ranked = mentorInputs
    .map(extractMentorSignals)
    .filter(
      (m) =>
        m.orgId === mentee.orgId &&
        m.userId !== mentee.userId &&
        m.isActive &&
        m.acceptingNew &&
        m.currentMenteeCount < m.maxMentees &&
        !excluded.has(m.userId) &&
        !alreadyMatched.has(m.userId)
    )
    .map((m) => {
      const gapMult =
        mentee.graduationYear != null && m.graduationYear != null
          ? graduationGapMultiplier(mentee.graduationYear - m.graduationYear)
          : 0;
      const industryHit =
        m.industries.some((i) => targetIndustries.has(i)) ||
        m.trajectoryIndustries.some((i) => targetIndustries.has(i))
          ? 1
          : 0;
      const openCapacity = m.maxMentees - m.currentMenteeCount;
      return { userId: m.userId, gapMult, industryHit, openCapacity };
    })
    .sort((a, b) => {
      if (b.gapMult !== a.gapMult) return b.gapMult - a.gapMult;
      if (b.industryHit !== a.industryHit) return b.industryHit - a.industryHit;
      if (b.openCapacity !== a.openCapacity) return b.openCapacity - a.openCapacity;
      return a.userId.localeCompare(b.userId);
    });

  const needed = minResults - base.length;
  const appended: MentorMatch[] = ranked.slice(0, needed).map((m) => ({
    mentorUserId: m.userId,
    score: 1,
    signals: [{ code: "fallback_general", weight: 1, value: "limited mentee data" }],
  }));

  return { matches: [...base, ...appended], usedFallback: appended.length > 0 };
}

export interface MenteeMatch {
  menteeUserId: string;
  score: number;
  signals: MentorshipSignal[];
}

/**
 * Bi-directional counterpart to {@link rankMentorsForMentee}: rank candidate
 * mentees for ONE mentor. Reuses {@link scoreMentorForMentee} unchanged — the
 * signal math is symmetric, so a mentor↔mentee pair scores identically in both
 * directions given the same rarity stats.
 *
 * Capacity is a single up-front gate on the mentor (a full mentor matches no
 * one), not a per-mentee filter. Required attributes remain mentee-side and are
 * honored per-mentee inside the scorer. Rarity stays mentor-population-based in
 * both directions; pass `options.rarityStats` for cross-direction comparability.
 */
export function rankMenteesForMentor(
  mentorInput: MentorInput,
  menteeInputs: readonly MenteeInput[],
  options: Omit<ScoreOptions, "excludeMentorUserIds"> & {
    excludeMenteeUserIds?: Iterable<string>;
  } = {}
): MenteeMatch[] {
  const config = resolveMentorshipConfig(options.orgSettings);
  const weights = options.weights ?? config.weights;
  const customDefs = config.customAttributeDefs;

  const mentor = extractMentorSignals(mentorInput);
  if (
    !mentor.isActive ||
    !mentor.acceptingNew ||
    mentor.currentMenteeCount >= mentor.maxMentees
  ) {
    return [];
  }

  const excluded = new Set(options.excludeMenteeUserIds ?? []);
  const rarity = options.rarityStats ?? buildRarityStats([mentor]);

  const matches: MenteeMatch[] = [];
  for (const menteeInput of menteeInputs) {
    if (excluded.has(menteeInput.userId)) continue;
    const mentee = extractMenteeSignals(menteeInput);
    if (mentee.orgId !== mentor.orgId) continue;
    const scored = scoreMentorForMentee(mentee, mentor, weights, rarity, customDefs);
    if (scored) {
      matches.push({
        menteeUserId: mentee.userId,
        score: scored.score,
        signals: scored.signals,
      });
    }
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.menteeUserId.localeCompare(b.menteeUserId);
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
