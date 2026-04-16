/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import type OpenAI from "openai";
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
} from "@/lib/ai/tools/executor";
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
  verifyToolBackedResponse,
  type SuccessfulToolSummary,
} from "@/lib/ai/tool-grounding";
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
import { getEnterprisePermissions, type EnterpriseRole } from "@/types/enterprise";
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
  trackOpsEventServer?: typeof trackOpsEventServer;
  getDraftSession?: typeof getDraftSession;
  saveDraftSession?: typeof saveDraftSession;
  clearDraftSession?: typeof clearDraftSession;
}

type ChatAttachment = {
  storagePath: string;
  fileName: string;
  mimeType: "application/pdf" | "image/png" | "image/jpeg" | "image/jpg";
};

const SCHEDULE_ATTACHMENT_MIME_TYPES = new Set<ChatAttachment["mimeType"]>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
]);

const PASS1_TOOL_NAMES: Record<CacheSurface, ToolName[]> = {
  general: [
    "list_members",
    "list_events",
    "list_announcements",
    "list_discussions",
    "list_job_postings",
    "list_alumni",
    "list_parents",
    "list_philanthropy_events",
    "list_donations",
    "get_org_stats",
    "suggest_connections",
  ],
  members: ["list_members", "list_alumni", "list_parents", "get_org_stats", "suggest_connections"],
  analytics: ["get_org_stats"],
  events: ["list_events"],
};

const CONNECTION_PROMPT_PATTERN =
  /(?<!\w)(?:connection|connections|connect|networking|introduc(?:e|tion))(?!\w)/i;
const DIRECT_NAVIGATION_PROMPT_PATTERN =
  /(?:(?<!\w)(?:go\s+to|take\s+me\s+to|navigate\s+to|open|where\s+is|where\s+(?:can|do)\s+i\s+find|find\s+the\s+page|link\s+to)(?!\w)|(?<!\w)show\s+me\b[\s\S]{0,80}\b(?:page|screen|tab|settings?)\b)/i;
const CREATE_ANNOUNCEMENT_PROMPT_PATTERN =
  /(?:(?<!\w)(?:create|add|post|publish|make|send|draft|write|compose)(?!\w)[\s\S]{0,120}\b(?:announcement|update|news post|bulletin)(?!\w)|(?<!\w)(?:announcement|update|news post|bulletin)(?!\w)[\s\S]{0,80}\b(?:create|add|post|publish|make|send|draft|write|compose)(?!\w))/i;
const CREATE_JOB_PROMPT_PATTERN =
  /(?:(?<!\w)(?:create|add|post|publish|make|open)(?!\w)[\s\S]{0,120}\b(?:job|job posting|opening|role|position)(?!\w)|(?<!\w)(?:job|job posting|opening|role|position)(?!\w)[\s\S]{0,80}\b(?:create|add|post|publish|make|open)(?!\w))/i;
const SEND_CHAT_MESSAGE_PROMPT_PATTERN =
  /(?:(?<!\w)(?:message|dm|direct\s+message|chat\s+message|write\s+to)(?!\w)[\s\S]{0,140}\b(?:someone|somebody|them|him|her|this person|that person|member|[a-z][\w.'-]*(?:\s+[a-z][\w.'-]*){0,3})(?!\w)|(?<!\w)send(?!\w)[\s\S]{0,80}\b(?:a\s+)?(?:dm|direct\s+message|chat\s+message)\b[\s\S]{0,80}\b(?:to|for)\b[\s\S]{0,80}\b(?:someone|somebody|them|him|her|this person|that person|member|[a-z][\w.'-]*(?:\s+[a-z][\w.'-]*){0,3})(?!\w))/i;
const LIST_CHAT_GROUPS_PROMPT_PATTERN =
  /(?:(?<!\w)(?:list|show|what|which|tell\s+me)(?!\w)[\s\S]{0,80}\b(?:chat groups?|groups?|channels?|group chats?)(?!\w)|(?<!\w)(?:chat groups?|my groups?|channels?|group chats?)(?!\w)[\s\S]{0,60}\b(?:list|show|available|can\s+i\s+message|do\s+i\s+have)(?!\w))/i;
const SEND_GROUP_CHAT_MESSAGE_PROMPT_PATTERN =
  /(?:(?<!\w)(?:message|write\s+to|send\s+(?:a\s+message\s+)?to|post\s+in)(?!\w)[\s\S]{0,140}\b(?:group|chat group|channel|group chat)\b|(?<!\w)(?:group|chat group|channel|group chat)(?!\w)[\s\S]{0,120}\b(?:message|write\s+to|send\s+(?:a\s+message\s+)?to|post\s+in)\b)/i;
const CREATE_DISCUSSION_PROMPT_PATTERN =
  /(?:(?<!\w)(?:create|add|post|publish|make|start|open)(?!\w)[\s\S]{0,120}\b(?:discussion|discussion thread|thread|forum thread|chat|group chat|conversation)(?!\w)|(?<!\w)(?:discussion|discussion thread|thread|forum thread|chat|group chat|conversation)(?!\w)[\s\S]{0,80}\b(?:create|add|post|publish|make|start|open)(?!\w))/i;
const DISCUSSION_REPLY_PROMPT_PATTERN =
  /(?:(?<!\w)(?:reply|respond|answer|comment|draft|write)(?!\w)[\s\S]{0,120}\b(?:discussion reply|reply|response|discussion|thread|post|message|conversation)(?!\w)|(?<!\w)(?:discussion reply|reply|response|discussion|thread|post|message|conversation)(?!\w)[\s\S]{0,80}\b(?:reply|respond|answer|comment|draft|write)(?!\w))/i;
const CREATE_EVENT_PROMPT_PATTERN =
  /(?:(?<!\w)(?:create|add|schedule|plan|make|organize|set\s+up)(?!\w)[\s\S]{0,120}\b(?:event|calendar event|meeting|fundraiser|social|philanthropy event)(?!\w)|(?<!\w)(?:event|calendar event|meeting|fundraiser|social|philanthropy event)(?!\w)[\s\S]{0,80}\b(?:create|add|schedule|plan|make|organize|set\s+up)(?!\w))/i;
const EXPLICIT_EVENT_DRAFT_SWITCH_PATTERN =
  /(?:(?<!\w)(?:create|add|schedule|plan|make|set\s+up)(?!\w)[\s\S]{0,80}\b(?:event|calendar event|meeting|fundraiser|social|philanthropy event)(?!\w)|(?<!\w)(?:event|calendar event|meeting|fundraiser|social|philanthropy event)(?!\w)[\s\S]{0,60}\b(?:create|add|schedule|plan|make|set\s+up)(?!\w))/i;
const MEMBER_COUNT_PROMPT_PATTERN =
  /(?:(?<!\w)(?:how many|count|number of|total|totals|snapshot|stats)(?!\w)[\s\S]{0,80}\b(?:member|members|active members|alumni|parents?|donors?|donations?)\b|(?<!\w)(?:member|members|active members|alumni|parents?|donors?|donations?)(?!\w)[\s\S]{0,40}\b(?:how many|count|number of|total|totals)\b)/i;
