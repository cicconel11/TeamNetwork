export type GraphFallbackReason = "disabled" | "unavailable" | "query_failure";
export type SuggestionResultStrength = "strong" | "weak_fallback" | "none";

export interface SuggestionObservabilitySnapshot {
  orgId: string;
  totalRequests: number;
  sqlFallbackCount: number;
  strongResultCount: number;
  weakFallbackCount: number;
  emptyResultCount: number;
  fallbackReasonCounts: Record<GraphFallbackReason, number>;
  staleReadCount: number;
  degradedReadCount: number;
  unknownReadCount: number;
  lastMode: "sql_fallback" | null;
  lastFallbackReason: GraphFallbackReason | null;
  lastFreshnessState: "fresh" | "stale" | "degraded" | "unknown" | null;
  lastResultStrength: SuggestionResultStrength | null;
  lastRequestedAt: string | null;
  recentTopCandidateCounts: Array<{ personId: string; appearances: number }>;
}

const suggestionTelemetryByOrg = new Map<string, SuggestionObservabilitySnapshot>();
const suggestionExposureByOrg = new Map<string, string[][]>();
const MAX_RECENT_TOP_CANDIDATE_WINDOWS = 50;

function nowIso() {
  return new Date().toISOString();
}

function emptySuggestionSnapshot(orgId: string): SuggestionObservabilitySnapshot {
  return {
    orgId,
    totalRequests: 0,
    sqlFallbackCount: 0,
    strongResultCount: 0,
    weakFallbackCount: 0,
    emptyResultCount: 0,
    fallbackReasonCounts: {
      disabled: 0,
      unavailable: 0,
      query_failure: 0,
    },
    staleReadCount: 0,
    degradedReadCount: 0,
    unknownReadCount: 0,
    lastMode: null,
    lastFallbackReason: null,
    lastFreshnessState: null,
    lastResultStrength: null,
    lastRequestedAt: null,
    recentTopCandidateCounts: [],
  };
}

function buildRecentTopCandidateCounts(orgId: string) {
  const windows = suggestionExposureByOrg.get(orgId) ?? [];
  const counts = new Map<string, number>();

  for (const window of windows) {
    for (const personId of window) {
      counts.set(personId, (counts.get(personId) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([personId, appearances]) => ({ personId, appearances }))
    .sort((left, right) => {
      if (right.appearances !== left.appearances) {
        return right.appearances - left.appearances;
      }
      return left.personId.localeCompare(right.personId);
    });
}

export function recordSuggestionExecution(input: {
  orgId: string;
  mode: "sql_fallback";
  fallbackReason: GraphFallbackReason | null;
  freshnessState: "fresh" | "stale" | "degraded" | "unknown";
  resultStrength: SuggestionResultStrength;
}) {
  const prev = suggestionTelemetryByOrg.get(input.orgId) ?? emptySuggestionSnapshot(input.orgId);

  const fallbackReasonCounts = input.fallbackReason
    ? {
        ...prev.fallbackReasonCounts,
        [input.fallbackReason]: prev.fallbackReasonCounts[input.fallbackReason] + 1,
      }
    : { ...prev.fallbackReasonCounts };

  const next: SuggestionObservabilitySnapshot = {
    ...prev,
    totalRequests: prev.totalRequests + 1,
    lastMode: input.mode,
    lastFallbackReason: input.fallbackReason,
    lastFreshnessState: input.freshnessState,
    lastResultStrength: input.resultStrength,
    lastRequestedAt: nowIso(),
    sqlFallbackCount: prev.sqlFallbackCount + 1,
    strongResultCount: prev.strongResultCount + (input.resultStrength === "strong" ? 1 : 0),
    weakFallbackCount: prev.weakFallbackCount + (input.resultStrength === "weak_fallback" ? 1 : 0),
    emptyResultCount: prev.emptyResultCount + (input.resultStrength === "none" ? 1 : 0),
    fallbackReasonCounts,
    staleReadCount: prev.staleReadCount + (input.freshnessState === "stale" ? 1 : 0),
    degradedReadCount: prev.degradedReadCount + (input.freshnessState === "degraded" ? 1 : 0),
    unknownReadCount: prev.unknownReadCount + (input.freshnessState === "unknown" ? 1 : 0),
    recentTopCandidateCounts: buildRecentTopCandidateCounts(input.orgId),
  };

  suggestionTelemetryByOrg.set(input.orgId, next);
}

export function recordSuggestedCandidates(input: { orgId: string; personIds: string[] }) {
  const uniquePersonIds = [...new Set(input.personIds.filter(Boolean))];
  if (uniquePersonIds.length === 0) {
    return;
  }

  const existing = suggestionExposureByOrg.get(input.orgId) ?? [];
  const next = [...existing, uniquePersonIds].slice(-MAX_RECENT_TOP_CANDIDATE_WINDOWS);
  suggestionExposureByOrg.set(input.orgId, next);

  const snapshot = suggestionTelemetryByOrg.get(input.orgId);
  if (snapshot) {
    suggestionTelemetryByOrg.set(input.orgId, {
      ...snapshot,
      recentTopCandidateCounts: buildRecentTopCandidateCounts(input.orgId),
    });
  }
}

export function getSuggestedCandidateExposureCounts(orgId: string) {
  return new Map(
    buildRecentTopCandidateCounts(orgId).map((entry) => [entry.personId, entry.appearances])
  );
}

export function getSuggestionObservabilitySnapshot(orgId: string): SuggestionObservabilitySnapshot {
  const state = suggestionTelemetryByOrg.get(orgId);
  return state
    ? {
        ...state,
        fallbackReasonCounts: { ...state.fallbackReasonCounts },
        recentTopCandidateCounts: [...state.recentTopCandidateCounts],
      }
    : emptySuggestionSnapshot(orgId);
}

export function resetSuggestionTelemetryForTests() {
  suggestionTelemetryByOrg.clear();
  suggestionExposureByOrg.clear();
}
