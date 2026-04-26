import type { ToolCallRequestedEvent } from "@/lib/ai/response-composer";
import type { AiAuditStageTimings } from "@/lib/ai/chat-telemetry";
import { skipStage } from "@/lib/ai/chat-telemetry";
import { deriveForcedPass1ToolArgs } from "../pass1-tools";

export interface RunPass1BypassInput {
  toolName: string;
  message: string;
  requestId: string;
  stageTimings: AiAuditStageTimings;
  onToolCall: (
    event: ToolCallRequestedEvent,
  ) => Promise<"continue" | "stop"> | "continue" | "stop";
}

export interface RunPass1BypassOutcome {
  /** "bypass_derived" when args injected; "bypass_zero_arg" when none. */
  pass1Path: "bypass_derived" | "bypass_zero_arg";
  /** Result of `onToolCall`. Caller treats "stop" as terminate. */
  callOutcome: "continue" | "stop";
}

/**
 * Synthesize the forced single-tool Pass-1 round-trip in-process: derive args
 * from the user message, build a `tool_call_requested` event, and hand it to
 * the existing `onToolCall` handler. Pass-2 + grounding fall through unchanged
 * because `toolResults` ends in the same shape as the model path produces.
 *
 * Eager `tool_status: calling` is emitted by the orchestrator before this
 * stage runs (so the wire byte-order matches the model path).
 */
export async function runPass1Bypass(
  input: RunPass1BypassInput,
): Promise<RunPass1BypassOutcome> {
  const derivedArgs = deriveForcedPass1ToolArgs(input.toolName, input.message);
  const args = derivedArgs ?? {};
  const pass1Path = derivedArgs ? "bypass_derived" : "bypass_zero_arg";

  const syntheticEvent: ToolCallRequestedEvent = {
    type: "tool_call_requested",
    id: `bypass-call-${input.requestId}`,
    name: input.toolName,
    argsJson: JSON.stringify(args),
  };

  skipStage(input.stageTimings, "pass1_model");
  input.stageTimings.request.pass1_path = pass1Path;

  const callOutcome = await input.onToolCall(syntheticEvent);
  return { pass1Path, callOutcome };
}
