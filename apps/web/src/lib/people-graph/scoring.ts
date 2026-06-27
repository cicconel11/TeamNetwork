import {
  areAdjacentRoleFamilies,
  normalizeCareerText,
} from "@/lib/people-graph/career-signals";
import type { ProjectedPerson } from "@/lib/people-graph/people";
import type { GraphFallbackReason } from "@/lib/people-graph/telemetry";

export type ConnectionReasonCode =
  | "shared_company"
  | "shared_industry"
  | "shared_role_family"
  | "shared_city"
  | "graduation_proximity";

export interface ConnectionReason {
  code: ConnectionReasonCode;
  weight: number;
  value?: string | number;
}

export interface SuggestedConnectionDebugInfo {
  qualificationCodes: CandidateQualificationCode[];
  rarityMultipliers: Partial<Record<"company" | "industry" | "role_family", number>>;
  exposurePenalty: number;
}

// The role a suggested person carries. Mirrors ProjectedPerson.personType and
// maps directly onto the direct-chat profile type for the Message action.
export type ConnectionPersonType = "member" | "alumni" | "parent";

export interface SuggestedConnection {
  person_type: ConnectionPersonType;
  person_id: string;
  name: string;
  // True only when the person is linked to an in-app user (user_id present), i.e.
  // they can actually be messaged. Unclaimed rows (user_id NULL) surface as
  // suggestions but show no Message button — clicking it would 409 profile_unlinked.
  messageable: boolean;
  score: number;
  preview: {
    role?: string;
    major?: string;
    current_company?: string;
    industry?: string;
    graduation_year?: number;
    current_city?: string;
  };
  reasons: ConnectionReason[];
  debug?: SuggestedConnectionDebugInfo;
}

export interface DisplayReadyConnectionReason extends ConnectionReason {
  /** Short caption, e.g. "Shared industry" — never includes the value. */
  label: string;
  /** The concrete shared value, e.g. "Finance" or "2026". null when there isn't one. */
  detail: string | null;
  /**
   * Professional-strength signals (industry / company / role family) — the chips
   * the card accents. City / graduation proximity are softer "context" reasons.
   */
  strong: boolean;
}

// Match strength is a presentation bucket derived from the engine score, so the
// card can show "Strong match" / "Good match" / "Suggested" without re-deriving
// scoring rules in the view. Thresholds are intentionally coarse.
export type ConnectionMatchStrength = "strong" | "good" | "suggested";

export const STRONG_MATCH_MIN_SCORE = 28;
export const GOOD_MATCH_MIN_SCORE = 12;

export interface DisplayReadyConnectionPerson {
  person_type: ConnectionPersonType;
  person_id: string;
  name: string;
  subtitle: string | null;
  messageable: boolean;
}

export interface DisplayReadySuggestedConnection extends DisplayReadyConnectionPerson {
  score: number;
  strength: ConnectionMatchStrength;
  preview: SuggestedConnection["preview"];
  reasons: DisplayReadyConnectionReason[];
}

export type SuggestConnectionsState =
  | "resolved"
  | "ambiguous"
  | "not_found"
  | "no_suggestions";

export interface SuggestConnectionsFreshness {
  state: "fresh" | "stale" | "degraded" | "unknown";
  as_of: string;
  lag_seconds?: number;
  reason?: string;
}

export interface SuggestConnectionsResult {
  mode: "sql_fallback";
  fallback_reason: GraphFallbackReason | null;
  freshness: SuggestConnectionsFreshness;
  state: SuggestConnectionsState;
  source_person: DisplayReadyConnectionPerson | null;
  suggestions: DisplayReadySuggestedConnection[];
  disambiguation_options?: DisplayReadyConnectionPerson[];
}

export const DEFAULT_SUGGESTIONS_LIMIT = 10;
export const MAX_SUGGESTIONS_LIMIT = 25;
export const GRAPH_STALE_AFTER_SECONDS = 120;

