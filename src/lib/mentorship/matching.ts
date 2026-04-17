import {
  DEFAULT_MENTORSHIP_WEIGHTS,
  graduationGapMultiplier,
  MENTORSHIP_REASON_ORDER,
  type MentorshipReasonCode,
  type MentorshipWeights,
  rarityMultiplier,
  resolveMentorshipWeights,
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

  for (const m of mentors) {
    if (m.industry) industry.set(m.industry, (industry.get(m.industry) ?? 0) + 1);
    if (m.roleFamily) roleFamily.set(m.roleFamily, (roleFamily.get(m.roleFamily) ?? 0) + 1);
    if (m.currentCompanyNorm) {
      company.set(m.currentCompanyNorm, (company.get(m.currentCompanyNorm) ?? 0) + 1);
    }
    for (const t of m.topics) topic.set(t, (topic.get(t) ?? 0) + 1);
  }

  return {
    totalMentors: mentors.length,
    industryCounts: industry,
    roleFamilyCounts: roleFamily,
    companyCounts: company,
    topicCounts: topic,
  };
}

function orderSignals(signals: MentorshipSignal[]): MentorshipSignal[] {
  return [...signals].sort(
    (a, b) =>
      MENTORSHIP_REASON_ORDER.indexOf(a.code) - MENTORSHIP_REASON_ORDER.indexOf(b.code)
  );
}

export function scoreMentorForMentee(
  mentee: MenteeSignals,
  mentor: MentorSignals,
  weights: MentorshipWeights,
  rarity: RarityStats | null
): MentorMatch | null {
  // Hard filter: same tenant
  if (mentor.orgId !== mentee.orgId) return null;

  // Hard filter: mentor self-match
  if (mentor.userId === mentee.userId) return null;

  // Hard filter: capacity / accepting
  if (!mentor.isActive) return null;
  if (!mentor.acceptingNew) return null;
  if (mentor.currentMenteeCount >= mentor.maxMentees) return null;

  const signals: MentorshipSignal[] = [];
  const total = rarity?.totalMentors ?? 0;

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
  if (
    mentor.industry &&
    mentee.preferredIndustries.includes(mentor.industry)
  ) {
    const mult = rarityMultiplier(rarity?.industryCounts.get(mentor.industry), total);
    signals.push({
      code: "shared_industry",
      weight: Math.round(weights.shared_industry * mult),
      value: mentor.industry,
    });
  }

  // shared_role_family
  if (
    mentor.roleFamily &&
    mentee.preferredRoleFamilies.includes(mentor.roleFamily)
  ) {
    const mult = rarityMultiplier(rarity?.roleFamilyCounts.get(mentor.roleFamily), total);
    signals.push({
      code: "shared_role_family",
      weight: Math.round(weights.shared_role_family * mult),
      value: mentor.roleFamily,
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
  if (
    mentor.currentCityNorm &&
    mentee.currentCityNorm &&
    mentor.currentCityNorm === mentee.currentCityNorm
  ) {
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
  const weights =
    options.weights ?? resolveMentorshipWeights(options.orgSettings) ?? DEFAULT_MENTORSHIP_WEIGHTS;

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
    const match = scoreMentorForMentee(mentee, mentor, weights, rarity);
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
export type { MentorshipReasonCode, MentorshipWeights } from "@/lib/mentorship/matching-weights";