const MEMBER_ROSTER_PROMPT_PATTERN =
  /(?:(?<!\w)(?:tell|give|summarize)(?!\w)[\s\S]{0,80}\b(?:member|members|people|roster|team)\b|(?<!\w)(?:who(?:'s|\s+are)?|recent|new)(?!\w)[\s\S]{0,40}\b(?:member|members|people|roster|team)\b|(?<!\w)member roster(?!\w))/i;
const SCRAPE_SCHEDULE_PROMPT_PATTERN =
  /(?:scrape|import|extract|pull|get|grab|fetch|load)\b[\s\S]{0,120}\b(?:schedule|events?|calendar)[\s\S]{0,60}(?:from|at|on)\s+(?:https?:\/\/|(?:the\s+)?(?:website|page|url|link|site))/i;
const PDF_SCHEDULE_PROMPT_PATTERN =
  /(?:extract|import|upload|read|parse|pull)\b[\s\S]{0,120}\b(?:schedule|events?|calendar)[\s\S]{0,60}(?:pdf|file|document|upload)/i;
const ALUMNI_ROSTER_PROMPT_PATTERN =
  /(?<!\w)(?:alumni|alumnus|alumna|alumnae|graduates?|who\s+graduated|graduation\s+(?:year|class)|class\s+of\b)(?!\w)/i;
const DONATION_STATS_PROMPT_PATTERN =
  /(?<!\w)(?:donation|donations|fundraising)\s+(?:metric|metrics|stats|statistics|total|totals|summary|overview|revenue|amount)(?!\w)/i;
const DONATION_LIST_PROMPT_PATTERN =
  /(?<!\w)(?:donations?|fundraising\s+details|donation\s+history|who\s+donated|list\s+(?:the\s+)?donors?)(?!\w)/i;
const PARENT_LIST_PROMPT_PATTERN =
  /(?<!\w)(?:parent\s+directory|parent\s+(?:list|roster|contacts)|guardians?|(?:list|show)\s+(?:the\s+)?parents)(?!\w)/i;
const PHILANTHROPY_EVENTS_PROMPT_PATTERN =
  /(?<!\w)(?:philanthropy\s+events?|service\s+events?|volunteer\s+events?)(?!\w)/i;
const ENTERPRISE_SCOPE_PROMPT_PATTERN =
  /(?<!\w)(?:enterprise|across all orgs?|across all organizations|managed orgs?|sub[-\s]?orgs?)(?!\w)/i;
const ENTERPRISE_QUOTA_PROMPT_PATTERN =
  /(?<!\w)(?:quota|capacity|seat|seats|slot|slots|billing|bucket|limit|remaining)(?!\w)/i;
const ENTERPRISE_SUB_ORG_CAPACITY_PROMPT_PATTERN =
  /(?<!\w)(?:sub[-\s]?orgs?|managed orgs?|managed organizations?|free orgs?|free organizations?)(?!\w)/i;
const MANAGED_ORGS_PROMPT_PATTERN =
  /(?<!\w)(?:managed orgs?|managed organizations?|sub[-\s]?orgs?|which orgs?|list orgs?|organizations?)(?!\w)/i;
const ENTERPRISE_AUDIT_PROMPT_PATTERN =
  /(?:who\s+(?:added|adopted|approved|invited|removed|revoked)\b|\baudit\b|\badoption\s+(?:history|requests?|log)\b|\bwhen\s+was\b[\s\S]{0,40}\badopted\b|\bhistory\s+of\s+adoptions?\b)/i;
const ENTERPRISE_INVITE_CREATE_PROMPT_PATTERN =
  /(?:invite\s+(?:a\s+|an\s+)?(?:new\s+)?(?:admin|member|alumni|active\s+member|user|person)\b[\s\S]{0,80}\b(?:to\s+)?(?:enterprise|org|organization)?|create\s+(?:an?\s+)?enterprise\s+invite|enterprise\s+invite\s+(?:for|to))/i;
const ENTERPRISE_INVITE_REVOKE_PROMPT_PATTERN =
  /(?:revoke\s+(?:an?\s+|the\s+)?(?:enterprise\s+)?invite|cancel\s+(?:an?\s+|the\s+)?(?:enterprise\s+)?invite|kill\s+(?:an?\s+|the\s+)?(?:enterprise\s+)?invite)/i;
const HTTPS_URL_PATTERN = /https?:\/\//i;
const ANNOUNCEMENT_DETAIL_FALLBACK_PATTERN =
  /\b(?:title|body|audience|pin(?:ned)?|notify|notification|all members|active members|alumni|parents|individuals)\b/i;
const CHAT_MESSAGE_FALLBACK_PATTERN =
  /\b(?:message|dm|direct message|chat message|write to|send to|message this person)\b/i;
const GROUP_CHAT_MESSAGE_FALLBACK_PATTERN =
  /\b(?:message|write to|send to|post in)\b[\s\S]{0,80}\b(?:group|chat group|channel|group chat)\b/i;
const DISCUSSION_REPLY_FALLBACK_PATTERN =
  /\b(?:reply|respond|response|comment|answer)\b/i;

function getCurrentPathFeatureSegment(pathname: string | undefined): string | null {
  if (!pathname) {
    return null;
  }

  const enterpriseMatch = pathname.match(/^\/enterprise\/[^/]+\/([^/?#]+)/);
  if (enterpriseMatch) {
    return enterpriseMatch[1] ?? null;
  }

  return pathname.match(/^\/[^/]+\/([^/?#]+)/)?.[1] ?? null;
}

function extractCurrentDiscussionThreadRouteId(pathname: string | undefined): string | null {
  if (!pathname) {
    return null;
  }

  const match =
    pathname.match(/^\/[^/]+\/messages\/threads\/([^/?#]+)(?:\/|$)/) ??
    pathname.match(/^\/[^/]+\/discussions\/([^/?#]+)(?:\/|$)/);

  return match?.[1] ?? null;
}

function extractCurrentMemberRouteId(pathname: string | undefined): string | null {
  if (!pathname) {
    return null;
  }

  const match = pathname.match(/^\/[^/]+\/members\/([^/?#]+)(?:\/|$)/);
  return match?.[1] ?? null;
}

function looksLikeStructuredJobDraft(message: string): boolean {
  const hasJobContext =
    /\b(job|job posting|opening|role|position|hiring|apply|application)\b/i.test(message);
  const structuredFieldMatches = [
    /\blocation type\b/i,
    /\bexperience level\b/i,
    /\bapplication (?:url|link)\b/i,
    /\bcontact email\b/i,
    /\bdescription\s*:/i,
    /\blink\s*:/i,
    /https?:\/\//i,
  ].filter((pattern) => pattern.test(message)).length;

  return hasJobContext && structuredFieldMatches >= 2 && message.trim().length >= 80;
}

const CONNECTION_PASS2_TEMPLATE = [
  "CONNECTION ANSWER CONTRACT:",
  "- If suggest_connections returned state=resolved, respond using this exact shape:",
  "  Top connections for [source person name]",
  "  1. [suggestion name] - [subtitle if present]",
  "  Why: [reason], [reason], [reason]",
  "- Use at most 3 suggestions.",
  "- Use only the returned source_person, suggestions, subtitles, and normalized reason labels.",
  "- Do not mention scores, UUIDs, Falkor, SQL fallback, freshness, or internal tool details.",
  "- Do not add a concluding summary sentence.",
  "- If state=ambiguous, ask the user which returned option they mean.",
  "- If state=not_found, say you couldn't find that person in the organization's member or alumni data and ask for a narrower identifier.",
  "- If state=no_suggestions, say you found the person but there is not enough strong professional overlap yet to recommend a connection.",
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

interface SuggestConnectionDisplayReason {
  label?: unknown;
}

function buildSseResponse(stream: ReadableStream<Uint8Array>, headers: HeadersInit, threadId: string) {
  return new Response(stream, {
    headers: {
      ...headers,
      "x-ai-thread-id": threadId,
    },
  });
}

interface SuggestConnectionDisplayRow {
  name?: unknown;
  subtitle?: unknown;
  reasons?: unknown;
}

interface SuggestConnectionDisplayPayload {
  state?: unknown;
  source_person?: { name?: unknown } | null;
  suggestions?: unknown;
  disambiguation_options?: unknown;
}

interface AnnouncementDisplayRow {
  title?: unknown;
  published_at?: unknown;
  audience?: unknown;
  is_pinned?: unknown;
  body_preview?: unknown;
}

interface NavigationDisplayTarget {
  label?: unknown;
  href?: unknown;
  description?: unknown;
  kind?: unknown;
}

interface NavigationDisplayPayload {
  state?: unknown;
  query?: unknown;
  matches?: unknown;
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

function getNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function formatIsoDate(value: unknown): string | null {
  const iso = getNonEmptyString(value);
  return iso ? iso.slice(0, 10) : null;
}

function formatDisplayRow(row: { name?: unknown; subtitle?: unknown }): string | null {
  const name = getNonEmptyString(row.name);
  if (!name) {
    return null;
  }

  const subtitle = getNonEmptyString(row.subtitle);
  return subtitle ? `${name} - ${subtitle}` : name;
}

function formatSuggestConnectionsResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as SuggestConnectionDisplayPayload;
  const state = getNonEmptyString(payload.state);

  if (!state) {
    return null;
  }

  if (state === "not_found") {
    return "I couldn't find that person in the organization's member or alumni data. Please share a narrower identifier like a full name or email.";
  }

  if (state === "ambiguous") {
    const options = Array.isArray(payload.disambiguation_options)
      ? payload.disambiguation_options
          .map((option) =>
            option && typeof option === "object"
              ? formatDisplayRow(option as { name?: unknown; subtitle?: unknown })
              : null
          )
          .filter((option): option is string => Boolean(option))
      : [];

    if (options.length === 0) {
      return null;
    }

    return `I found multiple matches. Which one did you mean?\n${options
      .map((option) => `- ${option}`)
      .join("\n")}`;
  }

  const sourceName = getNonEmptyString(payload.source_person?.name);
  if (!sourceName) {
    return null;
  }

  if (state === "no_suggestions") {
    return `I found ${sourceName}, but there isn't enough strong professional overlap yet to recommend specific connections within the organization.`;
  }

  if (state !== "resolved" || !Array.isArray(payload.suggestions)) {
    return null;
  }

  const suggestions = payload.suggestions
    .map((suggestion) => {
      if (!suggestion || typeof suggestion !== "object") {
        return null;
      }

      const displayLine = formatDisplayRow(suggestion as { name?: unknown; subtitle?: unknown });
      if (!displayLine) {
        return null;
      }

      const reasons = Array.isArray((suggestion as SuggestConnectionDisplayRow).reasons)
        ? ((suggestion as SuggestConnectionDisplayRow).reasons as SuggestConnectionDisplayReason[])
            .map((reason) => getNonEmptyString(reason?.label))
            .filter((label): label is string => Boolean(label))
        : [];

      if (reasons.length === 0) {
        return null;
      }

      return { displayLine, reasons };
    })
    .filter(
      (
        suggestion
      ): suggestion is {
        displayLine: string;
        reasons: string[];
      } => Boolean(suggestion)
    )
    .slice(0, 3);

  if (suggestions.length === 0) {
    return null;
  }

  const lines = [`Top connections for ${sourceName}`];
  for (const [index, suggestion] of suggestions.entries()) {
    lines.push(`${index + 1}. ${suggestion.displayLine}`);
    lines.push(`Why: ${suggestion.reasons.join(", ")}`);
  }

  return lines.join("\n");
}

function formatAnnouncementsResponse(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  if (data.length === 0) {
    return "I couldn't find any recent announcements for this organization.";
  }

  const rows = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const announcement = row as AnnouncementDisplayRow;
      const title = getNonEmptyString(announcement.title);
      if (!title) {
        return null;
      }

      const metadata: string[] = [];
      const publishedAt = getNonEmptyString(announcement.published_at);
      if (publishedAt) {
        metadata.push(publishedAt.slice(0, 10));
      }

      const audience = getNonEmptyString(announcement.audience);
      if (audience) {
        metadata.push(`audience: ${audience.replace(/_/g, " ")}`);
      }

      if (announcement.is_pinned === true) {
        metadata.push("pinned");
      }

      const preview = getNonEmptyString(announcement.body_preview);
      return {
        title,
        metadata,
        preview,
      };
    })
    .filter(
      (
        row
      ): row is {
        title: string;
        metadata: string[];
        preview: string | null;
      } => Boolean(row)
    )
    .slice(0, 5);

  if (rows.length === 0) {
    return null;
  }

  const lines = ["Recent announcements"];
  for (const row of rows) {
    lines.push(`- ${row.title}${row.metadata.length > 0 ? ` - ${row.metadata.join(" - ")}` : ""}`);
    if (row.preview) {
      lines.push(`  Preview: ${row.preview}`);
    }
  }

  return lines.join("\n");
}

function formatEventsResponse(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  if (data.length === 0) {
    return "I couldn't find any matching events for this organization.";
  }

  const rows = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const title = getNonEmptyString((row as { title?: unknown }).title);
      if (!title) {
        return null;
      }

      const metadata = [
        formatIsoDate((row as { start_date?: unknown }).start_date),
        getNonEmptyString((row as { location?: unknown }).location),
      ].filter((value): value is string => Boolean(value));
      const description = getNonEmptyString((row as { description?: unknown }).description);

      return { title, metadata, description };
    })
    .filter(
      (
        row
      ): row is {
        title: string;
        metadata: string[];
        description: string | null;
      } => Boolean(row)
    )
    .slice(0, 5);

  if (rows.length === 0) {
    return null;
  }

  const lines = ["Matching events"];
  for (const row of rows) {
    lines.push(`- ${row.title}${row.metadata.length > 0 ? ` - ${row.metadata.join(" - ")}` : ""}`);
    if (row.description) {
      lines.push(`  Details: ${row.description}`);
    }
  }

  return lines.join("\n");
}

function formatDiscussionsResponse(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  if (data.length === 0) {
    return "I couldn't find any recent discussion threads for this organization.";
  }

  const rows = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const title = getNonEmptyString((row as { title?: unknown }).title);
      if (!title) {
        return null;
      }

      const metadata = [
        formatIsoDate((row as { created_at?: unknown }).created_at),
        typeof (row as { comment_count?: unknown }).comment_count === "number"
          ? `${(row as { comment_count: number }).comment_count} comments`
          : null,
      ].filter((value): value is string => Boolean(value));
      const preview = getNonEmptyString((row as { body_preview?: unknown }).body_preview);

      return { title, metadata, preview };
    })
    .filter(
      (
        row
      ): row is {
        title: string;
        metadata: string[];
        preview: string | null;
      } => Boolean(row)
    )
    .slice(0, 5);

  if (rows.length === 0) {
    return null;
  }

  const lines = ["Recent discussions"];
  for (const row of rows) {
    lines.push(`- ${row.title}${row.metadata.length > 0 ? ` - ${row.metadata.join(" - ")}` : ""}`);
    if (row.preview) {
      lines.push(`  Preview: ${row.preview}`);
    }
  }

  return lines.join("\n");
}

function formatJobPostingsResponse(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  if (data.length === 0) {
    return "I couldn't find any active job postings for this organization.";
  }

  const rows = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const title = getNonEmptyString((row as { title?: unknown }).title);
      if (!title) {
        return null;
      }

      const metadata = [
        getNonEmptyString((row as { company?: unknown }).company),
        getNonEmptyString((row as { location?: unknown }).location),
        getNonEmptyString((row as { job_type?: unknown }).job_type),
      ].filter((value): value is string => Boolean(value));
      const preview = getNonEmptyString(
        (row as { description_preview?: unknown }).description_preview
      );

      return { title, metadata, preview };
    })
    .filter(
      (
        row
      ): row is {
        title: string;
        metadata: string[];
        preview: string | null;
      } => Boolean(row)
    )
    .slice(0, 5);

  if (rows.length === 0) {
    return null;
  }

  const lines = ["Active job postings"];
  for (const row of rows) {
    lines.push(`- ${row.title}${row.metadata.length > 0 ? ` - ${row.metadata.join(" - ")}` : ""}`);
    if (row.preview) {
      lines.push(`  Preview: ${row.preview}`);
    }
  }

  return lines.join("\n");
}

function formatOrgStatsResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    active_members?: unknown;
    alumni?: unknown;
    parents?: unknown;
    upcoming_events?: unknown;
    donations?: {
      total_amount_cents?: unknown;
      donation_count?: unknown;
      last_donation_at?: unknown;
    } | null;
  };

  const lines = ["Organization snapshot"];

  if (typeof payload.active_members === "number") {
    lines.push(`- Active members: ${payload.active_members}`);
  }
  if (typeof payload.alumni === "number") {
    lines.push(`- Alumni: ${payload.alumni}`);
  }
  if (typeof payload.parents === "number") {
    lines.push(`- Parents: ${payload.parents}`);
  }
  if (typeof payload.upcoming_events === "number") {
    lines.push(`- Upcoming events: ${payload.upcoming_events}`);
  }

  if (payload.donations && typeof payload.donations === "object") {
    const donationSummary: string[] = [];
    if (typeof payload.donations.donation_count === "number") {
      donationSummary.push(`${payload.donations.donation_count} donations`);
    }
    if (typeof payload.donations.total_amount_cents === "number") {
      donationSummary.push(`$${(payload.donations.total_amount_cents / 100).toFixed(0)} raised`);
    }
    const lastDonationDate = formatIsoDate(payload.donations.last_donation_at);
    if (lastDonationDate) {
      donationSummary.push(`last donation ${lastDonationDate}`);
    }

    if (donationSummary.length > 0) {
      lines.push(`- Donations: ${donationSummary.join(" - ")}`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

function formatMemberRole(value: unknown): string | null {
  const role = getNonEmptyString(value);
  if (!role) {
    return null;
  }

  switch (role) {
    case "admin":
      return "Admin";
    case "active_member":
      return "Active Member";
    case "alumni":
      return "Alumni";
    case "parent":
      return "Parent";
    default:
      return role
        .split(/[_\s]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}

function formatMembersResponse(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  if (data.length === 0) {
    return "I couldn't find any active members for this organization.";
  }

  const rows = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const email = getNonEmptyString((row as { email?: unknown }).email);
      const roleLabel = formatMemberRole((row as { role?: unknown }).role);
      const addedDate = formatIsoDate((row as { created_at?: unknown }).created_at);
      const name = getNonEmptyString((row as { name?: unknown }).name);

      const label = name
        ? `${name}${roleLabel ? ` (${roleLabel})` : ""}`
        : email
          ? roleLabel === "Admin"
            ? "Email-only admin account"
            : "Email-only member account"
          : null;

      if (!label) {
        return null;
      }

      const metadata = [email, addedDate ? `added ${addedDate}` : null].filter(
        (value): value is string => Boolean(value)
      );

      return `- ${label}${metadata.length > 0 ? ` - ${metadata.join(" - ")}` : ""}`;
    })
    .filter((row): row is string => Boolean(row))
    .slice(0, 5);

  if (rows.length === 0) {
    return null;
  }

  return ["Recent active members", ...rows].join("\n");
}

function formatAlumniResponse(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  if (data.length === 0) {
    return "I couldn't find any alumni for this organization.";
  }

  const rows = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const name = getNonEmptyString((row as { name?: unknown }).name);
      if (!name) {
        return null;
      }

      const gradYear = typeof (row as { graduation_year?: unknown }).graduation_year === "number"
        ? `class of ${(row as { graduation_year: number }).graduation_year}`
        : null;
      const company = getNonEmptyString((row as { current_company?: unknown }).current_company);
      const city = getNonEmptyString((row as { current_city?: unknown }).current_city);
      const title = getNonEmptyString((row as { title?: unknown }).title);

      const metadata = [gradYear, company, city].filter(
        (value): value is string => Boolean(value)
      );
      const suffix = title ? ` (${title})` : "";

      return `- ${name}${metadata.length > 0 ? ` - ${metadata.join(" - ")}` : ""}${suffix}`;
    })
    .filter((row): row is string => Boolean(row))
    .slice(0, 10);

  if (rows.length === 0) {
    return null;
  }

  return ["Alumni", ...rows].join("\n");
}

function formatEnterpriseAlumniResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    results?: unknown;
    total?: unknown;
  };

  if (!Array.isArray(payload.results)) {
    return null;
  }

  if (payload.results.length === 0) {
    return "I couldn't find any matching alumni across the enterprise.";
  }

  const rows = payload.results
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const name = getNonEmptyString((row as { name?: unknown }).name);
      if (!name) {
        return null;
      }

      const organizationName = getNonEmptyString(
        (row as { organization_name?: unknown }).organization_name,
      );
      const gradYear =
        typeof (row as { graduation_year?: unknown }).graduation_year === "number"
          ? `class of ${(row as { graduation_year: number }).graduation_year}`
          : null;
      const company = getNonEmptyString((row as { current_company?: unknown }).current_company);
      const city = getNonEmptyString((row as { current_city?: unknown }).current_city);
      const title = getNonEmptyString((row as { title?: unknown }).title);

      const metadata = [
        organizationName,
        gradYear,
        company,
        city,
      ].filter((value): value is string => Boolean(value));

      return `- ${name}${metadata.length > 0 ? ` - ${metadata.join(" - ")}` : ""}${title ? ` (${title})` : ""}`;
    })
    .filter((row): row is string => Boolean(row))
    .slice(0, 10);

  if (rows.length === 0) {
    return null;
  }

  const total =
    typeof payload.total === "number" ? ` (${payload.total} total)` : "";

  return [`Enterprise alumni${total}`, ...rows].join("\n");
}

function formatEnterpriseStatsResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    total_count?: unknown;
    org_stats?: unknown;
    top_industries?: unknown;
  };

  const lines = ["Enterprise alumni snapshot"];

  if (typeof payload.total_count === "number") {
    lines.push(`- Total alumni: ${payload.total_count}`);
  }

  if (Array.isArray(payload.org_stats) && payload.org_stats.length > 0) {
    const orgSummary = payload.org_stats
      .map((row) => {
        if (!row || typeof row !== "object") {
          return null;
        }
        const name = getNonEmptyString((row as { name?: unknown }).name);
        const count =
          typeof (row as { count?: unknown }).count === "number"
            ? (row as { count: number }).count
            : null;
        if (!name || count == null) {
          return null;
        }
        return `${name} (${count})`;
      })
      .filter((value): value is string => Boolean(value))
      .slice(0, 5);

    if (orgSummary.length > 0) {
      lines.push(`- Org counts: ${orgSummary.join(", ")}`);
    }
  }

  if (Array.isArray(payload.top_industries) && payload.top_industries.length > 0) {
    const industries = payload.top_industries
      .map((row) => {
        if (!row || typeof row !== "object") {
          return null;
        }
        const name = getNonEmptyString((row as { name?: unknown }).name);
        const count =
          typeof (row as { count?: unknown }).count === "number"
            ? (row as { count: number }).count
            : null;
        if (!name || count == null) {
          return null;
        }
        return `${name} (${count})`;
      })
      .filter((value): value is string => Boolean(value))
      .slice(0, 5);

    if (industries.length > 0) {
      lines.push(`- Top industries: ${industries.join(", ")}`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

function formatEnterpriseQuotaResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    alumni?: { used?: unknown; limit?: unknown; remaining?: unknown } | null;
    sub_orgs?: {
      total?: unknown;
      enterprise_managed_total?: unknown;
      free_limit?: unknown;
      free_remaining?: unknown;
      configured_limit?: unknown;
      configured_remaining?: unknown;
    } | null;
  };

  const lines = ["Enterprise quota"];

  if (payload.alumni && typeof payload.alumni === "object") {
    const used =
      typeof payload.alumni.used === "number" ? payload.alumni.used : null;
    const limit =
      typeof payload.alumni.limit === "number" ? payload.alumni.limit : null;
    const remaining =
      typeof payload.alumni.remaining === "number" ? payload.alumni.remaining : null;

    if (used != null && limit != null) {
      lines.push(`- Alumni seats: ${used}/${limit} used`);
    }
    if (remaining != null) {
      lines.push(`- Alumni seats remaining: ${remaining}`);
    }
  }

  if (payload.sub_orgs && typeof payload.sub_orgs === "object") {
    const total =
      typeof payload.sub_orgs.total === "number" ? payload.sub_orgs.total : null;
    const enterpriseManagedTotal =
      typeof payload.sub_orgs.enterprise_managed_total === "number"
        ? payload.sub_orgs.enterprise_managed_total
        : null;
    const freeLimit =
      typeof payload.sub_orgs.free_limit === "number" ? payload.sub_orgs.free_limit : null;
    const freeRemaining =
      typeof payload.sub_orgs.free_remaining === "number"
        ? payload.sub_orgs.free_remaining
        : null;
    const configuredLimit =
      typeof payload.sub_orgs.configured_limit === "number"
        ? payload.sub_orgs.configured_limit
        : null;
    const configuredRemaining =
      typeof payload.sub_orgs.configured_remaining === "number"
        ? payload.sub_orgs.configured_remaining
        : null;

    if (total != null) {
      lines.push(`- Managed orgs: ${total}`);
    }
    if (enterpriseManagedTotal != null) {
      lines.push(`- Enterprise-managed org seats in use: ${enterpriseManagedTotal}`);
    }
    if (freeLimit != null) {
      lines.push(`- Free sub-org slots included: ${freeLimit}`);
    }
    if (freeRemaining != null) {
      lines.push(`- Free sub-org slots remaining: ${freeRemaining}`);
    }
    if (configuredLimit != null) {
      lines.push(`- Configured sub-org seat limit: ${configuredLimit}`);
    }
    if (configuredRemaining != null) {
      lines.push(`- Configured sub-org seats remaining: ${configuredRemaining}`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

function formatEnterpriseOrgCapacityResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    sub_orgs?: {
      total?: unknown;
      enterprise_managed_total?: unknown;
      free_limit?: unknown;
      free_remaining?: unknown;
    } | null;
  };

  if (!payload.sub_orgs || typeof payload.sub_orgs !== "object") {
    return null;
  }

  const total =
    typeof payload.sub_orgs.total === "number" ? payload.sub_orgs.total : null;
  const enterpriseManagedTotal =
    typeof payload.sub_orgs.enterprise_managed_total === "number"
      ? payload.sub_orgs.enterprise_managed_total
      : null;
  const freeLimit =
    typeof payload.sub_orgs.free_limit === "number" ? payload.sub_orgs.free_limit : null;
  const freeRemaining =
    typeof payload.sub_orgs.free_remaining === "number"
      ? payload.sub_orgs.free_remaining
      : null;

  const lines = ["Enterprise managed-org capacity"];
  if (total != null) {
    lines.push(`- Managed orgs: ${total}`);
  }
  if (enterpriseManagedTotal != null) {
    lines.push(`- Enterprise-managed org seats in use: ${enterpriseManagedTotal}`);
  }
  if (freeLimit != null) {
    lines.push(`- Free sub-org slots included: ${freeLimit}`);
  }
  if (freeRemaining != null) {
    lines.push(`- Free sub-org slots remaining: ${freeRemaining}`);
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

function formatManagedOrgsResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as { organizations?: unknown; total?: unknown };
  if (!Array.isArray(payload.organizations)) {
    return null;
  }

  if (payload.organizations.length === 0) {
    return "I couldn't find any organizations managed by this enterprise.";
  }

  const rows = payload.organizations
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const name = getNonEmptyString((row as { name?: unknown }).name);
      if (!name) {
        return null;
      }

      const slug = getNonEmptyString((row as { slug?: unknown }).slug);
      const relationshipType = getNonEmptyString(
        (row as { enterprise_relationship_type?: unknown }).enterprise_relationship_type,
      );
      const adoptedAt = formatIsoDate(
        (row as { enterprise_adopted_at?: unknown }).enterprise_adopted_at,
      );

      const metadata = [slug, relationshipType, adoptedAt].filter(
        (value): value is string => Boolean(value),
      );

      return `- ${name}${metadata.length > 0 ? ` - ${metadata.join(" - ")}` : ""}`;
    })
    .filter((row): row is string => Boolean(row))
    .slice(0, 10);

  if (rows.length === 0) {
    return null;
  }

  const total =
    typeof payload.total === "number" ? ` (${payload.total} total)` : "";

  return [`Managed organizations${total}`, ...rows].join("\n");
}

function formatAuditEventsResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as { events?: unknown; total?: unknown };
  if (!Array.isArray(payload.events)) {
    return null;
  }

  if (payload.events.length === 0) {
    return "I couldn't find any recent enterprise audit events.";
  }

  const rows = payload.events
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const source = getNonEmptyString((row as { source?: unknown }).source);
      const action = getNonEmptyString((row as { action?: unknown }).action);
      const when = formatIsoDate((row as { created_at?: unknown }).created_at);
      const actor = getNonEmptyString(
        (row as { actor_email_redacted?: unknown }).actor_email_redacted,
      );
      const targetType = getNonEmptyString((row as { target_type?: unknown }).target_type);
      const status = getNonEmptyString((row as { status?: unknown }).status);

      const parts = [action ?? source ?? "event"];
      if (when) parts.push(when);
      if (actor) parts.push(`by ${actor}`);
      if (targetType) parts.push(`target: ${targetType}`);
      if (status) parts.push(`status: ${status}`);

      return `- ${parts.join(" - ")}`;
    })
    .filter((row): row is string => Boolean(row))
    .slice(0, 25);

  if (rows.length === 0) {
    return null;
  }

  const total =
    typeof payload.total === "number" ? ` (${payload.total} total)` : "";

  return [`Recent enterprise audit events${total}`, ...rows].join("\n");
}

function formatDonationsResponse(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  if (data.length === 0) {
    return "I couldn't find any donations for this organization.";
  }

  const rows = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const donorName = getNonEmptyString((row as { donor_name?: unknown }).donor_name) ?? "Unknown";
      const amountDollars = typeof (row as { amount_dollars?: unknown }).amount_dollars === "number"
        ? `$${((row as { amount_dollars: number }).amount_dollars).toFixed(2)}`
        : null;
      const status = getNonEmptyString((row as { status?: unknown }).status);
      const date = formatIsoDate((row as { created_at?: unknown }).created_at);
      const purpose = getNonEmptyString((row as { purpose?: unknown }).purpose);

      const metadata = [amountDollars, status, date].filter(
        (value): value is string => Boolean(value)
      );
      const suffix = purpose ? ` (${purpose})` : "";

      return `- ${donorName}${metadata.length > 0 ? ` - ${metadata.join(" - ")}` : ""}${suffix}`;
    })
    .filter((row): row is string => Boolean(row))
    .slice(0, 10);

  if (rows.length === 0) {
    return null;
  }

  return ["Donations", ...rows].join("\n");
}

function formatParentsResponse(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  if (data.length === 0) {
    return "I couldn't find any parents for this organization.";
  }

  const rows = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const name = getNonEmptyString((row as { name?: unknown }).name);
      if (!name) {
        return null;
      }

      const relationship = getNonEmptyString((row as { relationship?: unknown }).relationship);
      const studentName = getNonEmptyString((row as { student_name?: unknown }).student_name);

      const metadata = [
        relationship,
        studentName ? `student: ${studentName}` : null,
      ].filter((value): value is string => Boolean(value));

      return `- ${name}${metadata.length > 0 ? ` - ${metadata.join(" - ")}` : ""}`;
    })
    .filter((row): row is string => Boolean(row))
    .slice(0, 10);

  if (rows.length === 0) {
    return null;
  }

  return ["Parent directory", ...rows].join("\n");
}

function formatPhilanthropyEventsResponse(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  if (data.length === 0) {
    return "I couldn't find any philanthropy events for this organization.";
  }

  const rows = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const title = getNonEmptyString((row as { title?: unknown }).title);
      if (!title) {
        return null;
      }

      const metadata = [
        formatIsoDate((row as { start_date?: unknown }).start_date),
        getNonEmptyString((row as { location?: unknown }).location),
      ].filter((value): value is string => Boolean(value));
      const description = getNonEmptyString((row as { description?: unknown }).description);

      return { title, metadata, description };
    })
    .filter(
      (
        row
      ): row is {
        title: string;
        metadata: string[];
        description: string | null;
      } => Boolean(row)
    )
    .slice(0, 5);

  if (rows.length === 0) {
    return null;
  }

  const lines = ["Philanthropy events"];
  for (const row of rows) {
    lines.push(`- ${row.title}${row.metadata.length > 0 ? ` - ${row.metadata.join(" - ")}` : ""}`);
    if (row.description) {
      lines.push(`  Details: ${row.description}`);
    }
  }

  return lines.join("\n");
}

function formatNavigationTargetsResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as NavigationDisplayPayload;
  const state = getNonEmptyString(payload.state);
  const query = getNonEmptyString(payload.query) ?? "that";

  if (!state) {
    return null;
  }

  if (state === "not_found") {
    return `I couldn't find a matching page for "${query}". Try naming the feature, like announcements, members, events, donations, or navigation settings.`;
  }

  if (state !== "resolved" || !Array.isArray(payload.matches)) {
    return null;
  }

  const matches = payload.matches
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const target = row as NavigationDisplayTarget;
      const label = getNonEmptyString(target.label);
      const href = getNonEmptyString(target.href);
      if (!label || !href) {
        return null;
      }

      const description = getNonEmptyString(target.description);
      const kind = getNonEmptyString(target.kind);
      return { label, href, description, kind };
    })
    .filter(
      (
        row
      ): row is {
        label: string;
        href: string;
        description: string | null;
        kind: string | null;
      } => Boolean(row)
    )
    .slice(0, 3);

  if (matches.length === 0) {
    return null;
  }

  const lines = [`Best matches for "${query}"`];
  for (const match of matches) {
    lines.push(`- [${match.label}](${match.href})${match.kind ? ` - ${match.kind}` : ""}`);
    if (match.description) {
      lines.push(`  ${match.description}`);
    }
  }

  return lines.join("\n");
}

