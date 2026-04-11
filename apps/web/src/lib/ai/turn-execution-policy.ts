import type { AiSurface } from "@/lib/schemas/ai-assistant";
import { normalizeAiMessage } from "@/lib/ai/message-normalization";
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
export type RetrievalPolicy = "skip" | "allow";
export type ContextPolicy = "shared_static" | "full";
export type CachePolicy = "skip" | "lookup_exact";
export type GroundingPolicy = "none" | "verify_tool_summary";

export interface TurnExecutionPolicy {
  surface: AiSurface;
  intent: AiIntent;
  intentType: AiIntentType;
  profile: TurnExecutionProfile;
  toolPolicy: ToolPolicy;
  retrievalPolicy: RetrievalPolicy;
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
        retrievalPolicy: "allow",
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
        retrievalPolicy: "skip",
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
        retrievalPolicy: "skip",
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
        retrievalPolicy: "skip",
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
        retrievalPolicy: "allow",
        contextPolicy: "full",
        cachePolicy: "skip",
        groundingPolicy: "verify_tool_summary",
        reasons,
      };
  }
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
    reasons
  );
}
