import type { AiSurface } from "@/lib/schemas/ai-assistant";
import { normalizeAiMessage } from "@/lib/ai/message-normalization";
import type { AiAuditRetrievalReason } from "@/lib/ai/chat-telemetry";
import type {
  CacheEligibility,
  CacheSurface,
} from "@/lib/ai/semantic-cache-utils";
import type {
  AiIntent,
  AiIntentType,
  SurfaceRoutingDecision,
} from "@/lib/ai/intent-router";

export type TurnExecutionProfile =
  | "follow_up"
  | "casual"
  | "static_general"
  | "live_lookup"
  | "out_of_scope";

export type ToolPolicy = "none" | "surface_read_tools";
export type ContextPolicy = "shared_static" | "full";
export type CachePolicy = "skip" | "lookup_exact";
export type GroundingPolicy = "none" | "verify_tool_summary";

export interface RetrievalDecision {
  mode: "skip" | "allow";
  reason: AiAuditRetrievalReason;
}

export interface TurnExecutionPolicy {
  surface: AiSurface;
  intent: AiIntent;
  intentType: AiIntentType;
  profile: TurnExecutionProfile;
  toolPolicy: ToolPolicy;
  retrieval: RetrievalDecision;
  contextPolicy: ContextPolicy;
  cachePolicy: CachePolicy;
  groundingPolicy: GroundingPolicy;
  reasons: string[];
}

interface BuildTurnExecutionPolicyInput {
  message: string;
  threadId?: string;
  requestedSurface: AiSurface;
  routing: SurfaceRoutingDecision;
  cacheEligibility: CacheEligibility;
}

const OUT_OF_SCOPE_PATTERNS = [
  /(?<!\w)bylaws?(?!\w)/i,
  /(?<!\w)constitution(?:s)?(?!\w)/i,
  /(?<!\w)governance\s+polic(?:y|ies)(?!\w)/i,
  /(?<!\w)governance\s+document(?:s)?(?!\w)/i,
] as const;

const CONTEXT_DEPENDENT_KEYWORDS = [
  "summarize",
  "summary",
  "explain",
  "discussion",
  "announcement",
  "document",
  "policy",
  "policies",
  "context",
  "why",
  "compare",
] as const;

function includesKeyword(normalized: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "i").test(normalized);
}

function hasContextDependentLanguage(normalized: string): boolean {
  return CONTEXT_DEPENDENT_KEYWORDS.some((keyword) =>
    includesKeyword(normalized, keyword)
  );
}

function isStructuredToolIntent(
  intent: AiIntent,
  intentType: AiIntentType
): boolean {
  if (intentType !== "knowledge_query") {
    return false;
  }

  return (
    intent === "members_query" ||
    intent === "analytics_query" ||
    intent === "events_query"
  );
}

