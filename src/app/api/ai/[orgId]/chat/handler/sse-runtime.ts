import type { ToolName } from "@/lib/ai/tools/definitions";
import type { RagChunkInput } from "@/lib/ai/context-builder";
import type { UsageAccumulator } from "@/lib/ai/response-composer";
import {
  buildRagGroundingFallback,
  RAG_GROUNDING_ABSTAIN_TEXT,
  type RagGroundingMode,
  type verifyRagGrounding,
} from "@/lib/ai/rag-grounding";
import {
  SAFETY_FALLBACK_TEXT,
  type SafetyVerdict,
  type classifySafety,
} from "@/lib/ai/safety-gate";
import type {
  SuccessfulToolSummary,
  verifyToolBackedResponse,
} from "@/lib/ai/tool-grounding";
import type { trackOpsEventServer } from "@/lib/analytics/events-server";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";

export const CONNECTION_PASS1_DISAMBIGUATION_INSTRUCTION = [
  "CONNECTION TOOL ROUTING:",
  "- If the latest assistant message listed ambiguous suggest_connections options with [ref: person_type:person_id] tags and the user replies with a choice by number, position, name, or subtitle, call suggest_connections again.",
  "- In that follow-up call, use the matching person_type and person_id from the prior assistant message's [ref: person_type:person_id] tag.",
  "- Do not send person_query for that follow-up disambiguation call.",
].join("\n");

export const MENTOR_PASS2_TEMPLATE = [
  "MENTOR ANSWER CONTRACT:",
  "- If suggest_mentors returned state=resolved, respond using this exact shape:",
  "  Top mentors for [mentee name]",
  "  1. [Mentor Name] — [subtitle if present]",
  "     Why: [signal label]: [value], [signal label]: [value]",
  "- Use at most 5 suggestions.",
  "- Use only the returned mentee, suggestions, reasons, and labels.",
  "- Do not mention scores, UUIDs, or internal tool details.",
  "- Do not add a concluding summary sentence.",
  "- If state=ambiguous, ask the user which returned option they mean.",
  "- If state=not_found, say you couldn't find that person in the organization.",
  "- If state=no_suggestions, say you found the person but there are no eligible mentors matching their preferences.",
  "- If state=unauthorized, say mentor suggestions are currently available to admins only.",
].join("\n");

const TOOL_GROUNDING_FALLBACK =
  "I couldn’t verify that answer against your organization’s data, so I’m not returning it. Please try rephrasing or ask a narrower question.";
export const EMPTY_ASSISTANT_RESPONSE_FALLBACK =
  "I didn’t get a usable response for that question. Please try again.";
const MEMBER_TOOL_GROUNDING_FALLBACK =
  "I can list specific members from the current roster, but I couldn’t verify that summary from this tool. Try asking for a smaller list, recent members, or specific people.";
export const MEMBER_LIST_PASS2_INSTRUCTION = [
  "When using list_members results:",
  "- Only mention members explicitly present in the returned rows.",
  "- Do not infer org-wide totals, grouped counts, or role summaries.",
  "- If the user asked for more than the tool returned, say you are showing the first returned members.",
  "- Prefer simple row-backed bullets: name, optional role, optional email, optional added date.",
  "- You may render a presentation-only role suffix like `Name (Parent)` only when that role exists in the returned row.",
  "- If a row has no trustworthy human name, describe it as an email-only member/admin account instead of inventing a person name.",
].join("\n");
export const ACTIVE_DRAFT_CONTINUATION_INSTRUCTION = [
  "ACTIVE DRAFT CONTINUATION:",
  "- A matching assistant draft may already be in progress for this thread.",
  "- When a matching prepare tool is attached, treat the user's latest message as a continuation of that draft unless they clearly changed topics.",
  "- Call the attached prepare tool with the updated draft details instead of replying with read-only prose.",
  "- Do not say you lack the ability to create announcements, jobs, chat messages, group messages, discussion replies, discussion threads, or events when the matching prepare tool is attached.",
].join("\n");

export class ToolGroundingVerificationError extends Error {
  constructor(
    readonly failures: ReturnType<typeof verifyToolBackedResponse>["failures"]
  ) {
    super("tool_grounding_failed");
  }
}

export interface TurnRuntimeState {
  usage: UsageAccumulator | null;
  streamCompletedSuccessfully: boolean;
  auditErrorMessage: string | undefined;
  contextMetadata: { surface: string; estimatedTokens: number } | undefined;
  toolCallMade: boolean;
  toolCallSucceeded: boolean;
  safetyVerdict: SafetyVerdict | undefined;
  safetyCategories: string[] | undefined;
  safetyLatencyMs: number | undefined;
  ragGrounded: boolean | undefined;
  ragGroundingFailures: string[] | undefined;
  ragGroundingLatencyMs: number | undefined;
  ragGroundingAudited: RagGroundingMode | undefined;
}

export function createTurnRuntimeState(): TurnRuntimeState {
  return {
    usage: null,
    streamCompletedSuccessfully: false,
    auditErrorMessage: undefined,
    contextMetadata: undefined,
    toolCallMade: false,
    toolCallSucceeded: false,
    safetyVerdict: undefined,
    safetyCategories: undefined,
    safetyLatencyMs: undefined,
    ragGrounded: undefined,
    ragGroundingFailures: undefined,
    ragGroundingLatencyMs: undefined,
    ragGroundingAudited: undefined,
  };
}

