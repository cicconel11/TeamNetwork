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
    outcome: string;
    total_duration_ms: number;
  };
  retrieval: {
    decision: AiAuditRetrievalDecision;
    reason: AiAuditRetrievalReason;
  };
  stages: AiAuditStageMap;
}
