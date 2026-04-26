import type OpenAI from "openai";
import type { ServerSupabase, ServiceSupabase } from "@/lib/supabase/types";
import type {
  composeResponse,
  ToolResultMessage,
} from "@/lib/ai/response-composer";
import type { SSEEvent } from "@/lib/ai/sse";
import type {
  AiAuditStageTimings,
  AiToolAuthMode,
} from "@/lib/ai/chat-telemetry";
import { skipStage } from "@/lib/ai/chat-telemetry";
import type { AiLogContext } from "@/lib/ai/logger";
import type {
  executeToolCall,
  ToolExecutionAuthorization,
} from "@/lib/ai/tools/executor";
import type {
  SuccessfulToolSummary,
  verifyToolBackedResponse,
} from "@/lib/ai/grounding/tool/verifier";
import type { TurnExecutionPolicy } from "@/lib/ai/turn-execution-policy";
import type { trackOpsEventServer } from "@/lib/analytics/events-server";
import type { EnterpriseRole } from "@/types/enterprise";
import type {
  DraftSessionRecord,
  saveDraftSession,
} from "@/lib/ai/draft-sessions";
import type { ChatAttachment } from "../shared";
import type { TurnRuntimeState } from "../sse-runtime";
import {
  CONNECTION_PASS2_TEMPLATE,
  formatDeterministicToolResponse,
  formatDeterministicToolErrorResponse,
  resolveHideDonorNamesPreference,
  resolveOrgSlug,
} from "../formatters/index";
import { MEMBER_ROSTER_PROMPT_PATTERN, canBypassPass1 } from "../pass1-tools";
import { runPass1Bypass } from "./run-pass1-bypass";
import type { PendingEventRevisionAnalysis } from "../pending-event-revision";
import {
  MEMBER_LIST_PASS2_INSTRUCTION,
  MENTOR_PASS2_TEMPLATE,
} from "../sse-runtime";
import type { RouteEntityContext } from "@/lib/ai/route-entity";
import { runPass1 } from "./run-pass1";
import { runPass2 } from "./run-pass2";
import { runGroundingCheck } from "./run-grounding-check";
import { createToolCallHandler } from "./run-tool-calls";

export const PASS2_ANSWER_NARROWNESS_INSTRUCTION =
  "Answer narrowness: only mention the specific slice of tool data the user asked about. If they asked for a single number (e.g., 'how many active members'), return one short sentence with that number — do not enumerate other categories. If they asked for a single dimension (e.g., 'donation trends by month'), report only that dimension — do not lead with totals, averages, or top purposes. Mention other slices only when the user explicitly asked for the full picture.";

export interface RunModelToolsLoopInput {
  client: OpenAI;
  systemPrompt: string;
  effectivePass1SystemPrompt: string;
  contextMessages: OpenAI.Chat.ChatCompletionMessageParam[];
  pass1Tools: OpenAI.Chat.ChatCompletionTool[] | undefined;
  pass1ToolChoice: OpenAI.Chat.ChatCompletionToolChoiceOption | undefined;

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
  assistantMessageId: string;
  requestId: string;
  attachment: ChatAttachment | null | undefined;
  message: string;
  promptSafeMessage: string;
  currentPath: string | null | undefined;
  routeEntityContext: RouteEntityContext | null;
  threadMetadata: { last_chat_recipient_member_id?: string | null };
  canUseDraftSessions: boolean;
  executionPolicy: TurnExecutionPolicy;
  requestLogContext: AiLogContext;

  /** Pass-1 bypass flag mode (env-snapshot). */
  pass1BypassMode: "off" | "shadow" | "on";
  /** Pending-event-revision analysis (drives bypass suppression). */
  pendingEventRevisionAnalysis: PendingEventRevisionAnalysis | null;
  /** True when the latest user message is a connection-disambiguation reply. */
  pendingConnectionDisambiguation: boolean;

  /** Mutable accumulators owned by orchestrator (read after loop returns). */
  auditToolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  successfulToolResults: SuccessfulToolSummary[];

  runtimeState: TurnRuntimeState;
  stageTimings: AiAuditStageTimings;
  streamSignal: AbortSignal;

  enqueue: (event: SSEEvent) => void;
  recordUsage: (usage: { inputTokens: number; outputTokens: number }) => void;
  emitTimeoutError: () => void;

  /** Active draft session getter/setter (orchestrator owns the cell). */
  getActiveDraftSession: () => DraftSessionRecord | null;
  setActiveDraftSession: (next: DraftSessionRecord | null) => void;

