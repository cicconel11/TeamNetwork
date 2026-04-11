export type GraphQueueDrainState = "processed" | "empty" | "unavailable" | "degraded";

export type GraphFallbackReason = "disabled" | "unavailable" | "query_failure";

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
  fallbackReasonCounts: Record<GraphFallbackReason, number>;
  staleReadCount: number;
  degradedReadCount: number;
  unknownReadCount: number;
  lastMode: "falkor" | "sql_fallback" | null;
  lastFallbackReason: GraphFallbackReason | null;
  lastFreshnessState: "fresh" | "stale" | "degraded" | "unknown" | null;
  lastRequestedAt: string | null;
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
    lastRequestedAt: null,
  };
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
}) {
  const state = suggestionTelemetryByOrg.get(input.orgId) ?? emptySuggestionSnapshot(input.orgId);
  state.totalRequests += 1;
  state.lastMode = input.mode;
  state.lastFallbackReason = input.fallbackReason;
  state.lastFreshnessState = input.freshnessState;
  state.lastRequestedAt = nowIso();

  if (input.mode === "falkor") {
    state.falkorCount += 1;
  } else {
    state.sqlFallbackCount += 1;
  }

  if (input.fallbackReason) {
    state.fallbackReasonCounts[input.fallbackReason] += 1;
  }

  if (input.freshnessState === "stale") {
    state.staleReadCount += 1;
  } else if (input.freshnessState === "degraded") {
    state.degradedReadCount += 1;
  } else if (input.freshnessState === "unknown") {
    state.unknownReadCount += 1;
  }

  suggestionTelemetryByOrg.set(input.orgId, state);
}

export function getSuggestionObservabilitySnapshot(orgId: string): SuggestionObservabilitySnapshot {
  const state = suggestionTelemetryByOrg.get(orgId);
  return state ? { ...state, fallbackReasonCounts: { ...state.fallbackReasonCounts } } : emptySuggestionSnapshot(orgId);
}

export function resetFalkorTelemetryForTests() {
  graphFailuresByOrg.clear();
  suggestionTelemetryByOrg.clear();
  lastDrainSnapshot = {
    state: "empty",
    reason: null,
    processed: 0,
    skipped: 0,
    failed: 0,
    at: null,
  };
}
