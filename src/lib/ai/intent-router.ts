import type { AiSurface } from "@/lib/schemas/ai-assistant";
import {
  normalizeAiMessage,
  normalizeAiMessageForExactMatch,
} from "@/lib/ai/message-normalization";

export type AiIntent =
  | "general_query"
  | "members_query"
  | "analytics_query"
  | "events_query"
  | "ambiguous_query";

export type AiIntentType =
  | "knowledge_query"
  | "action_request"
  | "navigation"
  | "casual";

export interface SurfaceRoutingDecision {
  intent: AiIntent;
  intentType: AiIntentType;
  effectiveSurface: AiSurface;
  inferredSurface: AiSurface | null;
  confidence: "high" | "low";
  rerouted: boolean;
}

const SURFACE_KEYWORDS: Record<Exclude<AiSurface, "general">, readonly string[]> = {
  members: [
    "member",
    "members",
    "alumni",
    "parent",
    "parents",
    "roster",
    "directory",
    "mentorship",
    "connection",
    "connections",
    "connect",
    "networking",
    "introduce",
    "introduction",
    "graduation",
    "graduated",
    "graduate",
    "grad",
    "message",
    "messaging",
    "chat",
    "dm",
    "text",
    "reach out",
    "contact",
    "enterprise",
    "managed org",
    "managed orgs",
    "sub org",
    "sub orgs",
    "sub-org",
    "sub-orgs",
  ],
  analytics: ["analytics", "metric", "metrics", "donation", "donations", "fundraising", "revenue", "expense", "expenses", "budget", "budgets", "financial", "finance", "donor", "donors", "billing", "quota", "capacity", "seat", "seats", "slot", "slots", "limit", "limits"],
  events: [
    "event",
    "events",
    "philanthropy",
    "volunteer",
    "volunteering",
    "service",
    "calendar",
    "schedule",
    "schedules",
    "meeting",
    "meetings",
    "ceremony",
    "game",
    "games",
    "rsvp",
    "scrape",
    "import",
    "website",
    "extract",
  ],
};

const SURFACE_TO_INTENT: Record<AiSurface, Exclude<AiIntent, "ambiguous_query">> = {
  general: "general_query",
  members: "members_query",
  analytics: "analytics_query",
  events: "events_query",
};

const CASUAL_MESSAGE_PATTERNS = [
  /^(?:hi|hello|hey|hiya|howdy|yo)(?:\s+(?:there|team|everyone|all|folks))?$/i,
  /^(?:good\s+(?:morning|afternoon|evening))(?:\s+(?:team|everyone|all|folks))?$/i,
  /^(?:thanks|thank you|thx|ty)(?:\s+(?:so much|a lot|team|everyone|all))?$/i,
  /^(?:ok|okay|cool|great|awesome|perfect|sounds good|got it|nice)$/i,
  /^(?:bye|goodbye|see you|see ya|talk soon)$/i,
];

// Imperative verbs that signal the user wants something done
const ACTION_KEYWORDS: readonly string[] = [
  "create", "add", "delete", "remove", "update", "send", "invite",
  "schedule", "change", "set", "assign", "cancel", "approve", "reject",
  "make", "edit", "move", "rename", "archive", "unarchive", "restore",
  "enable", "disable", "reset", "upload", "post", "publish",
  "write", "compose", "draft", "reply", "respond", "comment",
];

// Keywords that map a message to general org content tools even when no surface-specific keyword fires
const GENERAL_CONTENT_KEYWORDS: readonly string[] = [
  "announcement",
  "announcements",
  "discussion",
  "discussions",
  "forum",
  "thread",
  "threads",
  "job",
  "jobs",
  "posting",
  "postings",
  "hiring",
  "career",
  "careers",
  "position",
  "positions",
  "opportunity",
  "opportunities",
];

// Phrases that signal the user wants to navigate somewhere
const NAVIGATION_PATTERNS = [
  /(?<!\w)go\s+to(?!\w)/i,
  /(?<!\w)show\s+me(?!\w)/i,
  /(?<!\w)take\s+me\s+to(?!\w)/i,
  /(?<!\w)navigate\s+to(?!\w)/i,
  /(?<!\w)open(?!\w)/i,
  /(?<!\w)where\s+is(?!\w)/i,
  /(?<!\w)where\s+(?:can|do)\s+i\s+find(?!\w)/i,
  /(?<!\w)find\s+the\s+page(?!\w)/i,
  /(?<!\w)link\s+to(?!\w)/i,
];

export function normalizeMessage(message: string): string {
  return normalizeAiMessage(message);
}

function isCasualMessage(message: string): boolean {
  const normalized = normalizeAiMessageForExactMatch(message);

  if (normalized.length === 0) {
    return false;
  }

  return CASUAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasActionKeywords(normalized: string): boolean {
  return ACTION_KEYWORDS.some((keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "i");
    return pattern.test(normalized);
  });
}

function hasNavigationPattern(normalized: string): boolean {
  return NAVIGATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function classifyIntentType(message: string, normalized: string): AiIntentType {
  if (isCasualMessage(message)) {
    return "casual";
  }
  if (hasActionKeywords(normalized)) {
    return "action_request";
  }
  if (hasNavigationPattern(normalized)) {
    return "navigation";
  }
  return "knowledge_query";
}

function countMatches(message: string, keywords: readonly string[]): number {
  return keywords.reduce((count, keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "i");
    return count + Number(pattern.test(message));
  }, 0);
}

export function resolveSurfaceRouting(
  message: string,
  requestedSurface: AiSurface
): SurfaceRoutingDecision {
  const normalized = normalizeMessage(message);
  const intentType = classifyIntentType(message, normalized);
  const scores = {
    members: countMatches(normalized, SURFACE_KEYWORDS.members),
    analytics: countMatches(normalized, SURFACE_KEYWORDS.analytics),
    events: countMatches(normalized, SURFACE_KEYWORDS.events),
  };

  const ranked = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]) as Array<[Exclude<AiSurface, "general">, number]>;

  if (ranked.length === 0) {
    const hasGeneralContent = countMatches(normalized, GENERAL_CONTENT_KEYWORDS) > 0;
    if (intentType === "casual") {
      return {
        intent: SURFACE_TO_INTENT.general,
        intentType,
        effectiveSurface: requestedSurface,
        inferredSurface: null,
        confidence: "low",
        rerouted: false,
      };
    }
    return {
      intent: SURFACE_TO_INTENT.general,
      intentType,
      effectiveSurface: hasGeneralContent ? "general" : requestedSurface,
      inferredSurface: hasGeneralContent ? "general" : null,
      confidence: hasGeneralContent ? "high" : "low",
      rerouted: hasGeneralContent && requestedSurface !== "general",
    };
  }

  const [winner, highScore] = ranked[0];
  const isAmbiguous = ranked.some(([surface, score]) => surface !== winner && score === highScore);

  if (isAmbiguous) {
    return {
      intent: "ambiguous_query",
      intentType,
      effectiveSurface: requestedSurface,
      inferredSurface: null,
      confidence: "low",
      rerouted: false,
    };
  }

  return {
    intent: SURFACE_TO_INTENT[winner],
    intentType,
    effectiveSurface: winner,
    inferredSurface: winner,
    confidence: "high",
    rerouted: winner !== requestedSurface,
  };
}
