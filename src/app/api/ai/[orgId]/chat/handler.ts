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
  executeToolCall,
  getToolAuthorizationMode,
} from "@/lib/ai/tools/executor";
import { resolveOwnThread } from "@/lib/ai/thread-resolver";
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

const PASS1_TOOL_NAMES: Record<CacheSurface, ToolName[]> = {
  general: [
    "list_members",
    "list_events",
    "list_announcements",
    "list_discussions",
    "list_job_postings",
    "get_org_stats",
    "suggest_connections",
  ],
  members: ["list_members", "get_org_stats", "suggest_connections"],
  analytics: ["get_org_stats"],
  events: ["list_events", "get_org_stats"],
};

const CONNECTION_PROMPT_PATTERN =
  /(?<!\w)(?:connection|connections|connect|networking|introduc(?:e|tion))(?!\w)/i;
const DIRECT_NAVIGATION_PROMPT_PATTERN =
  /(?:(?<!\w)(?:go\s+to|take\s+me\s+to|navigate\s+to|open|where\s+is|where\s+(?:can|do)\s+i\s+find|find\s+the\s+page|link\s+to)(?!\w)|(?<!\w)show\s+me\b[\s\S]{0,80}\b(?:page|screen|tab|settings?)\b)/i;
const CREATE_JOB_PROMPT_PATTERN =
  /(?:(?<!\w)(?:create|add|post|publish|make|open)(?!\w)[\s\S]{0,120}\b(?:job|job posting|opening|role|position)(?!\w)|(?<!\w)(?:job|job posting|opening|role|position)(?!\w)[\s\S]{0,80}\b(?:create|add|post|publish|make|open)(?!\w))/i;
const CREATE_DISCUSSION_PROMPT_PATTERN =
  /(?:(?<!\w)(?:create|add|post|publish|make|start|open)(?!\w)[\s\S]{0,120}\b(?:discussion|discussion thread|thread|forum thread|chat|group chat|conversation)(?!\w)|(?<!\w)(?:discussion|discussion thread|thread|forum thread|chat|group chat|conversation)(?!\w)[\s\S]{0,80}\b(?:create|add|post|publish|make|start|open)(?!\w))/i;
const CREATE_EVENT_PROMPT_PATTERN =
  /(?:(?<!\w)(?:create|add|schedule|plan|make|organize|set\s+up)(?!\w)[\s\S]{0,120}\b(?:event|calendar event|meeting|fundraiser|social|philanthropy event)(?!\w)|(?<!\w)(?:event|calendar event|meeting|fundraiser|social|philanthropy event)(?!\w)[\s\S]{0,80}\b(?:create|add|schedule|plan|make|organize|set\s+up)(?!\w))/i;

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

