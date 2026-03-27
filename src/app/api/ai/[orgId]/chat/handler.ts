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
  createStageAbortSignal,
  isStageTimeoutError,
  PASS1_MODEL_TIMEOUT_MS,
  PASS2_MODEL_TIMEOUT_MS,
} from "@/lib/ai/timeout";
import {
  type AiAuditStageName,
  type AiAuditStageStatus,
  type AiAuditStageSummary,
  type AiAuditStageTimings,
  type AiAuditToolCallSummary,
} from "@/lib/ai/chat-telemetry";

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

function getNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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

  if (intentType === "navigation" && DIRECT_NAVIGATION_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.find_navigation_targets];
  }

  if (effectiveSurface === "members" && CONNECTION_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.suggest_connections];
  }

  return PASS1_TOOL_NAMES[effectiveSurface].map((toolName) => AI_TOOL_MAP[toolName]);
}

function createDefaultStageSummary(): AiAuditStageSummary {
  return { status: "not_run", duration_ms: 0 };
}

function createStageTimings(): AiAuditStageTimings {
  return {
    schema_version: 1,
    request: {
      outcome: "pending",
      total_duration_ms: 0,
    },
    retrieval: {
      decision: "not_available",
      reason: "general_knowledge_query",
    },
    stages: {
      auth_org_context: createDefaultStageSummary(),
      request_validation_policy: createDefaultStageSummary(),
      thread_resolution: createDefaultStageSummary(),
      abandoned_stream_cleanup: createDefaultStageSummary(),
      idempotency_lookup: createDefaultStageSummary(),
      init_chat_rpc: createDefaultStageSummary(),
      cache_lookup: createDefaultStageSummary(),
      rag_retrieval: createDefaultStageSummary(),
      assistant_placeholder_write: createDefaultStageSummary(),
      context_build: createDefaultStageSummary(),
      history_load: createDefaultStageSummary(),
      pass1_model: createDefaultStageSummary(),
      tools: {
        ...createDefaultStageSummary(),
        calls: [],
      },
      pass2: createDefaultStageSummary(),
      grounding: createDefaultStageSummary(),
      assistant_finalize_write: createDefaultStageSummary(),
      cache_write: createDefaultStageSummary(),
    },
  };
}

function setStageStatus(
  stageTimings: AiAuditStageTimings,
  stage: AiAuditStageName,
  status: AiAuditStageStatus,
  durationMs: number
) {
  if (stage === "tools") {
    stageTimings.stages.tools.status = status;
    stageTimings.stages.tools.duration_ms = durationMs;
    return;
  }

  stageTimings.stages[stage] = {
    status,
    duration_ms: durationMs,
  };
}

async function runTimedStage<T>(
  stageTimings: AiAuditStageTimings,
  stage: AiAuditStageName,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    setStageStatus(stageTimings, stage, "completed", Date.now() - startedAt);
    return result;
  } catch (error) {
    setStageStatus(stageTimings, stage, "failed", Date.now() - startedAt);
    throw error;
  }
}

function skipStage(stageTimings: AiAuditStageTimings, stage: AiAuditStageName) {
  setStageStatus(stageTimings, stage, "skipped", 0);
}

const TOOL_STAGE_STATUS_PRECEDENCE: Record<AiAuditStageStatus, number> = {
  not_run: 0,
  skipped: 1,
  completed: 2,
  failed: 3,
  timed_out: 4,
  aborted: 5,
};

function addToolCallTiming(
  stageTimings: AiAuditStageTimings,
  call: AiAuditToolCallSummary
) {
  stageTimings.stages.tools.calls.push(call);
  stageTimings.stages.tools.duration_ms += call.duration_ms;

  const currentStatus = stageTimings.stages.tools.status;
  if (
    TOOL_STAGE_STATUS_PRECEDENCE[call.status] >=
    TOOL_STAGE_STATUS_PRECEDENCE[currentStatus]
  ) {
    stageTimings.stages.tools.status = call.status;
  }
}

function finalizeStageTimings(
  stageTimings: AiAuditStageTimings,
  outcome: string,
  totalDurationMs: number
): AiAuditStageTimings {
  return {
    ...stageTimings,
    request: {
      outcome,
      total_duration_ms: totalDurationMs,
    },
  };
}

const MESSAGE_SAFETY_FALLBACK =
  "I can’t help with instructions about hidden prompts, internal tools, or overriding safety rules. Ask a question about your organization’s data instead.";