export const CONNECTION_REASON_WEIGHTS: Record<ConnectionReasonCode, number> = {
  shared_company: 20,
  shared_industry: 24,
  shared_role_family: 20,
  shared_city: 4,
  graduation_proximity: 3,
};

const CONNECTION_REASON_ORDER: ConnectionReasonCode[] = [
  "shared_industry",
  "shared_company",
  "shared_role_family",
  "shared_city",
  "graduation_proximity",
];

export type CandidateQualificationCode =
  | ConnectionReasonCode
  | "adjacent_role_family";

export interface CandidateSignalMatch {
  sharedCompany: string | null;
  sharedIndustry: string | null;
  sharedRoleFamily: string | null;
  adjacentRoleFamily: boolean;
  sharedCity: string | null;
  graduationProximity: number | null;
}

export interface ConnectionRarityStats {
  totalPeople: number;
  companyCounts: ReadonlyMap<string, number>;
  industryCounts: ReadonlyMap<string, number>;
  roleFamilyCounts: ReadonlyMap<string, number>;
}

export interface ConnectionScoringContext {
  genericCompanyValues?: Iterable<string | null | undefined>;
  rarityStats?: ConnectionRarityStats;
  exposurePenaltyByPersonId?: ReadonlyMap<string, number>;
}

function chooseSharedTextValue(a: string | null | undefined, b: string | null | undefined) {
  const normalizedA = normalizeCareerText(a);
  const normalizedB = normalizeCareerText(b);
  if (!normalizedA || normalizedA !== normalizedB) {
    return null;
  }

  return a?.trim() || b?.trim() || null;
}

function buildGenericCompanySet(values: Iterable<string | null | undefined>) {
  const normalized = new Set<string>();

  for (const value of values) {
    const normalizedValue = normalizeCareerText(value);
    if (normalizedValue) {
      normalized.add(normalizedValue);
    }
  }

  return normalized;
}

function buildGenericCompanySetFromContext(context?: ConnectionScoringContext) {
  return buildGenericCompanySet([...(context?.genericCompanyValues ?? [])]);
}

function chooseSharedCompanyValue(
  a: string | null | undefined,
  b: string | null | undefined,
  genericCompanyValues: Set<string>
) {
  const sharedValue = chooseSharedTextValue(a, b);
  if (!sharedValue) {
    return null;
  }

  const normalizedSharedValue = normalizeCareerText(sharedValue);
  if (!normalizedSharedValue || genericCompanyValues.has(normalizedSharedValue)) {
    return null;
  }

  return sharedValue;
}

function hasGraduationProximity(source: ProjectedPerson, candidate: ProjectedPerson) {
  if (
    typeof source.graduationYear !== "number" ||
    typeof candidate.graduationYear !== "number"
  ) {
    return null;
  }

  return Math.abs(source.graduationYear - candidate.graduationYear) <= 3
    ? candidate.graduationYear
    : null;
}

function buildPreview(person: ProjectedPerson): SuggestedConnection["preview"] {
  return {
    ...(person.role ? { role: person.role } : {}),
    ...(person.major ? { major: person.major } : {}),
    ...(person.currentCompany ? { current_company: person.currentCompany } : {}),
    ...(person.industry ? { industry: person.industry } : {}),
    ...(typeof person.graduationYear === "number" ? { graduation_year: person.graduationYear } : {}),
    ...(person.currentCity ? { current_city: person.currentCity } : {}),
  };
}

export function formatConnectionReasonLabel(code: ConnectionReasonCode): string {
  switch (code) {
    case "shared_company":
      return "Shared company";
    case "shared_industry":
      return "Shared industry";
    case "shared_role_family":
      return "Shared role";
    case "shared_city":
      return "Same city";
    case "graduation_proximity":
      return "Same grad year";
  }
}

// Industry / company / role-family are the signals that justify a real intro;
// city and graduation proximity are softer context. The card accents the strong ones.
const STRONG_REASON_CODES: ReadonlySet<ConnectionReasonCode> = new Set([
  "shared_industry",
  "shared_company",
  "shared_role_family",
]);

