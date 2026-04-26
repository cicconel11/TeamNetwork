/**
 * Stage: history_load + context_build (parallel).
 *
 * Wraps the `Promise.all([buildPromptContext, historyPromise])` block. Owns
 * stage-timing transitions for `history_load` and `context_build`. Returns
 * the four bindings the orchestrator needs downstream: `historyRows`,
 * `systemPrompt`, `orgContextMessage`, `metadata`.
 *
 * Failure semantics match the original handler exactly:
 *  - `history_load` failure logs + falls back to `[{ role: "user", content: promptSafeMessage }]`.
 *  - `context_build` failure rethrows.
 */
import {
  setStageStatus,
  type AiAuditStageTimings,
} from "@/lib/ai/chat-telemetry";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import type { AiOrgContext } from "@/lib/ai/context";
import type { CacheSurface } from "@/lib/ai/semantic-cache-utils";
import type { RouteEntityContext } from "@/lib/ai/route-entity";
import type { RagChunkInput, buildPromptContext } from "@/lib/ai/context-builder";
import type { ToolName } from "@/lib/ai/tools/definitions";

export interface HistoryRow {
  role: "user" | "assistant" | string;
  content: string | null;
}

export interface InitChatHistoryInput {
  ctx: Extract<AiOrgContext, { ok: true }>;
  threadId: string;
  existingThreadId: string | undefined;
  promptSafeMessage: string;
  effectiveSurface: CacheSurface;
  usesSharedStaticContext: boolean;
  usesToolFirstContext: boolean;
  ragChunks: RagChunkInput[];
  requestNow: string;
  requestTimeZone: string;
  currentPath: string | undefined;
  routeEntityContext: RouteEntityContext | null;
  availableTools: ToolName[] | undefined;
  stageTimings: AiAuditStageTimings;
  requestLogContext: AiLogContext;
  buildPromptContextFn: typeof buildPromptContext;
}

export interface InitChatHistorySlice {
  historyRows: HistoryRow[];
  systemPrompt: string;
  orgContextMessage: string | null | undefined;
  metadata: Awaited<ReturnType<typeof buildPromptContext>>["metadata"];
}

export async function runInitChatHistoryStage(
  input: InitChatHistoryInput,
): Promise<InitChatHistorySlice> {
  const contextBuildStartedAt = Date.now();
  const historyLoadStartedAt = Date.now();
  const historyPromise = input.existingThreadId
    ? Promise.resolve(
        input.ctx.supabase
          .from("ai_messages")
          .select("role, content")
          .eq("thread_id", input.threadId)
          .eq("status", "complete")
          .order("created_at", { ascending: true })
          .limit(20),
      )
        .then((result: { data: unknown; error: unknown }) => {
          setStageStatus(
            input.stageTimings,
            "history_load",
            result.error ? "failed" : "completed",
            Date.now() - historyLoadStartedAt,
          );
          return result;
        })
        .catch((error: unknown) => {
          setStageStatus(
            input.stageTimings,
            "history_load",
            "failed",
            Date.now() - historyLoadStartedAt,
          );
          throw error;
        })
    : Promise.resolve().then(() => {
        setStageStatus(
          input.stageTimings,
          "history_load",
          "completed",
          Date.now() - historyLoadStartedAt,
        );
        return {
          data: [
            {
              role: "user",
              content: input.promptSafeMessage,
            },
          ],
          error: null,
        };
      });

  const [contextResult, { data: history, error: historyError }] = await Promise.all([
    input
      .buildPromptContextFn({
        orgId: input.ctx.orgId,
        userId: input.ctx.userId,
        role: input.ctx.role,
        enterpriseId: input.ctx.enterpriseId,
        enterpriseRole: input.ctx.enterpriseRole,
        serviceSupabase: input.ctx.serviceSupabase,
        logContext: { ...input.requestLogContext, threadId: input.threadId },
        contextMode: input.usesSharedStaticContext
          ? "shared_static"
          : input.usesToolFirstContext
            ? "tool_first"
            : "full",
        surface: input.effectiveSurface,
        ragChunks: input.ragChunks.length > 0 ? input.ragChunks : undefined,
        now: input.requestNow,
        timeZone: input.requestTimeZone,
        currentPath: input.currentPath,
        routeEntity: input.routeEntityContext,
        availableTools: input.availableTools,
        threadTurnCount: input.existingThreadId ? 2 : 1,
      })
      .then((result: Awaited<ReturnType<typeof buildPromptContext>>) => {
        setStageStatus(
          input.stageTimings,
          "context_build",
          "completed",
          Date.now() - contextBuildStartedAt,
        );
        return result;
      })
      .catch((error: unknown) => {
        setStageStatus(
          input.stageTimings,
          "context_build",
          "failed",
          Date.now() - contextBuildStartedAt,
        );
        throw error;
      }),
    historyPromise,
  ]);

  let historyRows: HistoryRow[] = (history as HistoryRow[] | null) ?? [];
  if (historyError) {
    aiLog(
      "error",
      "ai-chat",
      "history fetch failed",
      { ...input.requestLogContext, threadId: input.threadId },
      { error: historyError },
    );
    historyRows = [{ role: "user", content: input.promptSafeMessage }];
  }

  return {
    historyRows,
    systemPrompt: contextResult.systemPrompt,
    orgContextMessage: contextResult.orgContextMessage,
    metadata: contextResult.metadata,
  };
}