export function recordTurnUsage(
  state: TurnRuntimeState,
  usage: UsageAccumulator
): void {
  state.usage = {
    inputTokens: (state.usage?.inputTokens ?? 0) + usage.inputTokens,
    outputTokens: (state.usage?.outputTokens ?? 0) + usage.outputTokens,
  };
}

export async function applySafetyGate(args: {
  buffered: string;
  disabled: boolean;
  shadow: boolean;
  ragChunks: RagChunkInput[];
  successfulToolResults: SuccessfulToolSummary[];
  classifySafetyFn: typeof classifySafety;
  trackOpsEventServerFn: typeof trackOpsEventServer;
  collectPhoneNumberFields: (value: unknown, owned: Set<string>) => void;
  state: TurnRuntimeState;
  orgId: string;
  logContext: AiLogContext;
}): Promise<string> {
  if (args.disabled || !args.buffered) return args.buffered;

  try {
    const ownedEmails = new Set<string>();
    const ownedPhones = new Set<string>();
    const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

    for (const chunk of args.ragChunks) {
      const text = chunk.contentText ?? "";
      const emailMatches = text.match(emailRegex) ?? [];
      for (const match of emailMatches) ownedEmails.add(match.toLowerCase());
    }

    try {
      const serialized = JSON.stringify(args.successfulToolResults);
      const emailMatches = serialized.match(emailRegex) ?? [];
      for (const match of emailMatches) ownedEmails.add(match.toLowerCase());
    } catch {
      // Circular-ref tool data; skip.
    }

    args.collectPhoneNumberFields(args.successfulToolResults, ownedPhones);
    const result = await args.classifySafetyFn({
      content: args.buffered,
      orgContext: { ownedEmails, ownedPhones },
    });
    args.state.safetyVerdict = result.verdict;
    args.state.safetyCategories = result.categories;
    args.state.safetyLatencyMs = result.latencyMs;

    if (result.verdict === "unsafe") {
      void args.trackOpsEventServerFn(
        "api_error",
        {
          endpoint_group: args.shadow
            ? "ai-safety-gate-shadow"
            : "ai-safety-gate",
          http_status: 200,
          error_code: args.shadow
            ? "safety_gate_shadow_unsafe"
            : "safety_gate_blocked",
          retryable: false,
        },
        args.orgId
      );
      if (!args.shadow) {
        return SAFETY_FALLBACK_TEXT;
      }
    }

    return args.buffered;
  } catch (err) {
    aiLog("warn", "ai-safety-gate", "classify failed", args.logContext, {
      error: err,
    });
    return args.buffered;
  }
}

export async function applyRagGrounding(args: {
  buffered: string;
  disabled: boolean;
  mode: RagGroundingMode;
  minChunks: number;
  ragChunks: RagChunkInput[];
  verifyRagGroundingFn: typeof verifyRagGrounding;
  trackOpsEventServerFn: typeof trackOpsEventServer;
  state: TurnRuntimeState;
  orgId: string;
  logContext: AiLogContext;
}): Promise<string> {
  if (
    args.disabled ||
    args.mode === "bypass" ||
    !args.buffered ||
    args.ragChunks.length < args.minChunks
  ) {
    if (args.buffered) {
      args.state.ragGroundingAudited = args.mode;
    }
    if (args.mode === "bypass" && !args.disabled) {
      void args.trackOpsEventServerFn(
        "api_error",
        {
          endpoint_group: "ai-rag-grounding",
          error_code: "rag_grounding_bypassed",
          http_status: 200,
          retryable: false,
        },
        args.orgId
      );
    }
    return args.buffered;
  }

  try {
    const result = await args.verifyRagGroundingFn({
      content: args.buffered,
      ragChunks: args.ragChunks,
    });
    args.state.ragGrounded = result.grounded;
    args.state.ragGroundingFailures = result.uncoveredClaims;
    args.state.ragGroundingLatencyMs = result.latencyMs;
    args.state.ragGroundingAudited = args.mode;

    if (result.grounded) return args.buffered;

    void args.trackOpsEventServerFn(
      "api_error",
      {
        endpoint_group:
          args.mode === "shadow"
            ? "ai-rag-grounding-shadow"
            : "ai-rag-grounding",
        http_status: 200,
        error_code:
          args.mode === "shadow"
            ? "rag_grounding_shadow_ungrounded"
            : "rag_grounding_failed",
        retryable: false,
      },
      args.orgId
    );

    if (args.mode === "overwrite") {
      return buildRagGroundingFallback(
        result.uncoveredClaims,
        args.ragChunks[0] ?? null
      );
    }
    if (args.mode === "block") {
      return RAG_GROUNDING_ABSTAIN_TEXT;
    }

    return args.buffered;
  } catch (err) {
    aiLog("warn", "ai-rag-grounding", "verify failed", args.logContext, {
      error: err,
    });
    return args.buffered;
  }
}

export function buildSseResponse(
  stream: ReadableStream<Uint8Array>,
  headers: HeadersInit,
  threadId: string,
) {
  return new Response(stream, {
    headers: {
      ...headers,
      "x-ai-thread-id": threadId,
    },
  });
}

export function getGroundingFallbackForTools(toolNames: ToolName[]): string {
  if (toolNames.length > 0 && toolNames.every((toolName) => toolName === "list_members")) {
    return MEMBER_TOOL_GROUNDING_FALLBACK;
  }

  return TOOL_GROUNDING_FALLBACK;
}
