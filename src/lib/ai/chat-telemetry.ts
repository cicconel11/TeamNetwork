export const AI_AUDIT_STAGE_NAMES = [
  "auth_org_context",
  "request_validation_policy",
  "thread_resolution",
  "abandoned_stream_cleanup",
  "idempotency_lookup",
  "init_chat_rpc",
  "cache_lookup",
  "rag_retrieval",
  "assistant_placeholder_write",
  "context_build",
  "history_load",
  "pass1_model",
  "tools",
  "pass2",
  "grounding",
  "assistant_finalize_write",
  "cache_write",
] as const;

export type AiAuditStageName = (typeof AI_AUDIT_STAGE_NAMES)[number];

export type AiAuditStageStatus =
  | "completed"
  | "skipped"
  | "failed"
  | "timed_out"
  | "aborted"
  | "not_run";

export type AiAuditRetrievalDecision = "allow" | "skip" | "not_available";

export type AiAuditRetrievalReason =
  | "casual_turn"
  | "tool_only_structured_query"
  | "follow_up_requires_context"
  | "general_knowledge_query"
  | "ambiguous_query"
  | "out_of_scope_request"
  | "embedding_key_missing"
  | "cache_hit"
  | "message_safety_blocked";

export type AiToolAuthMode = "reused_verified_admin" | "db_lookup";

export interface AiAuditStageSummary {
  status: AiAuditStageStatus;
  duration_ms: number;
}

export interface AiAuditToolCallSummary {
  name: string;
  status: Exclude<AiAuditStageStatus, "skipped" | "not_run">;
  duration_ms: number;
  auth_mode: AiToolAuthMode;
  error_kind?: string;
}

export interface AiAuditToolsStageSummary extends AiAuditStageSummary {
  calls: AiAuditToolCallSummary[];
}

export interface AiAuditStageMap {
  auth_org_context: AiAuditStageSummary;
  request_validation_policy: AiAuditStageSummary;
  thread_resolution: AiAuditStageSummary;
  abandoned_stream_cleanup: AiAuditStageSummary;
  idempotency_lookup: AiAuditStageSummary;
  init_chat_rpc: AiAuditStageSummary;
  cache_lookup: AiAuditStageSummary;
  rag_retrieval: AiAuditStageSummary;
  assistant_placeholder_write: AiAuditStageSummary;
  context_build: AiAuditStageSummary;
  history_load: AiAuditStageSummary;
  pass1_model: AiAuditStageSummary;
  tools: AiAuditToolsStageSummary;
  pass2: AiAuditStageSummary;
  grounding: AiAuditStageSummary;
  assistant_finalize_write: AiAuditStageSummary;
  cache_write: AiAuditStageSummary;
}

export interface AiAuditStageTimings {
  schema_version: 1;
  request: {
    requestId: string;
    outcome: string;
    total_duration_ms: number;
  };
  retrieval: {
    decision: AiAuditRetrievalDecision;
    reason: AiAuditRetrievalReason;
  };
  stages: AiAuditStageMap;
}

// ---------------------------------------------------------------------------
// Runtime helpers for stage timing (used by chat handler)
// ---------------------------------------------------------------------------

export function createDefaultStageSummary(): AiAuditStageSummary {
  return { status: "not_run", duration_ms: 0 };
}

export function createStageTimings(requestId: string): AiAuditStageTimings {
  return {
    schema_version: 1,
    request: {
      requestId,
      outcome: "pending",
      total_duration_ms: 0,
    },
    retrieval: {
      decision: "not_available",
      reason: "general_knowledge_query",
    },
    stages: {
      auth_org_context: createDefaultStageSummary(),
      request_validation_policy: createDefaultStageSummary(),
      thread_resolution: createDefaultStageSummary(),
      abandoned_stream_cleanup: createDefaultStageSummary(),
      idempotency_lookup: createDefaultStageSummary(),
      init_chat_rpc: createDefaultStageSummary(),
      cache_lookup: createDefaultStageSummary(),
      rag_retrieval: createDefaultStageSummary(),
      assistant_placeholder_write: createDefaultStageSummary(),
      context_build: createDefaultStageSummary(),
      history_load: createDefaultStageSummary(),
      pass1_model: createDefaultStageSummary(),
      tools: {
        ...createDefaultStageSummary(),
        calls: [],
      },
      pass2: createDefaultStageSummary(),
      grounding: createDefaultStageSummary(),
      assistant_finalize_write: createDefaultStageSummary(),
      cache_write: createDefaultStageSummary(),
    },
  };
}

export function setStageStatus(
  stageTimings: AiAuditStageTimings,
  stage: AiAuditStageName,
  status: AiAuditStageStatus,
  durationMs: number
): void {
  if (stage === "tools") {
    stageTimings.stages.tools.status = status;
    stageTimings.stages.tools.duration_ms = durationMs;
    return;
  }

  stageTimings.stages[stage] = {
    status,
    duration_ms: durationMs,
  };
}

export async function runTimedStage<T>(
  stageTimings: AiAuditStageTimings,
  stage: AiAuditStageName,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    setStageStatus(stageTimings, stage, "completed", Date.now() - startedAt);
    return result;
  } catch (error) {
    setStageStatus(stageTimings, stage, "failed", Date.now() - startedAt);
    throw error;
  }
}

export function skipStage(stageTimings: AiAuditStageTimings, stage: AiAuditStageName): void {
  setStageStatus(stageTimings, stage, "skipped", 0);
}

/**
 * Skip all pipeline stages from `from` through the end of the stage list.
 * Use when returning early (idempotency hit, cache hit, safety block).
 */
export function skipRemainingStages(
  stageTimings: AiAuditStageTimings,
  from: AiAuditStageName
): void {
  const startIndex = AI_AUDIT_STAGE_NAMES.indexOf(from);
  for (let i = startIndex; i < AI_AUDIT_STAGE_NAMES.length; i++) {
    skipStage(stageTimings, AI_AUDIT_STAGE_NAMES[i]);
  }
}

const TOOL_STAGE_STATUS_PRECEDENCE: Record<AiAuditStageStatus, number> = {
  not_run: 0,
  skipped: 1,
  completed: 2,
  failed: 3,
  timed_out: 4,
  aborted: 5,
};

export function addToolCallTiming(
  stageTimings: AiAuditStageTimings,
  call: AiAuditToolCallSummary
): void {
  stageTimings.stages.tools.calls.push(call);
  stageTimings.stages.tools.duration_ms += call.duration_ms;

  const currentStatus = stageTimings.stages.tools.status;
  if (
    TOOL_STAGE_STATUS_PRECEDENCE[call.status] >=
    TOOL_STAGE_STATUS_PRECEDENCE[currentStatus]
  ) {
    stageTimings.stages.tools.status = call.status;
  }
}

export function finalizeStageTimings(
  stageTimings: AiAuditStageTimings,
  outcome: string,
  totalDurationMs: number
): AiAuditStageTimings {
  return {
    ...stageTimings,
    request: {
      requestId: stageTimings.request.requestId,
      outcome,
      total_duration_ms: totalDurationMs,
    },
  };
}
