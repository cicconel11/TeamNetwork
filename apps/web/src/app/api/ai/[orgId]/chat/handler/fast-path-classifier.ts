import type OpenAI from "openai";
import type { AiPass1Path, FastPathLabel } from "@/lib/ai/chat-telemetry";
import type { TurnExecutionPolicy } from "@/lib/ai/turn-execution-policy";
import type { ToolName } from "@/lib/ai/tools/definitions";
import {
  BYPASS_ELIGIBLE_TOOLS,
  TOOL_FIRST_ELIGIBLE,
} from "./pass1-tools";

export type FastPathReason =
  | "pending_disambiguation"
  | "pending_revision"
  | "draft_active"
  | "attachment_present"
  | "multi_tool"
  | "bypass_disabled"
  | "bypass_shadow"
  | "forced_single_tool"
  | "tool_first_eligible";

export interface ClassifyFastPathInput {
  executionPolicy: { toolPolicy: TurnExecutionPolicy["toolPolicy"] };
  pass1Tools: ReadonlyArray<OpenAI.Chat.ChatCompletionTool> | undefined;
  pass1ToolChoice: OpenAI.Chat.ChatCompletionToolChoiceOption | undefined;
  activeDraftSession: unknown | null;
  pendingEventRevisionAnalysis: { kind: string } | null | undefined;
  pendingConnectionDisambiguation: boolean;
  attachment: unknown | null | undefined;
  retrievalReason: string;
  usesSharedStaticContext: boolean;
  pass1BypassMode: "off" | "shadow" | "on";
}

export interface FastPathClassification {
  fastPathLabel: FastPathLabel;
  pass1Path?: AiPass1Path;
  usesToolFirstContext: boolean;
  canBypassPass1: boolean;
  forcedSingleToolName: string | null;
  reasons: FastPathReason[];
}

function getForcedSingleToolName(
  pass1Tools: ReadonlyArray<OpenAI.Chat.ChatCompletionTool> | undefined,
  pass1ToolChoice: OpenAI.Chat.ChatCompletionToolChoiceOption | undefined,
): string | null {
  if (!pass1Tools || pass1Tools.length !== 1 || pass1ToolChoice == null) {
    return null;
  }

  const firstTool = pass1Tools[0];
  return firstTool && "function" in firstTool ? firstTool.function.name ?? null : null;
}

function isToolFirstEligibleTool(
  pass1Tools: ReadonlyArray<OpenAI.Chat.ChatCompletionTool> | undefined,
): boolean {
  if (!pass1Tools || pass1Tools.length !== 1) return false;
  const firstTool = pass1Tools[0];
  const toolName = firstTool && "function" in firstTool ? firstTool.function.name : null;
  return Boolean(toolName) && TOOL_FIRST_ELIGIBLE.has(toolName as ToolName);
}

function isPendingRevision(value: { kind: string } | null | undefined): boolean {
  return value != null && value.kind !== "none";
}

export function classifyFastPath(input: ClassifyFastPathInput): FastPathClassification {
  const forcedSingleToolName = getForcedSingleToolName(
    input.pass1Tools,
    input.pass1ToolChoice,
  );
  const usesToolFirstContext =
    !input.usesSharedStaticContext &&
    input.retrievalReason === "tool_only_structured_query" &&
    isToolFirstEligibleTool(input.pass1Tools);

  const singleBypassEligible =
    forcedSingleToolName != null &&
    input.executionPolicy.toolPolicy === "surface_read_tools" &&
    (BYPASS_ELIGIBLE_TOOLS as ReadonlyArray<string>).includes(forcedSingleToolName);

  const canBypassPass1 =
    singleBypassEligible &&
    input.activeDraftSession == null &&
    !isPendingRevision(input.pendingEventRevisionAnalysis) &&
    !input.pendingConnectionDisambiguation &&
    input.attachment == null;

  const base = {
    usesToolFirstContext,
    canBypassPass1,
    forcedSingleToolName,
  };

  if (input.pendingConnectionDisambiguation) {
    return { ...base, fastPathLabel: "pending_disambiguation", pass1Path: "model", reasons: ["pending_disambiguation"] };
  }
  if (isPendingRevision(input.pendingEventRevisionAnalysis)) {
    return { ...base, fastPathLabel: "pending_revision", pass1Path: "model", reasons: ["pending_revision"] };
  }
  if (input.activeDraftSession != null) {
    return { ...base, fastPathLabel: "draft_active", pass1Path: "model", reasons: ["draft_active"] };
  }
  if (input.attachment != null) {
    return { ...base, fastPathLabel: "attachment_present", pass1Path: "model", reasons: ["attachment_present"] };
  }
  if (input.pass1Tools && input.pass1Tools.length > 1) {
    return { ...base, fastPathLabel: "multi_tool", pass1Path: "model", reasons: ["multi_tool"] };
  }
  if (canBypassPass1 && input.pass1BypassMode === "off") {
    return { ...base, fastPathLabel: "bypass_disabled", pass1Path: "model", reasons: ["bypass_disabled"] };
  }
  if (canBypassPass1 && input.pass1BypassMode === "shadow") {
    return {
      ...base,
      fastPathLabel: "bypass_shadow",
      pass1Path: "model_shadow_bypass_eligible",
      reasons: ["bypass_shadow"],
    };
  }
  if (canBypassPass1 && input.pass1BypassMode === "on") {
    return { ...base, fastPathLabel: "pass1_bypass_eligible", reasons: ["forced_single_tool"] };
  }
  if (forcedSingleToolName) {
    return { ...base, fastPathLabel: "forced_single_tool", pass1Path: "model", reasons: ["forced_single_tool"] };
  }
  if (usesToolFirstContext) {
    return { ...base, fastPathLabel: "tool_first_eligible", pass1Path: "model", reasons: ["tool_first_eligible"] };
  }

  return { ...base, fastPathLabel: "model_default", pass1Path: "model", reasons: [] };
}