export function isStrongReason(code: ConnectionReasonCode): boolean {
  return STRONG_REASON_CODES.has(code);
}

// The concrete shared value shown beside the label, e.g. "Finance" or "2026".
// graduation_proximity carries the candidate's grad year as a number.
function formatConnectionReasonDetail(reason: ConnectionReason): string | null {
  if (reason.value === undefined || reason.value === null) {
    return null;
  }
  if (typeof reason.value === "number") {
    return String(reason.value);
  }
  const trimmed = reason.value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Role/visibility enums that must never leak into a human-facing subtitle. The
// `role` field can carry a team role ("Captain") OR, for some seeded rows, a raw
// membership enum — we drop the latter so cards never read "active_member".
const ROLE_ENUM_VALUES: ReadonlySet<string> = new Set([
  "admin",
  "active_member",
  "member",
  "alumni",
  "viewer",
  "parent",
  "pending",
  "revoked",
]);

function humanRoleLabel(role: string | null | undefined): string | null {
  const trimmed = role?.trim();
  if (!trimmed) {
    return null;
  }
  return ROLE_ENUM_VALUES.has(trimmed.toLowerCase()) ? null : trimmed;
}

export function deriveMatchStrength(score: number): ConnectionMatchStrength {
  if (score >= STRONG_MATCH_MIN_SCORE) return "strong";
  if (score >= GOOD_MATCH_MIN_SCORE) return "good";
  return "suggested";
}

export function buildConnectionSubtitle(input: {
  role?: string | null;
  currentCompany?: string | null;
  industry?: string | null;
  major?: string | null;
  currentCity?: string | null;
}): string | null {
  const parts = [
    humanRoleLabel(input.role),
    input.currentCompany?.trim(),
    input.industry?.trim(),
    input.major?.trim(),
    input.currentCity?.trim(),
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.slice(0, 2).join(" • ") : null;
}

export function buildDisplayReadyConnectionPerson(person: ProjectedPerson): DisplayReadyConnectionPerson {
  return {
    person_type: person.personType,
    person_id: person.personId,
    name: person.name,
    subtitle: buildConnectionSubtitle({
      role: person.role,
      currentCompany: person.currentCompany,
      industry: person.industry,
      major: person.major,
      currentCity: person.currentCity,
    }),
    messageable: Boolean(person.userId),
  };
}

export const normalizeConnectionText = normalizeCareerText;

export function buildDisplayReadySuggestedConnection(
  suggestion: SuggestedConnection
): DisplayReadySuggestedConnection {
  return {
    person_type: suggestion.person_type,
    person_id: suggestion.person_id,
    name: suggestion.name,
    messageable: suggestion.messageable,
    subtitle: buildConnectionSubtitle({
      role: suggestion.preview.role,
      currentCompany: suggestion.preview.current_company,
      industry: suggestion.preview.industry,
      major: suggestion.preview.major,
      currentCity: suggestion.preview.current_city,
    }),
    score: suggestion.score,
    strength: deriveMatchStrength(suggestion.score),
    preview: suggestion.preview,
    reasons: suggestion.reasons.map((reason) => ({
      ...reason,
      label: formatConnectionReasonLabel(reason.code),
      detail: formatConnectionReasonDetail(reason),
      strong: isStrongReason(reason.code),
    })),
  };
}

export function clampSuggestionsLimit(limit?: number) {
  return Math.min(Math.max(limit ?? DEFAULT_SUGGESTIONS_LIMIT, 1), MAX_SUGGESTIONS_LIMIT);
}

export function inspectCandidateSignals(input: {
  source: ProjectedPerson;
  candidate: ProjectedPerson;
  scoringContext?: ConnectionScoringContext;
}): CandidateSignalMatch {
  const genericCompanyValues = buildGenericCompanySetFromContext(input.scoringContext);

  return {
    sharedCompany: chooseSharedCompanyValue(
      input.source.currentCompany,
      input.candidate.currentCompany,
      genericCompanyValues
    ),
    sharedIndustry: chooseSharedTextValue(input.source.industry, input.candidate.industry),
    sharedRoleFamily: chooseSharedTextValue(input.source.roleFamily, input.candidate.roleFamily),
    adjacentRoleFamily: areAdjacentRoleFamilies(
      input.source.roleFamily,
      input.candidate.roleFamily
    ),
    sharedCity: chooseSharedTextValue(input.source.currentCity, input.candidate.currentCity),
    graduationProximity: hasGraduationProximity(input.source, input.candidate),
  };
}

export function getCandidateQualificationCodes(
  signals: CandidateSignalMatch
): CandidateQualificationCode[] {
  const codes: CandidateQualificationCode[] = [];

  if (signals.sharedIndustry) codes.push("shared_industry");
  if (signals.sharedCompany) codes.push("shared_company");
  if (signals.sharedRoleFamily) codes.push("shared_role_family");
  if (signals.adjacentRoleFamily) codes.push("adjacent_role_family");
  if (signals.sharedCity) codes.push("shared_city");
  if (signals.graduationProximity) codes.push("graduation_proximity");

  return codes;
}

export function hasProfessionalStrengthQualification(
  qualifications: Iterable<CandidateQualificationCode>
) {
  const codes = new Set(qualifications);
  return (
    codes.has("shared_industry") ||
    codes.has("shared_company") ||
    codes.has("shared_role_family")
  );
}

export function buildConnectionRarityStats(input: {
  people: Iterable<ProjectedPerson>;
  scoringContext?: ConnectionScoringContext;
}): ConnectionRarityStats {
  const genericCompanyValues = buildGenericCompanySetFromContext(input.scoringContext);
  const companyCounts = new Map<string, number>();
  const industryCounts = new Map<string, number>();
  const roleFamilyCounts = new Map<string, number>();
  let totalPeople = 0;

  for (const person of input.people) {
    totalPeople += 1;

    const normalizedCompany = normalizeCareerText(person.currentCompany);
    if (normalizedCompany && !genericCompanyValues.has(normalizedCompany)) {
      companyCounts.set(normalizedCompany, (companyCounts.get(normalizedCompany) ?? 0) + 1);
    }

    const normalizedIndustry = normalizeCareerText(person.industry);
    if (normalizedIndustry) {
      industryCounts.set(normalizedIndustry, (industryCounts.get(normalizedIndustry) ?? 0) + 1);
    }

    const normalizedRoleFamily = normalizeCareerText(person.roleFamily);
    if (normalizedRoleFamily) {
      roleFamilyCounts.set(
        normalizedRoleFamily,
        (roleFamilyCounts.get(normalizedRoleFamily) ?? 0) + 1
      );
    }
  }

  return {
    totalPeople,
    companyCounts,
    industryCounts,
    roleFamilyCounts,
  };
}

function rarityMultiplier(count: number | undefined, totalPeople: number) {
  if (!count || totalPeople <= 0) {
    return 1;
  }

  const share = count / totalPeople;
  if (share <= 0.1) return 1.5;
  if (share <= 0.25) return 1.25;
  if (share <= 0.5) return 1.0;
  return 0.75;
}

function applyRarityWeight(input: {
  baseWeight: number;
  normalizedValue: string | null;
  counts: ReadonlyMap<string, number>;
  totalPeople: number;
}) {
  const multiplier = input.normalizedValue
    ? rarityMultiplier(input.counts.get(input.normalizedValue), input.totalPeople)
    : 1;

  return {
    multiplier,
    weight: Math.round(input.baseWeight * multiplier),
  };
}

export function buildSuggestionForCandidate(input: {
  source: ProjectedPerson;
  candidate: ProjectedPerson;
  scoringContext?: ConnectionScoringContext;
}): SuggestedConnection | null {
  const { source, candidate } = input;

  if (source.personKey === candidate.personKey) {
    return null;
  }

  const signals = inspectCandidateSignals(input);
  const qualifications = getCandidateQualificationCodes(signals);
  const reasons: ConnectionReason[] = [];
  const rarityMultipliers: SuggestedConnectionDebugInfo["rarityMultipliers"] = {};

  const rarityStats = input.scoringContext?.rarityStats;
  const totalPeople = rarityStats?.totalPeople ?? 0;

  if (signals.sharedIndustry) {
    const normalizedIndustry = normalizeCareerText(signals.sharedIndustry);
    const weighted = applyRarityWeight({
      baseWeight: CONNECTION_REASON_WEIGHTS.shared_industry,
      normalizedValue: normalizedIndustry,
      counts: rarityStats?.industryCounts ?? new Map(),
      totalPeople,
    });
    rarityMultipliers.industry = weighted.multiplier;
    reasons.push({
      code: "shared_industry",
      weight: weighted.weight,
      value: signals.sharedIndustry,
    });
  }

  if (signals.sharedCompany) {
    const normalizedCompany = normalizeCareerText(signals.sharedCompany);
    const weighted = applyRarityWeight({
      baseWeight: CONNECTION_REASON_WEIGHTS.shared_company,
      normalizedValue: normalizedCompany,
      counts: rarityStats?.companyCounts ?? new Map(),
      totalPeople,
    });
    rarityMultipliers.company = weighted.multiplier;
    reasons.push({
      code: "shared_company",
      weight: weighted.weight,
      value: signals.sharedCompany,
    });
  }

  if (signals.sharedRoleFamily) {
    const normalizedRoleFamily = normalizeCareerText(signals.sharedRoleFamily);
    const weighted = applyRarityWeight({
      baseWeight: CONNECTION_REASON_WEIGHTS.shared_role_family,
      normalizedValue: normalizedRoleFamily,
      counts: rarityStats?.roleFamilyCounts ?? new Map(),
      totalPeople,
    });
    rarityMultipliers.role_family = weighted.multiplier;
    reasons.push({
      code: "shared_role_family",
      weight: weighted.weight,
      value: signals.sharedRoleFamily,
    });
  }

  if (signals.sharedCity) {
    reasons.push({
      code: "shared_city",
      weight: CONNECTION_REASON_WEIGHTS.shared_city,
      value: signals.sharedCity,
    });
  }

  if (signals.graduationProximity) {
    reasons.push({
      code: "graduation_proximity",
      weight: CONNECTION_REASON_WEIGHTS.graduation_proximity,
      value: signals.graduationProximity,
    });
  }

  if (reasons.length === 0) {
    return null;
  }

  reasons.sort(
    (a, b) => CONNECTION_REASON_ORDER.indexOf(a.code) - CONNECTION_REASON_ORDER.indexOf(b.code)
  );

  const exposurePenalty = input.scoringContext?.exposurePenaltyByPersonId?.get(candidate.personId) ?? 0;
  const rawScore = reasons.reduce((sum, reason) => sum + reason.weight, 0) - exposurePenalty;

  return {
    person_type: candidate.personType,
    person_id: candidate.personId,
    name: candidate.name,
    messageable: Boolean(candidate.userId),
    score: Math.max(0, rawScore),
    preview: buildPreview(candidate),
    reasons,
    debug: {
      qualificationCodes: qualifications,
      rarityMultipliers,
      exposurePenalty,
    },
  };
}

export function hasProfessionalStrengthReason(suggestion: SuggestedConnection) {
  return suggestion.reasons.some((reason) =>
    ["shared_industry", "shared_company", "shared_role_family"].includes(reason.code)
  );
}

export function sortSuggestedConnections(results: SuggestedConnection[]) {
  return [...results].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (right.reasons.length !== left.reasons.length) {
      return right.reasons.length - left.reasons.length;
    }

    const nameComparison = left.name.localeCompare(right.name);
    if (nameComparison !== 0) {
      return nameComparison;
    }

    return left.person_id.localeCompare(right.person_id);
  });
}
