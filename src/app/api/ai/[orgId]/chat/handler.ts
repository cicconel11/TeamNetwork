/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiOrgContext } from "@/lib/ai/context";
import { sendMessageSchema } from "@/lib/schemas";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, validationErrorResponse, ValidationError } from "@/lib/security/validation";
import { createZaiClient, getZaiModel } from "@/lib/ai/client";
import { buildPromptContext } from "@/lib/ai/context-builder";
import {
  composeResponse,
  type ToolCallRequestedEvent,
  type ToolResultMessage,
  type UsageAccumulator,
} from "@/lib/ai/response-composer";
import { logAiRequest } from "@/lib/ai/audit";
import { createSSEStream, SSE_HEADERS, type CacheStatus, type SSEEvent } from "@/lib/ai/sse";
import {
  AI_TOOL_MAP,
  type ToolName,
} from "@/lib/ai/tools/definitions";
import {
  buildPendingEventBatchFromDrafts,
  executeToolCall,
  getToolAuthorizationMode,
  type ToolExecutionAuthorization,
} from "@/lib/ai/tools/executor";
import { filterAllowedTools } from "@/lib/ai/access-policy";
import { resolveOwnThread, type AiThreadMetadata } from "@/lib/ai/thread-resolver";
import {
  buildSemanticCacheKeyParts,
  checkCacheEligibility,
  type CacheSurface,
} from "@/lib/ai/semantic-cache-utils";
import { lookupSemanticCache, writeCacheEntry } from "@/lib/ai/semantic-cache";
import { retrieveRelevantChunks } from "@/lib/ai/rag-retriever";
import type { RagChunkInput } from "@/lib/ai/context-builder";
import { resolveSurfaceRouting } from "@/lib/ai/intent-router";
import {
  buildTurnExecutionPolicy,
  type TurnExecutionPolicy,
} from "@/lib/ai/turn-execution-policy";
import {
  extractCurrentMemberRouteId,
  extractRouteEntity,
  type RouteEntityContext,
} from "@/lib/ai/route-entity";
import { loadRouteEntityContext } from "@/lib/ai/route-entity-loaders";
import {
  verifyToolBackedResponse,
  type SuccessfulToolSummary,
} from "@/lib/ai/tool-grounding";
import {
  classifySafety,
  SAFETY_FALLBACK_TEXT,
  type SafetyVerdict,
} from "@/lib/ai/safety-gate";
import {
  verifyRagGrounding,
  buildRagGroundingFallback,
  RAG_GROUNDING_ABSTAIN_TEXT,
  type RagGroundingMode,
} from "@/lib/ai/rag-grounding";
import { trackOpsEventServer } from "@/lib/analytics/events-server";
import {
  assessAiMessageSafety,
  sanitizeHistoryMessageForPrompt,
} from "@/lib/ai/message-safety";
import {
  finalizeAssistantMessage,
  INTERRUPTED_ASSISTANT_MESSAGE,
} from "@/lib/ai/assistant-message-display";
import {
  clearDraftSession,
  getDraftSession,
  isDraftSessionExpired,
  saveDraftSession,
  supportsDraftSessionsStore,
  type DraftSessionRecord,
  type DraftSessionType,
} from "@/lib/ai/draft-sessions";
import {
  updatePendingActionStatus,
  type PendingActionRecord,
} from "@/lib/ai/pending-actions";
import {
  createStageAbortSignal,
  isStageTimeoutError,
  PASS1_MODEL_TIMEOUT_MS,
  PASS2_MODEL_TIMEOUT_MS,
} from "@/lib/ai/timeout";
import {
  createStageTimings,
  setStageStatus,
  runTimedStage,
  skipStage,
  skipRemainingStages,
  addToolCallTiming,
  finalizeStageTimings,
} from "@/lib/ai/chat-telemetry";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import {
  getNonEmptyString,
  hasPendingConnectionDisambiguation,
  looksLikeConnectionDisambiguationReply,
  collectPhoneNumberFields,
  formatDeterministicToolResponse,
  formatDeterministicToolErrorResponse,
  formatRevisedPendingEventResponse,
  resolveHideDonorNamesPreference,
  CONNECTION_PASS2_TEMPLATE,
} from "./handler/formatters/index";
import {
  type ChatAttachment,
} from "./handler/shared";
import {
  CREATE_ANNOUNCEMENT_PROMPT_PATTERN,
  CREATE_DISCUSSION_PROMPT_PATTERN,
  CREATE_EVENT_PROMPT_PATTERN,
  CREATE_JOB_PROMPT_PATTERN,
  DIRECT_QUERY_START_PATTERN,
  DISCUSSION_REPLY_PROMPT_PATTERN,
  EXPLICIT_EVENT_DRAFT_SWITCH_PATTERN,
  LIST_CHAT_GROUPS_PROMPT_PATTERN,
  MEMBER_ROSTER_PROMPT_PATTERN,
  SEND_CHAT_MESSAGE_PROMPT_PATTERN,
  SEND_GROUP_CHAT_MESSAGE_PROMPT_PATTERN,
  getForcedPass1ToolChoice,
  getPass1Tools,
  isToolFirstEligible,
  looksLikeStructuredJobDraft,
} from "./handler/pass1-tools";

export {
  CONNECTION_PASS2_TEMPLATE,
  collectPhoneNumberFields,
  formatSuggestConnectionsResponse,
  formatDeterministicToolResponse,
  formatDeterministicToolErrorResponse,
  formatRevisedPendingEventResponse,
  resolveHideDonorNamesPreference,
  type DonationResponseOptions,
} from "./handler/formatters/index";
export {
  CREATE_JOB_PROMPT_PATTERN,
  DIRECT_QUERY_START_PATTERN,
  getForcedPass1ToolChoice,
  getPass1Tools,
  isToolFirstEligible,
  looksLikeStructuredJobDraft,
} from "./handler/pass1-tools";
export type { ChatAttachment } from "./handler/shared";
export { SCHEDULE_ATTACHMENT_MIME_TYPES } from "./handler/shared";

export interface ChatRouteDeps {
  createClient?: typeof createClient;
  getAiOrgContext?: typeof getAiOrgContext;
  buildPromptContext?: typeof buildPromptContext;
  createZaiClient?: typeof createZaiClient;
  getZaiModel?: typeof getZaiModel;
  composeResponse?: typeof composeResponse;
  logAiRequest?: typeof logAiRequest;
  resolveOwnThread?: typeof resolveOwnThread;
  retrieveRelevantChunks?: typeof retrieveRelevantChunks;
  executeToolCall?: typeof executeToolCall;
  buildTurnExecutionPolicy?: typeof buildTurnExecutionPolicy;
  verifyToolBackedResponse?: typeof verifyToolBackedResponse;
  classifySafety?: typeof classifySafety;
  verifyRagGrounding?: typeof verifyRagGrounding;
  trackOpsEventServer?: typeof trackOpsEventServer;
  getDraftSession?: typeof getDraftSession;
  saveDraftSession?: typeof saveDraftSession;
  clearDraftSession?: typeof clearDraftSession;
  loadRouteEntityContext?: typeof loadRouteEntityContext;
}

const CONNECTION_PASS1_DISAMBIGUATION_INSTRUCTION = [
  "CONNECTION TOOL ROUTING:",
  "- If the latest assistant message listed ambiguous suggest_connections options with [ref: person_type:person_id] tags and the user replies with a choice by number, position, name, or subtitle, call suggest_connections again.",
  "- In that follow-up call, use the matching person_type and person_id from the prior assistant message's [ref: person_type:person_id] tag.",
  "- Do not send person_query for that follow-up disambiguation call.",
].join("\n");

const MENTOR_PASS2_TEMPLATE = [
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

const DEFAULT_AI_ORG_RATE_LIMIT = 60;

function getAiOrgRateLimit(): number {
  const parsed = Number.parseInt(process.env.AI_ORG_RATE_LIMIT ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AI_ORG_RATE_LIMIT;
}

class ToolGroundingVerificationError extends Error {
  constructor(
    readonly failures: ReturnType<typeof verifyToolBackedResponse>["failures"]
  ) {
    super("tool_grounding_failed");
  }
}

function buildSseResponse(stream: ReadableStream<Uint8Array>, headers: HeadersInit, threadId: string) {
  return new Response(stream, {
    headers: {
      ...headers,
      "x-ai-thread-id": threadId,
    },
  });
}

interface PendingActionToolPayload {
  pending_action?: {
    id?: unknown;
    action_type?: unknown;
    payload?: unknown;
    expires_at?: unknown;
    summary?: {
      title?: unknown;
      description?: unknown;
    } | null;
    revise_count?: unknown;
    previous_payload?: unknown;
  } | null;
  state?: unknown;
  missing_fields?: unknown;
  draft?: unknown;
  message?: unknown;
  source_warning?: unknown;
  clarification_kind?: unknown;
  candidate_recipients?: unknown;
  requested_recipient?: unknown;
  unavailable_reason?: unknown;
  candidate_groups?: unknown;
  requested_group?: unknown;
  candidate_thread_titles?: unknown;
  requested_thread_title?: unknown;
}

type PendingEventActionRecord = PendingActionRecord<"create_event">;

type PendingEventRevisionAnalysis =
  | { kind: "none" }
  | { kind: "clarify"; message: string }
  | { kind: "unsupported_event_type"; requestedType: string }
  | {
      kind: "apply";
      targetIndexes: number[];
      overrides: Record<string, unknown>;
    };

async function listPendingEventActionsForThread(
  supabase: unknown,
  input: {
    organizationId: string;
    userId: string;
    threadId: string;
  }
): Promise<PendingEventActionRecord[]> {
  const { data, error } = await (supabase as any)
    .from("ai_pending_actions")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.userId)
    .eq("thread_id", input.threadId)
    .eq("action_type", "create_event")
    .eq("status", "pending");

  if (error) {
    throw new Error("Failed to load pending event actions");
  }

  if (!Array.isArray(data)) {
    return [];
  }

  return data.filter(
    (row): row is PendingEventActionRecord =>
      row != null &&
      typeof row === "object" &&
      typeof row.id === "string" &&
      typeof row.thread_id === "string" &&
      row.action_type === "create_event" &&
      row.payload != null &&
      typeof row.payload === "object"
  );
}

function getPendingActionFromToolData(data: unknown) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as PendingActionToolPayload;
  if (payload.state !== "needs_confirmation" || !payload.pending_action) {
    return null;
  }

  const pending = payload.pending_action;
  if (
    typeof pending.id !== "string" ||
    typeof pending.action_type !== "string" ||
    typeof pending.expires_at !== "string" ||
    !pending.summary ||
    typeof pending.summary.title !== "string" ||
    typeof pending.summary.description !== "string" ||
    !pending.payload ||
    typeof pending.payload !== "object"
  ) {
    return null;
  }

  const reviseCount =
    typeof pending.revise_count === "number" ? pending.revise_count : null;
  const previousPayload =
    pending.previous_payload && typeof pending.previous_payload === "object"
      ? (pending.previous_payload as Record<string, unknown>)
      : null;

  return {
    actionId: pending.id,
    actionType: pending.action_type,
    expiresAt: pending.expires_at,
    summary: {
      title: pending.summary.title,
      description: pending.summary.description,
    },
    payload: pending.payload as Record<string, unknown>,
    reviseCount,
    previousPayload,
  };
}

function getBatchPendingActionsFromToolData(data: unknown) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as { state?: string; pending_actions?: unknown[] };
  if (payload.state !== "needs_batch_confirmation" || !Array.isArray(payload.pending_actions)) {
    return null;
  }

  const actions: Array<{
    actionId: string;
    actionType: string;
    summary: { title: string; description: string };
    payload: Record<string, unknown>;
    expiresAt: string;
  }> = [];

  for (const pa of payload.pending_actions) {
    if (!pa || typeof pa !== "object") continue;
    const pending = pa as {
      id?: string;
      action_type?: string;
      expires_at?: string;
      summary?: { title?: string; description?: string };
      payload?: unknown;
    };
    if (
      typeof pending.id !== "string" ||
      typeof pending.action_type !== "string" ||
      typeof pending.expires_at !== "string" ||
      !pending.summary ||
      typeof pending.summary.title !== "string" ||
      typeof pending.summary.description !== "string" ||
      !pending.payload ||
      typeof pending.payload !== "object"
    ) {
      continue;
    }
    actions.push({
      actionId: pending.id,
      actionType: pending.action_type,
      expiresAt: pending.expires_at,
      summary: {
        title: pending.summary.title,
        description: pending.summary.description,
      },
      payload: pending.payload as Record<string, unknown>,
    });
  }

  return actions.length > 0 ? actions : null;
}


const MESSAGE_SAFETY_FALLBACK =
  "I can’t help with instructions about hidden prompts, internal tools, or overriding safety rules. Ask a question about your organization’s data instead.";

const SCOPE_REFUSAL_FALLBACK =
  "I can only help with TeamNetwork tasks for your organization — like members, events, announcements, discussions, jobs, donations, or finding the right page. That request is outside what I do.";

const SCOPE_REFUSAL_CANONICAL_PREFIX = "I can only help with TeamNetwork tasks";

const TOOL_GROUNDING_FALLBACK =
  "I couldn’t verify that answer against your organization’s data, so I’m not returning it. Please try rephrasing or ask a narrower question.";
const EMPTY_ASSISTANT_RESPONSE_FALLBACK =
  "I didn’t get a usable response for that question. Please try again.";
const MEMBER_TOOL_GROUNDING_FALLBACK =
  "I can list specific members from the current roster, but I couldn’t verify that summary from this tool. Try asking for a smaller list, recent members, or specific people.";
const MEMBER_LIST_PASS2_INSTRUCTION = [
  "When using list_members results:",
  "- Only mention members explicitly present in the returned rows.",
  "- Do not infer org-wide totals, grouped counts, or role summaries.",
  "- If the user asked for more than the tool returned, say you are showing the first returned members.",
  "- Prefer simple row-backed bullets: name, optional role, optional email, optional added date.",
  "- You may render a presentation-only role suffix like `Name (Parent)` only when that role exists in the returned row.",
  "- If a row has no trustworthy human name, describe it as an email-only member/admin account instead of inventing a person name.",
].join("\n");
const ACTIVE_DRAFT_CONTINUATION_INSTRUCTION = [
  "ACTIVE DRAFT CONTINUATION:",
  "- A matching assistant draft may already be in progress for this thread.",
  "- When a matching prepare tool is attached, treat the user's latest message as a continuation of that draft unless they clearly changed topics.",
  "- Call the attached prepare tool with the updated draft details instead of replying with read-only prose.",
  "- Do not say you lack the ability to create announcements, jobs, chat messages, group messages, discussion replies, discussion threads, or events when the matching prepare tool is attached.",
].join("\n");
const DRAFT_CANCEL_PATTERN =
  /(?<!\w)(?:cancel|never\s+mind|nevermind|forget\s+(?:that|it)|scratch\s+that|stop\s+working\s+on\s+that)(?!\w)/i;

