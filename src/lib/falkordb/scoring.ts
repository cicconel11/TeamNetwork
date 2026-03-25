import { normalizeCareerText } from "@/lib/falkordb/career-signals";
import type { ProjectedPerson } from "@/lib/falkordb/people";
import type { GraphFallbackReason } from "@/lib/falkordb/telemetry";

export type ConnectionReasonCode =
  | "shared_company"
  | "shared_industry"
  | "shared_city"
  | "graduation_proximity";

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
  shared_company: 30,
  shared_industry: 40,
  shared_city: 15,
  graduation_proximity: 10,
};

const CONNECTION_REASON_ORDER: ConnectionReasonCode[] = [
  "shared_industry",
  "shared_company",
  "shared_city",
  "graduation_proximity",
];

function chooseSharedTextValue(a: string | null | undefined, b: string | null | undefined) {
  const normalizedA = normalizeCareerText(a);
  const normalizedB = normalizeCareerText(b);
  if (!normalizedA || normalizedA !== normalizedB) {
    return null;
  }

  return a?.trim() || b?.trim() || null;
}

export interface ConnectionScoringContext {
  genericCompanyValues?: Iterable<string | null | undefined>;
}

export function normalizeConnectionText(value: string | null | undefined): string | null {
  return normalizeCareerText(value);
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
    case "shared_company":
      return "shared company";
    case "shared_industry":
      return "shared industry";
    case "shared_city":
      return "shared city";
    case "graduation_proximity":
      return "graduation proximity";
  }
}

export function buildConnectionSubtitle(input: {
  role?: string | null;
  currentCompany?: string | null;
  industry?: string | null;
  major?: string | null;
  currentCity?: string | null;
}): string | null {
  const normalizedRole = input.role?.trim().toLowerCase() ?? null;
  const parts = [
    normalizedRole === "admin" ? null : input.role?.trim(),
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
  scoringContext?: ConnectionScoringContext;
}): SuggestedConnection | null {
  const { source, candidate } = input;

  if (source.personKey === candidate.personKey) {
    return null;
  }

  const reasons: ConnectionReason[] = [];

  const genericCompanyValues = buildGenericCompanySet([
    ...(input.scoringContext?.genericCompanyValues ?? []),
  ]);

  const sharedCompany = chooseSharedCompanyValue(
    source.currentCompany,
    candidate.currentCompany,
    genericCompanyValues
  );
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

  const sharedCity = chooseSharedTextValue(source.currentCity, candidate.currentCity);
  if (sharedCity) {
    reasons.push({
      code: "shared_city",
      weight: CONNECTION_REASON_WEIGHTS.shared_city,
      value: sharedCity,
    });
  }

  if (
    typeof source.graduationYear === "number" &&
    typeof candidate.graduationYear === "number" &&
    Math.abs(source.graduationYear - candidate.graduationYear) <= 3
  ) {
    reasons.push({
      code: "graduation_proximity",
      weight: CONNECTION_REASON_WEIGHTS.graduation_proximity,
      value: candidate.graduationYear,
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