interface MemberDisplayRow {
  name?: unknown;
  role?: unknown;
  email?: unknown;
  created_at?: unknown;
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

function formatMemberRole(value: unknown): string | null {
  const role = getNonEmptyString(value);
  if (!role) {
    return null;
  }

  switch (role) {
    case "active_member":
      return "Active Member";
    case "admin":
      return "Admin";
    case "alumni":
      return "Alumni";
    case "parent":
      return "Parent";
    default:
      return role.replace(/_/g, " ");
  }
}

function hasTrustworthyMemberName(value: unknown): value is string {
  const name = getNonEmptyString(value);
  return Boolean(name && name !== "Member" && !name.includes("@"));
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

      const member = row as MemberDisplayRow;
      const name = hasTrustworthyMemberName(member.name)
        ? member.name.trim()
        : getNonEmptyString(member.email);

      if (!name) {
        return null;
      }

      return {
        name,
        role: formatMemberRole(member.role),
        email: getNonEmptyString(member.email),
        createdAt: formatIsoDate(member.created_at),
      };
    })
    .filter(
      (
        row
      ): row is {
        name: string;
        role: string | null;
        email: string | null;
        createdAt: string | null;
      } => Boolean(row)
    )
    .slice(0, 5);

  if (rows.length === 0) {
    return null;
  }

  const lines = ["Recent active members"];
  for (const row of rows) {
    lines.push(`- ${row.name}${row.role ? ` (${row.role})` : ""}`);
    if (row.createdAt) {
      lines.push(`  Added: ${row.createdAt}`);
    }
    if (row.email) {
      lines.push(`  Email: ${row.email}`);
    }
  }

  return lines.join("\n");
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
  intentType: TurnExecutionPolicy["intentType"]
) {
  if (toolPolicy !== "surface_read_tools") {
    return undefined;
  }

  if (CREATE_JOB_PROMPT_PATTERN.test(message) || looksLikeStructuredJobDraft(message)) {
    return [AI_TOOL_MAP.prepare_job_posting];
  }

  if (CREATE_DISCUSSION_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.prepare_discussion_thread];
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

  if (effectiveSurface === "members" && CONNECTION_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.suggest_connections];
  }

  if (intentType === "knowledge_query") {
    if (effectiveSurface === "analytics") {
      return [AI_TOOL_MAP.get_org_stats];
    }

    if (effectiveSurface === "members") {
      if (MEMBER_STATS_PROMPT_PATTERN.test(message)) {
        return [AI_TOOL_MAP.get_org_stats];
      }

      if (SIMPLE_MEMBER_LIST_PROMPT_PATTERN.test(message)) {
        return [AI_TOOL_MAP.list_members];
      }
    }

    if (effectiveSurface === "events") {
      if (EVENT_STATS_PROMPT_PATTERN.test(message)) {
        return [AI_TOOL_MAP.get_org_stats];
      }

      if (SIMPLE_EVENT_LIST_PROMPT_PATTERN.test(message)) {
        return [AI_TOOL_MAP.list_events];
      }
    }
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
    forcedToolName !== "prepare_job_posting" &&
    forcedToolName !== "prepare_discussion_thread" &&
    forcedToolName !== "prepare_event"
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
    toolName === "list_events" ||
    toolName === "list_discussions" ||
    toolName === "list_job_postings" ||
    toolName === "suggest_connections"
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

function formatDeterministicToolResponse(
  name: string,
  data: unknown
): string | null {
  switch (name) {
    case "list_members":
      return formatMembersResponse(data);
    case "suggest_connections":
      return formatSuggestConnectionsResponse(data);
    case "list_events":
      return formatEventsResponse(data);
    case "list_announcements":
      return formatAnnouncementsResponse(data);
    case "list_discussions":
      return formatDiscussionsResponse(data);
    case "list_job_postings":
      return formatJobPostingsResponse(data);
    case "prepare_job_posting":
      return formatPrepareJobPostingResponse(data);
    case "prepare_discussion_thread":
      return formatPrepareDiscussionThreadResponse(data);
    case "prepare_event":
      return formatPrepareEventResponse(data);
    case "prepare_events_batch":
      return formatPrepareEventsBatchResponse(data);
    case "get_org_stats":
      return formatOrgStatsResponse(data);
    case "find_navigation_targets":
      return formatNavigationTargetsResponse(data);
    default:
      return null;
  }
}



const MESSAGE_SAFETY_FALLBACK =
  "I can’t help with instructions about hidden prompts, internal tools, or overriding safety rules. Ask a question about your organization’s data instead.";

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
  "- Do not say you lack the ability to create jobs, events, or discussion threads when the matching prepare tool is attached.",
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
    case "create_job_posting":
      return "prepare_job_posting";
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

function buildPromptHistoryMessages(rows: unknown): DraftHistoryMessage[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .filter(
      (row): row is { role: "user" | "assistant"; content: string } =>
        (row?.role === "user" || row?.role === "assistant") &&
        typeof row?.content === "string" &&
        row.content.trim().length > 0
    )
    .map((row) => ({
      role: row.role,
      content:
        row.role === "user"
          ? sanitizeHistoryMessageForPrompt(row.content).promptSafeMessage
          : row.content,
    }))
    .filter((row) => row.content.length > 0);
}

function ensureCurrentPromptInHistory(
  messages: DraftHistoryMessage[],
  promptSafeMessage: string
): DraftHistoryMessage[] {
  const lastMessage = messages[messages.length - 1];
  if (
    lastMessage?.role === "user" &&
    lastMessage.content === promptSafeMessage
  ) {
    return messages;
  }

  return [
    ...messages,
    {
      role: "user",
      content: promptSafeMessage,
    },
  ];
}

const DISCUSSION_DRAFT_ASSISTANT_PATTERN =
  /(?:happy to help you create a discussion thread|i can draft this discussion|i drafted the discussion thread)/i;
const JOB_DRAFT_ASSISTANT_PATTERN =
  /(?:happy to help you create a job posting|i can draft this job|i drafted the job posting)/i;
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

function normalizeEventType(
  value: string | undefined
): "general" | "philanthropy" | "game" | "meeting" | "social" | "fundraiser" | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "general" ||
    normalized === "philanthropy" ||
    normalized === "game" ||
    normalized === "meeting" ||
    normalized === "social" ||
    normalized === "fundraiser"
  ) {
    return normalized;
  }

  return undefined;
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