function getGroundingFallbackForTools(toolNames: ToolName[]): string {
  if (toolNames.length > 0 && toolNames.every((toolName) => toolName === "list_members")) {
    return MEMBER_TOOL_GROUNDING_FALLBACK;
  }

  return TOOL_GROUNDING_FALLBACK;
}

function getToolNameForDraftType(draftType: DraftSessionType): ToolName {
  switch (draftType) {
    case "create_announcement":
      return "prepare_announcement";
    case "create_job_posting":
      return "prepare_job_posting";
    case "send_chat_message":
      return "prepare_chat_message";
    case "send_group_chat_message":
      return "prepare_group_message";
    case "create_discussion_reply":
      return "prepare_discussion_reply";
    case "create_discussion_thread":
      return "prepare_discussion_thread";
    case "create_event":
      return "prepare_event";
  }
}

function mergeDraftPayload(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>
): Record<string, unknown> {
  const normalizedOverrides = Object.fromEntries(
    Object.entries(overrides).filter(
      ([, value]) => !(typeof value === "string" && value.trim().length === 0)
    )
  );

  return {
    ...base,
    ...normalizedOverrides,
  };
}

type DraftHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

const DISCUSSION_DRAFT_ASSISTANT_PATTERN =
  /(?:happy to help you create a discussion thread|i can draft this discussion|i drafted the discussion thread)/i;
const ANNOUNCEMENT_DRAFT_ASSISTANT_PATTERN =
  /(?:happy to help you create an announcement|i can draft this announcement|i drafted the announcement)/i;
const DISCUSSION_REPLY_DRAFT_ASSISTANT_PATTERN =
  /(?:happy to help you draft a reply|i can draft this reply|i drafted the discussion reply)/i;
const JOB_DRAFT_ASSISTANT_PATTERN =
  /(?:happy to help you create a job posting|i can draft this job|i drafted the job posting)/i;
const CHAT_MESSAGE_DRAFT_ASSISTANT_PATTERN =
  /(?:happy to help you draft a chat message|i can draft that chat message|i drafted the chat message)/i;
const GROUP_CHAT_MESSAGE_DRAFT_ASSISTANT_PATTERN =
  /(?:happy to help you draft a group message|i can draft that group message|i drafted the group message)/i;
const EVENT_DRAFT_ASSISTANT_PATTERN =
  /(?:happy to help you create an event|i can draft this event|i drafted the event)/i;

function extractStructuredFieldMap(message: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let currentLabel: string | null = null;
  let currentValue: string[] = [];

  const flush = () => {
    if (!currentLabel) {
      return;
    }
    const value = currentValue.join(" ").trim();
    if (value.length > 0) {
      entries[currentLabel] = value;
    }
    currentLabel = null;
    currentValue = [];
  };

  for (const line of lines) {
    const match = line.match(/^([a-z][a-z\s]+?)\s*:\s*(.+)$/i);
    if (match) {
      flush();
      currentLabel = match[1].trim().toLowerCase().replace(/\s+/g, " ");
      currentValue = [match[2].trim()];
      continue;
    }

    if (currentLabel) {
      currentValue.push(line);
    }
  }

  flush();
  return entries;
}

function normalizeLocationType(value: string | undefined): "remote" | "hybrid" | "onsite" | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "remote" || normalized === "hybrid" || normalized === "onsite") {
    return normalized;
  }

  return undefined;
}

function normalizeExperienceLevel(
  value: string | undefined
): "entry" | "mid" | "senior" | "lead" | "executive" | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "entry" || normalized === "mid" || normalized === "senior" || normalized === "lead" || normalized === "executive") {
    return normalized;
  }

  if (normalized === "junior" || normalized === "new grad" || normalized === "new graduate") {
    return "entry";
  }

  return undefined;
}

const PENDING_EVENT_BATCH_SCOPE_PATTERN =
  /\b(all|these|them|everything|every event|all events|all of them|all of these)\b/i;
const PENDING_EVENT_REVISION_CUE_PATTERN =
  /\b(actually|change|update|set|make|switch|move|rename|edit|correct|fix|should be|should actually be|title|description|location|category|type|event type|start date|start time|end date|end time)\b/i;
const PENDING_EVENT_SINGLE_SCOPE_PATTERNS = [
  { pattern: /\b(first|1st)\b/i, index: 0 },
  { pattern: /\b(second|2nd)\b/i, index: 1 },
  { pattern: /\b(third|3rd)\b/i, index: 2 },
] as const;
const SUPPORTED_EVENT_TYPE_LABELS = [
  "general",
  "philanthropy",
  "game",
  "practice",
  "meeting",
  "social",
  "workout",
  "fundraiser",
  "class",
] as const;

function normalizeEventType(
  value: string | undefined
): "general" | "philanthropy" | "game" | "practice" | "meeting" | "social" | "workout" | "fundraiser" | "class" | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "general" ||
    normalized === "philanthropy" ||
    normalized === "game" ||
    normalized === "practice" ||
    normalized === "meeting" ||
    normalized === "social" ||
    normalized === "workout" ||
    normalized === "fundraiser" ||
    normalized === "class"
  ) {
    return normalized;
  }

  return undefined;
}

function extractPendingEventRevisionOverrides(
  message: string
): { overrides: Record<string, unknown>; unsupportedEventType?: string } {
  const overrides: Record<string, unknown> = {};
  const fields = extractStructuredFieldMap(message);

  const title = getNonEmptyString(fields.title);
  const description = getNonEmptyString(fields.description);
  const startDate = getNonEmptyString(fields["start date"]);
  const startTime = getNonEmptyString(fields["start time"]);
  const endDate = getNonEmptyString(fields["end date"]);
  const endTime = getNonEmptyString(fields["end time"]);
  const location = getNonEmptyString(fields.location);
  const isPhilanthropy = normalizeBooleanFlag(
    getNonEmptyString(fields["is philanthropy"] ?? fields.philanthropy) ?? undefined
  );

  if (title) overrides.title = title;
  if (description) overrides.description = description;
  if (startDate) overrides.start_date = startDate;
  if (startTime) overrides.start_time = startTime;
  if (endDate) overrides.end_date = endDate;
  if (endTime) overrides.end_time = endTime;
  if (location) overrides.location = location;
  if (typeof isPhilanthropy === "boolean") overrides.is_philanthropy = isPhilanthropy;

  const structuredEventType = getNonEmptyString(fields["event type"]) ?? undefined;
  const normalizedStructuredEventType = normalizeEventType(structuredEventType);
  if (normalizedStructuredEventType) {
    overrides.event_type = normalizedStructuredEventType;
  } else if (structuredEventType) {
    return { overrides, unsupportedEventType: structuredEventType.trim() };
  }

  const shorthandEventTypeMatch = message.match(
    /\b(?:these|they|this|it)\s+(?:are|is)\s+actually\s+([a-z]+)\b/i
  ) ?? message.match(
    /\b(?:change|update|set|make)\s+(?:the\s+)?(?:category|type|event type)\s+(?:to|as)\s+([a-z]+)\b/i
  ) ?? message.match(
    /\bmake\s+(?:these|them|this|it)\s+([a-z]+)\b/i
  );
  const shorthandEventType = shorthandEventTypeMatch?.[1]?.trim();

  if (!("event_type" in overrides) && shorthandEventType) {
    const normalizedShorthandEventType = normalizeEventType(shorthandEventType);
    if (normalizedShorthandEventType) {
      overrides.event_type = normalizedShorthandEventType;
    } else {
      return { overrides, unsupportedEventType: shorthandEventType };
    }
  }

  return { overrides };
}

function resolvePendingEventRevisionAnalysis(
  message: string,
  actions: PendingEventActionRecord[]
): PendingEventRevisionAnalysis {
  if (actions.length === 0) {
    return { kind: "none" };
  }

  const { overrides, unsupportedEventType } = extractPendingEventRevisionOverrides(message);
  if (unsupportedEventType) {
    return { kind: "unsupported_event_type", requestedType: unsupportedEventType };
  }

  const trimmedMessage = message.trim();
  if (Object.keys(overrides).length === 0 && (trimmedMessage.endsWith("?") || DIRECT_QUERY_START_PATTERN.test(trimmedMessage))) {
    return { kind: "none" };
  }

  if (Object.keys(overrides).length === 0 && !PENDING_EVENT_REVISION_CUE_PATTERN.test(message)) {
    return { kind: "none" };
  }

  if (actions.length === 1) {
    return { kind: "apply", targetIndexes: [0], overrides };
  }

  if (PENDING_EVENT_BATCH_SCOPE_PATTERN.test(message)) {
    return {
      kind: "apply",
      targetIndexes: actions.map((_, index) => index),
      overrides,
    };
  }

  for (const candidate of PENDING_EVENT_SINGLE_SCOPE_PATTERNS) {
    if (candidate.pattern.test(message) && candidate.index < actions.length) {
      return {
        kind: "apply",
        targetIndexes: [candidate.index],
        overrides,
      };
    }
  }

  if (/\blast\b/i.test(message)) {
    return {
      kind: "apply",
      targetIndexes: [actions.length - 1],
      overrides,
    };
  }

  const normalizedMessage = message.toLowerCase();
  const titleMatches = actions
    .map((action, index) => ({
      index,
      title:
        typeof action.payload?.title === "string"
          ? action.payload.title.trim().toLowerCase()
          : null,
    }))
    .filter((entry): entry is { index: number; title: string } => Boolean(entry.title))
    .filter((entry) => normalizedMessage.includes(entry.title));

  if (titleMatches.length === 1) {
    return {
      kind: "apply",
      targetIndexes: [titleMatches[0].index],
      overrides,
    };
  }

  return {
    kind: "clarify",
    message: `I can revise these drafted events before confirmation. Should I apply that change to all ${actions.length} events, or which specific event should I update?`,
  };
}

function buildPrepareEventArgsFromPendingAction(
  action: PendingEventActionRecord
): Record<string, unknown> {
  const eventDraft = { ...(action.payload as unknown as Record<string, unknown>) };
  delete eventDraft.orgSlug;
  return eventDraft;
}

function normalizeBooleanFlag(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "n", "0"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function extractAnnouncementDraftFromHistory(messages: DraftHistoryMessage[]): Record<string, unknown> {
  const draft: Record<string, unknown> = {};

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const fields = extractStructuredFieldMap(message.content);
    const title = getNonEmptyString(fields.title);
    const body = getNonEmptyString(fields.body);
    const audience = getNonEmptyString(fields.audience);
    const isPinned = normalizeBooleanFlag(
      getNonEmptyString(fields["pin it"] ?? fields["is pinned"] ?? fields.pinned ?? fields.pin) ?? undefined
    );
    const sendNotification = normalizeBooleanFlag(
      getNonEmptyString(
        fields["send notification"] ??
          fields.notification ??
          fields.notify ??
          fields.email
      ) ?? undefined
    );

    if (title) draft.title = title;
    if (body) draft.body = body;
    if (
      audience === "all" ||
      audience === "members" ||
      audience === "active_members" ||
      audience === "alumni" ||
      audience === "parents" ||
      audience === "individuals"
    ) {
      draft.audience = audience;
    }
    if (typeof isPinned === "boolean") draft.is_pinned = isPinned;
    if (typeof sendNotification === "boolean") draft.send_notification = sendNotification;
  }

  return draft;
}

function extractDiscussionDraftFromHistory(messages: DraftHistoryMessage[]): Record<string, unknown> {
  const draft: Record<string, unknown> = {};

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const fields = extractStructuredFieldMap(message.content);
    const title = getNonEmptyString(fields.title);
    const body = getNonEmptyString(fields.body);

    if (title) {
      draft.title = title;
    }
    if (body) {
      draft.body = body;
    }
  }

  return draft;
}

function extractDiscussionReplyDraftFromHistory(
  messages: DraftHistoryMessage[]
): Record<string, unknown> {
  const draft: Record<string, unknown> = {};

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const fields = extractStructuredFieldMap(message.content);
    const discussionThreadId = getNonEmptyString(
      fields.discussion_thread_id ?? fields["discussion thread id"] ?? fields["thread id"]
    );
    const threadTitle = getNonEmptyString(fields.thread_title ?? fields["thread title"]);
    const body = getNonEmptyString(fields.body);

    if (discussionThreadId) {
      draft.discussion_thread_id = discussionThreadId;
    }
    if (threadTitle) {
      draft.thread_title = threadTitle;
    }
    if (body) {
      draft.body = body;
      continue;
    }

    const trimmed = message.content.trim();
    if (
      trimmed.length > 0 &&
      !trimmed.endsWith("?") &&
      !DISCUSSION_REPLY_PROMPT_PATTERN.test(trimmed) &&
      !CREATE_DISCUSSION_PROMPT_PATTERN.test(trimmed)
    ) {
      draft.body = trimmed;
    }
  }

  return draft;
}

function extractEventDraftFromHistory(messages: DraftHistoryMessage[]): Record<string, unknown> {
  const draft: Record<string, unknown> = {};

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const fields = extractStructuredFieldMap(message.content);
    const title = getNonEmptyString(fields.title);
    const description = getNonEmptyString(fields.description);
    const startDate = getNonEmptyString(fields["start date"]);
    const startTime = getNonEmptyString(fields["start time"]);
    const endDate = getNonEmptyString(fields["end date"]);
    const endTime = getNonEmptyString(fields["end time"]);
    const location = getNonEmptyString(fields.location);
    const eventType = normalizeEventType(getNonEmptyString(fields["event type"]) ?? undefined);
    const isPhilanthropy = normalizeBooleanFlag(
      getNonEmptyString(fields["is philanthropy"] ?? fields.philanthropy) ?? undefined
    );

    if (title) draft.title = title;
    if (description) draft.description = description;
    if (startDate) draft.start_date = startDate;
    if (startTime) draft.start_time = startTime;
    if (endDate) draft.end_date = endDate;
    if (endTime) draft.end_time = endTime;
    if (location) draft.location = location;
    if (eventType) draft.event_type = eventType;
    if (typeof isPhilanthropy === "boolean") draft.is_philanthropy = isPhilanthropy;
  }

  return draft;
}

function extractJobDraftFromHistory(messages: DraftHistoryMessage[]): Record<string, unknown> {
  const draft: Record<string, unknown> = {};

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const fields = extractStructuredFieldMap(message.content);
    const title = getNonEmptyString(fields.title);
    const company = getNonEmptyString(fields.company);
    const location = getNonEmptyString(fields.location);
    const description = getNonEmptyString(fields.description);
    const applicationUrl = getNonEmptyString(fields["application url"] ?? fields["application link"] ?? fields.link);
    const contactEmail = getNonEmptyString(fields["contact email"]);
    const industry = getNonEmptyString(fields.industry);
    const locationType = normalizeLocationType(getNonEmptyString(fields["location type"]) ?? undefined);
    const experienceLevel = normalizeExperienceLevel(getNonEmptyString(fields["experience level"]) ?? undefined);

    if (title) draft.title = title;
    if (company) draft.company = company;
    if (location) draft.location = location;
    if (description) draft.description = description;
    if (applicationUrl) draft.application_url = applicationUrl;
    if (contactEmail) draft.contact_email = contactEmail;
    if (industry) draft.industry = industry;
    if (locationType) draft.location_type = locationType;
    if (experienceLevel) draft.experience_level = experienceLevel;
  }

  return draft;
}

