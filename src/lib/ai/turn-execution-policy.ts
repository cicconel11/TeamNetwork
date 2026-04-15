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
  | "out_of_scope"
  | "out_of_scope_unrelated";

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

const HARM_PATTERNS = [
  // NSFW / sexual
  /\b(?:nsfw|porn|porno|pornography|erotic|erotica|xxx)\b/i,
  /\b(?:sexual(?:ly)? explicit|sex scene|sex story|make out|dirty talk|hook ?up advice)\b/i,
  /\b(?:naked|nude|nudes)\b/i,
  // Self-harm / suicide
  /\b(?:suicide|self[\s-]?harm|kill (?:myself|yourself)|end my life|how (?:do i|to) (?:kill|hurt) (?:myself|someone|people))\b/i,
  // Weapons / violence / illicit
  /\b(?:make (?:a )?bomb|build (?:a )?(?:bomb|weapon|gun|explosive)|3d ?print (?:a )?gun|pipe bomb|molotov)\b/i,
  /\b(?:synthesize (?:meth|cocaine|fentanyl|drugs)|cook meth|how to make (?:meth|cocaine|drugs|heroin|fentanyl)|buy (?:drugs|cocaine|meth|heroin))\b/i,
  /\b(?:how (?:do i|to) (?:hack|ddos|phish|breach)|crack (?:a )?password|bypass (?:login|auth))\b/i,
  // Hate / harassment
  /\b(?:hate speech|racial slur|say something (?:racist|sexist|homophobic|transphobic|offensive)|insult (?:my|a) (?:coworker|boss|teammate))\b/i,
  // Unauthorized professional advice
  /\b(?:medical advice|legal advice|diagnose my|prescribe (?:me|a)|invest in (?:stocks|crypto)|stock tip|financial advice (?!for))\b/i,
  // Gambling
  /\b(?:gambling tips|betting tips|parlay pick)\b/i,
] as const;