function getPass1Tools(
  message: string,
  effectiveSurface: CacheSurface,
  toolPolicy: TurnExecutionPolicy["toolPolicy"],
  intentType: TurnExecutionPolicy["intentType"],
  attachment?: ChatAttachment,
  currentPath?: string,
  enterpriseEnabled?: boolean,
  enterpriseRole?: EnterpriseRole,
) {
  if (toolPolicy !== "surface_read_tools") {
    return undefined;
  }

  if (CREATE_ANNOUNCEMENT_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.prepare_announcement];
  }

  if (CREATE_JOB_PROMPT_PATTERN.test(message) || looksLikeStructuredJobDraft(message)) {
    return [AI_TOOL_MAP.prepare_job_posting];
  }

  if (LIST_CHAT_GROUPS_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.list_chat_groups];
  }

  if (SEND_GROUP_CHAT_MESSAGE_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.prepare_group_message];
  }

  if (SEND_CHAT_MESSAGE_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.prepare_chat_message];
  }

  if (DISCUSSION_REPLY_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.prepare_discussion_reply];
  }

  if (CREATE_DISCUSSION_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.prepare_discussion_thread];
  }

  if (
    PDF_SCHEDULE_PROMPT_PATTERN.test(message) ||
    (attachment?.mimeType && SCHEDULE_ATTACHMENT_MIME_TYPES.has(attachment.mimeType))
  ) {
    return [AI_TOOL_MAP.extract_schedule_pdf];
  }

  if (
    SCRAPE_SCHEDULE_PROMPT_PATTERN.test(message) ||
    (HTTPS_URL_PATTERN.test(message) && CREATE_EVENT_PROMPT_PATTERN.test(message))
  ) {
    return [AI_TOOL_MAP.scrape_schedule_website];
  }

  if (CREATE_EVENT_PROMPT_PATTERN.test(message)) {
    // Detect multi-event intent: "create 3 events", "schedule multiple events", numbered list patterns
    const multiEventPattern = /(?:\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten|multiple|several|a few|some|batch)\s+events?\b|(?:events?.*,.*(?:and|&)\s))/i;
    if (multiEventPattern.test(message)) {
      // Provide both tools — the model can use prepare_events_batch for all
      // events in one call, or call prepare_event multiple times via parallel
      // tool calls. Either path works because the frontend accumulates
      // pending actions. Importantly, we do NOT force tool choice here — the
      // batch schema is too complex for the 15s pass-1 timeout when forced.
      return [AI_TOOL_MAP.prepare_events_batch, AI_TOOL_MAP.prepare_event];
    }
    return [AI_TOOL_MAP.prepare_event];
  }

  if (intentType === "navigation" && DIRECT_NAVIGATION_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.find_navigation_targets];
  }

  const currentFeatureSegment = getCurrentPathFeatureSegment(currentPath);
  const isEnterprisePortal =
    enterpriseEnabled === true && currentPath?.startsWith("/enterprise/") === true;
  const isEnterpriseScopedRequest =
    enterpriseEnabled === true &&
    (isEnterprisePortal || ENTERPRISE_SCOPE_PROMPT_PATTERN.test(message));
  const canManageEnterpriseBilling =
    enterpriseRole != null && getEnterprisePermissions(enterpriseRole).canManageBilling;

  if (isEnterpriseScopedRequest) {
    if (ENTERPRISE_INVITE_REVOKE_PROMPT_PATTERN.test(message)) {
      return [AI_TOOL_MAP.revoke_enterprise_invite];
    }

    if (ENTERPRISE_INVITE_CREATE_PROMPT_PATTERN.test(message)) {
      return [AI_TOOL_MAP.prepare_enterprise_invite];
    }

    if (ENTERPRISE_AUDIT_PROMPT_PATTERN.test(message)) {
      return [AI_TOOL_MAP.list_enterprise_audit_events];
    }

    if (
      currentFeatureSegment === "billing" ||
      ENTERPRISE_QUOTA_PROMPT_PATTERN.test(message)
    ) {
      if (canManageEnterpriseBilling) {
        return [AI_TOOL_MAP.get_enterprise_quota];
      }

      if (ENTERPRISE_SUB_ORG_CAPACITY_PROMPT_PATTERN.test(message)) {
        return [AI_TOOL_MAP.get_enterprise_org_capacity];
      }

      return [AI_TOOL_MAP.get_enterprise_quota];
    }

    if (
      currentFeatureSegment === "organizations" ||
      MANAGED_ORGS_PROMPT_PATTERN.test(message)
    ) {
      return [AI_TOOL_MAP.list_managed_orgs];
    }

    if (
      currentFeatureSegment === "alumni" ||
      ALUMNI_ROSTER_PROMPT_PATTERN.test(message)
    ) {
      if (MEMBER_COUNT_PROMPT_PATTERN.test(message)) {
        return [AI_TOOL_MAP.get_enterprise_stats];
      }

      return [AI_TOOL_MAP.list_enterprise_alumni];
    }
  }

  if (effectiveSurface === "members" && CONNECTION_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.suggest_connections];
  }

  if (ALUMNI_ROSTER_PROMPT_PATTERN.test(message) && !MEMBER_COUNT_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.list_alumni];
  }

  if (PARENT_LIST_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.list_parents];
  }

  if (PHILANTHROPY_EVENTS_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.list_philanthropy_events];
  }

  if (
    DONATION_LIST_PROMPT_PATTERN.test(message) &&
    !MEMBER_COUNT_PROMPT_PATTERN.test(message) &&
    !DONATION_STATS_PROMPT_PATTERN.test(message)
  ) {
    return [AI_TOOL_MAP.list_donations];
  }

  if (effectiveSurface === "members") {
    if (MEMBER_COUNT_PROMPT_PATTERN.test(message)) {
      return [AI_TOOL_MAP.get_org_stats];
    }

    if (MEMBER_ROSTER_PROMPT_PATTERN.test(message)) {
      return [AI_TOOL_MAP.list_members];
    }
  }

  if (
    currentFeatureSegment === "announcements" &&
    ANNOUNCEMENT_DETAIL_FALLBACK_PATTERN.test(message) &&
    !DIRECT_QUERY_START_PATTERN.test(message.trim()) &&
    !message.trim().endsWith("?")
  ) {
    return [AI_TOOL_MAP.prepare_announcement];
  }

  if (
    extractCurrentMemberRouteId(currentPath) &&
    CHAT_MESSAGE_FALLBACK_PATTERN.test(message) &&
    !DIRECT_QUERY_START_PATTERN.test(message.trim()) &&
    !message.trim().endsWith("?")
  ) {
    return [AI_TOOL_MAP.prepare_chat_message];
  }

  if (
    currentFeatureSegment === "messages" &&
    GROUP_CHAT_MESSAGE_FALLBACK_PATTERN.test(message) &&
    !DIRECT_QUERY_START_PATTERN.test(message.trim()) &&
    !message.trim().endsWith("?")
  ) {
    return [AI_TOOL_MAP.prepare_group_message];
  }

  if (
    extractCurrentDiscussionThreadRouteId(currentPath) &&
    DISCUSSION_REPLY_FALLBACK_PATTERN.test(message) &&
    !DIRECT_QUERY_START_PATTERN.test(message.trim()) &&
    !message.trim().endsWith("?")
  ) {
    return [AI_TOOL_MAP.prepare_discussion_reply];
  }

  return PASS1_TOOL_NAMES[effectiveSurface].map((toolName) => AI_TOOL_MAP[toolName]);
}