  /** Tool-pass breaker / terminate flags (orchestrator owns the cells). */
  isToolPassBreakerOpen: () => boolean;
  setToolPassBreakerOpen: (open: boolean) => void;
  isTerminateTurn: () => boolean;
  setTerminateTurn: () => void;

  /** Closure-built turn-scoped gates. */
  applyTurnRagGrounding: (buffered: string) => Promise<string>;
  applyTurnSafetyGate: (buffered: string) => Promise<string>;

  /** Injected dependencies. */
  composeResponseFn: typeof composeResponse;
  executeToolCallFn: typeof executeToolCall;
  saveDraftSessionFn: typeof saveDraftSession;
  verifyToolBackedResponseFn: typeof verifyToolBackedResponse;
  trackOpsEventServerFn: typeof trackOpsEventServer;
}

export interface RunModelToolsLoopOutcome {
  fullContent: string;
  /** True if pass1 completed (tool-loop ran to natural finish). False on
   *  early termination — caller should `return` without emitting `done`. */
  completed: boolean;
}

/**
 * Run pass1 → tool-call serial loop → pass2 → grounding. Mirrors the previous
 * inline orchestration block byte-for-byte (covered by the SSE snapshot suite).
 *
 * Side-effects:
 * - Mutates `runtimeState` (toolCallMade, auditErrorMessage, etc.).
 * - Pushes onto `successfulToolResults` + `auditToolCalls` via the tool-call
 *   handler.
 * - Enqueues SSE events via `enqueue` (chunks, tool_status, errors).
 *
 * Returns `{ fullContent, completed }`. Caller is responsible for the empty-
 * response fallback chunk and the `done` event.
 */
