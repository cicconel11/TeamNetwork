import type { ServerSupabase, ServiceSupabase } from "@/lib/supabase/types";
import type { ToolName } from "@/lib/ai/tools/definitions";
import type {
  executeToolCall,
  ToolExecutionAuthorization,
} from "@/lib/ai/tools/executor";
import type { SSEEvent, CacheStatus } from "@/lib/ai/sse";
import type { SuccessfulToolSummary } from "@/lib/ai/grounding/tool/verifier";
import type {
  AiAuditStageTimings,
  AiToolAuthMode,
} from "@/lib/ai/chat-telemetry";
import { addToolCallTiming, skipStage } from "@/lib/ai/chat-telemetry";
import type { EnterpriseRole } from "@/types/enterprise";
import type { ChatAttachment } from "../shared";
import type { TurnRuntimeState } from "../sse-runtime";
import {
  buildPrepareEventArgsFromPendingAction,
  getPendingActionFromToolData,
  SUPPORTED_EVENT_TYPE_LABELS,
  type PendingEventActionRecord,
  type PendingEventRevisionAnalysis,
} from "../pending-event-revision";
import { mergeDraftPayload } from "../draft-session";
import { formatRevisedPendingEventResponse } from "../formatters/index";

export interface RunPendingEventRevisionInput {
  pendingEventRevisionAnalysis: PendingEventRevisionAnalysis;
  activePendingEventActions: PendingEventActionRecord[];

  ctx: {
    orgId: string;
    userId: string;
    enterpriseId?: string;
    enterpriseRole?: EnterpriseRole;
    supabase: ServerSupabase;
    serviceSupabase: ServiceSupabase;
  };
  toolAuthorization: ToolExecutionAuthorization;
  toolAuthMode: AiToolAuthMode;
  threadId: string;
  requestId: string;
  attachment: ChatAttachment | null | undefined;

  cacheStatus: CacheStatus;
  cacheEntryId: string | null | undefined;
  cacheBypassReason: string | null | undefined;

  runtimeState: TurnRuntimeState;
  stageTimings: AiAuditStageTimings;
  auditToolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  successfulToolResults: SuccessfulToolSummary[];

  enqueue: (event: SSEEvent) => void;

  executeToolCallFn: typeof executeToolCall;
}

export interface RunPendingEventRevisionOutcome {
  /** "handled" => caller must return without further work; fullContent is set. */
  status: "handled" | "passthrough";
  fullContent: string;
}

const PASSTHROUGH: RunPendingEventRevisionOutcome = {
  status: "passthrough",
  fullContent: "",
};

function skipPipelineStages(stageTimings: AiAuditStageTimings) {
  skipStage(stageTimings, "history_load");
  skipStage(stageTimings, "context_build");
  skipStage(stageTimings, "pass1_model");
  skipStage(stageTimings, "pass2");
  skipStage(stageTimings, "grounding");
}

/**
 * Handle the pending-event revision branch. Three terminal sub-cases:
 * 1. clarify        — model asked the user to clarify; emit message + done.
 * 2. unsupported    — requested event type not supported; emit guidance + done.
 * 3. apply (single) — execute prepare_event under existing pending row; emit
 *                     pending_action(_updated) + revised summary + done.
 *
 * Returns "passthrough" when no branch applies and the normal pipeline should
 * run. Caller must return without doing anything else when status is "handled".
 */