function extractChatMessageDraftFromHistory(messages: DraftHistoryMessage[]): Record<string, unknown> {
  const draft: Record<string, unknown> = {};

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const fields = extractStructuredFieldMap(message.content);
    const recipientMemberId = getNonEmptyString(
      fields.recipient_member_id ?? fields["recipient member id"] ?? fields["member id"]
    );
    const personQuery = getNonEmptyString(
      fields.person_query ?? fields.recipient ?? fields.to ?? fields.member
    );
    const body = getNonEmptyString(fields.body ?? fields.message);

    if (recipientMemberId) {
      draft.recipient_member_id = recipientMemberId;
    }
    if (personQuery) {
      draft.person_query = personQuery;
    }
    if (body) {
      draft.body = body;
      continue;
    }

    const trimmed = message.content.trim();
    if (
      trimmed.length > 0 &&
      !trimmed.endsWith("?") &&
      !SEND_CHAT_MESSAGE_PROMPT_PATTERN.test(trimmed) &&
      !CREATE_DISCUSSION_PROMPT_PATTERN.test(trimmed) &&
      !DISCUSSION_REPLY_PROMPT_PATTERN.test(trimmed)
    ) {
      draft.body = trimmed;
    }
  }

  return draft;
}

function extractGroupMessageDraftFromHistory(messages: DraftHistoryMessage[]): Record<string, unknown> {
  const draft: Record<string, unknown> = {};

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const fields = extractStructuredFieldMap(message.content);
    const chatGroupId = getNonEmptyString(
      fields.chat_group_id ?? fields["chat group id"] ?? fields["group id"]
    );
    const groupNameQuery = getNonEmptyString(
      fields.group_name_query ?? fields.group ?? fields.channel ?? fields["chat group"]
    );
    const body = getNonEmptyString(fields.body ?? fields.message);

    if (chatGroupId) {
      draft.chat_group_id = chatGroupId;
    }
    if (groupNameQuery) {
      draft.group_name_query = groupNameQuery;
    }
    if (body) {
      draft.body = body;
      continue;
    }

    const trimmed = message.content.trim();
    if (
      trimmed.length > 0 &&
      !trimmed.endsWith("?") &&
      !SEND_GROUP_CHAT_MESSAGE_PROMPT_PATTERN.test(trimmed) &&
      !LIST_CHAT_GROUPS_PROMPT_PATTERN.test(trimmed) &&
      !CREATE_DISCUSSION_PROMPT_PATTERN.test(trimmed) &&
      !DISCUSSION_REPLY_PROMPT_PATTERN.test(trimmed)
    ) {
      draft.body = trimmed;
    }
  }

  return draft;
}

function inferDraftTypeFromMessage(message: DraftHistoryMessage): DraftSessionType | null {
  if (message.role === "user") {
    if (CREATE_ANNOUNCEMENT_PROMPT_PATTERN.test(message.content)) {
      return "create_announcement";
    }
    if (SEND_GROUP_CHAT_MESSAGE_PROMPT_PATTERN.test(message.content)) {
      return "send_group_chat_message";
    }
    if (SEND_CHAT_MESSAGE_PROMPT_PATTERN.test(message.content)) {
      return "send_chat_message";
    }
    if (DISCUSSION_REPLY_PROMPT_PATTERN.test(message.content)) {
      return "create_discussion_reply";
    }
    if (CREATE_JOB_PROMPT_PATTERN.test(message.content) || looksLikeStructuredJobDraft(message.content)) {
      return "create_job_posting";
    }
    if (CREATE_DISCUSSION_PROMPT_PATTERN.test(message.content)) {
      return "create_discussion_thread";
    }
    if (CREATE_EVENT_PROMPT_PATTERN.test(message.content)) {
      return "create_event";
    }
    return null;
  }

  if (ANNOUNCEMENT_DRAFT_ASSISTANT_PATTERN.test(message.content)) {
    return "create_announcement";
  }
  if (JOB_DRAFT_ASSISTANT_PATTERN.test(message.content)) {
    return "create_job_posting";
  }
  if (CHAT_MESSAGE_DRAFT_ASSISTANT_PATTERN.test(message.content)) {
    return "send_chat_message";
  }
  if (GROUP_CHAT_MESSAGE_DRAFT_ASSISTANT_PATTERN.test(message.content)) {
    return "send_group_chat_message";
  }
  if (DISCUSSION_REPLY_DRAFT_ASSISTANT_PATTERN.test(message.content)) {
    return "create_discussion_reply";
  }
  if (DISCUSSION_DRAFT_ASSISTANT_PATTERN.test(message.content)) {
    return "create_discussion_thread";
  }
  if (EVENT_DRAFT_ASSISTANT_PATTERN.test(message.content)) {
    return "create_event";
  }
  return null;
}

function inferDraftSessionFromHistory(input: {
  organizationId: string;
  userId: string;
  threadId: string;
  messages: DraftHistoryMessage[];
}): DraftSessionRecord | null {
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const draftType = inferDraftTypeFromMessage(input.messages[index]);
    if (!draftType) {
      continue;
    }

    const relevantMessages = input.messages.slice(index);
    let draftPayload: Record<string, unknown>;
    let missingFields: string[];

    switch (draftType) {
      case "create_announcement":
        draftPayload = extractAnnouncementDraftFromHistory(relevantMessages);
        missingFields = (["title"] as const).filter(
          (field) => getNonEmptyString(draftPayload[field]) == null
        );
        break;
      case "send_chat_message":
        draftPayload = extractChatMessageDraftFromHistory(relevantMessages);
        missingFields = [
          ...(["body"] as const).filter((field) => getNonEmptyString(draftPayload[field]) == null),
          ...(
            getNonEmptyString(draftPayload.recipient_member_id) == null &&
            getNonEmptyString(draftPayload.person_query) == null
              ? ["person_query"]
              : []
          ),
        ];
        break;
      case "send_group_chat_message":
        draftPayload = extractGroupMessageDraftFromHistory(relevantMessages);
        missingFields = [
          ...(["body"] as const).filter((field) => getNonEmptyString(draftPayload[field]) == null),
          ...(
            getNonEmptyString(draftPayload.chat_group_id) == null &&
            getNonEmptyString(draftPayload.group_name_query) == null
              ? ["group_name_query"]
              : []
          ),
        ];
        break;
      case "create_discussion_reply":
        draftPayload = extractDiscussionReplyDraftFromHistory(relevantMessages);
        missingFields = (["body"] as const).filter(
          (field) => getNonEmptyString(draftPayload[field]) == null
        );
        break;
      case "create_job_posting":
        draftPayload = extractJobDraftFromHistory(relevantMessages);
        missingFields = [
          ...(["title", "company", "location", "industry", "experience_level", "description"] as const)
            .filter((field) => getNonEmptyString(draftPayload[field]) == null),
          ...(
            getNonEmptyString(draftPayload.application_url) == null &&
            getNonEmptyString(draftPayload.contact_email) == null
              ? ["application_url"]
              : []
          ),
        ];
        break;
      case "create_discussion_thread":
        draftPayload = extractDiscussionDraftFromHistory(relevantMessages);
        missingFields = (["title", "body"] as const).filter(
          (field) => getNonEmptyString(draftPayload[field]) == null
        );
        break;
      case "create_event":
        draftPayload = extractEventDraftFromHistory(relevantMessages);
        missingFields = (["title", "start_date", "start_time"] as const).filter(
          (field) => getNonEmptyString(draftPayload[field]) == null
        );
        break;
    }

    if (Object.keys(draftPayload).length === 0 && missingFields.length === 0) {
      continue;
    }

    const now = new Date().toISOString();
    return {
      id: `inferred-${input.threadId}`,
      organization_id: input.organizationId,
      user_id: input.userId,
      thread_id: input.threadId,
      draft_type: draftType,
      status: missingFields.length > 0 ? "collecting_fields" : "ready_for_confirmation",
      draft_payload: draftPayload as DraftSessionRecord["draft_payload"],
      missing_fields: missingFields,
      pending_action_id: null,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_at: now,
      updated_at: now,
    };
  }

  return null;
}

function buildDraftSessionContextMessage(
  draftSession: DraftSessionRecord
): string | null {
  const lines = ["## Active Draft Session"];
  lines.push(`- Draft type: ${draftSession.draft_type.replace(/_/g, " ")}`);
  if (draftSession.missing_fields.length > 0) {
    lines.push(`- Missing fields: ${draftSession.missing_fields.join(", ")}`);
  }

  const payloadLines = Object.entries(draftSession.draft_payload ?? {})
    .map(([key, value]) => {
      if (typeof value === "string" && value.trim().length > 0) {
        return `- ${key}: ${value}`;
      }
      if (Array.isArray(value) && value.length > 0) {
        return `- ${key}: ${value.join(", ")}`;
      }
      return null;
    })
    .filter((line): line is string => Boolean(line));

  if (payloadLines.length > 0) {
    lines.push("- Current draft details:");
    lines.push(...payloadLines);
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

type DiscussionReplyTargetResolution =
  | {
      kind: "resolved";
      discussionThreadId: string;
      threadTitle: string | null;
    }
  | { kind: "thread_title_required" }
  | { kind: "ambiguous"; requestedThreadTitle: string; candidateThreadTitles: string[] }
  | { kind: "not_found"; requestedThreadTitle: string }
  | { kind: "lookup_error" };

function isDiscussionThreadDemonstrative(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  return /\b(?:this thread|that thread|the thread|this discussion|that discussion|current thread|the current thread|here)\b/i.test(
    value.trim()
  );
}

function isChatRecipientDemonstrative(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  return /\b(?:this person|that person|this member|that member|him|her|them|here)\b/i.test(
    value.trim()
  );
}

function normalizeDiscussionThreadTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function extractDiscussionThreadLookupRows(data: unknown): Array<{ id: string; title: string }> {
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const id = getNonEmptyString((row as { id?: unknown }).id);
      const title = getNonEmptyString((row as { title?: unknown }).title);
      if (!id || !title) {
        return null;
      }

      return { id, title };
    })
    .filter((row): row is { id: string; title: string } => row !== null);
}

async function resolveDiscussionReplyTarget(
  supabase: {
    from(table: "discussion_threads"): {
      select(columns: string): {
        eq(column: string, value: unknown): any;
      };
    };
  },
  input: {
    organizationId: string;
    requestedThreadTitle?: string | null;
  }
): Promise<DiscussionReplyTargetResolution> {
  const requestedThreadTitle = getNonEmptyString(input.requestedThreadTitle);
  if (!requestedThreadTitle || isDiscussionThreadDemonstrative(requestedThreadTitle)) {
    return { kind: "thread_title_required" };
  }

  const normalizedTitle = normalizeDiscussionThreadTitle(requestedThreadTitle);

  const buildBaseQuery = () => {
    const baseQuery = supabase
      .from("discussion_threads")
      .select("id, title")
      .eq("organization_id", input.organizationId);
    return typeof baseQuery.is === "function" ? baseQuery.is("deleted_at", null) : baseQuery;
  };

  try {
    const exactBaseQuery = buildBaseQuery();
    const exactQuery =
      typeof exactBaseQuery.ilike === "function"
        ? exactBaseQuery.ilike("title", normalizedTitle)
        : exactBaseQuery;
    const exactOrderedQuery =
      typeof exactQuery.order === "function"
        ? exactQuery.order("title", { ascending: true })
        : exactQuery;
    const { data: exactData, error: exactError } = await exactOrderedQuery;
    if (exactError) {
      return { kind: "lookup_error" };
    }

    const exactMatches = extractDiscussionThreadLookupRows(exactData);
    if (exactMatches.length === 1) {
      return {
        kind: "resolved",
        discussionThreadId: exactMatches[0].id,
        threadTitle: exactMatches[0].title,
      };
    }

    if (exactMatches.length >= 2 && exactMatches.length <= 5) {
      return {
        kind: "ambiguous",
        requestedThreadTitle: normalizedTitle,
        candidateThreadTitles: [...new Set(exactMatches.map((row) => row.title))],
      };
    }

    if (exactMatches.length > 5) {
      return { kind: "not_found", requestedThreadTitle: normalizedTitle };
    }

    const substringBaseQuery = buildBaseQuery();
    const substringPattern = `%${normalizedTitle}%`;
    const substringQuery =
      typeof substringBaseQuery.ilike === "function"
        ? substringBaseQuery.ilike("title", substringPattern)
        : substringBaseQuery;
    const substringOrderedQuery =
      typeof substringQuery.order === "function"
        ? substringQuery.order("title", { ascending: true })
        : substringQuery;
    const { data: substringData, error: substringError } = await substringOrderedQuery;
    if (substringError) {
      return { kind: "lookup_error" };
    }

    const substringMatches = extractDiscussionThreadLookupRows(substringData);
    if (substringMatches.length === 1) {
      return {
        kind: "resolved",
        discussionThreadId: substringMatches[0].id,
        threadTitle: substringMatches[0].title,
      };
    }

    if (substringMatches.length >= 2 && substringMatches.length <= 5) {
      return {
        kind: "ambiguous",
        requestedThreadTitle: normalizedTitle,
        candidateThreadTitles: [...new Set(substringMatches.map((row) => row.title))],
      };
    }

    return { kind: "not_found", requestedThreadTitle: normalizedTitle };
  } catch {
    return { kind: "lookup_error" };
  }
}

function buildDiscussionReplyClarificationPayload(
  draft: Record<string, unknown>,
  resolution: Exclude<DiscussionReplyTargetResolution, { kind: "resolved" }>
): PendingActionToolPayload {
  switch (resolution.kind) {
    case "thread_title_required":
      return {
        state: "missing_fields",
        draft,
        missing_fields: ["thread_title"],
        clarification_kind: "thread_title_required",
      };
    case "ambiguous":
      return {
        state: "missing_fields",
        draft,
        missing_fields: ["thread_title"],
        clarification_kind: "thread_title_ambiguous",
        requested_thread_title: resolution.requestedThreadTitle,
        candidate_thread_titles: resolution.candidateThreadTitles,
      };
    case "not_found":
      return {
        state: "missing_fields",
        draft,
        missing_fields: ["thread_title"],
        clarification_kind: "thread_title_not_found",
        requested_thread_title: resolution.requestedThreadTitle,
      };
    case "lookup_error":
      return {
        state: "missing_fields",
        draft,
        missing_fields: [],
        clarification_kind: "thread_lookup_failed",
      };
  }
}