export async function runModelToolsLoop(
  input: RunModelToolsLoopInput,
): Promise<RunModelToolsLoopOutcome> {
  let fullContent = "";
  let pass1BufferedContent = "";
  let pass2BufferedContent = "";

  const toolResults: ToolResultMessage[] = [];

  const onToolCall = createToolCallHandler({
    ctx: input.ctx,
    toolAuthorization: input.toolAuthorization,
    toolAuthMode: input.toolAuthMode,
    threadId: input.threadId,
    requestId: input.requestId,
    attachment: input.attachment,
    message: input.message,
    currentPath: input.currentPath,
    routeEntityContext: input.routeEntityContext,
    threadMetadata: input.threadMetadata,
    canUseDraftSessions: input.canUseDraftSessions,
    requestLogContext: input.requestLogContext,
    auditToolCalls: input.auditToolCalls,
    toolResults,
    successfulToolResults: input.successfulToolResults,
    runtimeState: input.runtimeState,
    stageTimings: input.stageTimings,
    enqueue: input.enqueue,
    getActiveDraftSession: input.getActiveDraftSession,
    setActiveDraftSession: input.setActiveDraftSession,
    isToolPassBreakerOpen: input.isToolPassBreakerOpen,
    setToolPassBreakerOpen: input.setToolPassBreakerOpen,
    setTerminateTurn: input.setTerminateTurn,
    executeToolCallFn: input.executeToolCallFn,
    saveDraftSessionFn: input.saveDraftSessionFn,
  });

  const forcedFirstTool =
    input.pass1Tools && input.pass1Tools.length === 1 && input.pass1ToolChoice
      ? input.pass1Tools[0]
      : null;
  const forcedSingleToolName =
    forcedFirstTool && "function" in forcedFirstTool
      ? forcedFirstTool.function.name
      : null;
  if (forcedSingleToolName) {
    input.enqueue({
      type: "tool_status",
      toolName: forcedSingleToolName,
      status: "calling",
    });
    input.runtimeState.eagerStatusEmittedFor.add(forcedSingleToolName);
  }

  const clearUnclaimedEagerStatus = () => {
    if (!forcedSingleToolName) return;
    if (!input.runtimeState.eagerStatusEmittedFor.has(forcedSingleToolName)) return;
    input.runtimeState.eagerStatusEmittedFor.delete(forcedSingleToolName);
    if (!input.runtimeState.toolCallMade) {
      input.enqueue({
        type: "tool_status",
        toolName: forcedSingleToolName,
        status: "error",
      });
    }
  };

  const bypassEligible =
    forcedSingleToolName != null &&
    canBypassPass1({
      pass1Tools: input.pass1Tools,
      pass1ToolChoice: input.pass1ToolChoice,
      activeDraftSession: input.getActiveDraftSession(),
      pendingEventRevisionAnalysis: input.pendingEventRevisionAnalysis,
      pendingConnectionDisambiguation: input.pendingConnectionDisambiguation,
      attachment: input.attachment,
      executionPolicy: input.executionPolicy,
    });

  const usingBypass = bypassEligible && input.pass1BypassMode === "on";

  if (!usingBypass) {
    input.stageTimings.request.pass1_path =
      bypassEligible && input.pass1BypassMode === "shadow"
        ? "model_shadow_bypass_eligible"
        : "model";
  }

  if (usingBypass) {
    const bypassOutcome = await runPass1Bypass({
      toolName: forcedSingleToolName!,
      message: input.message,
      requestId: input.requestId,
      stageTimings: input.stageTimings,
      onToolCall,
    });

    if (input.isTerminateTurn() || bypassOutcome.callOutcome === "stop") {
      if (!input.runtimeState.toolCallMade) {
        skipStage(input.stageTimings, "tools");
      }
      clearUnclaimedEagerStatus();
      return { fullContent, completed: false };
    }
  } else {
    const pass1Outcome = await runPass1({
      client: input.client,
      systemPrompt: input.effectivePass1SystemPrompt,
      messages: input.contextMessages,
      tools: input.pass1Tools,
      toolChoice: input.pass1ToolChoice,
      composeResponseFn: input.composeResponseFn,
      stageTimings: input.stageTimings,
      streamSignal: input.streamSignal,
      threadId: input.threadId,
      requestLogContext: input.requestLogContext,
      runtimeState: input.runtimeState,
      emitTimeoutError: input.emitTimeoutError,
      onUsage: input.recordUsage,
      onChunk: (content) => {
        pass1BufferedContent += content;
      },
      onError: (event) => {
        input.runtimeState.auditErrorMessage = event.message;
        input.enqueue(event);
      },
      onToolCall,
    });

    if (input.isTerminateTurn() || pass1Outcome !== "completed") {
      if (!input.runtimeState.toolCallMade) {
        skipStage(input.stageTimings, "tools");
      }
      clearUnclaimedEagerStatus();
      return { fullContent, completed: false };
    }
  }

  clearUnclaimedEagerStatus();
  // Clear eager-emit set so subsequent tool-loop iterations re-emit.
  input.runtimeState.eagerStatusEmittedFor.clear();

  if (!input.runtimeState.toolCallMade) {
    skipStage(input.stageTimings, "tools");
  }

  if (!input.runtimeState.toolCallMade && pass1BufferedContent) {
    pass1BufferedContent = await input.applyTurnRagGrounding(pass1BufferedContent);
    pass1BufferedContent = await input.applyTurnSafetyGate(pass1BufferedContent);
    fullContent += pass1BufferedContent;
    input.enqueue({ type: "chunk", content: pass1BufferedContent });
  }

  if (input.runtimeState.toolCallMade && toolResults.length > 0) {
    const willRenderNavigationDeterministically =
      toolResults.length === 1 &&
      input.successfulToolResults.length === 1 &&
      input.successfulToolResults[0]?.name === "find_navigation_targets";
    if (pass1BufferedContent && !willRenderNavigationDeterministically) {
      pass1BufferedContent = await input.applyTurnSafetyGate(pass1BufferedContent);
      fullContent += pass1BufferedContent;
      input.enqueue({ type: "chunk", content: pass1BufferedContent });
    }
    if (willRenderNavigationDeterministically) {
      pass1BufferedContent = "";
    }
    const canUseDeterministicMemberRoster =
      input.successfulToolResults.length === 1 &&
      input.successfulToolResults[0]?.name === "list_members" &&
      MEMBER_ROSTER_PROMPT_PATTERN.test(input.promptSafeMessage);
    const needsDonorPrivacy = input.successfulToolResults.some(
      (result) => result.name === "list_donations",
    );
    const hideDonorNames = needsDonorPrivacy
      ? await resolveHideDonorNamesPreference(
          input.ctx.serviceSupabase,
          input.ctx.orgId,
        )
      : false;
    const needsOrgSlug =
      input.successfulToolResults.length === 1 &&
      input.successfulToolResults[0]?.name === "list_chat_groups";
    const orgSlug = needsOrgSlug
      ? await resolveOrgSlug(
          input.ctx.serviceSupabase,
          input.ctx.orgId,
        )
      : undefined;
    const deterministicFormatterOptions =
      input.successfulToolResults.length === 1 &&
      input.successfulToolResults[0]?.name === "list_donations"
        ? { hideDonorNames }
        : input.successfulToolResults.length === 1 &&
          input.successfulToolResults[0]?.name === "list_chat_groups"
        ? { orgSlug }
        : undefined;
    const deterministicToolContent =
      toolResults.length === 1 &&
      input.successfulToolResults.length === 1 &&
      toolResults[0].name === input.successfulToolResults[0].name &&
      (input.successfulToolResults[0].name !== "list_members" || canUseDeterministicMemberRoster)
        ? formatDeterministicToolResponse(
            input.successfulToolResults[0].name,
            input.successfulToolResults[0].data,
            deterministicFormatterOptions,
          )
        : null;
    const singleToolError =
      toolResults.length === 1 &&
      input.successfulToolResults.length === 0 &&
      toolResults[0].data &&
      typeof toolResults[0].data === "object" &&
      "error" in toolResults[0].data &&
      typeof toolResults[0].data.error === "string"
        ? (toolResults[0].data as { error: string }).error
        : null;
    const singleToolErrorCode =
      toolResults.length === 1 &&
      input.successfulToolResults.length === 0 &&
      toolResults[0].data &&
      typeof toolResults[0].data === "object" &&
      "error_code" in toolResults[0].data &&
      typeof (toolResults[0].data as { error_code?: unknown }).error_code === "string"
        ? (toolResults[0].data as { error_code: string }).error_code
        : null;
    const deterministicToolErrorContent = singleToolError
      ? formatDeterministicToolErrorResponse(
          toolResults[0].name,
          singleToolError,
          singleToolErrorCode,
        )
      : null;

    if (deterministicToolContent || deterministicToolErrorContent) {
      skipStage(input.stageTimings, "pass2");
      pass2BufferedContent =
        deterministicToolContent ?? deterministicToolErrorContent ?? "";
    } else {
      const hasToolErrors =
        toolResults.length > input.successfulToolResults.length;
      const connectionPass2 = input.successfulToolResults.some(
        (result) => result.name === "suggest_connections",
      );
      const mentorPass2 = input.successfulToolResults.some(
        (result) => result.name === "suggest_mentors",
      );
      const memberRosterPass2 = input.successfulToolResults.some(
        (result) => result.name === "list_members",
      );
      const toolErrorInstruction = hasToolErrors
        ? "\n\nSome tool calls failed. Only cite data from successful tool results. Acknowledge any failures honestly — do not fabricate data."
        : "";
      const pass2Instructions = [
        PASS2_ANSWER_NARROWNESS_INSTRUCTION,
        connectionPass2 ? CONNECTION_PASS2_TEMPLATE : null,
        mentorPass2 ? MENTOR_PASS2_TEMPLATE : null,
        memberRosterPass2 ? MEMBER_LIST_PASS2_INSTRUCTION : null,
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n\n");
      const pass2SystemPrompt =
        pass2Instructions.length > 0
          ? `${input.systemPrompt}\n\n${pass2Instructions}${toolErrorInstruction}`
          : `${input.systemPrompt}${toolErrorInstruction}`;

      const pass2Outcome = await runPass2({
        client: input.client,
        systemPrompt: pass2SystemPrompt,
        messages: input.contextMessages,
        toolResults,
        composeResponseFn: input.composeResponseFn,
        stageTimings: input.stageTimings,
        streamSignal: input.streamSignal,
        threadId: input.threadId,
        requestLogContext: input.requestLogContext,
        runtimeState: input.runtimeState,
        emitTimeoutError: input.emitTimeoutError,
        onUsage: input.recordUsage,
        onChunk: (content) => {
          pass2BufferedContent += content;
        },
        onError: (event) => {
          input.runtimeState.auditErrorMessage = event.message;
          input.enqueue(event);
        },
      });

      if (pass2Outcome !== "completed") {
        return { fullContent, completed: false };
      }
    }

    pass2BufferedContent = await runGroundingCheck({
      pass2BufferedContent,
      successfulToolResults: input.successfulToolResults,
      executionPolicy: input.executionPolicy,
      hideDonorNames,
      runtimeState: input.runtimeState,
      stageTimings: input.stageTimings,
      threadId: input.threadId,
      assistantMessageId: input.assistantMessageId,
      orgId: input.ctx.orgId,
      requestLogContext: input.requestLogContext,
      verifyToolBackedResponseFn: input.verifyToolBackedResponseFn,
      trackOpsEventServerFn: input.trackOpsEventServerFn,
    });

    if (pass2BufferedContent) {
      pass2BufferedContent = await input.applyTurnSafetyGate(pass2BufferedContent);
      fullContent += pass2BufferedContent;
      input.enqueue({ type: "chunk", content: pass2BufferedContent });
    }
  } else {
    skipStage(input.stageTimings, "pass2");
    skipStage(input.stageTimings, "grounding");
  }

  return { fullContent, completed: true };
}