function isOutOfScopeGovernanceRequest(
  message: string,
  requestedSurface: AiSurface,
  effectiveSurface: AiSurface,
  intentType: AiIntentType
): boolean {
  if (requestedSurface !== "general" || effectiveSurface !== "general") {
    return false;
  }

  if (intentType !== "knowledge_query") {
    return false;
  }

  const normalized = normalizeAiMessage(message);
  return OUT_OF_SCOPE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function buildPolicyForProfile(
  profile: TurnExecutionProfile,
  surface: CacheSurface,
  intent: AiIntent,
  intentType: AiIntentType,
  retrieval: RetrievalDecision,
  reasons: string[]
): TurnExecutionPolicy {
  switch (profile) {
    case "follow_up":
      return {
        surface,
        intent,
        intentType,
        profile,
        toolPolicy: "surface_read_tools",
        retrieval,
        contextPolicy: "full",
        cachePolicy: "skip",
        groundingPolicy: "verify_tool_summary",
        reasons,
      };
    case "casual":
      return {
        surface,
        intent,
        intentType,
        profile,
        toolPolicy: "none",
        retrieval,
        contextPolicy: "full",
        cachePolicy: "skip",
        groundingPolicy: "none",
        reasons,
      };
    case "static_general":
      return {
        surface,
        intent,
        intentType,
        profile,
        toolPolicy: "none",
        retrieval,
        contextPolicy: "shared_static",
        cachePolicy: "lookup_exact",
        groundingPolicy: "none",
        reasons,
      };
    case "out_of_scope":
      return {
        surface,
        intent,
        intentType,
        profile,
        toolPolicy: "none",
        retrieval,
        contextPolicy: "full",
        cachePolicy: "skip",
        groundingPolicy: "none",
        reasons,
      };
    case "live_lookup":
    default:
      return {
        surface,
        intent,
        intentType,
        profile,
        toolPolicy: "surface_read_tools",
        retrieval,
        contextPolicy: "full",
        cachePolicy: "skip",
        groundingPolicy: "verify_tool_summary",
        reasons,
      };
  }
}

function buildRetrievalDecision(input: {
  profile: TurnExecutionProfile;
  intent: AiIntent;
  intentType: AiIntentType;
  normalizedMessage: string;
  hasThread: boolean;
}): RetrievalDecision {
  const { profile, intent, intentType, normalizedMessage, hasThread } = input;

  if (profile === "casual") {
    return { mode: "skip", reason: "casual_turn" };
  }

  if (profile === "out_of_scope") {
    return { mode: "skip", reason: "out_of_scope_request" };
  }

  if (profile === "static_general") {
    return { mode: "skip", reason: "general_knowledge_query" };
  }

  if (intentType === "action_request" || intentType === "navigation") {
    return { mode: "skip", reason: "tool_only_structured_query" };
  }

  if (intent === "ambiguous_query") {
    return { mode: "allow", reason: "ambiguous_query" };
  }

  if (hasThread) {
    if (hasContextDependentLanguage(normalizedMessage)) {
      return { mode: "allow", reason: "follow_up_requires_context" };
    }

    if (isStructuredToolIntent(intent, intentType)) {
      return { mode: "skip", reason: "tool_only_structured_query" };
    }

    return { mode: "allow", reason: "follow_up_requires_context" };
  }

  if (hasContextDependentLanguage(normalizedMessage)) {
    return { mode: "allow", reason: "general_knowledge_query" };
  }

  if (isStructuredToolIntent(intent, intentType)) {
    return { mode: "skip", reason: "tool_only_structured_query" };
  }

  return { mode: "allow", reason: "general_knowledge_query" };
}

export function buildTurnExecutionPolicy(
  input: BuildTurnExecutionPolicyInput
): TurnExecutionPolicy {
  const {
    message,
    threadId,
    requestedSurface,
    routing,
    cacheEligibility,
  } = input;

  const surface = routing.effectiveSurface as CacheSurface;
  const normalizedMessage = normalizeAiMessage(message);
  const reasons: string[] = [];

  if (threadId) {
    reasons.push("thread_follow_up");
    if (!cacheEligibility.eligible) {
      reasons.push(cacheEligibility.reason);
    }
    return buildPolicyForProfile(
      "follow_up",
      surface,
      routing.intent,
      routing.intentType,
      buildRetrievalDecision({
        profile: "follow_up",
        intent: routing.intent,
        intentType: routing.intentType,
        normalizedMessage,
        hasThread: true,
      }),
      reasons
    );
  }

  if (routing.intentType === "casual") {
    reasons.push("casual_turn");
    return buildPolicyForProfile(
      "casual",
      surface,
      routing.intent,
      routing.intentType,
      buildRetrievalDecision({
        profile: "casual",
        intent: routing.intent,
        intentType: routing.intentType,
        normalizedMessage,
        hasThread: false,
      }),
      reasons
    );
  }

  if (
    isOutOfScopeGovernanceRequest(
      message,
      requestedSurface,
      routing.effectiveSurface,
      routing.intentType
    )
  ) {
    reasons.push("out_of_scope_governance_request");
    return buildPolicyForProfile(
      "out_of_scope",
      surface,
      routing.intent,
      routing.intentType,
      buildRetrievalDecision({
        profile: "out_of_scope",
        intent: routing.intent,
        intentType: routing.intentType,
        normalizedMessage,
        hasThread: false,
      }),
      reasons
    );
  }

  if (
    routing.intentType === "knowledge_query" &&
    routing.effectiveSurface === "general" &&
    cacheEligibility.eligible
  ) {
    reasons.push("static_general_cacheable");
    return buildPolicyForProfile(
      "static_general",
      surface,
      routing.intent,
      routing.intentType,
      buildRetrievalDecision({
        profile: "static_general",
        intent: routing.intent,
        intentType: routing.intentType,
        normalizedMessage,
        hasThread: false,
      }),
      reasons
    );
  }

  reasons.push("live_lookup");
  if (!cacheEligibility.eligible) {
    reasons.push(cacheEligibility.reason);
  }

  return buildPolicyForProfile(
    "live_lookup",
    surface,
    routing.intent,
    routing.intentType,
    buildRetrievalDecision({
      profile: "live_lookup",
      intent: routing.intent,
      intentType: routing.intentType,
      normalizedMessage,
      hasThread: false,
    }),
    reasons
  );
}