const TOOL_GROUNDING_FALLBACK =
  "I couldn’t verify that answer against your organization’s data, so I’m not returning it. Please try rephrasing or ask a narrower question.";

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

  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string }> }
  ) {
    const { orgId } = await params;
    const startTime = Date.now();
    const stageTimings = createStageTimings();
    const cacheDisabled = process.env.DISABLE_AI_CACHE === "true";
    // 1. Rate limit — get user first to allow per-user limiting
    const supabase = await createClientFn();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: "ai-chat",
      limitPerIp: 30,
      limitPerUser: 20,
    });
    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    // 2. Auth — validate admin role
    const ctx = await runTimedStage(stageTimings, "auth_org_context", async () =>
      getAiOrgContextFn(orgId, user, rateLimit, { supabase })
    );
    if (!ctx.ok) return ctx.response;

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
            ctx.serviceSupabase
          )
      );
      if (!resolution.ok) {
        return NextResponse.json(
          { error: resolution.message },
          { status: resolution.status, headers: rateLimit.headers }
        );
      }
    } else {
      skipStage(stageTimings, "thread_resolution");
    }

    // 5. Abandoned stream cleanup (5-min threshold)
    if (existingThreadId) {
      await runTimedStage(stageTimings, "abandoned_stream_cleanup", async () => {
        const { error: cleanupError } = await ctx.supabase
          .from("ai_messages")
          .update({ status: "error", content: INTERRUPTED_ASSISTANT_MESSAGE })
          .eq("thread_id", existingThreadId)
          .eq("role", "assistant")
          .in("status", ["pending", "streaming"])
          .lt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
        if (cleanupError) {
          console.error("[ai-chat] abandoned stream cleanup failed:", cleanupError);
        }
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
          .select("id, status, thread_id")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle()
    );

    if (idempError) {
      console.error("[ai-chat] idempotency check failed:", idempError);
      return NextResponse.json({ error: "Failed to check message idempotency" }, { status: 500 });
    }

    if (existingMsg) {
      if (existingMsg.status === "complete") {
        stageTimings.retrieval = {
          decision: "skip",
          reason: "cache_hit",
        };
        skipStage(stageTimings, "cache_lookup");
        skipStage(stageTimings, "rag_retrieval");
        skipStage(stageTimings, "assistant_placeholder_write");
        skipStage(stageTimings, "context_build");
        skipStage(stageTimings, "history_load");
        skipStage(stageTimings, "pass1_model");
        skipStage(stageTimings, "tools");
        skipStage(stageTimings, "pass2");
        skipStage(stageTimings, "grounding");
        skipStage(stageTimings, "assistant_finalize_write");
        skipStage(stageTimings, "cache_write");

        const { data: assistantReplay } = await ctx.supabase
          .from("ai_messages")
          .select("content")
          .eq("thread_id", existingMsg.thread_id)
          .eq("role", "assistant")
          .eq("status", "complete")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        return buildSseResponse(
          createSSEStream(async (enqueue) => {
            if (assistantReplay?.content) {
              enqueue({ type: "chunk", content: assistantReplay.content });
            }
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
      console.error("[ai-chat] init_ai_chat RPC failed:", initError);
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
      skipStage(stageTimings, "cache_lookup");
      skipStage(stageTimings, "rag_retrieval");
      skipStage(stageTimings, "assistant_placeholder_write");
      skipStage(stageTimings, "context_build");
      skipStage(stageTimings, "history_load");
      skipStage(stageTimings, "pass1_model");
      skipStage(stageTimings, "tools");
      skipStage(stageTimings, "pass2");
      skipStage(stageTimings, "grounding");
      skipStage(stageTimings, "assistant_finalize_write");
      skipStage(stageTimings, "cache_write");

      const { data: safetyAssistantMsg, error: safetyAssistantError } =
        await insertAssistantMessage({
          content: MESSAGE_SAFETY_FALLBACK,
          status: "complete",
        });

      if (safetyAssistantError || !safetyAssistantMsg) {
        console.error("[ai-chat] safety assistant message failed:", safetyAssistantError);
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

    if (!cacheDisabled && executionPolicy.cachePolicy === "lookup_exact") {
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
        })
      );

      if (cacheResult.ok) {
        cacheStatus = "hit_exact";
        cacheEntryId = cacheResult.hit.id;
        stageTimings.retrieval = {
          decision: "skip",
          reason: "cache_hit",
        };
        skipStage(stageTimings, "rag_retrieval");
        skipStage(stageTimings, "assistant_placeholder_write");
        skipStage(stageTimings, "context_build");
        skipStage(stageTimings, "history_load");
        skipStage(stageTimings, "pass1_model");
        skipStage(stageTimings, "tools");
        skipStage(stageTimings, "pass2");
        skipStage(stageTimings, "grounding");
        skipStage(stageTimings, "assistant_finalize_write");
        skipStage(stageTimings, "cache_write");

        const { data: cachedAssistantMsg, error: cachedAssistantError } =
          await insertAssistantMessage({
            content: cacheResult.hit.responseContent,
            status: "complete",
          });

        if (cachedAssistantError || !cachedAssistantMsg) {
          console.error("[ai-chat] cache hit assistant message failed:", cachedAssistantError);
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
    } else {
      skipStage(stageTimings, "cache_lookup");
    }

    let ragChunks: RagChunkInput[] = [];
    let ragChunkCount = 0;
    let ragTopSimilarity: number | undefined;
    let ragError: string | undefined;

    const hasEmbeddingKey = !!process.env.EMBEDDING_API_KEY;
    if (hasEmbeddingKey && !skipRagRetrieval) {
      const ragStartedAt = Date.now();
      try {
        const retrieved = await retrieveRelevantChunksFn({
          query: messageSafety.promptSafeMessage,
          orgId: ctx.orgId,
          serviceSupabase: ctx.serviceSupabase,
        });
        setStageStatus(stageTimings, "rag_retrieval", "completed", Date.now() - ragStartedAt);
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
        setStageStatus(stageTimings, "rag_retrieval", "failed", Date.now() - ragStartedAt);
        console.error("[ai-chat] RAG retrieval failed (continuing without):", err);
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
      console.error("[ai-chat] assistant placeholder failed:", assistantError);
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

      await ctx.supabase
        .from("ai_messages")
        .update({
          intent: resolvedIntent,
          intent_type: resolvedIntentType,
          context_surface: effectiveSurface,
          status: "streaming",
        })
        .eq("id", assistantMessageId);

        const contextBuildStartedAt = Date.now();
        const historyLoadStartedAt = Date.now();
        const [contextResult, { data: history, error: historyError }] =
          await Promise.all([
            buildPromptContextFn({
              orgId: ctx.orgId,
              userId: ctx.userId,
              role: ctx.role,
              serviceSupabase: ctx.serviceSupabase,
              contextMode: usesSharedStaticContext ? "shared_static" : "full",
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
            }),
            ctx.supabase
              .from("ai_messages")
              .select("role, content")
              .eq("thread_id", threadId)
              .eq("status", "complete")
              .order("created_at", { ascending: true })
              .limit(20)
              .then((result: { error: unknown }) => {
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
              }),
          ]);

      const { systemPrompt, orgContextMessage, metadata } = contextResult;
      contextMetadata = metadata;

      if (historyError) {
        console.error("[ai-chat] history fetch failed:", historyError);
        enqueue({ type: "error", message: "Failed to load conversation history", retryable: true });
        return;
      }

      const historyMessages = (history ?? [])
        .filter((m: any) => m.content)
        .map((m: any) => ({
          role: m.role as "user" | "assistant",
          content:
            m.role === "user"
              ? sanitizeHistoryMessageForPrompt(m.content as string).promptSafeMessage
              : (m.content as string),
        }))
        .filter((m: { content: string }) => Boolean(m.content));

      const contextMessages = orgContextMessage
        ? [{ role: "user" as const, content: orgContextMessage }, ...historyMessages]
        : historyMessages;

      const toolResults: ToolResultMessage[] = [];
        const pass1Outcome = await runModelStage(
          "pass1_model",
          "pass1_model",
          PASS1_MODEL_TIMEOUT_MS,
          {
            client,
            systemPrompt,
            messages: contextMessages,
            tools: pass1Tools,
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
              },
              { name: toolEvent.name, args: parsedArgs }
            );

            switch (result.kind) {
              case "ok":
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
          const deterministicToolContent =
            toolResults.length === 1 &&
            successfulToolResults.length === 1 &&
            toolResults[0].name === successfulToolResults[0].name
              ? successfulToolResults[0].name === "suggest_connections"
                ? formatSuggestConnectionsResponse(successfulToolResults[0].data)
                : successfulToolResults[0].name === "list_announcements"
                  ? formatAnnouncementsResponse(successfulToolResults[0].data)
                  : successfulToolResults[0].name === "find_navigation_targets"
                    ? formatNavigationTargetsResponse(successfulToolResults[0].data)
                    : null
              : null;

          if (deterministicToolContent) {
            skipStage(stageTimings, "pass2");
            pass2BufferedContent = deterministicToolContent;
          } else {
            const pass2SystemPrompt = successfulToolResults.some(
              (result) => result.name === "suggest_connections"
            )
              ? `${systemPrompt}\n\n${CONNECTION_PASS2_TEMPLATE}`
              : systemPrompt;

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
            const groundingStartedAt = Date.now();
            const groundingResult = verifyToolBackedResponseFn({
              content: pass2BufferedContent,
              toolResults: successfulToolResults,
            });

            if (!groundingResult.grounded) {
              setStageStatus(stageTimings, "grounding", "failed", Date.now() - groundingStartedAt);
              auditErrorMessage = "tool_grounding_failed";
              console.warn("[ai-grounding] verification failed:", {
                orgId: ctx.orgId,
                threadId,
                messageId: assistantMessageId,
                tools: successfulToolResults.map((result) => result.name),
                failures: groundingResult.failures,
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
              pass2BufferedContent = TOOL_GROUNDING_FALLBACK;
            } else {
              setStageStatus(
                stageTimings,
                "grounding",
                "completed",
                Date.now() - groundingStartedAt
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
        console.error("[ai-chat] stream error:", err);
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
          console.error("[ai-chat] assistant finalize failed:", finalizeError);
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

          const cacheWriteStartedAt = Date.now();
          const cacheWriteResult = await writeCacheEntry({
            cacheKey,
            responseContent: fullContent,
            orgId: ctx.orgId,
            surface: effectiveSurface,
            sourceMessageId: assistantMessageId,
            supabase: ctx.serviceSupabase,
          });
          setStageStatus(stageTimings, "cache_write", "completed", Date.now() - cacheWriteStartedAt);

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
        });
      }
    }, request.signal);

    return buildSseResponse(stream, { ...SSE_HEADERS, ...rateLimit.headers }, threadId!);
  };
}
