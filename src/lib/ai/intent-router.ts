import type { AiSurface } from "@/lib/schemas/ai-assistant";

export type AiIntent =
  | "general_query"
  | "members_query"
  | "analytics_query"
  | "events_query"
  | "ambiguous_query";

export interface SurfaceRoutingDecision {
  intent: AiIntent;
  effectiveSurface: AiSurface;
  inferredSurface: AiSurface | null;
  confidence: "high" | "low";
  rerouted: boolean;
  skipRetrieval: boolean;
}

const SURFACE_KEYWORDS: Record<Exclude<AiSurface, "general">, readonly string[]> = {
  members: ["member", "members", "alumni", "parent", "parents", "roster", "directory", "mentorship"],
  analytics: ["analytics", "metric", "metrics", "donation", "donations", "fundraising", "revenue", "expense", "expenses", "budget", "budgets", "financial", "finance"],
  events: ["event", "events", "calendar", "schedule", "schedules", "meeting", "meetings", "ceremony", "game", "games", "rsvp"],
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

function normalizeMessage(message: string): string {
  return message
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isCasualMessage(message: string): boolean {
  const normalized = normalizeMessage(message)
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length === 0) {
    return false;
  }

  return CASUAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(normalized));
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
  const skipRetrieval = isCasualMessage(message);
  const scores = {
    members: countMatches(normalized, SURFACE_KEYWORDS.members),
    analytics: countMatches(normalized, SURFACE_KEYWORDS.analytics),
    events: countMatches(normalized, SURFACE_KEYWORDS.events),
  };

  const ranked = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]) as Array<[Exclude<AiSurface, "general">, number]>;

  if (ranked.length === 0) {
    return {
      intent: SURFACE_TO_INTENT.general,
      effectiveSurface: requestedSurface,
      inferredSurface: null,
      confidence: "low",
      rerouted: false,
      skipRetrieval,
    };
  }

  const [winner, highScore] = ranked[0];
  const isAmbiguous = ranked.some(([surface, score]) => surface !== winner && score === highScore);

  if (isAmbiguous) {
    return {
      intent: "ambiguous_query",
      effectiveSurface: requestedSurface,
      inferredSurface: null,
      confidence: "low",
      rerouted: false,
      skipRetrieval,
    };
  }

  return {
    intent: SURFACE_TO_INTENT[winner],
    effectiveSurface: winner,
    inferredSurface: winner,
    confidence: "high",
    rerouted: winner !== requestedSurface,
    skipRetrieval,
  };
}