function getForcedPass1ToolChoice(
  pass1Tools: ReturnType<typeof getPass1Tools>
): OpenAI.Chat.ChatCompletionToolChoiceOption | undefined {
  if (!pass1Tools || pass1Tools.length !== 1) {
    return undefined;
  }

  const forcedToolName = pass1Tools[0]?.function.name;
  if (
    forcedToolName !== "prepare_announcement" &&
    forcedToolName !== "prepare_job_posting" &&
    forcedToolName !== "prepare_chat_message" &&
    forcedToolName !== "list_chat_groups" &&
    forcedToolName !== "prepare_group_message" &&
    forcedToolName !== "prepare_discussion_reply" &&
    forcedToolName !== "prepare_discussion_thread" &&
    forcedToolName !== "prepare_event" &&
    forcedToolName !== "list_members" &&
    forcedToolName !== "get_org_stats" &&
    forcedToolName !== "get_enterprise_stats" &&
    forcedToolName !== "get_enterprise_quota" &&
    forcedToolName !== "get_enterprise_org_capacity" &&
    forcedToolName !== "list_events" &&
    forcedToolName !== "list_alumni" &&
    forcedToolName !== "list_enterprise_alumni" &&
    forcedToolName !== "list_donations" &&
    forcedToolName !== "list_managed_orgs" &&
    forcedToolName !== "list_enterprise_audit_events" &&
    forcedToolName !== "prepare_enterprise_invite" &&
    forcedToolName !== "revoke_enterprise_invite" &&
    forcedToolName !== "list_parents" &&
    forcedToolName !== "list_philanthropy_events" &&
    forcedToolName !== "scrape_schedule_website" &&
    forcedToolName !== "extract_schedule_pdf"
  ) {
    return undefined;
  }

  return {
    type: "function",
    function: {
      name: forcedToolName,
    },
  };
}

