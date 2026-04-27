/**
 * Shared types for the AI eval harness.
 *
 * A "case" is one prompt → expected outcome record. The harness drives the chat
 * handler with the case's `input`, captures everything the agent did, then runs
 * scorers against `expected`. See `tests/ai-eval/cases/*.json`.
 */

export type EvalSeverity = "p0" | "p1" | "p2";

export type EvalCategory =
  | "tool_use"
  | "org_scope_leak"
  | "refusal"
  | "auth_refusal"
  | "guardrail_propagation"
  | "rag_faithfulness"
  | "multi_turn"
  | "prompt_injection"
  | "confirmation_gate"
  | "hallucination_unanswerable";

export type EvalRole = "admin" | "active_member" | "alumni" | "parent";

/**
 * Mirrors `getAiOrgContext`'s outcome:
 *   - ok=true: handler proceeds with given role/orgId/userId.
 *   - ok=false: handler must short-circuit with the matching HTTP refusal.
 *
 * Default in `buildHarnessDeps` is admin success. Override for negative cases
 * (revoked, wrong-org, non-admin) — the matching scorer asserts no tool calls
 * were captured.
 */
export type EvalAuthContext =
  | { ok: true; role: EvalRole; orgId?: string; userId?: string }
  | { ok: false; reason: "revoked" | "not_member" | "wrong_org" | "auth_error"; status: number };

/**
 * Per-case forced outcomes for the three production guardrails. Lets cases
 * exercise the downstream propagation (final SSE text + audit row) without
 * needing real LLM judges.
 */
export interface EvalGuardrailOverrides {
  safety?: { verdict: "safe" | "controversial" | "unsafe"; categories?: string[] };
  rag?: { grounded: boolean; uncoveredClaims?: string[] };
  tool?: { grounded: boolean; failures?: string[] };
  ragMode?: "shadow" | "overwrite" | "block" | "bypass";
}

export interface EvalCaseInput {
  message: string;
  surface?: "general" | "members" | "events" | "discussions" | "announcements" | "calendar" | "donations" | "jobs" | "philanthropy" | "feed";
  currentPath?: string;
  /**
   * Pre-canned tool result the LLM stub will receive after pass-1 picks the
   * `expectedToolName`. Lets cases stay deterministic without real DB.
   */
  toolResult?: { kind: "ok"; data: unknown } | { kind: "tool_error"; error: string };
  /**
   * What the LLM stub yields on pass-1. If `toolName` is set, the stub yields a
   * tool_call_requested with the given args. If `chunkText` is set (and no
   * toolName), the stub yields a chunk and stops.
   *
   * Cases that test refusal or out-of-scope responses skip the tool path:
   * leave `toolName` undefined and put the model's prose in `chunkText`.
   */
  llmStub?: {
    pass1ToolName?: string;
    pass1ArgsJson?: string;
    /** Final text rendered to the user (pass-2 if tool, else pass-1). */
    finalText?: string;
  };
  /** Override auth outcome. Defaults to admin success. */
  authContext?: EvalAuthContext;
  /** Force guardrail outcomes (safety / RAG / tool grounding) for propagation cases. */
  guardrails?: EvalGuardrailOverrides;
}

export interface EvalCaseExpected {
  /** Pass-1 must call exactly this tool (or none). */
  toolName?: string | null;
  /** Subset match — every key in expectedArgs must equal actual args. */
  toolArgs?: Record<string, unknown>;
  /** Substrings that MUST appear in the final assistant text. */
  textIncludes?: string[];
  /** Substrings that MUST NOT appear (e.g., other-org IDs in scope-leak probes). */
  textExcludes?: string[];
  /** Whether the agent should refuse (no tool call, refusal markers in text). */
  refuses?: boolean;
  /** Expected pending_action SSE event for confirmation-gate tests. */
  pendingAction?: { actionType: string; payloadIncludes?: Record<string, unknown> };
  /** For auth-refusal cases: handler must short-circuit before SSE with this status. */
  httpStatus?: number;
  /** Audit row keys/values that must be present (subset match). */
  auditIncludes?: Record<string, unknown>;
  /** No tool call captured (refusal cases). */
  noToolCall?: boolean;
}

export interface EvalCase {
  id: string;
  category: EvalCategory;
  severity: EvalSeverity;
  description: string;
  input: EvalCaseInput;
  expected: EvalCaseExpected;
}

export interface EvalCaseResult {
  caseId: string;
  category: EvalCategory;
  severity: EvalSeverity;
  passed: boolean;
  scores: Record<string, { passed: boolean; reason?: string }>;
  /** Full transcript for debugging. */
  transcript: {
    httpStatus: number;
    toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
    finalText: string;
    sseEvents: unknown[];
    auditEntry: Record<string, unknown> | null;
  };
  durationMs: number;
}

export interface EvalReport {
  startedAt: string;
  finishedAt: string;
  totalCases: number;
  totalPassed: number;
  totalFailed: number;
  byCategory: Record<string, { passed: number; failed: number }>;
  bySeverity: Record<string, { passed: number; failed: number }>;
  /** True when any P0 case failed — drives non-zero exit. */
  hasP0Regression: boolean;
  results: EvalCaseResult[];
}