function inferDraftTypeFromMessage(message: DraftHistoryMessage): DraftSessionType | null {
  if (message.role === "user") {
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

  if (JOB_DRAFT_ASSISTANT_PATTERN.test(message.content)) {
    return "create_job_posting";
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

function shouldContinueDraftSession(
  message: string,
  draftSession: DraftSessionRecord,
  routing: ReturnType<typeof resolveSurfaceRouting>
): boolean {
  const isJobPrompt = CREATE_JOB_PROMPT_PATTERN.test(message);
  const isDiscussionPrompt = CREATE_DISCUSSION_PROMPT_PATTERN.test(message);
  const isEventPrompt = CREATE_EVENT_PROMPT_PATTERN.test(message);

  if (draftSession.draft_type === "create_job_posting" && isJobPrompt) {
    return true;
  }

  if (draftSession.draft_type === "create_discussion_thread" && isDiscussionPrompt) {
    return true;
  }

  if (draftSession.draft_type === "create_event" && isEventPrompt) {
    return true;
  }

  if (
    (draftSession.draft_type === "create_job_posting" && (isDiscussionPrompt || isEventPrompt)) ||
    (draftSession.draft_type === "create_discussion_thread" && (isJobPrompt || isEventPrompt)) ||
    (draftSession.draft_type === "create_event" && (isJobPrompt || isDiscussionPrompt))
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
    let messageSafety!: ReturnType<typeof assessAiMessageSafety>;
    let routing!: ReturnType<typeof resolveSurfaceRouting>;
    let effectiveSurface!: CacheSurface;
    let resolvedIntent!: ReturnType<typeof resolveSurfaceRouting>["intent"];
    let resolvedIntentType!: ReturnType<typeof resolveSurfaceRouting>["intentType"];
    let executionPolicy!: TurnExecutionPolicy;
    let usesSharedStaticContext = false;
    let pass1Tools: ReturnType<typeof getPass1Tools>;
    let activeDraftSession: DraftSessionRecord | null = null;
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
          executionPolicy.intentType
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
    } else {
      skipStage(stageTimings, "thread_resolution");
    }

    usesToolFirstContext =
      !usesSharedStaticContext &&
      executionPolicy.retrieval.reason === "tool_only_structured_query" &&
      isToolFirstEligible(pass1Tools);

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
          aiLog("warn", "ai-chat", "idempotency replay not ready", {
            ...requestLogContext,
            threadId: existingMsg.thread_id,
          }, {
            userMessageId: existingMsg.id,
          });
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

      let historyMessages: DraftHistoryMessage[] = ensureCurrentPromptInHistory(
        [],
        messageSafety.promptSafeMessage
      );

      if (existingThreadId) {
        const historyLoadStartedAt = Date.now();

        try {
          const { data: history, error: historyError } = await ctx.supabase
            .from("ai_messages")
            .select("role, content")
            .eq("thread_id", threadId)
            .eq("status", "complete")
            .order("created_at", { ascending: true })
            .limit(20);

          setStageStatus(
            stageTimings,
            "history_load",
            historyError ? "failed" : "completed",
            Date.now() - historyLoadStartedAt
          );

          if (historyError) {
            aiLog("warn", "ai-chat", "history fetch failed; continuing with current turn only", {
              ...requestLogContext,
              threadId: threadId!,
            }, { error: historyError });
          } else {
            historyMessages = ensureCurrentPromptInHistory(
              buildPromptHistoryMessages(history),
              messageSafety.promptSafeMessage
            );
          }
        } catch (error) {
          setStageStatus(
            stageTimings,
            "history_load",
            "failed",
            Date.now() - historyLoadStartedAt
          );
          aiLog("warn", "ai-chat", "history fetch failed; continuing with current turn only", {
            ...requestLogContext,
            threadId: threadId!,
          }, { error });
        }
      } else {
        setStageStatus(stageTimings, "history_load", "completed", 0);
      }

      if (!activeDraftSession && canUseDraftSessions && existingThreadId) {
        const inferredDraftSession = inferDraftSessionFromHistory({
          organizationId: ctx.orgId,
          userId: ctx.userId,
          threadId: threadId!,
          messages: historyMessages,
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

      usesToolFirstContext =
        !usesSharedStaticContext &&
        executionPolicy.retrieval.reason === "tool_only_structured_query" &&
        isToolFirstEligible(pass1Tools);

      const contextBuildStartedAt = Date.now();
      const contextResult = await buildPromptContextFn({
        orgId: ctx.orgId,
        userId: ctx.userId,
        role: ctx.role,
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
      });

      const { systemPrompt, orgContextMessage, metadata } = contextResult;
      contextMetadata = metadata;

      const draftSessionContextMessage = activeDraftSession
        ? buildDraftSessionContextMessage(activeDraftSession)
        : null;
      const pass1SystemPrompt = activeDraftSession
        ? `${systemPrompt}\n\n${ACTIVE_DRAFT_CONTINUATION_INSTRUCTION}`
        : systemPrompt;

      const contextMessages = orgContextMessage
        ? [
            { role: "user" as const, content: orgContextMessage },
            ...(draftSessionContextMessage
              ? [{ role: "user" as const, content: draftSessionContextMessage }]
              : []),
            ...historyMessages,
          ]
        : draftSessionContextMessage
          ? [{ role: "user" as const, content: draftSessionContextMessage }, ...historyMessages]
          : historyMessages;

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

            auditToolCalls.push({ name: toolEvent.name, args: parsedArgs });

            if (toolPassBreakerOpen) {
              return "continue";
            }

            enqueue({ type: "tool_status", toolName: toolEvent.name, status: "calling" });

            const toolStartedAt = Date.now();
            const result = await executeToolCallFn(
              {
                orgId: ctx.orgId,
                userId: ctx.userId,
                serviceSupabase: ctx.serviceSupabase,
                authorization: toolAuthorization,
                threadId,
                requestId,
              },
              { name: toolEvent.name, args: parsedArgs }
            );

            switch (result.kind) {
              case "ok":
                if (
                  canUseDraftSessions &&
                  (toolEvent.name === "prepare_job_posting" ||
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
                          toolEvent.name === "prepare_job_posting"
                            ? "create_job_posting"
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
                  data: { error: result.error },
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
          const deterministicToolName =
            toolResults.length === 1 && successfulToolResults.length === 1
              ? successfulToolResults[0].name
              : null;
          const allowDeterministicToolResponse =
            deterministicToolName !== "list_members" ||
            (pass1Tools?.length === 1 && pass1Tools[0]?.function.name === "list_members");
          const deterministicToolContent =
            allowDeterministicToolResponse &&
            toolResults.length === 1 &&
            successfulToolResults.length === 1 &&
            toolResults[0].name === successfulToolResults[0].name
              ? formatDeterministicToolResponse(
                  successfulToolResults[0].name,
                  successfulToolResults[0].data
                )
              : null;

          if (deterministicToolContent) {
            skipStage(stageTimings, "pass2");
            pass2BufferedContent = deterministicToolContent;
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
          error: auditErrorMessage,
          cacheStatus,
          cacheEntryId,
          cacheBypassReason,
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