function isToolFirstEligible(
  pass1Tools: ReturnType<typeof getPass1Tools>
): boolean {
  if (!pass1Tools || pass1Tools.length !== 1) {
    return false;
  }

  const toolName = pass1Tools[0]?.function.name;
  return (
    toolName === "list_members" ||
    toolName === "get_org_stats" ||
    toolName === "find_navigation_targets" ||
    toolName === "list_announcements" ||
    toolName === "list_chat_groups" ||
    toolName === "list_events" ||
    toolName === "list_discussions" ||
    toolName === "list_job_postings" ||
    toolName === "list_alumni" ||
    toolName === "list_enterprise_alumni" ||
    toolName === "list_donations" ||
    toolName === "list_managed_orgs" ||
    toolName === "list_enterprise_audit_events" ||
    toolName === "list_parents" ||
    toolName === "list_philanthropy_events" ||
    toolName === "get_enterprise_stats" ||
    toolName === "get_enterprise_quota" ||
    toolName === "get_enterprise_org_capacity" ||
    toolName === "suggest_connections" ||
    toolName === "prepare_group_message"
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

  return {
    actionId: pending.id,
    actionType: pending.action_type,
    expiresAt: pending.expires_at,
    summary: {
      title: pending.summary.title,
      description: pending.summary.description,
    },
    payload: pending.payload as Record<string, unknown>,
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

function formatPrepareJobPostingResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as PendingActionToolPayload;
  if (payload.state === "invalid_source_url") {
    return typeof payload.message === "string" && payload.message.length > 0
      ? `I couldn't read that job posting URL safely. ${payload.message}`
      : "I couldn't read that job posting URL safely. Please provide the job details directly.";
  }

  if (payload.state === "missing_fields") {
    const missingFields = Array.isArray(payload.missing_fields)
      ? payload.missing_fields.filter((field): field is string => typeof field === "string" && field.length > 0)
      : [];
    const sourceWarning =
      typeof payload.source_warning === "string" && payload.source_warning.length > 0
        ? payload.source_warning
        : null;

    if (missingFields.length === 0) {
      return sourceWarning
        ? `I couldn't read that job posting URL safely, but I can still draft this job if you share a few more details.`
        : "I still need a few more job details before I can prepare this posting.";
    }

    return sourceWarning
      ? `I couldn't read that job posting URL safely, so I still need: ${missingFields.join(", ")}.`
      : `I can draft this job, but I still need: ${missingFields.join(", ")}.`;
  }

  if (payload.state === "needs_confirmation") {
    return "I drafted the job posting. Review the details below and confirm when you're ready to create it.";
  }

  return null;
}

function formatPrepareAnnouncementResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as PendingActionToolPayload;
  if (payload.state === "missing_fields") {
    const missingFields = Array.isArray(payload.missing_fields)
      ? payload.missing_fields.filter((field): field is string => typeof field === "string" && field.length > 0)
      : [];

    if (missingFields.length === 0) {
      return "I still need an announcement title before I can prepare this post.";
    }

    return `I can draft this announcement, but I still need: ${missingFields.join(", ")}.`;
  }

  if (payload.state === "needs_confirmation") {
    return "I drafted the announcement. Review the details below and confirm when you're ready to publish it.";
  }

  return null;
}

function formatPrepareEnterpriseInviteResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const payload = data as PendingActionToolPayload;
  if (payload.state === "missing_fields") {
    const missingFields = Array.isArray(payload.missing_fields)
      ? payload.missing_fields.filter(
          (field): field is string => typeof field === "string" && field.length > 0,
        )
      : [];
    if (missingFields.length === 0) {
      return "I can draft this enterprise invite, but I still need more details before I can prepare it.";
    }
    return `I can draft this enterprise invite, but I still need: ${missingFields.join(", ")}.`;
  }
  if (payload.state === "needs_confirmation") {
    return "I drafted the enterprise invite. Review the details below and confirm when you're ready to create it.";
  }
  return null;
}

function formatRevokeEnterpriseInviteResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const payload = data as PendingActionToolPayload;
  if (payload.state === "needs_confirmation") {
    return "I found that enterprise invite. Confirm below to revoke it.";
  }
  return null;
}

function formatPrepareDiscussionThreadResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as PendingActionToolPayload;
  if (payload.state === "missing_fields") {
    const missingFields = Array.isArray(payload.missing_fields)
      ? payload.missing_fields.filter((field): field is string => typeof field === "string" && field.length > 0)
      : [];

    if (missingFields.length === 0) {
      return "I still need a discussion title and body before I can prepare this thread.";
    }

    return `I can draft this discussion, but I still need: ${missingFields.join(", ")}.`;
  }

  if (payload.state === "needs_confirmation") {
    return "I drafted the discussion thread. Review the details below and confirm when you're ready to post it.";
  }

  return null;
}

function formatPrepareDiscussionReplyResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as PendingActionToolPayload;
  if (payload.state === "missing_fields") {
    const clarificationKind = getNonEmptyString(payload.clarification_kind);
    const requestedThreadTitle = getNonEmptyString(payload.requested_thread_title);
    const candidateThreadTitles = Array.isArray(payload.candidate_thread_titles)
      ? payload.candidate_thread_titles.filter(
          (title): title is string => typeof title === "string" && title.trim().length > 0
        )
      : [];
    const missingFields = Array.isArray(payload.missing_fields)
      ? payload.missing_fields.filter((field): field is string => typeof field === "string" && field.length > 0)
      : [];

    if (clarificationKind === "thread_title_required") {
      return "I can draft this discussion reply, but I still need the thread title before I can prepare it.";
    }

    if (clarificationKind === "thread_title_ambiguous") {
      const options =
        candidateThreadTitles.length > 0
          ? candidateThreadTitles.join("; ")
          : "the matching discussion threads";
      return `I found a few discussion threads that match${
        requestedThreadTitle ? ` "${requestedThreadTitle}"` : ""
      }. Tell me which one you mean: ${options}.`;
    }

    if (clarificationKind === "thread_title_not_found") {
      if (requestedThreadTitle) {
        return `I couldn't find a discussion thread titled "${requestedThreadTitle}". Share a more specific thread title and I'll use that.`;
      }
      return "I couldn't find that discussion thread. Share a more specific thread title and I'll use that.";
    }

    if (clarificationKind === "thread_lookup_failed") {
      return "I couldn't look up that thread right now. Please try again.";
    }

    if (missingFields.length === 0) {
      return "I still need the reply body and the target discussion thread title before I can prepare this reply.";
    }

    const displayFields = missingFields.map((field) =>
      field === "discussion_thread_id" ? "thread title" : field
    );

    return `I can draft this discussion reply, but I still need: ${displayFields.join(", ")}.`;
  }

  if (payload.state === "needs_confirmation") {
    return "I drafted the discussion reply. Review the details below and confirm when you're ready to post it.";
  }

  return null;
}

function formatPrepareChatMessageResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as PendingActionToolPayload;
  if (payload.state === "missing_fields") {
    const clarificationKind = getNonEmptyString(payload.clarification_kind);
    const requestedRecipient = getNonEmptyString(payload.requested_recipient);
    const candidateRecipients = Array.isArray(payload.candidate_recipients)
      ? payload.candidate_recipients.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0
        )
      : [];
    const missingFields = Array.isArray(payload.missing_fields)
      ? payload.missing_fields.filter((field): field is string => typeof field === "string" && field.length > 0)
      : [];

    if (clarificationKind === "recipient_required") {
      if (missingFields.includes("body")) {
        return "I can draft that chat message, but I still need who it should go to and the message body.";
      }
      return "I can draft that chat message, but I still need to know who should receive it.";
    }

    if (clarificationKind === "recipient_ambiguous") {
      const options =
        candidateRecipients.length > 0 ? candidateRecipients.join("; ") : "the matching members";
      return `I found a few members that match${
        requestedRecipient ? ` "${requestedRecipient}"` : ""
      }. Tell me which one you mean: ${options}.`;
    }

    if (clarificationKind === "recipient_unavailable") {
      if (requestedRecipient) {
        return `I can't send an in-app chat message to "${requestedRecipient}" right now. Pick a different member or choose someone with an active linked account.`;
      }
      return "I can't send an in-app chat message to that person right now. Pick a different member or choose someone with an active linked account.";
    }

    if (missingFields.length === 0) {
      return "I still need the chat message details before I can prepare it.";
    }

    const displayFields = missingFields.map((field) =>
      field === "person_query" ? "recipient" : field
    );
    return `I can draft that chat message, but I still need: ${displayFields.join(", ")}.`;
  }

  if (payload.state === "needs_confirmation") {
    return "I drafted the chat message. Review the details below and confirm when you're ready to send it.";
  }

  return null;
}

function formatChatGroupsResponse(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  const groups = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const name = getNonEmptyString((row as { name?: unknown }).name);
      if (!name) {
        return null;
      }

      const role = getNonEmptyString((row as { role?: unknown }).role);
      return role ? `${name} (${role})` : name;
    })
    .filter((row): row is string => Boolean(row))
    .slice(0, 8);

  if (groups.length === 0) {
    return "You do not have any active chat groups available right now.";
  }

  return `You can message these chat groups:\n- ${groups.join("\n- ")}`;
}

function formatPrepareGroupMessageResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as PendingActionToolPayload;
  if (payload.state === "missing_fields") {
    const clarificationKind = getNonEmptyString(payload.clarification_kind);
    const requestedGroup = getNonEmptyString(payload.requested_group);
    const candidateGroups = Array.isArray(payload.candidate_groups)
      ? payload.candidate_groups
          .map((value) => {
            if (!value || typeof value !== "object") {
              return null;
            }

            return getNonEmptyString((value as { name?: unknown }).name);
          })
          .filter((value): value is string => Boolean(value))
      : [];
    const missingFields = Array.isArray(payload.missing_fields)
      ? payload.missing_fields.filter((field): field is string => typeof field === "string" && field.length > 0)
      : [];

    if (clarificationKind === "group_required") {
      if (missingFields.includes("body")) {
        return "I can draft that group message, but I still need which chat group it should go to and the message body.";
      }
      return "I can draft that group message, but I still need to know which chat group should receive it.";
    }

    if (clarificationKind === "group_ambiguous") {
      const options =
        candidateGroups.length > 0 ? candidateGroups.join("; ") : "the matching chat groups";
      return `I found a few chat groups that match${
        requestedGroup ? ` "${requestedGroup}"` : ""
      }. Tell me which one you mean: ${options}.`;
    }

    if (clarificationKind === "group_unavailable") {
      if (requestedGroup) {
        return `I can't send an in-app group chat message to "${requestedGroup}" right now. Pick a different chat group or choose one you still belong to.`;
      }
      return "I can't send an in-app group chat message there right now. Pick a different chat group or choose one you still belong to.";
    }

    if (missingFields.length === 0) {
      return "I still need the group chat message details before I can prepare it.";
    }

    const displayFields = missingFields.map((field) =>
      field === "group_name_query" ? "chat group" : field
    );
    return `I can draft that group message, but I still need: ${displayFields.join(", ")}.`;
  }

  if (payload.state === "needs_confirmation") {
    return "I drafted the group message. Review the details below and confirm when you're ready to send it.";
  }

  return null;
}

function formatPrepareEventResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as PendingActionToolPayload;
  if (payload.state === "missing_fields") {
    const missingFields = Array.isArray(payload.missing_fields)
      ? payload.missing_fields.filter((field): field is string => typeof field === "string" && field.length > 0)
      : [];

    if (missingFields.length === 0) {
      return "I still need an event title, start date, and start time before I can prepare this event.";
    }

    return `I can draft this event, but I still need: ${missingFields.join(", ")}.`;
  }

  if (payload.state === "needs_confirmation") {
    return "I drafted the event. Review the details below and confirm when you're ready to add it to the calendar.";
  }

  return null;
}

function formatPrepareEventsBatchResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    state?: string;
    pending_actions?: unknown[];
    validation_errors?: Array<{ index: number; missing_fields: string[] }>;
  };

  if (payload.state === "missing_fields") {
    const errors = payload.validation_errors ?? [];
    const allMissing = errors.flatMap((e) => e.missing_fields);
    const unique = [...new Set(allMissing)];
    if (unique.length === 0) {
      return "I need more details for these events before I can prepare them.";
    }
    return `None of the events are ready yet. I still need: ${unique.join(", ")} for each event.`;
  }

  if (payload.state === "needs_batch_confirmation") {
    const count = Array.isArray(payload.pending_actions) ? payload.pending_actions.length : 0;
    const errorCount = Array.isArray(payload.validation_errors) ? payload.validation_errors.length : 0;
    let msg = `I drafted ${count} event${count !== 1 ? "s" : ""}. Review the details below and confirm when you're ready.`;
    if (errorCount > 0) {
      msg += ` ${errorCount} event${errorCount !== 1 ? "s" : ""} couldn't be prepared — I'll need more details for ${errorCount === 1 ? "that one" : "those"}.`;
    }
    return msg;
  }

  return null;
}

function formatRevisedPendingEventResponse(data: unknown, count: number): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    state?: string;
    validation_errors?: Array<{ index: number; missing_fields: string[] }>;
  };

  if (payload.state === "missing_fields") {
    const errors = Array.isArray(payload.validation_errors) ? payload.validation_errors : [];
    const missingFields = [...new Set(errors.flatMap((error) => error.missing_fields))];

    if (missingFields.length === 0) {
      return "I updated the drafted schedule, but I still need a few more details before it is ready to confirm again.";
    }

    return `I updated the drafted schedule, but I still need: ${missingFields.join(", ")} before you can confirm the revised events.`;
  }

  if (payload.state === "needs_batch_confirmation" || payload.state === "needs_confirmation") {
    return count === 1
      ? "I revised the drafted event. Review the updated details below and confirm when you're ready."
      : "I revised the drafted schedule. Review the updated details below and confirm when you're ready.";
  }

  return null;
}

function formatExtractScheduleFileResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    state?: string;
    pending_actions?: unknown[];
    validation_errors?: Array<{ index: number; missing_fields: string[] }>;
    source_file?: unknown;
  };

  if (payload.state === "no_events_found") {
    return "I couldn't find any usable events in that schedule file. Try a clearer photo or upload a PDF export if you have one.";
  }

  if (payload.state === "missing_fields") {
    const errors = Array.isArray(payload.validation_errors) ? payload.validation_errors : [];
    const missingFields = [...new Set(errors.flatMap((error) => error.missing_fields))];

    if (missingFields.length === 0) {
      return "I could read the schedule file, but I need a few more event details before I can prepare anything for confirmation.";
    }

    return `I could read the schedule file, but I still need: ${missingFields.join(", ")} before I can prepare those events.`;
  }

  if (payload.state === "needs_batch_confirmation") {
    const count = Array.isArray(payload.pending_actions) ? payload.pending_actions.length : 0;
    const skipped = Array.isArray(payload.validation_errors) ? payload.validation_errors.length : 0;
    let message = `I drafted ${count} event${count === 1 ? "" : "s"} from that schedule file. Review the details below and confirm when you're ready.`;
    if (skipped > 0) {
      message += ` ${skipped} event${skipped === 1 ? "" : "s"} still need more details.`;
    }
    return message;
  }

  return null;
}

function formatDeterministicToolErrorResponse(
  name: string,
  error: string,
  errorCode?: string | null
): string | null {
  if (name !== "extract_schedule_pdf") {
    if (
      name === "get_enterprise_quota" &&
      (errorCode === "enterprise_billing_role_required" ||
        /enterprise owner or billing admin role/i.test(error))
    ) {
      return "I can’t access enterprise quota or billing details for your role. Enterprise owners and billing admins can view alumni seat limits and billing quotas.";
    }

    return null;
  }

  switch (errorCode) {
    case "attachment_required":
      return "I need an uploaded schedule file before I can import anything. Please attach a PDF or schedule image and try again.";
    case "invalid_attachment_path":
      return "That uploaded schedule file is no longer valid for this session. Please upload it again.";
    case "org_context_failed":
      return "I couldn't load the organization context for that schedule import right now. Please try again.";
    case "attachment_unavailable":
      return "I couldn't load that uploaded schedule file. Please re-upload it and try again.";
    case "image_too_large":
      return "That schedule image is too large to process. Please upload an image under 2MB or use a PDF instead.";
    case "image_timeout":
      return "I wasn't able to extract the schedule from the attached image file because the extraction tool timed out. This can happen with larger or more complex image files. Please re-upload it and I'll try again, or upload a PDF version if you have one.";
    case "image_unreadable":
      return "I couldn't read that schedule image. Try a clearer photo, better lighting, or upload a PDF version of the schedule.";
    case "image_model_misconfigured":
      return "Schedule image extraction is misconfigured in this environment. Set ZAI_IMAGE_MODEL to a Z.AI vision model like glm-5v-turbo and restart the server.";
    case "pdf_timeout":
      return "The attached PDF schedule timed out during extraction. Please try again, or send the event details in text if the PDF keeps failing.";
    case "pdf_unreadable":
      return "I couldn't read that PDF schedule. Try re-exporting the PDF or upload a clear image instead.";
    default:
      break;
  }

  if (error === "Unable to read attached schedule image") {
    return "I couldn't read that schedule image. Try a clearer photo, better lighting, or upload a PDF version of the schedule.";
  }

  if (error === "Schedule image extraction timed out") {
    return "I wasn't able to extract the schedule from the attached image file because the extraction tool timed out. This can happen with larger or more complex image files. Please re-upload it and I'll try again, or upload a PDF version if you have one.";
  }

  if (error === "Schedule PDF extraction timed out") {
    return "The attached PDF schedule timed out during extraction. Please try again, or send the event details in text if the PDF keeps failing.";
  }

  if (
    error ===
    "Schedule image extraction is misconfigured. Set ZAI_IMAGE_MODEL to a Z.AI vision model such as glm-5v-turbo."
  ) {
    return "Schedule image extraction is misconfigured in this environment. Set ZAI_IMAGE_MODEL to a Z.AI vision model like glm-5v-turbo and restart the server.";
  }

  if (error === "Unable to read attached PDF") {
    return "I couldn't read that PDF schedule. Try re-exporting the PDF or upload a clear image instead.";
  }

  return null;
}