const UNRELATED_PATTERNS = [
  /\b(?:python|java(?:script)?|typescript|c\+\+|rust|golang|leetcode|hackerrank|algorithm|debug my code|my code|stack trace)\b/i,
  /\b(?:compiler|interpreter|linker|kernel|regex pattern|binary tree|linked list|hash ?map|sql query(?! for (?:members|events|donations|announcements)))\b/i,
  /\b(?:make (?:me )?(?:a|an) (?:c|c\+\+|go|rust|python|java|js|javascript|typescript|web|mobile|ios|android) (?:compiler|app|program|script|bot|game|website))\b/i,
  /\bhelp me (?:make|build|write|create|code) (?:a|an) (?:c|c\+\+|go|rust|python|java|web|mobile|chrome|ios|android|full-?stack)\b/i,
  /\b(?:homework|essay|thesis|dissertation|assignment|my teacher|my professor|for (?:my )?(?:class|school|college|university))\b/i,
  /\b(?:flights?|itinerary|hotel|vacation|travel plan|restaurants? in|things to do in)\b/i,
  /\btrip to (?!the (?:office|gym|store|bathroom))[a-z]/i,
  /\bplan (?:a|an|me|my|our) (?:\d+[\s-]?(?:day|night|week|hour) )?(?:trip|vacation|getaway|holiday|tour|journey)\b/i,
  /\b(?:visit|travelling|traveling) (?:to )?(?:japan|tokyo|paris|france|london|italy|rome|europe|asia|africa|spain|germany|china|india|mexico|canada|australia|brazil|thailand|greece|egypt|turkey|peru|russia)\b/i,
  /\b(?:recipe|how do i cook|how to cook|diet plan|workout plan|dating advice|relationship advice|therapy|meditation guide)\b/i,
  /\b(?:capital of|population of|weather in|translate to|tell me about (?:the )?(?:world|history|news)|what happened in (?:\d{4}|the past))\b/i,
  /\bwho won (?:the )?(?:world ?cup|super ?bowl|olympics|oscars|emmy|grammy|nobel|election|presidency|world series|stanley cup|nba finals|masters|wimbledon|tour de france)\b/i,
  /\b(?:write (?:me )?(?:a )?(?:poem|song|story|rap|joke|limerick|haiku|sonnet|lyrics|screenplay|novel))\b/i,
  /\b(?:tell me a joke|sing (?:me )?(?:a )?song|rap about)\b/i,
  /\b(?:act as|pretend to be|role[\s-]?play as|you are now (?:a|an)|behave like (?:a|an))\b/i,
  /\b(?:solve|calculate|compute) (?:this|the|for) (?:equation|math|integral|derivative|problem)\b/i,
  /\bwhat(?:'s| is) \d+\s*[+\-*/×÷]\s*\d+/i,
] as const;

const ORG_SCOPE_KEYWORDS = [
  "member", "members", "alumni", "alum", "parent", "parents", "admin", "admins",
  "event", "events", "calendar", "meeting", "meetings", "practice", "practices", "game", "games",
  "announcement", "announcements", "announce",
  "discussion", "discussions", "forum", "thread", "threads", "reply", "replies", "post", "posts",
  "job", "jobs", "posting", "postings", "hiring", "career", "careers", "position", "positions",
  "donation", "donations", "donor", "donors", "fundrais", "philanthropy", "pledge", "pledges",
  "chat", "message", "messages", "dm", "group",
  "org", "organization", "organisation", "team", "teams", "chapter", "chapters",
  "enterprise", "managed org", "quota", "billing",
  "roster", "attendance", "rsvp",
  "stat", "stats", "analytic", "analytics", "metric", "metrics", "count", "counts", "total", "totals",
  "coach", "coaches", "captain", "captains", "player", "players", "staff", "volunteer", "volunteers",
  "schedule", "season", "tournament", "league", "ics",
  "invite", "invites", "invitation", "onboarding", "signup", "sign up",
  "page", "navigate", "navigation", "where do i", "where is", "how do i get to", "go to",
  "draft", "prepare", "create", "add", "update", "edit", "remove", "delete",
  "recent", "upcoming", "latest", "today", "this week", "this month",
] as const;

function hasOrgScopeKeyword(normalized: string): boolean {
  return ORG_SCOPE_KEYWORDS.some((keyword) => includesKeyword(normalized, keyword));
}

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

export type UnrelatedReason =
  | "harm_pattern"
  | "unrelated_pattern"
  | "no_org_keyword_present";

export function classifyUnrelatedRequest(
  message: string,
  requestedSurface: AiSurface,
  intent: AiIntent,
  intentType: AiIntentType,
  hasThread: boolean
): UnrelatedReason | null {
  if (requestedSurface !== "general") {
    return null;
  }

  const normalized = normalizeAiMessage(message);

  if (HARM_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "harm_pattern";
  }

  if (UNRELATED_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "unrelated_pattern";
  }

  // Tier 2 allowlist gate: only applies when the intent router failed to
  // classify the message into a known org domain. If routing.intent is a
  // domain query (members/analytics/events), it's on-topic by definition.
  const intentIsOrgScoped =
    intent === "members_query" ||
    intent === "analytics_query" ||
    intent === "events_query";

  if (
    !hasThread &&
    intentType === "knowledge_query" &&
    !intentIsOrgScoped &&
    !hasOrgScopeKeyword(normalized) &&
    !hasContextDependentLanguage(normalized)
  ) {
    return "no_org_keyword_present";
  }

  return null;
}

export function isUnrelatedRequest(
  message: string,
  requestedSurface: AiSurface
): boolean {
  if (requestedSurface !== "general") {
    return false;
  }

  const normalized = normalizeAiMessage(message);
  return (
    HARM_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    UNRELATED_PATTERNS.some((pattern) => pattern.test(normalized))
  );
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
    case "out_of_scope_unrelated":
      return {
        surface,
        intent,
        intentType,
        profile,
        toolPolicy: "none",
        retrieval,
        contextPolicy: "shared_static",
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

  if (profile === "out_of_scope_unrelated") {
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

  const unrelatedReason = classifyUnrelatedRequest(
    message,
    requestedSurface,
    routing.intent,
    routing.intentType,
    Boolean(threadId)
  );
  if (unrelatedReason) {
    reasons.push(`out_of_scope_${unrelatedReason}`);
    return buildPolicyForProfile(
      "out_of_scope_unrelated",
      surface,
      routing.intent,
      routing.intentType,
      buildRetrievalDecision({
        profile: "out_of_scope_unrelated",
        intent: routing.intent,
        intentType: routing.intentType,
        normalizedMessage,
        hasThread: Boolean(threadId),
      }),
      reasons
    );
  }

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