function shouldContinueDraftSession(
  message: string,
  draftSession: DraftSessionRecord,
  routing: ReturnType<typeof resolveSurfaceRouting>
): boolean {
  const isAnnouncementPrompt = CREATE_ANNOUNCEMENT_PROMPT_PATTERN.test(message);
  const isJobPrompt = CREATE_JOB_PROMPT_PATTERN.test(message);
  const isChatMessagePrompt = SEND_CHAT_MESSAGE_PROMPT_PATTERN.test(message);
  const isDiscussionReplyPrompt = DISCUSSION_REPLY_PROMPT_PATTERN.test(message);
  const isDiscussionPrompt = CREATE_DISCUSSION_PROMPT_PATTERN.test(message);
  const isEventPrompt = EXPLICIT_EVENT_DRAFT_SWITCH_PATTERN.test(message);

  if (draftSession.draft_type === "create_announcement" && isAnnouncementPrompt) {
    return true;
  }

  if (draftSession.draft_type === "create_job_posting" && isJobPrompt) {
    return true;
  }

  if (draftSession.draft_type === "send_chat_message" && isChatMessagePrompt) {
    return true;
  }

  if (draftSession.draft_type === "create_discussion_reply" && isDiscussionReplyPrompt) {
    return true;
  }

  if (draftSession.draft_type === "create_discussion_thread" && isDiscussionPrompt) {
    return true;
  }

  if (draftSession.draft_type === "create_event" && isEventPrompt) {
    return true;
  }

  if (
    (draftSession.draft_type === "create_announcement" &&
      (isJobPrompt || isChatMessagePrompt || isDiscussionReplyPrompt || isDiscussionPrompt || isEventPrompt)) ||
    (draftSession.draft_type === "create_job_posting" &&
      (isAnnouncementPrompt || isChatMessagePrompt || isDiscussionReplyPrompt || isDiscussionPrompt || isEventPrompt)) ||
    (draftSession.draft_type === "send_chat_message" &&
      (isAnnouncementPrompt || isJobPrompt || isDiscussionReplyPrompt || isDiscussionPrompt || isEventPrompt)) ||
    (draftSession.draft_type === "create_discussion_reply" &&
      (isAnnouncementPrompt || isJobPrompt || isChatMessagePrompt || isDiscussionPrompt || isEventPrompt)) ||
    (draftSession.draft_type === "create_discussion_thread" &&
      (isAnnouncementPrompt || isJobPrompt || isChatMessagePrompt || isDiscussionReplyPrompt || isEventPrompt)) ||
    (draftSession.draft_type === "create_event" &&
      (isAnnouncementPrompt || isJobPrompt || isChatMessagePrompt || isDiscussionReplyPrompt || isDiscussionPrompt))
  ) {
    return false;
  }

  if (DRAFT_CANCEL_PATTERN.test(message)) {
    return false;
  }

  if (routing.intentType === "navigation" || routing.intentType === "casual") {
    return false;
  }

  const trimmed = message.trim();
  if (trimmed.endsWith("?") || DIRECT_QUERY_START_PATTERN.test(trimmed)) {
    return false;
  }

  return true;
}

