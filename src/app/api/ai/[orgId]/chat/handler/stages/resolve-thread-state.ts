/**
 * Thread-resolution sub-stage of thread-idempotency.
 *
 * Owns the `if (threadId) { ... }` block:
 *   - resolveOwnThread + 403/404 short-circuit
 *   - draft-session load (with expired-cleanup, history-inferred drafts)
 *   - pending-event action revision context
 *
 * Returns a state slice the parent stage merges into its locals.
 * Pure mechanical lift — same DB calls, same error flow, same logging.
 */
import { NextResponse } from "next/server";
import type { AiOrgContext } from "@/lib/ai/context";
import type {
  AiThreadMetadata,
  resolveOwnThread,
} from "@/lib/ai/thread-resolver";
import {
  clearDraftSession as clearDraftSessionDefault,
  getDraftSession as getDraftSessionDefault,
  isDraftSessionExpired,
  type DraftSessionRecord,
  type DraftSessionSupabase,
} from "@/lib/ai/draft-sessions";
import { filterAllowedTools } from "@/lib/ai/access-policy";
import { AI_TOOL_MAP, type ToolName } from "@/lib/ai/tools/definitions";
import { sanitizeHistoryMessageForPrompt } from "@/lib/ai/message-safety";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import { runTimedStage, type AiAuditStageTimings } from "@/lib/ai/chat-telemetry";
import {
  getToolNameForDraftType,
  inferDraftSessionFromHistory,
  shouldContinueDraftSession,
} from "../draft-session";
import {
  listPendingEventActionsForThread,
  resolvePendingEventRevisionAnalysis,
  type PendingEventActionRecord,
  type PendingEventRevisionAnalysis,
} from "../pending-event-revision";
import type { getPass1Tools } from "../pass1-tools";

export interface ResolveThreadStateInput {
  ctx: Extract<AiOrgContext, { ok: true }>;
  threadId: string;
  rateLimit: { headers: Record<string, string> | undefined };
  requestLogContext: AiLogContext;
  canUseDraftSessions: boolean;
  stageTimings: AiAuditStageTimings;
  attachment: unknown;
  messageSafetyPromptSafeMessage: string;
  routing: Parameters<typeof shouldContinueDraftSession>[2];
  pass1Tools: ReturnType<typeof getPass1Tools>;
  resolveOwnThreadFn: typeof resolveOwnThread;
  getDraftSessionFn: typeof getDraftSessionDefault;
  clearDraftSessionFn: typeof clearDraftSessionDefault;
}

export interface ResolveThreadStateSlice {
  threadMetadata: AiThreadMetadata;
  activeDraftSession: DraftSessionRecord | null;
  activePendingEventActions: PendingEventActionRecord[];
  pendingEventRevisionAnalysis: PendingEventRevisionAnalysis;
  pass1Tools: ReturnType<typeof getPass1Tools>;
}

export type ResolveThreadStateOutcome =
  | { ok: true; value: ResolveThreadStateSlice }
  | { ok: false; response: NextResponse };