function formatDeterministicToolResponse(
  name: string,
  data: unknown
): string | null {
  switch (name) {
    case "suggest_connections":
      return formatSuggestConnectionsResponse(data);
    case "list_events":
      return formatEventsResponse(data);
    case "list_announcements":
      return formatAnnouncementsResponse(data);
    case "list_chat_groups":
      return formatChatGroupsResponse(data);
    case "list_discussions":
      return formatDiscussionsResponse(data);
    case "list_job_postings":
      return formatJobPostingsResponse(data);
    case "prepare_announcement":
      return formatPrepareAnnouncementResponse(data);
    case "prepare_job_posting":
      return formatPrepareJobPostingResponse(data);
    case "prepare_chat_message":
      return formatPrepareChatMessageResponse(data);
    case "prepare_group_message":
      return formatPrepareGroupMessageResponse(data);
    case "prepare_discussion_reply":
      return formatPrepareDiscussionReplyResponse(data);
    case "prepare_discussion_thread":
      return formatPrepareDiscussionThreadResponse(data);
    case "prepare_event":
      return formatPrepareEventResponse(data);
    case "prepare_events_batch":
      return formatPrepareEventsBatchResponse(data);
    case "extract_schedule_pdf":
      return formatExtractScheduleFileResponse(data);
    case "get_org_stats":
      return formatOrgStatsResponse(data);
    case "get_enterprise_stats":
      return formatEnterpriseStatsResponse(data);
    case "get_enterprise_quota":
      return formatEnterpriseQuotaResponse(data);
    case "get_enterprise_org_capacity":
      return formatEnterpriseOrgCapacityResponse(data);
    case "list_members":
      return formatMembersResponse(data);
    case "list_alumni":
      return formatAlumniResponse(data);
    case "list_enterprise_alumni":
      return formatEnterpriseAlumniResponse(data);
    case "list_donations":
      return formatDonationsResponse(data);
    case "list_managed_orgs":
      return formatManagedOrgsResponse(data);
    case "list_enterprise_audit_events":
      return formatAuditEventsResponse(data);
    case "prepare_enterprise_invite":
      return formatPrepareEnterpriseInviteResponse(data);
    case "revoke_enterprise_invite":
      return formatRevokeEnterpriseInviteResponse(data);
    case "list_parents":
      return formatParentsResponse(data);
    case "list_philanthropy_events":
      return formatPhilanthropyEventsResponse(data);
    case "find_navigation_targets":
      return formatNavigationTargetsResponse(data);
    default:
      return null;
  }
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
const DIRECT_QUERY_START_PATTERN =
  /^(?:show|tell|list|what|who|when|where|why|how|give|summarize|explain|open|find)\b/i;

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

interface CurrentDiscussionThreadContext {
  discussionThreadId: string;
  threadTitle: string | null;
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

type DiscussionThreadLookupQuery = {
  eq(column: string, value: unknown): DiscussionThreadLookupQuery;
  is?(column: string, value: unknown): DiscussionThreadLookupQuery;
  maybeSingle(): Promise<{ data: unknown; error: unknown }>;
};

async function resolveCurrentDiscussionThreadContext(
  supabase: {
    from(table: "discussion_threads"): {
      select(columns: string): {
        eq(column: string, value: unknown): DiscussionThreadLookupQuery;
      };
    };
  },
  input: {
    organizationId: string;
    currentPath?: string;
  }
): Promise<CurrentDiscussionThreadContext | null> {
  const routeThreadId = extractCurrentDiscussionThreadRouteId(input.currentPath);
  if (!routeThreadId) {
    return null;
  }

  const baseQuery = supabase
    .from("discussion_threads")
    .select("id, title")
    .eq("id", routeThreadId)
    .eq("organization_id", input.organizationId) as DiscussionThreadLookupQuery;

  const query =
    typeof baseQuery.is === "function"
      ? baseQuery.is("deleted_at", null)
      : baseQuery;

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error("Failed to load current discussion thread context");
  }

  if (!data || typeof data !== "object") {
    return null;
  }

  return {
    discussionThreadId:
      getNonEmptyString((data as { id?: unknown }).id) ?? routeThreadId,
    threadTitle: getNonEmptyString((data as { title?: unknown }).title),
  };
}

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
  const trackOpsEventServerFn = deps.trackOpsEventServer ?? trackOpsEventServer;
  const getDraftSessionFn = deps.getDraftSession ?? getDraftSession;
  const saveDraftSessionFn = deps.saveDraftSession ?? saveDraftSession;
  const clearDraftSessionFn = deps.clearDraftSession ?? clearDraftSession;

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

    // 2. Auth — validate admin role
    const ctx = await runTimedStage(stageTimings, "auth_org_context", async () =>
      getAiOrgContextFn(orgId, user, rateLimit, { supabase, logContext: baseLogContext })
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
    let currentDiscussionThreadContext: CurrentDiscussionThreadContext | null = null;
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
              pass1Tools = [AI_TOOL_MAP[getToolNameForDraftType(activeDraftSession.draft_type)]];
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
                pass1Tools = [AI_TOOL_MAP[getToolNameForDraftType(inferredDraftSession.draft_type)]];
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

    if (extractCurrentDiscussionThreadRouteId(currentPath)) {
      try {
        currentDiscussionThreadContext = await resolveCurrentDiscussionThreadContext(
          ctx.supabase as any,
          {
            organizationId: ctx.orgId,
            currentPath,
          }
        );
      } catch (error) {
        aiLog("error", "ai-chat", "current discussion thread resolution failed", requestLogContext, {
          error,
          currentPath,
        });
        return NextResponse.json(
          { error: "Failed to resolve the current discussion thread" },
          { status: 500, headers: rateLimit.headers }
        );
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
      const toolAuthorization = {
        kind: "preverified_admin" as const,
        source: "ai_org_context" as const,
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
      const pass1SystemPrompt = activeDraftSession
        ? `${systemPrompt}\n\n${ACTIVE_DRAFT_CONTINUATION_INSTRUCTION}`
        : systemPrompt;

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
            systemPrompt: pass1SystemPrompt,
            messages: contextMessages,
            tools: pass1Tools,
            toolChoice: pass1ToolChoice,
            onUsage: recordUsage,
          },
          async (event) => {
            if (event.type === "chunk") {
              if (pass1Tools) {
                pass1BufferedContent += event.content;
              } else {
                fullContent += event.content;
                enqueue(event);
              }
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
              const currentMemberRouteId = extractCurrentMemberRouteId(currentPath);
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
              } else if (currentDiscussionThreadContext && !discussionThreadId) {
                parsedArgs.discussion_thread_id =
                  currentDiscussionThreadContext.discussionThreadId;
                if (
                  getNonEmptyString(parsedArgs.thread_title) == null &&
                  currentDiscussionThreadContext.threadTitle
                ) {
                  parsedArgs.thread_title = currentDiscussionThreadContext.threadTitle;
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
              result = await executeToolCallFn(
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
                  enqueue({
                    type: "pending_action",
                    actionId: pendingAction.actionId,
                    actionType: pendingAction.actionType,
                    summary: pendingAction.summary,
                    payload: pendingAction.payload,
                    expiresAt: pendingAction.expiresAt,
                  });
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

        if (!toolCallMade && pass1Tools && pass1BufferedContent) {
          fullContent += pass1BufferedContent;
          enqueue({ type: "chunk", content: pass1BufferedContent });
        }

        if (toolCallMade && toolResults.length > 0) {
          const canUseDeterministicMemberRoster =
            successfulToolResults.length === 1 &&
            successfulToolResults[0]?.name === "list_members" &&
            MEMBER_ROSTER_PROMPT_PATTERN.test(messageSafety.promptSafeMessage);
          const deterministicToolContent =
            toolResults.length === 1 &&
            successfulToolResults.length === 1 &&
            toolResults[0].name === successfulToolResults[0].name &&
            (successfulToolResults[0].name !== "list_members" || canUseDeterministicMemberRoster)
              ? formatDeterministicToolResponse(
                  successfulToolResults[0].name,
                  successfulToolResults[0].data
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
            const memberRosterPass2 = successfulToolResults.some(
              (result) => result.name === "list_members"
            );
            const toolErrorInstruction = hasToolErrors
              ? "\n\nSome tool calls failed. Only cite data from successful tool results. Acknowledge any failures honestly — do not fabricate data."
              : "";
            const pass2Instructions = [
              connectionPass2 ? CONNECTION_PASS2_TEMPLATE : null,
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