export function createChatPostHandler(deps: ChatRouteDeps = {}) {
  const createClientFn = deps.createClient ?? createClient;
  const getAiOrgContextFn = deps.getAiOrgContext ?? getAiOrgContext;
  const buildPromptContextFn = deps.buildPromptContext ?? buildPromptContext;
  const createZaiClientFn = deps.createZaiClient ?? createZaiClient;
  const getZaiModelFn = deps.getZaiModel ?? getZaiModel;
  const composeResponseFn = deps.composeResponse ?? composeResponse;
  const logAiRequestFn = deps.logAiRequest ?? logAiRequest;
  const resolveOwnThreadFn = deps.resolveOwnThread ?? resolveOwnThread;
  const retrieveRelevantChunksFn = deps.retrieveRelevantChunks ?? retrieveRelevantChunks;
  const executeToolCallFn = deps.executeToolCall ?? executeToolCall;
  const buildTurnExecutionPolicyFn =
    deps.buildTurnExecutionPolicy ?? buildTurnExecutionPolicy;
  const verifyToolBackedResponseFn =
    deps.verifyToolBackedResponse ?? verifyToolBackedResponse;
  const classifySafetyFn = deps.classifySafety ?? classifySafety;
  const verifyRagGroundingFn = deps.verifyRagGrounding ?? verifyRagGrounding;
  const trackOpsEventServerFn = deps.trackOpsEventServer ?? trackOpsEventServer;
  const getDraftSessionFn = deps.getDraftSession ?? getDraftSession;
  const saveDraftSessionFn = deps.saveDraftSession ?? saveDraftSession;
  const clearDraftSessionFn = deps.clearDraftSession ?? clearDraftSession;
  const loadRouteEntityContextFn = deps.loadRouteEntityContext ?? loadRouteEntityContext;

  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string }> }
  ) {
    const { orgId } = await params;
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    const stageTimings = createStageTimings(requestId);
    const cacheDisabled = process.env.DISABLE_AI_CACHE === "true";
    const baseLogContext: AiLogContext = { requestId, orgId };
    // 1. Rate limit — get user first to allow per-user limiting
    const supabase = await createClientFn();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(request, {
      orgId,
      userId: user?.id ?? null,
      feature: "ai-chat",
      limitPerIp: 30,
      limitPerUser: 20,
      limitPerOrg: getAiOrgRateLimit(),
    });
    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    // 2. Auth — validate role (admins always allowed; members/alumni gated by
    // AI_MEMBER_ACCESS_KILL env var inside getAiOrgContext)
    const ctx = await runTimedStage(stageTimings, "auth_org_context", async () =>
      getAiOrgContextFn(
        orgId,
        user,
        rateLimit,
        { supabase, logContext: baseLogContext },
        { allowedRoles: ["admin", "active_member", "alumni"] },
      )
    );
    if (!ctx.ok) return ctx.response;
    const canUseDraftSessions =
      supportsDraftSessionsStore(ctx.serviceSupabase) ||
      Boolean(deps.getDraftSession || deps.saveDraftSession || deps.clearDraftSession);
    const requestLogContext: AiLogContext = {
      ...baseLogContext,
      userId: ctx.userId,
    };

    // 3. Validate body and build policy
    let validatedBody: ReturnType<typeof sendMessageSchema.parse> extends infer T ? T : never;
    let message = "";
    let surface: typeof validatedBody.surface = "general";
    let existingThreadId: string | undefined;
    let idempotencyKey = "";
    let currentPath: string | undefined;
    let attachment: ChatAttachment | undefined;
    let messageSafety!: ReturnType<typeof assessAiMessageSafety>;
    let routing!: ReturnType<typeof resolveSurfaceRouting>;
    let effectiveSurface!: CacheSurface;
    let resolvedIntent!: ReturnType<typeof resolveSurfaceRouting>["intent"];
    let resolvedIntentType!: ReturnType<typeof resolveSurfaceRouting>["intentType"];
    let executionPolicy!: TurnExecutionPolicy;
    let usesSharedStaticContext = false;
    let pass1Tools: ReturnType<typeof getPass1Tools>;
    let activeDraftSession: DraftSessionRecord | null = null;
    let routeEntityContext: RouteEntityContext | null = null;
    let activePendingEventActions: PendingEventActionRecord[] = [];
    let pendingEventRevisionAnalysis: PendingEventRevisionAnalysis = { kind: "none" };
    let cacheStatus: CacheStatus;
    let cacheEntryId: string | undefined;
    let cacheBypassReason: string | undefined;

    try {
      await runTimedStage(stageTimings, "request_validation_policy", async () => {
        validatedBody = await validateJson(request, sendMessageSchema);
        ({
          message,
          surface,
          threadId: existingThreadId,
          idempotencyKey,
          currentPath,
          attachment,
        } = validatedBody);
        messageSafety = assessAiMessageSafety(message);
        routing = resolveSurfaceRouting(messageSafety.promptSafeMessage, surface);
        effectiveSurface = routing.effectiveSurface as CacheSurface;
        resolvedIntent = routing.intent;
        resolvedIntentType = routing.intentType;

        const eligibility = checkCacheEligibility({
          message: messageSafety.promptSafeMessage,
          threadId: existingThreadId,
          surface: effectiveSurface,
          bypassCache: validatedBody.bypassCache,
        });

        executionPolicy = buildTurnExecutionPolicyFn({
          message: messageSafety.promptSafeMessage,
          threadId: existingThreadId,
          requestedSurface: surface,
          routing,
          cacheEligibility: eligibility,
        });
        usesSharedStaticContext =
          executionPolicy.contextPolicy === "shared_static";
        stageTimings.retrieval = {
          decision: executionPolicy.retrieval.mode,
          reason: executionPolicy.retrieval.reason,
        };

        cacheStatus = cacheDisabled
          ? "disabled"
          : validatedBody.bypassCache
            ? "bypass"
            : "ineligible";
        cacheEntryId = undefined;
        cacheBypassReason = undefined;

        if (cacheDisabled && executionPolicy.cachePolicy === "lookup_exact") {
          cacheStatus = "disabled";
          cacheBypassReason = "disabled_via_env";
        } else if (executionPolicy.cachePolicy === "skip") {
          cacheBypassReason =
            executionPolicy.profile === "casual"
              ? "casual_turn"
              : executionPolicy.profile === "out_of_scope"
                ? "out_of_scope_request"
                : executionPolicy.profile === "out_of_scope_unrelated"
                  ? "scope_refusal"
                  : eligibility.eligible
                    ? executionPolicy.reasons[0]
                    : eligibility.reason;
        } else if (!eligibility.eligible) {
          cacheBypassReason = eligibility.reason;
        }

        pass1Tools = getPass1Tools(
          messageSafety.promptSafeMessage,
          effectiveSurface,
          executionPolicy.toolPolicy,
          executionPolicy.intentType,
          attachment,
          currentPath,
          Boolean(ctx.enterpriseId),
          ctx.enterpriseRole,
        );
        pass1Tools = filterAllowedTools(pass1Tools, {
          role: ctx.role,
          enterpriseRole: ctx.enterpriseRole,
        });
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        return validationErrorResponse(err);
      }
      return NextResponse.json(
        { error: "Invalid JSON" },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const requestNow = new Date().toISOString();
    const requestTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    const skipRagRetrieval = executionPolicy.retrieval.mode === "skip";
    let usesToolFirstContext =
      !usesSharedStaticContext &&
      executionPolicy.retrieval.reason === "tool_only_structured_query" &&
      isToolFirstEligible(pass1Tools);

    // 4. Validate provided thread ownership before any cleanup or writes
    let threadId = existingThreadId;
    let threadMetadata: AiThreadMetadata = {};
    if (threadId) {
      const resolution = await runTimedStage(
        stageTimings,
        "thread_resolution",
        async () =>
          resolveOwnThreadFn(
            threadId!,
            ctx.userId,
            ctx.orgId,
            ctx.serviceSupabase,
            { ...requestLogContext, threadId: threadId! }
          )
      );
      if (!resolution.ok) {
        return NextResponse.json(
          { error: resolution.message },
          { status: resolution.status, headers: rateLimit.headers }
        );
      }
      threadMetadata = resolution.thread.metadata;

      if (canUseDraftSessions) {
        try {
          activeDraftSession = await getDraftSessionFn(ctx.serviceSupabase, {
            organizationId: ctx.orgId,
            userId: ctx.userId,
            threadId,
          });

          if (activeDraftSession && isDraftSessionExpired(activeDraftSession)) {
            try {
              await clearDraftSessionFn(ctx.serviceSupabase, {
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
                messageSafety.promptSafeMessage,
                activeDraftSession,
                routing
              )
            ) {
              pass1Tools = filterAllowedTools(
                [AI_TOOL_MAP[getToolNameForDraftType(activeDraftSession.draft_type)]],
                {
                  role: ctx.role,
                  enterpriseRole: ctx.enterpriseRole,
                },
              );
            } else {
              try {
                await clearDraftSessionFn(ctx.serviceSupabase, {
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
                    (row: any): row is { role: "user" | "assistant"; content: string } =>
                      (row?.role === "user" || row?.role === "assistant") &&
                      typeof row?.content === "string" &&
                      row.content.trim().length > 0
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
                  messageSafety.promptSafeMessage,
                  inferredDraftSession,
                  routing
                )
              ) {
                activeDraftSession = inferredDraftSession;
                pass1Tools = filterAllowedTools(
                  [AI_TOOL_MAP[getToolNameForDraftType(inferredDraftSession.draft_type)]],
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
            messageSafety.promptSafeMessage,
            activePendingEventActions
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
    } else {
      skipStage(stageTimings, "thread_resolution");
    }

    usesToolFirstContext =
      !usesSharedStaticContext &&
      executionPolicy.retrieval.reason === "tool_only_structured_query" &&
      isToolFirstEligible(pass1Tools);

    const routeEntityRef = extractRouteEntity(currentPath);
    if (routeEntityRef) {
      try {
        routeEntityContext = await loadRouteEntityContextFn({
          supabase: ctx.supabase as any,
          organizationId: ctx.orgId,
          currentPath,
          routeEntity: routeEntityRef,
        });
        if (!routeEntityContext) {
          aiLog("warn", "ai-chat", "route entity context omitted", requestLogContext, {
            currentPath,
            routeEntityKind: routeEntityRef.kind,
          });
        }
      } catch (error) {
        aiLog("error", "ai-chat", "route entity resolution failed", requestLogContext, {
          error,
          currentPath,
          routeEntityKind: routeEntityRef.kind,
        });
        if (routeEntityRef.kind === "discussion_thread") {
          return NextResponse.json(
            { error: "Failed to resolve the current discussion thread" },
            { status: 500, headers: rateLimit.headers }
          );
        }
      }
    }

    // 5. Abandoned stream cleanup (5-min threshold)
    if (existingThreadId) {
      skipStage(stageTimings, "abandoned_stream_cleanup");
      void ctx.supabase
        .from("ai_messages")
        .update({ status: "error", content: INTERRUPTED_ASSISTANT_MESSAGE })
        .eq("thread_id", existingThreadId)
        .eq("role", "assistant")
        .in("status", ["pending", "streaming"])
        .lt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
        .then(({ error: cleanupError }: { error: unknown }) => {
          if (cleanupError) {
            aiLog("error", "ai-chat", "abandoned stream cleanup failed", {
              ...requestLogContext,
              threadId: existingThreadId,
            }, { error: cleanupError });
          }
        })
        .catch((cleanupError: unknown) => {
          aiLog("error", "ai-chat", "abandoned stream cleanup failed", {
            ...requestLogContext,
            threadId: existingThreadId,
          }, { error: cleanupError });
        });
    } else {
      skipStage(stageTimings, "abandoned_stream_cleanup");
    }

    // 6. Idempotency check — look up by idempotency_key
    const { data: existingMsg, error: idempError } = await runTimedStage(
      stageTimings,
      "idempotency_lookup",
      async () =>
        ctx.supabase
          .from("ai_messages")
          .select("id, status, thread_id, created_at")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle()
    );

    if (idempError) {
      aiLog("error", "ai-chat", "idempotency check failed", requestLogContext, {
        error: idempError,
      });
      return NextResponse.json({ error: "Failed to check message idempotency" }, { status: 500 });
    }

    if (existingMsg) {
      if (existingMsg.status === "complete") {
        stageTimings.retrieval = {
          decision: "skip",
          reason: "cache_hit",
        };
        skipRemainingStages(stageTimings, "cache_lookup");

        // Find the assistant reply that immediately follows the user message with this idempotency key
        const { data: assistantReplay, error: assistantReplayError } = await ctx.supabase
          .from("ai_messages")
          .select("content")
          .eq("thread_id", existingMsg.thread_id)
          .eq("role", "assistant")
          .eq("status", "complete")
          .gt("created_at", existingMsg.created_at)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (assistantReplayError) {
          aiLog("error", "ai-chat", "idempotency replay lookup failed", {
            ...requestLogContext,
            threadId: existingMsg.thread_id,
          }, { error: assistantReplayError });
          return NextResponse.json(
            { error: "Failed to replay completed response" },
            { status: 500, headers: rateLimit.headers }
          );
        }

        if (!assistantReplay?.content) {
          return NextResponse.json(
            { error: "Request already in progress", threadId: existingMsg.thread_id },
            { status: 409, headers: rateLimit.headers }
          );
        }

        return buildSseResponse(
          createSSEStream(async (enqueue) => {
            enqueue({ type: "chunk", content: assistantReplay.content });
            enqueue({
              type: "done",
              threadId: existingMsg.thread_id,
              replayed: true,
              cache: {
                status: cacheStatus,
                ...(cacheBypassReason ? { bypassReason: cacheBypassReason } : {}),
              },
            });
          }),
          { ...SSE_HEADERS, ...rateLimit.headers },
          existingMsg.thread_id
        );
      }
      return NextResponse.json(
        { error: "Request already in progress", threadId: existingMsg.thread_id },
        { status: 409, headers: rateLimit.headers }
      );
    }

    let preInitCacheHit:
      | {
          id: string;
          responseContent: string;
        }
      | undefined;
    let preInitCacheLookupPerformed = false;

    if (
      !cacheDisabled &&
      executionPolicy.cachePolicy === "lookup_exact" &&
      !existingThreadId &&
      messageSafety.riskLevel === "none"
    ) {
      preInitCacheLookupPerformed = true;
      const cacheKey = buildSemanticCacheKeyParts({
        message: messageSafety.promptSafeMessage,
        orgId: ctx.orgId,
        role: ctx.role,
      });

      const cacheResult = await runTimedStage(stageTimings, "cache_lookup", async () =>
        lookupSemanticCache({
          cacheKey,
          orgId: ctx.orgId,
          surface: effectiveSurface,
          supabase: ctx.serviceSupabase,
          logContext: requestLogContext,
        })
      );

      if (cacheResult.ok) {
        preInitCacheHit = {
          id: cacheResult.hit.id,
          responseContent: cacheResult.hit.responseContent,
        };
      } else {
        cacheStatus = cacheResult.reason === "miss" ? "miss" : "error";
        if (cacheResult.reason === "error") {
          cacheBypassReason = "cache_lookup_failed";
        }
      }
    }

    // 7+8. Atomically create/reuse thread and insert user message via RPC
    const { data: initResult, error: initError } = await runTimedStage(
      stageTimings,
      "init_chat_rpc",
      async () =>
        (ctx.serviceSupabase as any).rpc("init_ai_chat", {
          p_user_id: ctx.userId,
          p_org_id: ctx.orgId,
          p_surface: surface,
          p_title: message.slice(0, 100),
          p_message: message,
          p_idempotency_key: idempotencyKey,
          p_thread_id: threadId ?? null,
          p_intent: resolvedIntent,
          p_context_surface: effectiveSurface,
          p_intent_type: resolvedIntentType,
        })
    );

    if (initError || !initResult) {
      aiLog("error", "ai-chat", "init_ai_chat RPC failed", requestLogContext, {
        error: initError,
      });
      return NextResponse.json(
        { error: "Failed to initialize chat" },
        { status: 500, headers: rateLimit.headers }
      );
    }

    threadId = initResult.thread_id;

    const insertAssistantMessage = async (input: {
      content: string | null;
      status: "pending" | "complete";
    }) =>
      ctx.supabase
        .from("ai_messages")
        .insert({
          thread_id: threadId,
          org_id: ctx.orgId,
          user_id: ctx.userId,
          role: "assistant",
          intent: resolvedIntent,
          intent_type: resolvedIntentType,
          context_surface: effectiveSurface,
          status: input.status,
          content: input.content,
        })
        .select("id")
        .single();

    if (messageSafety.riskLevel !== "none") {
      cacheStatus = "bypass";
      cacheBypassReason = `message_safety_${messageSafety.riskLevel}`;
      stageTimings.retrieval = {
        decision: "skip",
        reason: "message_safety_blocked",
      };
      skipRemainingStages(stageTimings, "cache_lookup");

      const { data: safetyAssistantMsg, error: safetyAssistantError } =
        await insertAssistantMessage({
          content: MESSAGE_SAFETY_FALLBACK,
          status: "complete",
        });

      if (safetyAssistantError || !safetyAssistantMsg) {
        aiLog("error", "ai-chat", "safety assistant message failed", {
          ...requestLogContext,
          threadId: threadId!,
        }, { error: safetyAssistantError });
        return NextResponse.json(
          { error: "Failed to create response" },
          { status: 500, headers: rateLimit.headers }
        );
      }

      void trackOpsEventServerFn(
        "api_error",
        {
          endpoint_group: "ai-safety",
          http_status: 200,
          error_code: `message_safety_${messageSafety.riskLevel}`,
          retryable: false,
        },
        ctx.orgId
      );

      await logAiRequestFn(ctx.serviceSupabase, {
        threadId: threadId!,
        messageId: safetyAssistantMsg.id,
        userId: ctx.userId,
        orgId: ctx.orgId,
        intent: resolvedIntent,
        intentType: resolvedIntentType,
        latencyMs: Date.now() - startTime,
        error: `message_safety_${messageSafety.riskLevel}:${messageSafety.reasons.join(",")}`,
        cacheStatus,
        cacheBypassReason,
        contextSurface: effectiveSurface,
        stageTimings: finalizeStageTimings(
          stageTimings,
          "message_safety_blocked",
          Date.now() - startTime
        ),
      }, {
        ...requestLogContext,
        threadId: threadId!,
      });

      return buildSseResponse(
        createSSEStream(async (enqueue) => {
          enqueue({ type: "chunk", content: MESSAGE_SAFETY_FALLBACK });
          enqueue({
            type: "done",
            threadId: threadId!,
            cache: {
              status: cacheStatus,
              ...(cacheBypassReason ? { bypassReason: cacheBypassReason } : {}),
            },
          });
        }),
        { ...SSE_HEADERS, ...rateLimit.headers },
        threadId!
      );
    }

    if (executionPolicy.profile === "out_of_scope_unrelated") {
      const refusalReason =
        executionPolicy.reasons[0]?.replace(/^out_of_scope_/, "") ??
        "unrelated_pattern";
      cacheStatus = "bypass";
      cacheBypassReason = "scope_refusal";
      stageTimings.retrieval = {
        decision: "skip",
        reason: "out_of_scope_request",
      };
      skipRemainingStages(stageTimings, "cache_lookup");

      const { data: scopeAssistantMsg, error: scopeAssistantError } =
        await insertAssistantMessage({
          content: SCOPE_REFUSAL_FALLBACK,
          status: "complete",
        });

      if (scopeAssistantError || !scopeAssistantMsg) {
        aiLog("error", "ai-chat", "scope refusal assistant message failed", {
          ...requestLogContext,
          threadId: threadId!,
        }, { error: scopeAssistantError });
        return NextResponse.json(
          { error: "Failed to create response" },
          { status: 500, headers: rateLimit.headers }
        );
      }

      void trackOpsEventServerFn(
        "api_error",
        {
          endpoint_group: "ai-scope",
          http_status: 200,
          error_code: `scope_refusal_${refusalReason}`,
          retryable: false,
        },
        ctx.orgId
      );

      await logAiRequestFn(ctx.serviceSupabase, {
        threadId: threadId!,
        messageId: scopeAssistantMsg.id,
        userId: ctx.userId,
        orgId: ctx.orgId,
        intent: resolvedIntent,
        intentType: resolvedIntentType,
        latencyMs: Date.now() - startTime,
        error: `scope_refusal:${refusalReason}`,
        cacheStatus,
        cacheBypassReason,
        contextSurface: effectiveSurface,
        stageTimings: finalizeStageTimings(
          stageTimings,
          "out_of_scope_request",
          Date.now() - startTime
        ),
      }, {
        ...requestLogContext,
        threadId: threadId!,
      });

      return buildSseResponse(
        createSSEStream(async (enqueue) => {
          enqueue({ type: "chunk", content: SCOPE_REFUSAL_FALLBACK });
          enqueue({
            type: "done",
            threadId: threadId!,
            cache: {
              status: cacheStatus,
              bypassReason: cacheBypassReason,
            },
          });
        }),
        { ...SSE_HEADERS, ...rateLimit.headers },
        threadId!
      );
    }

    if (preInitCacheHit) {
      const { data: cachedAssistantMsg, error: cachedAssistantError } =
        await insertAssistantMessage({
          content: preInitCacheHit.responseContent,
          status: "complete",
        });

      if (cachedAssistantError || !cachedAssistantMsg) {
        aiLog("error", "ai-chat", "cache hit assistant message failed", {
          ...requestLogContext,
          threadId: threadId!,
        }, { error: cachedAssistantError });
        cacheStatus = "error";
        cacheBypassReason = "cache_hit_persist_failed";
      } else {
        cacheStatus = "hit_exact";
        cacheEntryId = preInitCacheHit.id;
        stageTimings.retrieval = {
          decision: "skip",
          reason: "cache_hit",
        };
        skipRemainingStages(stageTimings, "rag_retrieval");

        const cachedStream = createSSEStream(async (enqueue) => {
          enqueue({ type: "chunk", content: preInitCacheHit!.responseContent });
          enqueue({
            type: "done",
            threadId: threadId!,
            replayed: true,
            cache: { status: "hit_exact", entryId: preInitCacheHit!.id },
          });
        });

        await logAiRequestFn(ctx.serviceSupabase, {
          threadId: threadId!,
          messageId: cachedAssistantMsg.id,
          userId: ctx.userId,
          orgId: ctx.orgId,
          intent: resolvedIntent,
          intentType: resolvedIntentType,
          latencyMs: Date.now() - startTime,
          cacheStatus: "hit_exact",
          cacheEntryId: preInitCacheHit.id,
          contextSurface: effectiveSurface,
          stageTimings: finalizeStageTimings(stageTimings, "cache_hit", Date.now() - startTime),
        }, {
          ...requestLogContext,
          threadId: threadId!,
        });

        return buildSseResponse(
          cachedStream,
          { ...SSE_HEADERS, ...rateLimit.headers },
          threadId!
        );
      }
    }

    if (
      !preInitCacheLookupPerformed &&
      !cacheDisabled &&
      executionPolicy.cachePolicy === "lookup_exact"
    ) {
      const cacheKey = buildSemanticCacheKeyParts({
        message: messageSafety.promptSafeMessage,
        orgId: ctx.orgId,
        role: ctx.role,
      });

      const cacheResult = await runTimedStage(stageTimings, "cache_lookup", async () =>
        lookupSemanticCache({
          cacheKey,
          orgId: ctx.orgId,
          surface: effectiveSurface,
          supabase: ctx.serviceSupabase,
          logContext: {
            ...requestLogContext,
            threadId: threadId!,
          },
        })
      );

      if (cacheResult.ok) {
        cacheStatus = "hit_exact";
        cacheEntryId = cacheResult.hit.id;
        stageTimings.retrieval = {
          decision: "skip",
          reason: "cache_hit",
        };
        skipRemainingStages(stageTimings, "rag_retrieval");

        const { data: cachedAssistantMsg, error: cachedAssistantError } =
          await insertAssistantMessage({
            content: cacheResult.hit.responseContent,
            status: "complete",
          });

        if (cachedAssistantError || !cachedAssistantMsg) {
          aiLog("error", "ai-chat", "cache hit assistant message failed", {
            ...requestLogContext,
            threadId: threadId!,
          }, { error: cachedAssistantError });
          cacheStatus = "error";
          cacheBypassReason = "cache_hit_persist_failed";
        } else {
          const cachedStream = createSSEStream(async (enqueue) => {
            enqueue({ type: "chunk", content: cacheResult.hit.responseContent });
            enqueue({
              type: "done",
              threadId: threadId!,
              replayed: true,
              cache: { status: "hit_exact", entryId: cacheResult.hit.id },
            });
          });

          await logAiRequestFn(ctx.serviceSupabase, {
            threadId: threadId!,
            messageId: cachedAssistantMsg.id,
            userId: ctx.userId,
            orgId: ctx.orgId,
            intent: resolvedIntent,
            intentType: resolvedIntentType,
            latencyMs: Date.now() - startTime,
            cacheStatus: "hit_exact",
            cacheEntryId: cacheResult.hit.id,
            contextSurface: effectiveSurface,
            stageTimings: finalizeStageTimings(stageTimings, "cache_hit", Date.now() - startTime),
          }, {
            ...requestLogContext,
            threadId: threadId!,
          });

          return buildSseResponse(
            cachedStream,
            { ...SSE_HEADERS, ...rateLimit.headers },
            threadId!
          );
        }
      } else {
        cacheStatus = cacheResult.reason === "miss" ? "miss" : "error";
        if (cacheResult.reason === "error") {
          cacheBypassReason = "cache_lookup_failed";
        }
      }
    } else if (!preInitCacheLookupPerformed) {
      skipStage(stageTimings, "cache_lookup");
    }

    let ragChunks: RagChunkInput[] = [];
    let ragChunkCount = 0;
    let ragTopSimilarity: number | undefined;
    let ragError: string | undefined;

    const hasEmbeddingKey = !!process.env.EMBEDDING_API_KEY;
    if (hasEmbeddingKey && !skipRagRetrieval) {
      try {
        const retrieved = await runTimedStage(stageTimings, "rag_retrieval", async () =>
          retrieveRelevantChunksFn({
            query: messageSafety.promptSafeMessage,
            orgId: ctx.orgId,
            serviceSupabase: ctx.serviceSupabase,
            logContext: {
              ...requestLogContext,
              threadId: threadId!,
            },
          })
        );
        ragChunkCount = retrieved.length;
        if (retrieved.length > 0) {
          ragTopSimilarity = Math.max(...retrieved.map((c) => c.similarity));
          ragChunks = retrieved.map((c) => ({
            contentText: c.contentText,
            sourceTable: c.sourceTable,
            metadata: c.metadata,
          }));
        }
      } catch (err) {
        ragError = err instanceof Error ? err.message : "rag_retrieval_failed";
        aiLog("error", "ai-chat", "RAG retrieval failed (continuing without)", {
          ...requestLogContext,
          threadId: threadId!,
        }, { error: err });
      }
    } else {
      if (!hasEmbeddingKey && executionPolicy.retrieval.mode === "allow") {
        stageTimings.retrieval = {
          decision: "not_available",
          reason: "embedding_key_missing",
        };
      }
      skipStage(stageTimings, "rag_retrieval");
    }

    const { data: assistantMsg, error: assistantError } = await runTimedStage(
      stageTimings,
      "assistant_placeholder_write",
      async () =>
        insertAssistantMessage({
          content: null,
          status: "pending",
        })
    );

    if (assistantError || !assistantMsg) {
      aiLog("error", "ai-chat", "assistant placeholder failed", {
        ...requestLogContext,
        threadId: threadId!,
      }, { error: assistantError });
      return NextResponse.json(
        { error: "Failed to create response" },
        { status: 500, headers: rateLimit.headers }
      );
    }

    const assistantMessageId = assistantMsg.id;

    // 10–12. Stream SSE response
    const stream = createSSEStream(async (enqueue, streamSignal) => {
      let fullContent = "";
      let pass1BufferedContent = "";
      let pass2BufferedContent = "";
      let safetyVerdict: SafetyVerdict | undefined;
      let safetyCategories: string[] | undefined;
      let safetyLatencyMs: number | undefined;
      let ragGrounded: boolean | undefined;
      let ragGroundingFailures: string[] | undefined;
      let ragGroundingLatencyMs: number | undefined;
      let ragGroundingAudited: RagGroundingMode | undefined;
      const safetyGateDisabled = process.env.DISABLE_SAFETY_GATE === "1";
      const safetyGateShadow = process.env.SAFETY_GATE_SHADOW === "1";
      const ragGroundingDisabled = process.env.DISABLE_RAG_GROUNDING === "1";
      const ragGroundingMode: RagGroundingMode =
        (process.env.RAG_GROUNDING_MODE as RagGroundingMode) || "shadow";
      const ragGroundingMinChunks = Number.parseInt(
        process.env.RAG_GROUNDING_MIN_CHUNKS ?? "1",
        10
      );

      const applySafetyGate = async (buffered: string): Promise<string> => {
        if (safetyGateDisabled || !buffered) return buffered;
        try {
          const ownedEmails = new Set<string>();
          const ownedPhones = new Set<string>();
          const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
          // RAG chunks: emails are widely distributed directory identifiers
          // (low marginal harm); phones may be personal cell numbers embedded
          // in free-text bodies. Allowlist emails only. Phones from RAG free
          // text are NOT allowlisted — the gate should flag them if echoed.
          for (const chunk of ragChunks) {
            const text = chunk.contentText ?? "";
            const emailMatches = text.match(emailRegex) ?? [];
            for (const m of emailMatches) ownedEmails.add(m.toLowerCase());
          }
          // Tool-row identifiers are org-owned data visible to this user by
          // policy. Emails: flat regex over serialized JSON is fine.
          // Phones: only collect from explicitly-modeled `phone_number`
          // fields to avoid a poisoned free-text tool blob widening the
          // allowlist. `list_parents` + `list_alumni` are the two surfaces
          // that emit a structured phone_number.
          try {
            const serialized = JSON.stringify(successfulToolResults);
            const emailMatches = serialized.match(emailRegex) ?? [];
            for (const m of emailMatches) ownedEmails.add(m.toLowerCase());
          } catch {
            // Circular-ref tool data; skip.
          }
          collectPhoneNumberFields(successfulToolResults, ownedPhones);
          const result = await classifySafetyFn({
            content: buffered,
            orgContext: { ownedEmails, ownedPhones },
          });
          safetyVerdict = result.verdict;
          safetyCategories = result.categories;
          safetyLatencyMs = result.latencyMs;

          if (result.verdict === "unsafe") {
            void trackOpsEventServerFn(
              "api_error",
              {
                endpoint_group: safetyGateShadow
                  ? "ai-safety-gate-shadow"
                  : "ai-safety-gate",
                http_status: 200,
                error_code: safetyGateShadow
                  ? "safety_gate_shadow_unsafe"
                  : "safety_gate_blocked",
                retryable: false,
              },
              ctx.orgId
            );
            if (!safetyGateShadow) {
              return SAFETY_FALLBACK_TEXT;
            }
          }
          return buffered;
        } catch (err) {
          aiLog("warn", "ai-safety-gate", "classify failed", {
            ...requestLogContext,
            threadId: threadId!,
          }, { error: err });
          return buffered;
        }
      };

      const applyRagGrounding = async (buffered: string): Promise<string> => {
        if (
          ragGroundingDisabled ||
          ragGroundingMode === "bypass" ||
          !buffered ||
          ragChunks.length < ragGroundingMinChunks
        ) {
          // Record which gate we short-circuited on so the audit row
          // distinguishes bypass from normal ungrounded traffic.
          // ragGrounded stays undefined → persisted as null ("not evaluated").
          if (buffered) {
            ragGroundingAudited = ragGroundingMode;
          }
          if (ragGroundingMode === "bypass" && !ragGroundingDisabled) {
            void trackOpsEventServerFn(
              "api_error",
              {
                endpoint_group: "ai-rag-grounding",
                error_code: "rag_grounding_bypassed",
                http_status: 200,
                retryable: false,
              },
              ctx.orgId
            );
          }
          return buffered;
        }
        try {
          const result = await verifyRagGroundingFn({
            content: buffered,
            ragChunks,
          });
          ragGrounded = result.grounded;
          ragGroundingFailures = result.uncoveredClaims;
          ragGroundingLatencyMs = result.latencyMs;
          ragGroundingAudited = ragGroundingMode;

          if (result.grounded) return buffered;

          void trackOpsEventServerFn(
            "api_error",
            {
              endpoint_group:
                ragGroundingMode === "shadow"
                  ? "ai-rag-grounding-shadow"
                  : "ai-rag-grounding",
              http_status: 200,
              error_code:
                ragGroundingMode === "shadow"
                  ? "rag_grounding_shadow_ungrounded"
                  : "rag_grounding_failed",
              retryable: false,
            },
            ctx.orgId
          );

          if (ragGroundingMode === "overwrite") {
            return buildRagGroundingFallback(
              result.uncoveredClaims,
              ragChunks[0] ?? null
            );
          }
          if (ragGroundingMode === "block") {
            return RAG_GROUNDING_ABSTAIN_TEXT;
          }
          // shadow | bypass: passthrough
          return buffered;
        } catch (err) {
          aiLog("warn", "ai-rag-grounding", "verify failed", {
            ...requestLogContext,
            threadId: threadId!,
          }, { error: err });
          return buffered;
        }
      };

      const usageRef: { current: UsageAccumulator | null } = { current: null };
      let streamCompletedSuccessfully = false;
      let auditErrorMessage: string | undefined;
      let contextMetadata: { surface: string; estimatedTokens: number } | undefined;
      let toolCallMade = false;
      let toolCallSucceeded = false;
      let terminateTurn = false;
      let toolPassBreakerOpen = false;
      const auditToolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
      const successfulToolResults: SuccessfulToolSummary[] = [];
      const toolAuthorization: ToolExecutionAuthorization =
        ctx.role === "admin"
          ? {
              kind: "preverified_admin",
              source: "ai_org_context",
            }
          : {
              kind: "preverified_role",
              source: "ai_org_context",
              role: ctx.role,
            };
      const toolAuthMode = getToolAuthorizationMode(toolAuthorization);
      const recordUsage = (usage: UsageAccumulator) => {
        usageRef.current = {
          inputTokens: (usageRef.current?.inputTokens ?? 0) + usage.inputTokens,
          outputTokens: (usageRef.current?.outputTokens ?? 0) + usage.outputTokens,
        };
      };
      const emitTimeoutError = () =>
        enqueue({
          type: "error",
          message: "The response timed out. Please try again.",
          retryable: true,
        });
      const runModelStage = async (
        stage: "pass1_model" | "pass2_model",
        auditStage: "pass1_model" | "pass2",
        timeoutMs: number,
        options: Parameters<typeof composeResponseFn>[0],
        onEvent: (event: SSEEvent | ToolCallRequestedEvent) => Promise<"continue" | "stop"> | "continue" | "stop"
      ): Promise<"completed" | "stopped" | "timeout" | "aborted"> => {
        const stageSignal = createStageAbortSignal({
          stage,
          timeoutMs,
          parentSignal: streamSignal,
        });
        const stageStartedAt = Date.now();

        try {
          for await (const event of composeResponseFn({
            ...options,
            signal: stageSignal.signal,
            logContext: {
              ...requestLogContext,
              threadId: threadId!,
            },
          })) {
            const disposition = await onEvent(event as SSEEvent | ToolCallRequestedEvent);
            if (disposition === "stop") {
              setStageStatus(
                stageTimings,
                auditStage,
                "completed",
                Date.now() - stageStartedAt
              );
              return "stopped";
            }
          }
          setStageStatus(stageTimings, auditStage, "completed", Date.now() - stageStartedAt);
          return "completed";
        } catch (err) {
          const failureReason = stageSignal.signal.reason ?? err;
          if (isStageTimeoutError(failureReason)) {
            setStageStatus(stageTimings, auditStage, "timed_out", Date.now() - stageStartedAt);
            auditErrorMessage = `${stage}:timeout`;
            emitTimeoutError();
            return "timeout";
          }
          if (streamSignal.aborted || stageSignal.signal.aborted) {
            setStageStatus(stageTimings, auditStage, "aborted", Date.now() - stageStartedAt);
            auditErrorMessage = `${stage}:request_aborted`;
            return "aborted";
          }
          setStageStatus(stageTimings, auditStage, "failed", Date.now() - stageStartedAt);
          throw err;
        } finally {
          stageSignal.cleanup();
        }
      };

    try {
      if (!process.env.ZAI_API_KEY) {
        const msg =
          "AI assistant is not configured. Please set the ZAI_API_KEY environment variable.";
        enqueue({ type: "chunk", content: msg });
        fullContent = msg;
        enqueue({
          type: "done",
          threadId: threadId!,
          cache: {
            status: cacheStatus,
            ...(cacheEntryId ? { entryId: cacheEntryId } : {}),
            ...(cacheBypassReason ? { bypassReason: cacheBypassReason } : {}),
          },
        });
        streamCompletedSuccessfully = true;
        return;
      }

      const client = createZaiClientFn();

      const { error: streamingStatusError } = await ctx.supabase
        .from("ai_messages")
        .update({
          intent: resolvedIntent,
          intent_type: resolvedIntentType,
          context_surface: effectiveSurface,
          status: "streaming",
        })
        .eq("id", assistantMessageId);

      if (streamingStatusError) {
        auditErrorMessage = "assistant_streaming_status_failed";
        aiLog("error", "ai-chat", "assistant streaming status update failed", {
          ...requestLogContext,
          threadId: threadId!,
        }, { error: streamingStatusError, messageId: assistantMessageId });
        enqueue({
          type: "error",
          message: "Failed to start the response stream",
          retryable: true,
        });
        return;
      }

      if (pendingEventRevisionAnalysis.kind === "clarify") {
        skipStage(stageTimings, "history_load");
        skipStage(stageTimings, "context_build");
        skipStage(stageTimings, "pass1_model");
        skipStage(stageTimings, "pass2");
        skipStage(stageTimings, "grounding");

        fullContent = pendingEventRevisionAnalysis.message;
        enqueue({ type: "chunk", content: fullContent });
        enqueue({
          type: "done",
          threadId: threadId!,
          cache: {
            status: cacheStatus,
            ...(cacheEntryId ? { entryId: cacheEntryId } : {}),
            ...(cacheBypassReason ? { bypassReason: cacheBypassReason } : {}),
          },
        });
        streamCompletedSuccessfully = true;
        return;
      }

      if (pendingEventRevisionAnalysis.kind === "unsupported_event_type") {
        skipStage(stageTimings, "history_load");
        skipStage(stageTimings, "context_build");
        skipStage(stageTimings, "pass1_model");
        skipStage(stageTimings, "pass2");
        skipStage(stageTimings, "grounding");

        fullContent =
          `I can revise the drafted schedule before confirmation, but "${pendingEventRevisionAnalysis.requestedType}" isn't a supported event type yet. ` +
          `Use one of: ${SUPPORTED_EVENT_TYPE_LABELS.join(", ")}.`;
        enqueue({ type: "chunk", content: fullContent });
        enqueue({
          type: "done",
          threadId: threadId!,
          cache: {
            status: cacheStatus,
            ...(cacheEntryId ? { entryId: cacheEntryId } : {}),
            ...(cacheBypassReason ? { bypassReason: cacheBypassReason } : {}),
          },
        });
        streamCompletedSuccessfully = true;
        return;
      }

      if (pendingEventRevisionAnalysis.kind === "apply" && activePendingEventActions.length > 0) {
        skipStage(stageTimings, "history_load");
        skipStage(stageTimings, "context_build");
        skipStage(stageTimings, "pass1_model");
        skipStage(stageTimings, "pass2");
        skipStage(stageTimings, "grounding");

        const revisedEvents = activePendingEventActions.map((action, index) =>
          pendingEventRevisionAnalysis.targetIndexes.includes(index)
            ? mergeDraftPayload(
                buildPrepareEventArgsFromPendingAction(action),
                pendingEventRevisionAnalysis.overrides
              )
            : buildPrepareEventArgsFromPendingAction(action)
        );
        const revisionToolName: ToolName =
          revisedEvents.length > 1 ? "prepare_events_batch" : "prepare_event";
        const revisionArgs =
          revisedEvents.length > 1 ? { events: revisedEvents } : revisedEvents[0];
        const revisedOrgSlug = activePendingEventActions.find((action) =>
          action.payload &&
          typeof action.payload === "object" &&
          typeof action.payload.orgSlug === "string" &&
          action.payload.orgSlug.trim().length > 0
        )?.payload.orgSlug ?? null;

        toolCallMade = true;
        auditToolCalls.push({
          name: revisionToolName,
          args: revisionArgs,
        });
        enqueue({ type: "tool_status", toolName: revisionToolName, status: "calling" });

        const toolStartedAt = Date.now();
        const revisionResult =
          revisedEvents.length > 10
            ? ({
                kind: "ok",
                data: await buildPendingEventBatchFromDrafts(
                  ctx.serviceSupabase as any,
                  {
                    orgId: ctx.orgId,
                    userId: ctx.userId,
                    enterpriseId: ctx.enterpriseId,
                    enterpriseRole: ctx.enterpriseRole,
                    serviceSupabase: ctx.serviceSupabase,
                    authorization: toolAuthorization,
                    threadId,
                    requestId,
                    attachment,
                  },
                  revisedEvents,
                  {
                    ...requestLogContext,
                    threadId: threadId!,
                  },
                  revisedOrgSlug
                ),
              } as const)
            : await executeToolCallFn(
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
                  attachment,
                },
                {
                  name: revisionToolName,
                  args: revisionArgs,
                }
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
          return;
        }

        addToolCallTiming(stageTimings, {
          name: revisionToolName,
          status: "completed",
          duration_ms: Date.now() - toolStartedAt,
          auth_mode: toolAuthMode,
        });
        enqueue({ type: "tool_status", toolName: revisionToolName, status: "done" });
        toolCallSucceeded = true;
        successfulToolResults.push({
          name: revisionToolName,
          data: revisionResult.data,
        });

        const pendingAction = getPendingActionFromToolData(revisionResult.data);
        const batchActions = getBatchPendingActionsFromToolData(revisionResult.data);
        if (pendingAction || batchActions) {
          for (const action of activePendingEventActions) {
            await updatePendingActionStatus(ctx.serviceSupabase, action.id, {
              status: "cancelled",
              expectedStatus: "pending",
            });
          }
        }

        if (pendingAction) {
          enqueue({
            type: "pending_action",
            actionId: pendingAction.actionId,
            actionType: pendingAction.actionType,
            summary: pendingAction.summary,
            payload: pendingAction.payload,
            expiresAt: pendingAction.expiresAt,
          });
        } else if (batchActions) {
          enqueue({
            type: "pending_actions_batch",
            actions: batchActions,
          });
        }

        fullContent =
          formatRevisedPendingEventResponse(revisionResult.data, revisedEvents.length) ??
          "I revised the drafted schedule. Review the updated details below and confirm when you're ready.";
        enqueue({ type: "chunk", content: fullContent });
        enqueue({
          type: "done",
          threadId: threadId!,
          cache: {
            status: cacheStatus,
            ...(cacheEntryId ? { entryId: cacheEntryId } : {}),
            ...(cacheBypassReason ? { bypassReason: cacheBypassReason } : {}),
          },
        });
        streamCompletedSuccessfully = true;
        return;
      }

        const contextBuildStartedAt = Date.now();
        const historyLoadStartedAt = Date.now();
        const historyPromise = existingThreadId
          ? ctx.supabase
              .from("ai_messages")
              .select("role, content")
              .eq("thread_id", threadId)
              .eq("status", "complete")
              .order("created_at", { ascending: true })
              .limit(20)
              .then((result: { data: unknown; error: unknown }) => {
                setStageStatus(
                  stageTimings,
                  "history_load",
                  result.error ? "failed" : "completed",
                  Date.now() - historyLoadStartedAt
                );
                return result;
              })
              .catch((error: unknown) => {
                setStageStatus(
                  stageTimings,
                  "history_load",
                  "failed",
                  Date.now() - historyLoadStartedAt
                );
                throw error;
              })
          : Promise.resolve().then(() => {
              setStageStatus(
                stageTimings,
                "history_load",
                "completed",
                Date.now() - historyLoadStartedAt
              );
              return {
                data: [
                  {
                    role: "user",
                    content: messageSafety.promptSafeMessage,
                  },
                ],
                error: null,
              };
            });

        const [contextResult, { data: history, error: historyError }] =
          await Promise.all([
            buildPromptContextFn({
              orgId: ctx.orgId,
              userId: ctx.userId,
              role: ctx.role,
              enterpriseId: ctx.enterpriseId,
              enterpriseRole: ctx.enterpriseRole,
              serviceSupabase: ctx.serviceSupabase,
              logContext: {
                ...requestLogContext,
                threadId: threadId!,
              },
              contextMode: usesSharedStaticContext
                ? "shared_static"
                : usesToolFirstContext
                  ? "tool_first"
                  : "full",
              surface: effectiveSurface,
              ragChunks: ragChunks.length > 0 ? ragChunks : undefined,
              now: requestNow,
              timeZone: requestTimeZone,
              currentPath,
              routeEntity: routeEntityContext,
              availableTools: pass1Tools?.map((tool) => tool.function.name as ToolName),
              threadTurnCount: existingThreadId ? 2 : 1,
            }).then((result: Awaited<ReturnType<typeof buildPromptContext>>) => {
              setStageStatus(
                stageTimings,
                "context_build",
                "completed",
                Date.now() - contextBuildStartedAt
              );
              return result;
            }).catch((error: unknown) => {
              setStageStatus(
                stageTimings,
                "context_build",
                "failed",
                Date.now() - contextBuildStartedAt
              );
                throw error;
              }),
            historyPromise,
          ]);

      const { systemPrompt, orgContextMessage, metadata } = contextResult;
      contextMetadata = metadata;

      let historyRows = history;
      if (historyError) {
        aiLog("error", "ai-chat", "history fetch failed", {
          ...requestLogContext,
          threadId: threadId!,
        }, { error: historyError });
        historyRows = [
          {
            role: "user",
            content: messageSafety.promptSafeMessage,
          },
        ];
      }

      const draftSessionContextMessage = activeDraftSession
        ? buildDraftSessionContextMessage(activeDraftSession)
        : null;
      const historyMessages = (historyRows ?? [])
        .filter((m: any) => m.content)
        .map((m: any) => ({
          role: m.role as "user" | "assistant",
          content:
            m.role === "user"
              ? sanitizeHistoryMessageForPrompt(m.content as string).promptSafeMessage
              : (m.content as string),
        }))
        .filter((m: { content: string }) => Boolean(m.content));
      const finalHistory =
        attachment &&
        historyMessages.length > 0 &&
        historyMessages[historyMessages.length - 1]?.role === "user"
          ? [
              ...historyMessages.slice(0, -1),
              {
                ...historyMessages[historyMessages.length - 1],
                content:
                  `${historyMessages[historyMessages.length - 1].content}\n\n` +
                  `[Attached schedule file: "${attachment.fileName}", storage path: "${attachment.storagePath}"]`,
              },
            ]
          : historyMessages;
      const pendingConnectionDisambiguation =
        hasPendingConnectionDisambiguation(finalHistory) &&
        looksLikeConnectionDisambiguationReply(messageSafety.promptSafeMessage);
      if (pendingConnectionDisambiguation) {
        pass1Tools = [AI_TOOL_MAP.suggest_connections];
      }
      const pass1Instructions: string[] = [];
      if (activeDraftSession) {
        pass1Instructions.push(ACTIVE_DRAFT_CONTINUATION_INSTRUCTION);
      }
      if (pass1Tools?.some((tool) => tool.function.name === "suggest_connections")) {
        pass1Instructions.push(CONNECTION_PASS1_DISAMBIGUATION_INSTRUCTION);
      }
      const effectivePass1SystemPrompt = pass1Instructions.length > 0
        ? `${systemPrompt}\n\n${pass1Instructions.join("\n\n")}`
        : systemPrompt;

      const contextMessages = orgContextMessage
        ? [
            { role: "user" as const, content: orgContextMessage },
            ...(draftSessionContextMessage
              ? [{ role: "user" as const, content: draftSessionContextMessage }]
              : []),
            ...finalHistory,
          ]
        : draftSessionContextMessage
          ? [{ role: "user" as const, content: draftSessionContextMessage }, ...finalHistory]
          : finalHistory;

      const toolResults: ToolResultMessage[] = [];
      const pass1ToolChoice = getForcedPass1ToolChoice(pass1Tools);
        const pass1Outcome = await runModelStage(
          "pass1_model",
          "pass1_model",
          PASS1_MODEL_TIMEOUT_MS,
          {
            client,
            systemPrompt: effectivePass1SystemPrompt,
            messages: contextMessages,
            tools: pass1Tools,
            toolChoice: pass1ToolChoice,
            onUsage: recordUsage,
          },
          async (event) => {
            if (event.type === "chunk") {
              // Buffer pass-1 text until validators run. Freeform (no-tool)
              // path used to stream token-by-token; now buffered so RAG
              // grounding + safety gate can inspect before release.
              pass1BufferedContent += event.content;
              return "continue";
            }

            if (event.type === "error") {
              auditErrorMessage = event.message;
              enqueue(event);
              return "stop";
            }

            const toolEvent = event as ToolCallRequestedEvent;
            toolCallMade = true;

            let parsedArgs: Record<string, unknown>;
            try {
              parsedArgs = JSON.parse(toolEvent.argsJson);
            } catch {
              enqueue({ type: "tool_status", toolName: toolEvent.name, status: "error" });
              auditToolCalls.push({ name: toolEvent.name, args: {} });
              addToolCallTiming(stageTimings, {
                name: toolEvent.name,
                status: "failed",
                duration_ms: 0,
                auth_mode: toolAuthMode,
                error_kind: "tool_error",
              });
              toolResults.push({
                toolCallId: toolEvent.id,
                name: toolEvent.name,
                args: {},
                data: { error: "Malformed tool arguments" },
              });
              return "continue";
            }

            if (
              activeDraftSession &&
              toolEvent.name === getToolNameForDraftType(activeDraftSession.draft_type)
            ) {
              parsedArgs = mergeDraftPayload(
                activeDraftSession.draft_payload as Record<string, unknown>,
                parsedArgs
              );
            }

            if (toolEvent.name === "prepare_chat_message") {
              const currentMemberRouteId =
                routeEntityContext?.kind === "member"
                  ? routeEntityContext.id
                  : extractCurrentMemberRouteId(currentPath);
              if (currentMemberRouteId && isChatRecipientDemonstrative(message)) {
                parsedArgs.recipient_member_id = currentMemberRouteId;
                delete parsedArgs.person_query;
              } else if (
                currentMemberRouteId &&
                getNonEmptyString(parsedArgs.recipient_member_id) == null &&
                getNonEmptyString(parsedArgs.person_query) == null
              ) {
                parsedArgs.recipient_member_id = currentMemberRouteId;
              } else if (
                threadMetadata.last_chat_recipient_member_id &&
                getNonEmptyString(parsedArgs.recipient_member_id) == null &&
                getNonEmptyString(parsedArgs.person_query) == null
              ) {
                // Use the last chat recipient from thread metadata for follow-up messages
                parsedArgs.recipient_member_id = threadMetadata.last_chat_recipient_member_id;
              }
            }

            let syntheticToolResult:
              | Awaited<ReturnType<typeof executeToolCallFn>>
              | null = null;
            if (toolEvent.name === "prepare_discussion_reply") {
              const discussionThreadId = getNonEmptyString(parsedArgs.discussion_thread_id);
              const requestedThreadTitle = getNonEmptyString(parsedArgs.thread_title);
              const explicitNamedThreadTitle =
                requestedThreadTitle && !isDiscussionThreadDemonstrative(requestedThreadTitle)
                  ? requestedThreadTitle
                  : null;

              if (!discussionThreadId && explicitNamedThreadTitle) {
                const resolution = await resolveDiscussionReplyTarget(ctx.serviceSupabase as any, {
                  organizationId: ctx.orgId,
                  requestedThreadTitle: explicitNamedThreadTitle,
                });

                if (resolution.kind === "resolved") {
                  parsedArgs.discussion_thread_id = resolution.discussionThreadId;
                  parsedArgs.thread_title = resolution.threadTitle ?? explicitNamedThreadTitle;
                } else {
                  if (resolution.kind === "lookup_error") {
                    aiLog("warn", "ai-chat", "discussion thread title resolution failed", {
                      ...requestLogContext,
                      threadId: threadId ?? undefined,
                    }, {
                      requestedThreadTitle: explicitNamedThreadTitle,
                    });
                  }
                  syntheticToolResult = {
                    kind: "ok",
                    data: buildDiscussionReplyClarificationPayload(parsedArgs, resolution),
                  };
                }
              } else if (
                routeEntityContext?.kind === "discussion_thread" &&
                !discussionThreadId
              ) {
                parsedArgs.discussion_thread_id =
                  routeEntityContext.id;
                if (
                  getNonEmptyString(parsedArgs.thread_title) == null &&
                  routeEntityContext.displayName
                ) {
                  parsedArgs.thread_title = routeEntityContext.displayName;
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

            auditToolCalls.push({ name: toolEvent.name, args: parsedArgs });

            if (toolPassBreakerOpen) {
              return "continue";
            }

            const toolStartedAt = Date.now();
            let result: Awaited<ReturnType<typeof executeToolCallFn>>;
            if (syntheticToolResult) {
              result = syntheticToolResult;
            } else {
              enqueue({ type: "tool_status", toolName: toolEvent.name, status: "calling" });

              const activePendingActionId =
                toolEvent.name.startsWith("prepare_") &&
                activeDraftSession?.pending_action_id
                  ? activeDraftSession.pending_action_id
                  : null;

              result = await executeToolCallFn(
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
                  attachment,
                  activePendingActionId,
                },
                { name: toolEvent.name, args: parsedArgs }
              );
            }

            switch (result.kind) {
              case "ok":
                if (
                  canUseDraftSessions &&
                  (toolEvent.name === "prepare_announcement" ||
                    toolEvent.name === "prepare_job_posting" ||
                    toolEvent.name === "prepare_chat_message" ||
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
                            typeof field === "string" && field.length > 0
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
                      activeDraftSession = await saveDraftSessionFn(ctx.serviceSupabase, {
                        organizationId: ctx.orgId,
                        userId: ctx.userId,
                        threadId: threadId!,
                        draftType:
                          toolEvent.name === "prepare_announcement"
                            ? "create_announcement"
                            : toolEvent.name === "prepare_job_posting"
                            ? "create_job_posting"
                            : toolEvent.name === "prepare_chat_message"
                            ? "send_chat_message"
                            : toolEvent.name === "prepare_discussion_reply"
                              ? "create_discussion_reply"
                            : toolEvent.name === "prepare_discussion_thread"
                              ? "create_discussion_thread"
                              : "create_event",
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
                        expiresAt: pendingExpiresAt,
                      });
                    } catch (error) {
                      activeDraftSession = null;
                      aiLog("warn", "ai-chat", "failed to persist draft session; continuing without it", {
                        ...requestLogContext,
                        threadId: threadId!,
                      }, { error, toolName: toolEvent.name });
                    }
                  }
                }

                addToolCallTiming(stageTimings, {
                  name: toolEvent.name,
                  status: "completed",
                  duration_ms: Date.now() - toolStartedAt,
                  auth_mode: toolAuthMode,
                });
                enqueue({ type: "tool_status", toolName: toolEvent.name, status: "done" });
                toolCallSucceeded = true;
                toolResults.push({
                  toolCallId: toolEvent.id,
                  name: toolEvent.name,
                  args: parsedArgs,
                  data: result.data,
                });
                const pendingAction = getPendingActionFromToolData(result.data);
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
                } else {
                  const batchActions = getBatchPendingActionsFromToolData(result.data);
                  if (batchActions) {
                    enqueue({
                      type: "pending_actions_batch",
                      actions: batchActions,
                    });
                  }
                }
                successfulToolResults.push({
                  name: toolEvent.name as ToolName,
                  data: result.data,
                });
                return "continue";
              case "tool_error":
                addToolCallTiming(stageTimings, {
                  name: toolEvent.name,
                  status: "failed",
                  duration_ms: Date.now() - toolStartedAt,
                  auth_mode: toolAuthMode,
                  error_kind: "tool_error",
                });
                enqueue({ type: "tool_status", toolName: toolEvent.name, status: "error" });
                toolResults.push({
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
                addToolCallTiming(stageTimings, {
                  name: toolEvent.name,
                  status: "timed_out",
                  duration_ms: Date.now() - toolStartedAt,
                  auth_mode: toolAuthMode,
                  error_kind: "timeout",
                });
                enqueue({ type: "tool_status", toolName: toolEvent.name, status: "error" });
                toolResults.push({
                  toolCallId: toolEvent.id,
                  name: toolEvent.name,
                  args: parsedArgs,
                  data: { error: result.error },
                });
                toolPassBreakerOpen = true;
                return "continue";
              case "forbidden":
              case "auth_error":
                addToolCallTiming(stageTimings, {
                  name: toolEvent.name,
                  status: "failed",
                  duration_ms: Date.now() - toolStartedAt,
                  auth_mode: toolAuthMode,
                  error_kind: result.kind,
                });
                enqueue({ type: "tool_status", toolName: toolEvent.name, status: "error" });
                auditErrorMessage = `tool_${toolEvent.name}:${result.kind}`;
                terminateTurn = true;
                enqueue({
                  type: "error",
                  message:
                    result.kind === "forbidden"
                      ? "Your access to AI tools for this organization has changed."
                      : "Unable to verify access to AI tools right now.",
                  retryable: false,
                });
                return "stop";
            }
          }
        );

        if (terminateTurn || pass1Outcome !== "completed") {
          if (!toolCallMade) {
            skipStage(stageTimings, "tools");
          }
          return;
        }

        if (!toolCallMade) {
          skipStage(stageTimings, "tools");
        }

        if (!toolCallMade && pass1BufferedContent) {
          pass1BufferedContent = await applyRagGrounding(pass1BufferedContent);
          pass1BufferedContent = await applySafetyGate(pass1BufferedContent);
          fullContent += pass1BufferedContent;
          enqueue({ type: "chunk", content: pass1BufferedContent });
        }

        if (toolCallMade && toolResults.length > 0) {
          const willRenderNavigationDeterministically =
            toolResults.length === 1 &&
            successfulToolResults.length === 1 &&
            successfulToolResults[0]?.name === "find_navigation_targets";
          if (pass1BufferedContent && !willRenderNavigationDeterministically) {
            pass1BufferedContent = await applySafetyGate(pass1BufferedContent);
            fullContent += pass1BufferedContent;
            enqueue({ type: "chunk", content: pass1BufferedContent });
          }
          if (willRenderNavigationDeterministically) {
            pass1BufferedContent = "";
          }
          const canUseDeterministicMemberRoster =
            successfulToolResults.length === 1 &&
            successfulToolResults[0]?.name === "list_members" &&
            MEMBER_ROSTER_PROMPT_PATTERN.test(messageSafety.promptSafeMessage);
          const needsDonorPrivacy = successfulToolResults.some(
            (result) => result.name === "list_donations",
          );
          const hideDonorNames = needsDonorPrivacy
            ? await resolveHideDonorNamesPreference(
                ctx.serviceSupabase as { from: (table: string) => any },
                ctx.orgId,
              )
            : false;
          const deterministicDonationOptions =
            successfulToolResults.length === 1 &&
            successfulToolResults[0]?.name === "list_donations"
              ? { hideDonorNames }
              : undefined;
          const deterministicToolContent =
            toolResults.length === 1 &&
            successfulToolResults.length === 1 &&
            toolResults[0].name === successfulToolResults[0].name &&
            (successfulToolResults[0].name !== "list_members" || canUseDeterministicMemberRoster)
              ? formatDeterministicToolResponse(
                  successfulToolResults[0].name,
                  successfulToolResults[0].data,
                  deterministicDonationOptions,
                )
              : null;
          const singleToolError =
            toolResults.length === 1 &&
            successfulToolResults.length === 0 &&
            toolResults[0].data &&
            typeof toolResults[0].data === "object" &&
            "error" in toolResults[0].data &&
            typeof toolResults[0].data.error === "string"
              ? toolResults[0].data.error
              : null;
          const singleToolErrorCode =
            toolResults.length === 1 &&
            successfulToolResults.length === 0 &&
            toolResults[0].data &&
            typeof toolResults[0].data === "object" &&
            "error_code" in toolResults[0].data &&
            typeof toolResults[0].data.error_code === "string"
              ? toolResults[0].data.error_code
              : null;
          const deterministicToolErrorContent =
            singleToolError
              ? formatDeterministicToolErrorResponse(
                  toolResults[0].name,
                  singleToolError,
                  singleToolErrorCode
                )
              : null;

          if (deterministicToolContent || deterministicToolErrorContent) {
            skipStage(stageTimings, "pass2");
            pass2BufferedContent = deterministicToolContent ?? deterministicToolErrorContent ?? "";
          } else {
            const hasToolErrors = toolResults.length > successfulToolResults.length;
            const connectionPass2 = successfulToolResults.some(
              (result) => result.name === "suggest_connections"
            );
            const mentorPass2 = successfulToolResults.some(
              (result) => result.name === "suggest_mentors"
            );
            const memberRosterPass2 = successfulToolResults.some(
              (result) => result.name === "list_members"
            );
            const toolErrorInstruction = hasToolErrors
              ? "\n\nSome tool calls failed. Only cite data from successful tool results. Acknowledge any failures honestly — do not fabricate data."
              : "";
            const pass2Instructions = [
              connectionPass2 ? CONNECTION_PASS2_TEMPLATE : null,
              mentorPass2 ? MENTOR_PASS2_TEMPLATE : null,
              memberRosterPass2 ? MEMBER_LIST_PASS2_INSTRUCTION : null,
            ]
              .filter((value): value is string => Boolean(value))
              .join("\n\n");
            const pass2SystemPrompt = pass2Instructions.length > 0
              ? `${systemPrompt}\n\n${pass2Instructions}${toolErrorInstruction}`
              : `${systemPrompt}${toolErrorInstruction}`;

            const pass2Outcome = await runModelStage(
              "pass2_model",
              "pass2",
              PASS2_MODEL_TIMEOUT_MS,
              {
                client,
                systemPrompt: pass2SystemPrompt,
                messages: contextMessages,
                toolResults,
                onUsage: recordUsage,
              },
              (event) => {
                if (event.type === "chunk") {
                  pass2BufferedContent += event.content;
                  return "continue";
                }

                if (event.type === "error") {
                  auditErrorMessage = event.message;
                  enqueue(event);
                  return "stop";
                }

                return "continue";
              }
            );

            if (pass2Outcome !== "completed") {
              return;
            }
          }

          const groundedToolSummary =
            executionPolicy.groundingPolicy === "verify_tool_summary" &&
            toolCallSucceeded &&
            successfulToolResults.length > 0 &&
            pass2BufferedContent.length > 0;

          if (groundedToolSummary) {
            try {
              await runTimedStage(stageTimings, "grounding", async () => {
                const groundingResult = verifyToolBackedResponseFn({
                  content: pass2BufferedContent,
                  toolResults: successfulToolResults,
                  orgContext: { hideDonorNames },
                });

                if (!groundingResult.grounded) {
                  throw new ToolGroundingVerificationError(groundingResult.failures);
                }
              });
            } catch (error) {
              if (!(error instanceof ToolGroundingVerificationError)) {
                throw error;
              }

              auditErrorMessage = "tool_grounding_failed";
              aiLog("warn", "ai-grounding", "verification failed", {
                ...requestLogContext,
                threadId: threadId!,
              }, {
                messageId: assistantMessageId,
                tools: successfulToolResults.map((result) => result.name),
                failures: error.failures,
              });
              void trackOpsEventServerFn(
                "api_error",
                {
                  endpoint_group: "ai-grounding",
                  http_status: 200,
                  error_code: "tool_grounding_failed",
                  retryable: false,
                },
                ctx.orgId
              );
              pass2BufferedContent = getGroundingFallbackForTools(
                successfulToolResults.map((result) => result.name)
              );
            }
          } else {
            skipStage(stageTimings, "grounding");
          }

          if (pass2BufferedContent) {
            // Tool-backed pass-2: tool-grounding already ran. Still gate output
            // for safety (PII / toxicity) before release.
            pass2BufferedContent = await applySafetyGate(pass2BufferedContent);
            fullContent += pass2BufferedContent;
            enqueue({ type: "chunk", content: pass2BufferedContent });
          }
        } else {
          skipStage(stageTimings, "pass2");
          skipStage(stageTimings, "grounding");
        }

      if (fullContent.trim().length === 0) {
        fullContent = EMPTY_ASSISTANT_RESPONSE_FALLBACK;
        enqueue({ type: "chunk", content: fullContent });
        auditErrorMessage ??= "empty_response_fallback";
      }

      const usage = usageRef.current;
      enqueue({
        type: "done",
        threadId: threadId!,
        ...(usage ? { usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } } : {}),
        cache: {
          status: cacheStatus,
          ...(cacheEntryId ? { entryId: cacheEntryId } : {}),
          ...(cacheBypassReason ? { bypassReason: cacheBypassReason } : {}),
        },
      });
      streamCompletedSuccessfully = true;
      } catch (err) {
        aiLog("error", "ai-chat", "stream error", {
          ...requestLogContext,
          threadId: threadId!,
        }, { error: err, messageId: assistantMessageId });
        auditErrorMessage = err instanceof Error ? err.message : "stream_failed";
        if (!streamSignal.aborted) {
          enqueue({ type: "error", message: "An error occurred", retryable: true });
        }
      } finally {
        const finalMessage = finalizeAssistantMessage({
          fullContent,
          streamCompletedSuccessfully,
          requestAborted: streamSignal.aborted,
        });
        const finalizeStartedAt = Date.now();
        const { error: finalizeError } = await ctx.supabase
          .from("ai_messages")
          .update({
            content: finalMessage.content,
            status: finalMessage.status,
          })
          .eq("id", assistantMessageId);

        setStageStatus(
          stageTimings,
          "assistant_finalize_write",
          finalizeError ? "failed" : "completed",
          Date.now() - finalizeStartedAt
        );

        if (finalizeError) {
          aiLog("error", "ai-chat", "assistant finalize failed", {
            ...requestLogContext,
            threadId: threadId!,
          }, { error: finalizeError, messageId: assistantMessageId });
          auditErrorMessage ??= "assistant_finalize_failed";
        }

        if (toolCallMade && !cacheBypassReason && executionPolicy.cachePolicy === "lookup_exact") {
          cacheBypassReason = "tool_call_made";
        }

        const canWriteCache =
          streamCompletedSuccessfully &&
          !finalizeError &&
          executionPolicy.cachePolicy === "lookup_exact" &&
          cacheStatus === "miss" &&
          !toolCallMade;

        if (canWriteCache) {
          const cacheKey = buildSemanticCacheKeyParts({
            message: messageSafety.promptSafeMessage,
            orgId: ctx.orgId,
            role: ctx.role,
          });

          let cacheWriteResult;
          try {
            cacheWriteResult = await runTimedStage(stageTimings, "cache_write", async () => {
              const result = await writeCacheEntry({
                cacheKey,
                responseContent: fullContent,
                orgId: ctx.orgId,
                surface: effectiveSurface,
                sourceMessageId: assistantMessageId,
                supabase: ctx.serviceSupabase,
                logContext: {
                  ...requestLogContext,
                  threadId: threadId!,
                },
              });

              if (result.status === "error") {
                throw new Error("cache_write_failed");
              }

              return result;
            });
          } catch (error) {
            cacheWriteResult = { status: "error" as const };
            aiLog("error", "ai-chat", "cache write failed", {
              ...requestLogContext,
              threadId: threadId!,
            }, { error, messageId: assistantMessageId });
          }

          if (cacheWriteResult.status === "inserted") {
            cacheEntryId = cacheWriteResult.entryId;
          } else if (cacheWriteResult.status === "duplicate" && !cacheBypassReason) {
            cacheBypassReason = "cache_write_duplicate";
          } else if (
            cacheWriteResult.status === "skipped_too_large" &&
            !cacheBypassReason
          ) {
            cacheBypassReason = "cache_write_skipped_too_large";
          } else if (cacheWriteResult.status === "error" && !cacheBypassReason) {
            cacheBypassReason = "cache_write_failed";
          }
        } else {
          skipStage(stageTimings, "cache_write");
        }

        const requestOutcome = streamCompletedSuccessfully
          ? auditErrorMessage === "tool_grounding_failed"
            ? "tool_grounding_fallback"
            : "completed"
          : streamSignal.aborted
            ? "aborted"
            : auditErrorMessage?.includes("timeout")
              ? "timed_out"
              : "error";

        const modelRefusalDetected =
          fullContent.trim().startsWith(SCOPE_REFUSAL_CANONICAL_PREFIX);
        const finalBypassReason = modelRefusalDetected
          ? cacheBypassReason ?? "scope_refusal"
          : cacheBypassReason;
        const finalAuditError = modelRefusalDetected
          ? auditErrorMessage ?? "scope_refusal:model_refusal_detected"
          : auditErrorMessage;

        await logAiRequestFn(ctx.serviceSupabase, {
          threadId: threadId!,
          messageId: assistantMessageId,
          userId: ctx.userId,
          orgId: ctx.orgId,
          intent: resolvedIntent,
          intentType: resolvedIntentType,
          toolCalls: auditToolCalls.length > 0 ? auditToolCalls : undefined,
          latencyMs: Date.now() - startTime,
          model: process.env.ZAI_API_KEY ? getZaiModelFn() : undefined,
          inputTokens: usageRef.current?.inputTokens,
          outputTokens: usageRef.current?.outputTokens,
          error: finalAuditError,
          cacheStatus,
          cacheEntryId,
          cacheBypassReason: finalBypassReason,
          contextSurface: (contextMetadata?.surface ?? effectiveSurface) as CacheSurface,
          contextTokenEstimate: contextMetadata?.estimatedTokens,
          ragChunkCount: ragChunkCount > 0 ? ragChunkCount : undefined,
          ragTopSimilarity,
          ragError,
          safetyVerdict,
          safetyCategories,
          safetyLatencyMs,
          ragGrounded,
          ragGroundingFailures,
          ragGroundingLatencyMs,
          ragGroundingMode: ragGroundingAudited,
          stageTimings: finalizeStageTimings(
            stageTimings,
            requestOutcome,
            Date.now() - startTime
          ),
        }, {
          ...requestLogContext,
          threadId: threadId!,
        });
      }
    }, request.signal);

    return buildSseResponse(stream, { ...SSE_HEADERS, ...rateLimit.headers }, threadId!);
  };
}
