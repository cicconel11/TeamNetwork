/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  ToolCallRequestedEvent,
  ToolResultMessage,
} from "@/lib/ai/response-composer";
import type { ToolName } from "@/lib/ai/tools/definitions";
import type {
  executeToolCall,
  ToolExecutionAuthorization,
  ToolExecutionResult,
} from "@/lib/ai/tools/executor";
import type { SSEEvent } from "@/lib/ai/sse";
import type { SuccessfulToolSummary } from "@/lib/ai/grounding/tool/verifier";
import type { AiAuditStageTimings, AiToolAuthMode } from "@/lib/ai/chat-telemetry";
import { addToolCallTiming } from "@/lib/ai/chat-telemetry";
import type { EnterpriseRole } from "@/types/enterprise";
import type {
  DraftSessionRecord,
  DraftSessionType,
} from "@/lib/ai/draft-sessions";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import type { ChatAttachment } from "../shared";
import type { TurnRuntimeState } from "../sse-runtime";
import {
  extractCurrentMemberRouteId,
  type RouteEntityContext,
} from "@/lib/ai/route-entity";
import { getNonEmptyString } from "../formatters/index";
import {
  getToolNameForDraftType,
  mergeDraftPayload,
} from "../draft-session";
import {
  buildDiscussionReplyClarificationPayload,
  isChatRecipientDemonstrative,
  isDiscussionThreadDemonstrative,
  resolveDiscussionReplyTarget,
  type PendingActionToolPayload,
} from "../discussion-reply";
import {
  getBatchPendingActionsFromToolData,
  getPendingActionFromToolData,
} from "../pending-event-revision";
import type { saveDraftSession } from "@/lib/ai/draft-sessions";

export interface CreateToolCallHandlerInput {
  ctx: {
    orgId: string;
    userId: string;
    enterpriseId?: string;
    enterpriseRole?: EnterpriseRole;
    supabase: any;
    serviceSupabase: any;
  };
  toolAuthorization: ToolExecutionAuthorization;
  toolAuthMode: AiToolAuthMode;
  threadId: string | undefined;
  requestId: string;
  attachment: ChatAttachment | null | undefined;
  message: string;
  currentPath: string | null | undefined;
  routeEntityContext: RouteEntityContext | null;
  threadMetadata: { last_chat_recipient_member_id?: string | null };
  canUseDraftSessions: boolean;
  requestLogContext: AiLogContext;

  /** Mutable accumulators owned by orchestrator. */
  auditToolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  toolResults: ToolResultMessage[];
  successfulToolResults: SuccessfulToolSummary[];

  runtimeState: TurnRuntimeState;
  stageTimings: AiAuditStageTimings;

  enqueue: (event: SSEEvent) => void;

  /** Read+update active draft session. */
  getActiveDraftSession: () => DraftSessionRecord | null;
  setActiveDraftSession: (next: DraftSessionRecord | null) => void;

  /** Toggle the breaker flag (timeout) and terminate flag (auth/forbidden). */
  setToolPassBreakerOpen: (open: boolean) => void;
  isToolPassBreakerOpen: () => boolean;
  setTerminateTurn: () => void;

  executeToolCallFn: typeof executeToolCall;
  saveDraftSessionFn: typeof saveDraftSession;
}

/**
 * Build the onToolCall callback for runPass1. Exists as a factory so the
 * orchestrator keeps owning runtimeState / SSE enqueue / accumulators while
 * the per-tool handling body lives in a single dedicated module.
 *
 * Behavior is byte-identical to the previous inline implementation; SSE
 * snapshot suite is the regression gate.
 */
