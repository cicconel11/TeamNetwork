export type GraphQueueDrainState = "processed" | "empty" | "unavailable" | "degraded";

export type GraphFallbackReason = "disabled" | "unavailable" | "query_failure";
export type SuggestionResultStrength = "strong" | "weak_fallback" | "none";

export interface GraphDrainTelemetrySnapshot {
  state: GraphQueueDrainState;
  reason: string | null;
  processed: number;
  skipped: number;
  failed: number;
  at: string | null;
}

export interface GraphFailureEvidence {
  at: string;
  sourceTable: "members" | "alumni" | "mentorship_pairs";
  sourceId: string;
  message: string;
  attempts: number;
  deadLetter: boolean;
}

export interface GraphFailureTelemetrySnapshot {
  totalFailures: number;
  deadLetterCount: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  recentErrors: GraphFailureEvidence[];
}

export interface SuggestionObservabilitySnapshot {
  orgId: string;
  totalRequests: number;
  falkorCount: number;
  sqlFallbackCount: number;
  strongResultCount: number;
  weakFallbackCount: number;
  emptyResultCount: number;
  fallbackReasonCounts: Record<GraphFallbackReason, number>;
  staleReadCount: number;
  degradedReadCount: number;
  unknownReadCount: number;
  lastMode: "falkor" | "sql_fallback" | null;
  lastFallbackReason: GraphFallbackReason | null;
  lastFreshnessState: "fresh" | "stale" | "degraded" | "unknown" | null;
  lastResultStrength: SuggestionResultStrength | null;
  lastRequestedAt: string | null;
  recentTopCandidateCounts: Array<{ personId: string; appearances: number }>;
}

const MAX_RECENT_ERRORS = 10;

const graphFailuresByOrg = new Map<
  string,
  {
    totalFailures: number;
    deadLetterCount: number;
    lastFailureAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    recentErrors: GraphFailureEvidence[];
  }
>();

const suggestionTelemetryByOrg = new Map<string, SuggestionObservabilitySnapshot>();
const suggestionExposureByOrg = new Map<string, string[][]>();
const MAX_RECENT_TOP_CANDIDATE_WINDOWS = 50;

let lastDrainSnapshot: GraphDrainTelemetrySnapshot = {
  state: "empty",
  reason: null,
  processed: 0,
  skipped: 0,
  failed: 0,
  at: null,
};

function nowIso() {
  return new Date().toISOString();
}

function getOrCreateGraphFailureState(orgId: string) {
  const existing = graphFailuresByOrg.get(orgId);
  if (existing) {
    return existing;
  }

  const created = {
    totalFailures: 0,
    deadLetterCount: 0,
    lastFailureAt: null,
    lastSuccessAt: null,
    lastError: null,
    recentErrors: [] as GraphFailureEvidence[],
  };
  graphFailuresByOrg.set(orgId, created);
  return created;
}

function emptySuggestionSnapshot(orgId: string): SuggestionObservabilitySnapshot {
  return {
    orgId,
    totalRequests: 0,
    falkorCount: 0,
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

export function recordGraphDrainResult(input: {
  state: GraphQueueDrainState;
  reason?: string | null;
  processed: number;
  skipped: number;
  failed: number;
}) {
  lastDrainSnapshot = {
    state: input.state,
    reason: input.reason ?? null,
    processed: input.processed,
    skipped: input.skipped,
    failed: input.failed,
    at: nowIso(),
  };
}

export function getLastGraphDrainResult(): GraphDrainTelemetrySnapshot {
  return { ...lastDrainSnapshot };
}

export function recordGraphFailure(input: {
  orgId: string;
  sourceTable: "members" | "alumni" | "mentorship_pairs";
  sourceId: string;
  message: string;
  attempts: number;
  deadLetter: boolean;
}) {
  const state = getOrCreateGraphFailureState(input.orgId);
  const evidence: GraphFailureEvidence = {
    at: nowIso(),
    sourceTable: input.sourceTable,
    sourceId: input.sourceId,
    message: input.message,
    attempts: input.attempts,
    deadLetter: input.deadLetter,
  };

  state.totalFailures += 1;
  if (input.deadLetter) {
    state.deadLetterCount += 1;
  }
  state.lastFailureAt = evidence.at;
  state.lastError = input.message;
  state.recentErrors = [evidence, ...state.recentErrors].slice(0, MAX_RECENT_ERRORS);
}

export function recordGraphSuccess(orgId: string) {
  const state = getOrCreateGraphFailureState(orgId);
  state.lastSuccessAt = nowIso();
}

export function getGraphFailureTelemetry(orgId: string): GraphFailureTelemetrySnapshot {
  const state = graphFailuresByOrg.get(orgId);
  if (!state) {
    return {
      totalFailures: 0,
      deadLetterCount: 0,
      lastFailureAt: null,
      lastSuccessAt: null,
      lastError: null,
      recentErrors: [],
    };
  }

  return {
    totalFailures: state.totalFailures,
    deadLetterCount: state.deadLetterCount,
    lastFailureAt: state.lastFailureAt,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
    recentErrors: [...state.recentErrors],
  };
}

export function recordSuggestionExecution(input: {
  orgId: string;
  mode: "falkor" | "sql_fallback";
  fallbackReason: GraphFallbackReason | null;
  freshnessState: "fresh" | "stale" | "degraded" | "unknown";
  resultStrength: SuggestionResultStrength;
}) {
  const prev = suggestionTelemetryByOrg.get(input.orgId) ?? emptySuggestionSnapshot(input.orgId);

  const fallbackReasonCounts = input.fallbackReason
    ? { ...prev.fallbackReasonCounts, [input.fallbackReason]: prev.fallbackReasonCounts[input.fallbackReason] + 1 }
    : { ...prev.fallbackReasonCounts };

  const next: SuggestionObservabilitySnapshot = {
    ...prev,
    totalRequests: prev.totalRequests + 1,
    lastMode: input.mode,
    lastFallbackReason: input.fallbackReason,
    lastFreshnessState: input.freshnessState,
    lastResultStrength: input.resultStrength,
    lastRequestedAt: nowIso(),
    falkorCount: prev.falkorCount + (input.mode === "falkor" ? 1 : 0),
    sqlFallbackCount: prev.sqlFallbackCount + (input.mode === "sql_fallback" ? 1 : 0),
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

export function recordSuggestedCandidates(input: {
  orgId: string;
  personIds: string[];
}) {
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

export function resetFalkorTelemetryForTests() {
  graphFailuresByOrg.clear();
  suggestionTelemetryByOrg.clear();
  suggestionExposureByOrg.clear();
  lastDrainSnapshot = {
    state: "empty",
    reason: null,
    processed: 0,
    skipped: 0,
    failed: 0,
    at: null,
  };
}
