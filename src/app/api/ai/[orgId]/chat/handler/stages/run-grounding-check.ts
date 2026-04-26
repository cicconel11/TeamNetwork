import {
  runTimedStage,
  skipStage,
  type AiAuditStageTimings,
} from "@/lib/ai/chat-telemetry";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import type { trackOpsEventServer } from "@/lib/analytics/events-server";
import type {
  verifyToolBackedResponse,
  SuccessfulToolSummary,
} from "@/lib/ai/grounding/tool/verifier";
import type { TurnExecutionPolicy } from "@/lib/ai/turn-execution-policy";
import type { TurnRuntimeState } from "../sse-runtime";
import {
  ToolGroundingVerificationError,
  getGroundingFallbackForTools,
} from "../sse-runtime";

export interface RunGroundingCheckInput {
  pass2BufferedContent: string;
  successfulToolResults: SuccessfulToolSummary[];
  executionPolicy: TurnExecutionPolicy;
  hideDonorNames: boolean;

  runtimeState: TurnRuntimeState;
  stageTimings: AiAuditStageTimings;
  threadId: string;
  assistantMessageId: string;
  orgId: string;
  requestLogContext: AiLogContext;

  verifyToolBackedResponseFn: typeof verifyToolBackedResponse;
  trackOpsEventServerFn: typeof trackOpsEventServer;
}

/**
 * Verify pass-2 output against successful tool results when policy demands
 * `verify_tool_summary`. On failure, replaces the buffered content with a
 * deterministic fallback message and logs the audit error. Returns the
 * (possibly replaced) buffered content for the orchestrator to flush.
 */
export async function runGroundingCheck(
  input: RunGroundingCheckInput,
): Promise<string> {
  const groundedToolSummary =
    input.executionPolicy.groundingPolicy === "verify_tool_summary" &&
    input.runtimeState.toolCallSucceeded &&
    input.successfulToolResults.length > 0 &&
    input.pass2BufferedContent.length > 0;

  if (!groundedToolSummary) {
    skipStage(input.stageTimings, "grounding");
    return input.pass2BufferedContent;
  }

  try {
    await runTimedStage(input.stageTimings, "grounding", async () => {
      const groundingResult = input.verifyToolBackedResponseFn({
        content: input.pass2BufferedContent,
        toolResults: input.successfulToolResults,
        orgContext: { hideDonorNames: input.hideDonorNames },
      });
      if (!groundingResult.grounded) {
        throw new ToolGroundingVerificationError(groundingResult.failures);
      }
    });
    return input.pass2BufferedContent;
  } catch (error) {
    if (!(error instanceof ToolGroundingVerificationError)) {
      throw error;
    }

    input.runtimeState.auditErrorMessage = "tool_grounding_failed";
    aiLog(
      "warn",
      "ai-grounding",
      "verification failed",
      { ...input.requestLogContext, threadId: input.threadId },
      {
        messageId: input.assistantMessageId,
        tools: input.successfulToolResults.map((result) => result.name),
        failures: error.failures,
      },
    );
    void input.trackOpsEventServerFn(
      "api_error",
      {
        endpoint_group: "ai-grounding",
        http_status: 200,
        error_code: "tool_grounding_failed",
        retryable: false,
      },
      input.orgId,
    );
    return getGroundingFallbackForTools(
      input.successfulToolResults.map((result) => result.name),
    );
  }
}