export function createToolCallHandler(input: CreateToolCallHandlerInput) {
  return async function onToolCall(
    toolEvent: ToolCallRequestedEvent,
  ): Promise<"continue" | "stop"> {
    input.runtimeState.toolCallMade = true;
    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = JSON.parse(toolEvent.argsJson);
    } catch {
      input.enqueue({
        type: "tool_status",
        toolName: toolEvent.name,
        status: "error",
      });
      input.auditToolCalls.push({ name: toolEvent.name, args: {} });
      addToolCallTiming(input.stageTimings, {
        name: toolEvent.name,
        status: "failed",
        duration_ms: 0,
        auth_mode: input.toolAuthMode,
        error_kind: "tool_error",
      });
      input.toolResults.push({
        toolCallId: toolEvent.id,
        name: toolEvent.name,
        args: {},
        data: { error: "Malformed tool arguments" },
      });
      return "continue";
    }

    const activeDraftSession = input.getActiveDraftSession();
    if (
      activeDraftSession &&
      toolEvent.name === getToolNameForDraftType(activeDraftSession.draft_type)
    ) {
      parsedArgs = mergeDraftPayload(
        activeDraftSession.draft_payload as Record<string, unknown>,
        parsedArgs,
      );
    }

    if (toolEvent.name === "prepare_chat_message") {
      const currentMemberRouteId =
        input.routeEntityContext?.kind === "member"
          ? input.routeEntityContext.id
          : extractCurrentMemberRouteId(input.currentPath ?? undefined);
      if (currentMemberRouteId && isChatRecipientDemonstrative(input.message)) {
        parsedArgs.recipient_member_id = currentMemberRouteId;
        delete parsedArgs.person_query;
      } else if (
        currentMemberRouteId &&
        getNonEmptyString(parsedArgs.recipient_member_id) == null &&
        getNonEmptyString(parsedArgs.person_query) == null
      ) {
        parsedArgs.recipient_member_id = currentMemberRouteId;
      } else if (
        input.threadMetadata.last_chat_recipient_member_id &&
        getNonEmptyString(parsedArgs.recipient_member_id) == null &&
        getNonEmptyString(parsedArgs.person_query) == null
      ) {
        parsedArgs.recipient_member_id =
          input.threadMetadata.last_chat_recipient_member_id;
      }
    }

    let syntheticToolResult: ToolExecutionResult | null = null;
    if (toolEvent.name === "prepare_discussion_reply") {
      const discussionThreadId = getNonEmptyString(parsedArgs.discussion_thread_id);
      const requestedThreadTitle = getNonEmptyString(parsedArgs.thread_title);
      const explicitNamedThreadTitle =
        requestedThreadTitle && !isDiscussionThreadDemonstrative(requestedThreadTitle)
          ? requestedThreadTitle
          : null;

      if (!discussionThreadId && explicitNamedThreadTitle) {
        const resolution = await resolveDiscussionReplyTarget(
          input.ctx.serviceSupabase as any,
          {
            organizationId: input.ctx.orgId,
            requestedThreadTitle: explicitNamedThreadTitle,
          },
        );

        if (resolution.kind === "resolved") {
          parsedArgs.discussion_thread_id = resolution.discussionThreadId;
          parsedArgs.thread_title =
            resolution.threadTitle ?? explicitNamedThreadTitle;
        } else {
          if (resolution.kind === "lookup_error") {
            aiLog(
              "warn",
              "ai-chat",
              "discussion thread title resolution failed",
              {
                ...input.requestLogContext,
                threadId: input.threadId ?? undefined,
              },
              { requestedThreadTitle: explicitNamedThreadTitle },
            );
          }
          syntheticToolResult = {
            kind: "ok",
            data: buildDiscussionReplyClarificationPayload(parsedArgs, resolution),
          };
        }
      } else if (
        input.routeEntityContext?.kind === "discussion_thread" &&
        !discussionThreadId
      ) {
        parsedArgs.discussion_thread_id = input.routeEntityContext.id;
        if (
          getNonEmptyString(parsedArgs.thread_title) == null &&
          input.routeEntityContext.displayName
        ) {
          parsedArgs.thread_title = input.routeEntityContext.displayName;
        }
      } else if (!discussionThreadId && !syntheticToolResult) {
        syntheticToolResult = {
          kind: "ok",
          data: buildDiscussionReplyClarificationPayload(parsedArgs, {
            kind: "thread_title_required",
          }),
        };
      }
    }

    input.auditToolCalls.push({ name: toolEvent.name, args: parsedArgs });

    if (input.isToolPassBreakerOpen()) {
      return "continue";
    }

    const toolStartedAt = Date.now();
    let result: ToolExecutionResult;
    if (syntheticToolResult) {
      result = syntheticToolResult;
    } else {
      input.enqueue({
        type: "tool_status",
        toolName: toolEvent.name,
        status: "calling",
      });

      const activePendingActionId =
        toolEvent.name.startsWith("prepare_") &&
        activeDraftSession?.pending_action_id
          ? activeDraftSession.pending_action_id
          : null;

      result = await input.executeToolCallFn(
        {
          orgId: input.ctx.orgId,
          userId: input.ctx.userId,
          enterpriseId: input.ctx.enterpriseId,
          enterpriseRole: input.ctx.enterpriseRole,
          supabase: input.ctx.supabase,
          serviceSupabase: input.ctx.serviceSupabase,
          authorization: input.toolAuthorization,
          threadId: input.threadId,
          requestId: input.requestId,
          attachment: input.attachment ?? undefined,
          activePendingActionId,
        },
        { name: toolEvent.name, args: parsedArgs },
      );
    }

    switch (result.kind) {
      case "ok":
        if (
          input.canUseDraftSessions &&
          (toolEvent.name === "prepare_announcement" ||
            toolEvent.name === "prepare_job_posting" ||
            toolEvent.name === "prepare_chat_message" ||
            toolEvent.name === "prepare_group_message" ||
            toolEvent.name === "prepare_discussion_reply" ||
            toolEvent.name === "prepare_discussion_thread" ||
            toolEvent.name === "prepare_event") &&
          result.data &&
          typeof result.data === "object"
        ) {
          const toolData = result.data as PendingActionToolPayload;
          if (
            toolData.state === "missing_fields" ||
            toolData.state === "needs_confirmation"
          ) {
            const missingFields = Array.isArray(toolData.missing_fields)
              ? toolData.missing_fields.filter(
                  (field): field is string =>
                    typeof field === "string" && field.length > 0,
                )
              : [];
            const pendingActionId =
              toolData.pending_action &&
              typeof toolData.pending_action === "object" &&
              typeof toolData.pending_action.id === "string"
                ? toolData.pending_action.id
                : null;
            const pendingExpiresAt =
              toolData.pending_action &&
              typeof toolData.pending_action === "object" &&
              typeof toolData.pending_action.expires_at === "string"
                ? toolData.pending_action.expires_at
                : undefined;

            try {
              const draftType: DraftSessionType =
                toolEvent.name === "prepare_announcement"
                  ? "create_announcement"
                  : toolEvent.name === "prepare_job_posting"
                  ? "create_job_posting"
                  : toolEvent.name === "prepare_chat_message"
                  ? "send_chat_message"
                  : toolEvent.name === "prepare_group_message"
                  ? "send_group_chat_message"
                  : toolEvent.name === "prepare_discussion_reply"
                  ? "create_discussion_reply"
                  : toolEvent.name === "prepare_discussion_thread"
                  ? "create_discussion_thread"
                  : "create_event";
              const next = await input.saveDraftSessionFn(
                input.ctx.serviceSupabase,
                {
                  organizationId: input.ctx.orgId,
                  userId: input.ctx.userId,
                  threadId: input.threadId!,
                  draftType,
                  status:
                    toolData.state === "needs_confirmation"
                      ? "ready_for_confirmation"
                      : "collecting_fields",
                  draftPayload:
                    toolData.draft && typeof toolData.draft === "object"
                      ? (toolData.draft as any)
                      : (parsedArgs as any),
                  missingFields,
                  pendingActionId,
                  expiresAt: pendingExpiresAt ?? undefined,
                },
              );
              input.setActiveDraftSession(next);
            } catch (error) {
              input.setActiveDraftSession(null);
              aiLog(
                "warn",
                "ai-chat",
                "failed to persist draft session; continuing without it",
                {
                  ...input.requestLogContext,
                  threadId: input.threadId!,
                },
                { error, toolName: toolEvent.name },
              );
            }
          }
        }

        addToolCallTiming(input.stageTimings, {
          name: toolEvent.name,
          status: "completed",
          duration_ms: Date.now() - toolStartedAt,
          auth_mode: input.toolAuthMode,
        });
        input.enqueue({
          type: "tool_status",
          toolName: toolEvent.name,
          status: "done",
        });
        input.runtimeState.toolCallSucceeded = true;
        input.toolResults.push({
          toolCallId: toolEvent.id,
          name: toolEvent.name,
          args: parsedArgs,
          data: result.data,
        });
        const pendingAction = getPendingActionFromToolData(result.data);
        if (pendingAction) {
          if (pendingAction.reviseCount !== null) {
            input.enqueue({
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
            input.enqueue({
              type: "pending_action",
              actionId: pendingAction.actionId,
              actionType: pendingAction.actionType,
              summary: pendingAction.summary,
              payload: pendingAction.payload,
              expiresAt: pendingAction.expiresAt,
            });
          }
        } else {
          const batchActions = getBatchPendingActionsFromToolData(result.data);
          if (batchActions) {
            input.enqueue({
              type: "pending_actions_batch",
              actions: batchActions,
            });
          }
        }
        input.successfulToolResults.push({
          name: toolEvent.name as ToolName,
          data: result.data,
        });
        return "continue";
      case "tool_error":
        addToolCallTiming(input.stageTimings, {
          name: toolEvent.name,
          status: "failed",
          duration_ms: Date.now() - toolStartedAt,
          auth_mode: input.toolAuthMode,
          error_kind: "tool_error",
        });
        input.enqueue({
          type: "tool_status",
          toolName: toolEvent.name,
          status: "error",
        });
        input.toolResults.push({
          toolCallId: toolEvent.id,
          name: toolEvent.name,
          args: parsedArgs,
          data: {
            error: result.error,
            error_code: result.code,
          },
        });
        return "continue";
      case "timeout":
        addToolCallTiming(input.stageTimings, {
          name: toolEvent.name,
          status: "timed_out",
          duration_ms: Date.now() - toolStartedAt,
          auth_mode: input.toolAuthMode,
          error_kind: "timeout",
        });
        input.enqueue({
          type: "tool_status",
          toolName: toolEvent.name,
          status: "error",
        });
        input.toolResults.push({
          toolCallId: toolEvent.id,
          name: toolEvent.name,
          args: parsedArgs,
          data: { error: result.error },
        });
        input.setToolPassBreakerOpen(true);
        return "continue";
      case "forbidden":
      case "auth_error":
        addToolCallTiming(input.stageTimings, {
          name: toolEvent.name,
          status: "failed",
          duration_ms: Date.now() - toolStartedAt,
          auth_mode: input.toolAuthMode,
          error_kind: result.kind,
        });
        input.enqueue({
          type: "tool_status",
          toolName: toolEvent.name,
          status: "error",
        });
        input.runtimeState.auditErrorMessage = `tool_${toolEvent.name}:${result.kind}`;
        input.setTerminateTurn();
        input.enqueue({
          type: "error",
          message:
            result.kind === "forbidden"
              ? "Your access to AI tools for this organization has changed."
              : "Unable to verify access to AI tools right now.",
          retryable: false,
        });
        return "stop";
    }
  };
}
