// Audit-log writer for AI request outcomes.
//
// Writes to `ai_audit_log` are safety-critical: they're the only persistent
// record of `unsafe` safety verdicts, RAG grounding failures, and tool-grounding
// outcomes. To avoid losing rows on transient infra blips:
//
//   1. Single retry with 200ms jitter on transient errors (PGRST*, 57P03,
//      `fetch failed`). Non-transient errors (RLS denial, schema drift) skip
//      retry — repeating won't help.
//   2. Terminal failure (retry exhausted, non-transient error, or unexpected
//      throw) fires `trackOpsEventServer("api_error", ..., audit_insert_failed)`
//      so ops dashboards surface the silent-fail.
//
// Env vars:
//   AI_AUDIT_RETRY_DISABLED=1 — break-glass to skip retry (still fires the
//                               ops event on failure).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CacheStatus } from "./sse";
import type { CacheSurface } from "./semantic-cache-utils";
import type { AiAuditStageTimings } from "./chat-telemetry";
import { aiLog, type AiLogContext } from "./logger";
import { trackOpsEventServer } from "@/lib/analytics/events-server";

export interface AuditEntry {
  threadId: string | null;
  messageId: string | null;
  userId: string;
  orgId: string;
  intent?: string;
  intentType?: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  latencyMs?: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  cacheStatus?: CacheStatus;
  cacheEntryId?: string; // UUID of the cache entry that was hit
  cacheBypassReason?: string; // why cache was bypassed (eligibility reason)
  contextSurface?: CacheSurface; // which surface was used for context selection
  contextTokenEstimate?: number; // estimated token count of the context message
  ragChunkCount?: number; // number of RAG chunks injected into context
  ragTopSimilarity?: number; // highest cosine similarity score
  ragError?: string; // error message if RAG retrieval failed
  stageTimings?: AiAuditStageTimings;
  // Output safety gate (Phase 1)
  safetyVerdict?: "safe" | "controversial" | "unsafe";
  safetyCategories?: string[];
  safetyLatencyMs?: number;
  // RAG grounding validator (Phase 2)
  ragGrounded?: boolean;
  ragGroundingFailures?: string[];
  ragGroundingLatencyMs?: number;
  ragGroundingMode?: "shadow" | "overwrite" | "block" | "bypass";
}

interface AuditInsertClient {
  from(table: "ai_audit_log"): {
    insert(row: Record<string, unknown>): Promise<{ error: unknown }> | { error: unknown };
  };
}

export interface LogAiRequestDeps {
  trackOpsEvent?: typeof trackOpsEventServer;
  // Test seam — defaults to setTimeout. Lets tests skip the 200ms backoff.
  sleep?: (ms: number) => Promise<void>;
}

function redactSensitive(value: string): string {
  return value
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]")                // OpenAI API keys
    .replace(/key_[a-zA-Z0-9_-]+/g, "[REDACTED]")              // Generic key_ prefixed
    .replace(/AIza[a-zA-Z0-9_-]{30,}/g, "[REDACTED]")          // Google/Gemini API keys
    .replace(/sbp_[a-zA-Z0-9]{20,}/g, "[REDACTED]")            // Supabase keys
    .replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, "[REDACTED]") // JWTs
    .replace(/Bearer [a-zA-Z0-9._-]+/g, "Bearer [REDACTED]");  // Auth headers
}

function redactJsonValue<T>(value: T): T {
  return JSON.parse(redactSensitive(JSON.stringify(value))) as T;
}

// Transient = worth a single retry. Non-transient = repeating cannot help.
// PGRST204 (schema cache mismatch) + 422xx (validation) are persistent and
// skip retry. Only infra-class PGRST codes are transient.
const TRANSIENT_PGRST_CODES = new Set([
  "PGRST000", // connection failure
  "PGRST001", // connection timeout
  "PGRST002", // schema cache load failure
]);