export async function runPendingEventRevision(
  input: RunPendingEventRevisionInput,
): Promise<RunPendingEventRevisionOutcome> {
  const {
    pendingEventRevisionAnalysis,
    activePendingEventActions,
    ctx,
    toolAuthorization,
    toolAuthMode,
    threadId,
    requestId,
    attachment,
    cacheStatus,
    cacheEntryId,
    cacheBypassReason,
    runtimeState,
    stageTimings,
    auditToolCalls,
    successfulToolResults,
    enqueue,
    executeToolCallFn,
  } = input;

  if (pendingEventRevisionAnalysis.kind === "clarify") {
    skipPipelineStages(stageTimings);
    const fullContent = pendingEventRevisionAnalysis.message;
    enqueue({ type: "chunk", content: fullContent });
    enqueue({
      type: "done",
      threadId,
      cache: {
        status: cacheStatus,
        ...(cacheEntryId ? { entryId: cacheEntryId } : {}),
        ...(cacheBypassReason ? { bypassReason: cacheBypassReason } : {}),
      },
    });
    runtimeState.streamCompletedSuccessfully = true;
    return { status: "handled", fullContent };
  }

  if (pendingEventRevisionAnalysis.kind === "unsupported_event_type") {
    skipPipelineStages(stageTimings);
    const fullContent =
      `I can revise the drafted schedule before confirmation, but "${pendingEventRevisionAnalysis.requestedType}" isn't a supported event type yet. ` +
      `Use one of: ${SUPPORTED_EVENT_TYPE_LABELS.join(", ")}.`;
    enqueue({ type: "chunk", content: fullContent });
    enqueue({
      type: "done",
      threadId,
      cache: {
        status: cacheStatus,
        ...(cacheEntryId ? { entryId: cacheEntryId } : {}),
        ...(cacheBypassReason ? { bypassReason: cacheBypassReason } : {}),
      },
    });
    runtimeState.streamCompletedSuccessfully = true;
    return { status: "handled", fullContent };
  }

  if (
    pendingEventRevisionAnalysis.kind === "apply" &&
    activePendingEventActions.length > 0
  ) {
    skipPipelineStages(stageTimings);

    const revisedEvents = activePendingEventActions.map((action, index) =>
      pendingEventRevisionAnalysis.targetIndexes.includes(index)
        ? mergeDraftPayload(
            buildPrepareEventArgsFromPendingAction(action),
            pendingEventRevisionAnalysis.overrides,
          )
        : buildPrepareEventArgsFromPendingAction(action),
    );
    const revisionToolName: ToolName =
      revisedEvents.length > 1 ? "prepare_events_batch" : "prepare_event";
    const revisionArgs =
      revisedEvents.length > 1 ? { events: revisedEvents } : revisedEvents[0];

    runtimeState.toolCallMade = true;
    auditToolCalls.push({ name: revisionToolName, args: revisionArgs });
    enqueue({ type: "tool_status", toolName: revisionToolName, status: "calling" });

    const toolStartedAt = Date.now();

    // Batch revisions (>1 active event) cannot preserve the per-row revise
    // cap because prepare_events_batch / buildPendingEventBatchFromDrafts
    // mints fresh rows in a loop. Reject explicitly so the user confirms
    // or cancels the existing batch instead of silently bypassing the cap.
    if (activePendingEventActions.length > 1) {
      addToolCallTiming(stageTimings, {
        name: revisionToolName,
        status: "failed",
        duration_ms: Date.now() - toolStartedAt,
        auth_mode: toolAuthMode,
        error_kind: "tool_error",
      });
      enqueue({ type: "tool_status", toolName: revisionToolName, status: "error" });
      enqueue({
        type: "error",
        message:
          "I can't revise a multi-event draft in place. Please confirm or cancel the current pending events, then ask again with the changes you want.",
        retryable: false,
      });
      return { status: "handled", fullContent: "" };
    }

    // Single-event revise: pass activePendingActionId so the executor's
    // createOrRevisePendingAction revises the existing row under the
    // 3-loop cap instead of minting a fresh one.
    const revisionResult = await executeToolCallFn(
      {
        orgId: ctx.orgId,
        userId: ctx.userId,
        enterpriseId: ctx.enterpriseId,
        enterpriseRole: ctx.enterpriseRole,
        supabase: ctx.supabase,
        serviceSupabase: ctx.serviceSupabase,
        authorization: toolAuthorization,
        threadId,
        requestId,
        attachment: attachment ?? undefined,
        activePendingActionId: activePendingEventActions[0].id,
      },
      {
        name: revisionToolName,
        args: revisionArgs,
      },
    );

    if (revisionResult.kind !== "ok") {
      addToolCallTiming(stageTimings, {
        name: revisionToolName,
        status: revisionResult.kind === "timeout" ? "timed_out" : "failed",
        duration_ms: Date.now() - toolStartedAt,
        auth_mode: toolAuthMode,
        error_kind: revisionResult.kind === "timeout" ? "timeout" : "tool_error",
      });
      enqueue({ type: "tool_status", toolName: revisionToolName, status: "error" });
      enqueue({
        type: "error",
        message:
          revisionResult.kind === "timeout"
            ? "Updating the drafted schedule timed out. Please try again."
            : revisionResult.error,
        retryable: revisionResult.kind === "timeout",
      });
      return { status: "handled", fullContent: "" };
    }

    addToolCallTiming(stageTimings, {
      name: revisionToolName,
      status: "completed",
      duration_ms: Date.now() - toolStartedAt,
      auth_mode: toolAuthMode,
    });
    enqueue({ type: "tool_status", toolName: revisionToolName, status: "done" });
    runtimeState.toolCallSucceeded = true;
    successfulToolResults.push({
      name: revisionToolName,
      data: revisionResult.data,
    });

    const pendingAction = getPendingActionFromToolData(revisionResult.data);
    if (pendingAction) {
      if (pendingAction.reviseCount !== null) {
        enqueue({
          type: "pending_action_updated",
          actionId: pendingAction.actionId,
          actionType: pendingAction.actionType,
          summary: pendingAction.summary,
          payload: pendingAction.payload,
          previousPayload: pendingAction.previousPayload,
          reviseCount: pendingAction.reviseCount,
          expiresAt: pendingAction.expiresAt,
        });
      } else {
        enqueue({
          type: "pending_action",
          actionId: pendingAction.actionId,
          actionType: pendingAction.actionType,
          summary: pendingAction.summary,
          payload: pendingAction.payload,
          expiresAt: pendingAction.expiresAt,
        });
      }
    }

    const fullContent =
      formatRevisedPendingEventResponse(revisionResult.data, revisedEvents.length) ??
      "I revised the drafted schedule. Review the updated details below and confirm when you're ready.";
    enqueue({ type: "chunk", content: fullContent });
    enqueue({
      type: "done",
      threadId,
      cache: {
        status: cacheStatus,
        ...(cacheEntryId ? { entryId: cacheEntryId } : {}),
        ...(cacheBypassReason ? { bypassReason: cacheBypassReason } : {}),
      },
    });
    runtimeState.streamCompletedSuccessfully = true;
    return { status: "handled", fullContent };
  }

  return PASSTHROUGH;
}
