/**
 * Shared terminal-refusal serving path.
 *
 * Both `message_safety_blocked` and `out_of_scope_unrelated` (scope-refusal)
 * branches in the chat handler share the same shape:
 *   1. mark retrieval skipped + skip remaining stages
 *   2. insert a complete assistant message with a fixed fallback string
 *   3. on insert failure -> 500 JSON
 *   4. fire trackOpsEventServer("api_error", ...)
 *   5. write the audit row via logAiRequest
 *   6. SSE replay the fallback + `done` event
 *
 * This module owns 1-6 so each branch is a single call. Inputs cover what
 * the two branches actually differ on: the fallback content, the error
 * codes/strings, and the cache-bypass reason.
 */
import { NextResponse } from "next/server";
import type { logAiRequest as logAiRequestDefault } from "@/lib/ai/audit";
import type { trackOpsEventServer as trackOpsEventServerDefault } from "@/lib/analytics/events-server";
import {
  finalizeStageTimings,
  skipRemainingStages,
  type AiAuditRetrievalReason,
  type AiAuditStageTimings,
} from "@/lib/ai/chat-telemetry";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import { createSSEStream, SSE_HEADERS, type CacheStatus } from "@/lib/ai/sse";
import type { AiOrgContext } from "@/lib/ai/context";
import type { CacheSurface } from "@/lib/ai/semantic-cache-utils";
import { buildSseResponse } from "../sse-runtime";
import type { AssistantInserter } from "./init-chat-rpc";

export type TerminalRefusalKind = "message_safety" | "scope_refusal";

export interface ServeTerminalRefusalInput {
  kind: TerminalRefusalKind;
  ctx: Extract<AiOrgContext, { ok: true }>;
  threadId: string;
  fallbackContent: string;
  /** Used in the audit `error` field, e.g. `message_safety_high:reason1,reason2`. */
  auditErrorCode: string;
  /** OpsEventServer endpoint_group, e.g. `ai-safety` or `ai-scope`. */
  opsEndpointGroup: string;
  /** OpsEventServer error_code, e.g. `message_safety_high` or `scope_refusal_unrelated_pattern`. */
  opsErrorCode: string;
  /** Audit-finalize reason, e.g. `message_safety_blocked` or `out_of_scope_request`. */
  finalizeReason: string;
  /** Stage-timings retrieval reason, e.g. `message_safety_blocked` or `out_of_scope_request`. */
  retrievalReason: AiAuditRetrievalReason;
  /** Cache status to surface in the SSE `done.cache.status` field — typically "bypass". */
  cacheStatus: CacheStatus;
  /** Cache bypass reason, surfaced both in audit and SSE. */
  cacheBypassReason: string;
  effectiveSurface: CacheSurface;
  resolvedIntent: string;
  resolvedIntentType: string;
  startTime: number;
  stageTimings: AiAuditStageTimings;
  rateLimit: { headers: Record<string, string> | undefined };
  requestLogContext: AiLogContext;
  insertAssistantMessage: AssistantInserter;
  logAiRequestFn: typeof logAiRequestDefault;
  trackOpsEventServerFn: typeof trackOpsEventServerDefault;
  /** Optional: include `bypassReason` only when truthy (matches today's behavior for safety where it's always set, scope where it's also always set). */
  alwaysIncludeBypassReason?: boolean;
}

export async function serveTerminalRefusal(
  input: ServeTerminalRefusalInput,
): Promise<Response> {
  input.stageTimings.retrieval = {
    decision: "skip",
    reason: input.retrievalReason,
  };
  skipRemainingStages(input.stageTimings, "cache_lookup");

  const { data: assistantMsg, error: assistantError } =
    await input.insertAssistantMessage({
      content: input.fallbackContent,
      status: "complete",
    });

  if (assistantError || !assistantMsg) {
    aiLog(
      "error",
      "ai-chat",
      input.kind === "message_safety"
        ? "safety assistant message failed"
        : "scope refusal assistant message failed",
      { ...input.requestLogContext, threadId: input.threadId },
      { error: assistantError },
    );
    return NextResponse.json(
      { error: "Failed to create response" },
      { status: 500, headers: input.rateLimit.headers },
    );
  }

  void input.trackOpsEventServerFn(
    "api_error",
    {
      endpoint_group: input.opsEndpointGroup,
      http_status: 200,
      error_code: input.opsErrorCode,
      retryable: false,
    },
    input.ctx.orgId,
  );

  await input.logAiRequestFn(
    input.ctx.serviceSupabase,
    {
      threadId: input.threadId,
      messageId: assistantMsg.id,
      userId: input.ctx.userId,
      orgId: input.ctx.orgId,
      intent: input.resolvedIntent,
      intentType: input.resolvedIntentType,
      latencyMs: Date.now() - input.startTime,
      error: input.auditErrorCode,
      cacheStatus: input.cacheStatus,
      cacheBypassReason: input.cacheBypassReason,
      contextSurface: input.effectiveSurface,
      stageTimings: finalizeStageTimings(
        input.stageTimings,
        input.finalizeReason,
        Date.now() - input.startTime,
      ),
    },
    { ...input.requestLogContext, threadId: input.threadId },
  );

  return buildSseResponse(
    createSSEStream(async (enqueue) => {
      enqueue({ type: "chunk", content: input.fallbackContent });
      enqueue({
        type: "done",
        threadId: input.threadId,
        cache: {
          status: input.cacheStatus,
          ...(input.cacheBypassReason
            ? { bypassReason: input.cacheBypassReason }
            : {}),
        },
      });
    }),
    { ...SSE_HEADERS, ...input.rateLimit.headers },
    input.threadId,
  );
}