function isTransientInsertError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") {
    if (TRANSIENT_PGRST_CODES.has(code)) return true;
    if (code === "57P03") return true; // cannot_connect_now / admin shutdown
  }
  const message = (error as { message?: unknown }).message;
  if (typeof message === "string" && /fetch failed|network|ECONN|ETIMEDOUT/i.test(message)) {
    return true;
  }
  return false;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function logAiRequest(
  serviceSupabase: SupabaseClient,
  entry: AuditEntry,
  logContext?: AiLogContext,
  deps: LogAiRequestDeps = {}
): Promise<void> {
  const trackOpsEvent = deps.trackOpsEvent ?? trackOpsEventServer;
  const sleep = deps.sleep ?? defaultSleep;
  const retryDisabled = process.env.AI_AUDIT_RETRY_DISABLED === "1";

  const fallbackLogContext: AiLogContext = logContext ?? {
    requestId: entry.stageTimings?.request.requestId ?? "unknown_request",
    orgId: entry.orgId,
    threadId: entry.threadId ?? undefined,
    userId: entry.userId,
  };

  const fireOpsEvent = async (): Promise<void> => {
    // Serverless teardown can drop unawaited promises. Await with a tight
    // timeout so the RPC has a chance to flush without hanging the request
    // if telemetry is sick.
    await Promise.race([
      Promise.resolve(
        trackOpsEvent(
          "api_error",
          {
            endpoint_group: "ai-audit",
            error_code: "audit_insert_failed",
            http_status: 200,
            retryable: false,
          },
          entry.orgId
        )
      ).catch(() => {}),
      sleep(500),
    ]);
  };

  try {
    const toolCallsJson = entry.toolCalls
      ? redactJsonValue(entry.toolCalls)
      : null;
    const stageTimingsJson = entry.stageTimings
      ? redactJsonValue(entry.stageTimings)
      : null;

    const row = {
      thread_id: entry.threadId,
      message_id: entry.messageId,
      user_id: entry.userId,
      org_id: entry.orgId,
      intent: entry.intent ?? null,
      intent_type: entry.intentType ?? null,
      tool_calls: toolCallsJson,
      latency_ms: entry.latencyMs ?? null,
      model: entry.model ?? null,
      input_tokens: entry.inputTokens ?? null,
      output_tokens: entry.outputTokens ?? null,
      error: entry.error ? entry.error.slice(0, 1000) : null,
      cache_status: entry.cacheStatus ?? null,
      cache_entry_id: entry.cacheEntryId ?? null,
      cache_bypass_reason: entry.cacheBypassReason ?? null,
      context_surface: entry.contextSurface ?? null,
      context_token_estimate: entry.contextTokenEstimate ?? null,
      rag_chunk_count: entry.ragChunkCount ?? null,
      rag_top_similarity: entry.ragTopSimilarity ?? null,
      rag_error: entry.ragError ? entry.ragError.slice(0, 500) : null,
      stage_timings: stageTimingsJson,
      safety_verdict: entry.safetyVerdict ?? null,
      safety_categories: entry.safetyCategories ? redactJsonValue(entry.safetyCategories) : null,
      safety_latency_ms: entry.safetyLatencyMs ?? null,
      rag_grounded: entry.ragGrounded ?? null,
      rag_grounding_failures: entry.ragGroundingFailures
        ? redactJsonValue(entry.ragGroundingFailures.slice(0, 20))
        : null,
      rag_grounding_latency_ms: entry.ragGroundingLatencyMs ?? null,
      rag_grounding_mode: entry.ragGroundingMode ?? null,
    };

    const insert = (): Promise<{ error: unknown }> | { error: unknown } =>
      (serviceSupabase as unknown as AuditInsertClient)
        .from("ai_audit_log")
        .insert(row);

    const { error } = await insert();
    if (!error) return;

    if (!isTransientInsertError(error) || retryDisabled) {
      aiLog("error", "ai-audit", "insert failed", fallbackLogContext, { error });
      await fireOpsEvent();
      return;
    }

    // 200ms base + up to 100ms jitter so concurrent retries don't collide.
    await sleep(200 + Math.floor(Math.random() * 100));
    const { error: retryError } = await insert();
    if (!retryError) return;

    aiLog("error", "ai-audit", "insert failed after retry", fallbackLogContext, {
      error: retryError,
    });
    await fireOpsEvent();
  } catch (err) {
    aiLog("error", "ai-audit", "unexpected error", fallbackLogContext, { error: err });
    await fireOpsEvent();
  }
}
