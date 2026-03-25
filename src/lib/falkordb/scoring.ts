import type { ProjectedPerson } from "@/lib/falkordb/people";
import type { GraphFallbackReason } from "@/lib/falkordb/telemetry";

export type ConnectionReasonCode =
  | "direct_mentorship"
  | "second_degree_mentorship"
  | "shared_company"
  | "shared_industry"
  | "shared_major"
  | "shared_graduation_year"
  | "shared_city";

export interface ConnectionReason {
  code: ConnectionReasonCode;
  weight: number;
  value?: string | number;
}

export interface SuggestedConnection {
  person_type: "member" | "alumni";
  person_id: string;
  name: string;
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
}

export interface DisplayReadyConnectionReason extends ConnectionReason {
  label: string;
}

export interface DisplayReadyConnectionPerson {
  person_type: "member" | "alumni";
  person_id: string;
  name: string;
  subtitle: string | null;
}

export interface DisplayReadySuggestedConnection extends DisplayReadyConnectionPerson {
  score: number;
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
  mode: "falkor" | "sql_fallback";
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
  direct_mentorship: 100,
  second_degree_mentorship: 50,
  shared_company: 20,
  shared_industry: 12,
  shared_major: 10,
  shared_graduation_year: 8,
  shared_city: 5,
};

const CONNECTION_REASON_ORDER: ConnectionReasonCode[] = [
  "direct_mentorship",
  "second_degree_mentorship",
  "shared_company",
  "shared_industry",
  "shared_major",
  "shared_graduation_year",
  "shared_city",
];

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function chooseSharedTextValue(a: string | null | undefined, b: string | null | undefined) {
  const normalizedA = normalizeText(a);
  const normalizedB = normalizeText(b);
  if (!normalizedA || normalizedA !== normalizedB) {
    return null;
  }

  return a?.trim() || b?.trim() || null;
}

function buildPreview(person: ProjectedPerson): SuggestedConnection["preview"] {
  const preview: SuggestedConnection["preview"] = {};

  if (person.role) preview.role = person.role;
  if (person.major) preview.major = person.major;
  if (person.currentCompany) preview.current_company = person.currentCompany;
  if (person.industry) preview.industry = person.industry;
  if (typeof person.graduationYear === "number") preview.graduation_year = person.graduationYear;
  if (person.currentCity) preview.current_city = person.currentCity;

  return preview;
}

export function formatConnectionReasonLabel(code: ConnectionReasonCode): string {
  switch (code) {
    case "direct_mentorship":
      return "direct mentorship";
    case "second_degree_mentorship":
      return "second-degree mentorship";
    case "shared_company":
      return "shared company";
    case "shared_industry":
      return "shared industry";
    case "shared_major":
      return "shared major";
    case "shared_graduation_year":
      return "shared graduation year";
    case "shared_city":
      return "shared city";
  }
}

export function buildConnectionSubtitle(input: {
  role?: string | null;
  currentCompany?: string | null;
  industry?: string | null;
  major?: string | null;
  currentCity?: string | null;
}): string | null {
  const parts = [
    input.role?.trim(),
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
  };
}

export function buildDisplayReadySuggestedConnection(
  suggestion: SuggestedConnection
): DisplayReadySuggestedConnection {
  return {
    person_type: suggestion.person_type,
    person_id: suggestion.person_id,
    name: suggestion.name,
    subtitle: buildConnectionSubtitle({
      role: suggestion.preview.role,
      currentCompany: suggestion.preview.current_company,
      industry: suggestion.preview.industry,
      major: suggestion.preview.major,
      currentCity: suggestion.preview.current_city,
    }),
    score: suggestion.score,
    preview: suggestion.preview,
    reasons: suggestion.reasons.map((reason) => ({
      ...reason,
      label: formatConnectionReasonLabel(reason.code),
    })),
  };
}

export function clampSuggestionsLimit(limit?: number) {
  return Math.min(Math.max(limit ?? DEFAULT_SUGGESTIONS_LIMIT, 1), MAX_SUGGESTIONS_LIMIT);
}

export function buildSuggestionForCandidate(input: {
  source: ProjectedPerson;
  candidate: ProjectedPerson;
  mentorshipDistance: number | null;
}): SuggestedConnection | null {
  const { source, candidate, mentorshipDistance } = input;

  if (source.personKey === candidate.personKey) {
    return null;
  }

  const reasons: ConnectionReason[] = [];

  if (mentorshipDistance === 1) {
    reasons.push({
      code: "direct_mentorship",
      weight: CONNECTION_REASON_WEIGHTS.direct_mentorship,
    });
  } else if (mentorshipDistance === 2) {
    reasons.push({
      code: "second_degree_mentorship",
      weight: CONNECTION_REASON_WEIGHTS.second_degree_mentorship,
    });
  }

  const sharedCompany = chooseSharedTextValue(source.currentCompany, candidate.currentCompany);
  if (sharedCompany) {
    reasons.push({
      code: "shared_company",
      weight: CONNECTION_REASON_WEIGHTS.shared_company,
      value: sharedCompany,
    });
  }

  const sharedIndustry = chooseSharedTextValue(source.industry, candidate.industry);
  if (sharedIndustry) {
    reasons.push({
      code: "shared_industry",
      weight: CONNECTION_REASON_WEIGHTS.shared_industry,
      value: sharedIndustry,
    });
  }

  const sharedMajor = chooseSharedTextValue(source.major, candidate.major);
  if (sharedMajor) {
    reasons.push({
      code: "shared_major",
      weight: CONNECTION_REASON_WEIGHTS.shared_major,
      value: sharedMajor,
    });
  }

  if (
    typeof source.graduationYear === "number" &&
    source.graduationYear === candidate.graduationYear
  ) {
    reasons.push({
      code: "shared_graduation_year",
      weight: CONNECTION_REASON_WEIGHTS.shared_graduation_year,
      value: source.graduationYear,
    });
  }

  const sharedCity = chooseSharedTextValue(source.currentCity, candidate.currentCity);
  if (sharedCity) {
    reasons.push({
      code: "shared_city",
      weight: CONNECTION_REASON_WEIGHTS.shared_city,
      value: sharedCity,
    });
  }

  if (reasons.length === 0) {
    return null;
  }

  reasons.sort(
    (a, b) => CONNECTION_REASON_ORDER.indexOf(a.code) - CONNECTION_REASON_ORDER.indexOf(b.code)
  );

  return {
    person_type: candidate.personType,
    person_id: candidate.personId,
    name: candidate.name,
    score: reasons.reduce((sum, reason) => sum + reason.weight, 0),
    preview: buildPreview(candidate),
    reasons,
  };
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