export async function resolveThreadState(
  input: ResolveThreadStateInput,
): Promise<ResolveThreadStateOutcome> {
  const {
    ctx,
    threadId,
    rateLimit,
    requestLogContext,
    canUseDraftSessions,
    stageTimings,
    attachment,
    messageSafetyPromptSafeMessage,
    routing,
    resolveOwnThreadFn,
    getDraftSessionFn,
    clearDraftSessionFn,
  } = input;

  let pass1Tools = input.pass1Tools;
  let threadMetadata: AiThreadMetadata = {};
  let activeDraftSession: DraftSessionRecord | null = null;
  let activePendingEventActions: PendingEventActionRecord[] = [];
  let pendingEventRevisionAnalysis: PendingEventRevisionAnalysis = { kind: "none" };

  const resolution = await runTimedStage(
    stageTimings,
    "thread_resolution",
    async () =>
      resolveOwnThreadFn(
        threadId,
        ctx.userId,
        ctx.orgId,
        ctx.serviceSupabase,
        { ...requestLogContext, threadId },
      ),
  );
  if (!resolution.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: resolution.message },
        { status: resolution.status, headers: rateLimit.headers },
      ),
    };
  }
  threadMetadata = resolution.thread.metadata;

  if (canUseDraftSessions) {
    try {
      activeDraftSession = await getDraftSessionFn(ctx.serviceSupabase as unknown as DraftSessionSupabase, {
        organizationId: ctx.orgId,
        userId: ctx.userId,
        threadId,
      });

      if (activeDraftSession && isDraftSessionExpired(activeDraftSession)) {
        try {
          await clearDraftSessionFn(ctx.serviceSupabase as unknown as DraftSessionSupabase, {
            organizationId: ctx.orgId,
            userId: ctx.userId,
            threadId,
            pendingActionId: activeDraftSession.pending_action_id,
          });
        } catch (error) {
          aiLog("warn", "ai-chat", "failed to clear expired draft session", {
            ...requestLogContext,
            threadId,
          }, { error });
        }
        activeDraftSession = null;
      }

      if (activeDraftSession) {
        if (
          shouldContinueDraftSession(
            messageSafetyPromptSafeMessage,
            activeDraftSession,
            routing,
          )
        ) {
          pass1Tools = filterAllowedTools(
            [AI_TOOL_MAP[getToolNameForDraftType(activeDraftSession.draft_type) as ToolName]],
            {
              role: ctx.role,
              enterpriseRole: ctx.enterpriseRole,
            },
          );
        } else {
          try {
            await clearDraftSessionFn(ctx.serviceSupabase as unknown as DraftSessionSupabase, {
              organizationId: ctx.orgId,
              userId: ctx.userId,
              threadId,
              pendingActionId: activeDraftSession.pending_action_id,
            });
          } catch (error) {
            aiLog("warn", "ai-chat", "failed to clear abandoned draft session", {
              ...requestLogContext,
              threadId,
            }, { error });
          }
          activeDraftSession = null;
        }
      }
    } catch (error) {
      activeDraftSession = null;
      aiLog("warn", "ai-chat", "failed to load draft session; continuing without it", {
        ...requestLogContext,
        threadId,
      }, { error });
    }

    if (!activeDraftSession) {
      try {
        const { data: draftHistory, error: draftHistoryError } = await ctx.supabase
          .from("ai_messages")
          .select("role, content")
          .eq("thread_id", threadId)
          .eq("status", "complete")
          .order("created_at", { ascending: true })
          .limit(12);

        if (draftHistoryError) {
          aiLog("warn", "ai-chat", "failed to load thread history for draft inference", {
            ...requestLogContext,
            threadId,
          }, { error: draftHistoryError });
        } else {
          const inferredDraftSession = inferDraftSessionFromHistory({
            organizationId: ctx.orgId,
            userId: ctx.userId,
            threadId,
            messages: (draftHistory ?? [])
              .filter(
                (row: { role: unknown; content: unknown }): row is { role: "user" | "assistant"; content: string } =>
                  (row?.role === "user" || row?.role === "assistant") &&
                  typeof row?.content === "string" &&
                  row.content.trim().length > 0,
              )
              .map((row: { role: "user" | "assistant"; content: string }) => ({
                role: row.role,
                content:
                  row.role === "user"
                    ? sanitizeHistoryMessageForPrompt(row.content).promptSafeMessage
                    : row.content,
              })),
          });

          if (
            inferredDraftSession &&
            shouldContinueDraftSession(
              messageSafetyPromptSafeMessage,
              inferredDraftSession,
              routing,
            )
          ) {
            activeDraftSession = inferredDraftSession;
            pass1Tools = filterAllowedTools(
              [AI_TOOL_MAP[getToolNameForDraftType(inferredDraftSession.draft_type) as ToolName]],
              {
                role: ctx.role,
                enterpriseRole: ctx.enterpriseRole,
              },
            );
          }
        }
      } catch (error) {
        aiLog("warn", "ai-chat", "failed to infer draft session from thread history", {
          ...requestLogContext,
          threadId,
        }, { error });
      }
    }
  }

  if (
    !attachment &&
    !activeDraftSession &&
    ctx.serviceSupabase &&
    typeof (ctx.serviceSupabase as { from?: unknown }).from === "function"
  ) {
    try {
      activePendingEventActions = await listPendingEventActionsForThread(ctx.serviceSupabase, {
        organizationId: ctx.orgId,
        userId: ctx.userId,
        threadId,
      });
      pendingEventRevisionAnalysis = resolvePendingEventRevisionAnalysis(
        messageSafetyPromptSafeMessage,
        activePendingEventActions,
      );
    } catch (error) {
      activePendingEventActions = [];
      pendingEventRevisionAnalysis = { kind: "none" };
      aiLog("warn", "ai-chat", "failed to load pending event actions; continuing without revision support", {
        ...requestLogContext,
        threadId,
      }, { error });
    }
  }

  return {
    ok: true,
    value: {
      threadMetadata,
      activeDraftSession,
      activePendingEventActions,
      pendingEventRevisionAnalysis,
      pass1Tools,
    },
  };
}
