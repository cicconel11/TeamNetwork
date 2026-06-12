import {
  formatMatchExplanation,
  type MatchExplanationDirection,
} from "@/lib/mentorship/presentation";
import { getNonEmptyString } from "./index";

/**
 * Differentiated rendering for the suggest_mentors / suggest_mentees lists.
 *
 * The raw scorer output reads generic when an org is homogeneous — every
 * suggestion matching on the same school/industry/topics tells the user the
 * candidates are relevant but not how they differ. This renderer:
 *
 *  1. collapses reasons shared by EVERY suggestion into one line under the
 *     heading, so per-person bullets only show differentiators;
 *  2. adds a "what sets #1 apart from #2" line so the ranking reads intentional;
 *  3. appends a thin-data caveat when profiles carry too few signals to trust;
 *  4. (mentor direction only) suggests conversation-starter questions for the
 *     top match, derived from that match's actual reason codes.
 *
 * Grounding safety: every reason text comes from formatMatchExplanation, so
 * the codes a line claims are always backed by tool output. Question wording
 * deliberately avoids the phrases in REASON_CODE_LABEL_PATTERNS so questions
 * never register as reason claims.
 */

export interface SuggestionReason {
  /** Identity used for shared/distinct comparison: code + value. */
  key: string;
  /** Human-readable explanation text (already direction-aware). */
  text: string;
  code: string | null;
  value: string | number | null;
}

export interface SuggestionCard {
  name: string;
  displayLine: string;
  reasons: SuggestionReason[];
  confidence: number | null;
  confidenceLabel: string | null;
}

/**
 * Build a comparable reason from a raw payload entry. Prefers the engine
 * code + value (human copy via formatMatchExplanation); falls back to the
 * legacy "Label: value" join when the payload predates reason codes.
 */
export function buildSuggestionReason(
  r: { code?: unknown; label?: unknown; value?: unknown } | null | undefined,
  direction: MatchExplanationDirection
): SuggestionReason | null {
  const code = getNonEmptyString(r?.code);
  const rawValue = r?.value;
  const value =
    typeof rawValue === "string" || typeof rawValue === "number" ? rawValue : null;

  if (code) {
    const text = formatMatchExplanation(
      { code, value: value ?? undefined },
      direction
    );
    if (!text) return null;
    return { key: `${code}::${String(value ?? "")}`, text, code, value };
  }

  const label = getNonEmptyString(r?.label);
  if (!label) return null;
  const text = value != null && value !== "" ? `${label}: ${value}` : label;
  return { key: text, text, code: null, value };
}

/**
 * Normalize whitespace inside a reason string so comma-joined values read
 * cleanly ("consulting,strategy" -> "consulting, strategy"). Whitespace-only:
 * the label/value wording the grounding verifier inspects is unchanged.
 */
function normalizeReasonSpacing(reason: string): string {
  return reason.replace(/\s*,\s*/g, ", ").trim();
}

/** Render a "Confidence 92/100 (High)" line body, or null when unavailable. */
function formatConfidenceLine(card: SuggestionCard): string | null {
  if (card.confidence == null) return null;
  const label = card.confidenceLabel ? ` (${card.confidenceLabel})` : "";
  return `Confidence: ${card.confidence}/100${label}`;
}

function firstNameOf(full: string): string {
  return full.split(/\s+/)[0] || full;
}

/** First entry of a comma-joined signal value, trimmed. */
function firstValueOf(value: string | number | null): string | null {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return null;
  const first = value.split(",")[0]?.trim();
  return first || null;
}

/** Collapse shared reasons only when at least this many repeat on every card. */
const MIN_SHARED_TO_COLLAPSE = 2;
/** A list where every card has at most this many signals is "thin data". */
const THIN_DATA_MAX_REASONS = 2;
const MAX_SUGGESTED_QUESTIONS = 3;

/**
 * Conversation-starter templates keyed by reason code, in priority order.
 * Wording must never reproduce a REASON_CODE_LABEL_PATTERNS phrase, or the
 * grounding verifier would read the question as a reason claim.
 */
const QUESTION_BUILDERS: ReadonlyArray<{
  code: string;
  build: (value: string | number | null) => string | null;
}> = [
  {
    code: "shared_role_family",
    build: (v) => {
      const role = firstValueOf(v);
      return role
        ? `What should someone aiming for a career in ${role} be doing right now?`
        : null;
    },
  },
  {
    code: "career_trajectory",
    build: (v) => {
      const area = firstValueOf(v);
      return area ? `How did you get your start in ${area}?` : null;
    },
  },
  {
    code: "shared_industry",
    build: (v) => {
      const industry = firstValueOf(v);
      return industry ? `How did you break into ${industry}?` : null;
    },
  },
  {
    code: "aspirational_skill",
    build: (v) => {
      const skill = firstValueOf(v);
      return skill ? `How did you develop your ${skill} abilities?` : null;
    },
  },
  {
    code: "shared_topics",
    build: (v) => {
      const topic = firstValueOf(v);
      return topic ? `What experiences taught you the most about ${topic}?` : null;
    },
  },
  {
    code: "graduation_gap_fit",
    build: () => "Looking back, what do you wish you'd done differently at my stage?",
  },
  {
    code: "past_employer_overlap",
    build: (v) => {
      const company = firstValueOf(v);
      return company ? `What was your time at ${company} like?` : null;
    },
  },
];

/** Build up to MAX_SUGGESTED_QUESTIONS conversation starters for one card. */
function buildSuggestedQuestions(card: SuggestionCard): string[] {
  const byCode = new Map<string, SuggestionReason>();
  for (const reason of card.reasons) {
    if (reason.code && !byCode.has(reason.code)) byCode.set(reason.code, reason);
  }

  const questions: string[] = [];
  for (const { code, build } of QUESTION_BUILDERS) {
    const reason = byCode.get(code);
    if (!reason) continue;
    const question = build(reason.value);
    if (question) questions.push(question);
    if (questions.length >= MAX_SUGGESTED_QUESTIONS) break;
  }
  return questions;
}

/** Reason keys present on every card (order taken from the first card). */
function sharedReasons(cards: SuggestionCard[]): SuggestionReason[] {
  if (cards.length < 2) return [];
  const [first, ...rest] = cards;
  return first.reasons.filter((reason) =>
    rest.every((card) => card.reasons.some((r) => r.key === reason.key))
  );
}

export function renderMentorshipSuggestionList(args: {
  heading: string;
  cards: SuggestionCard[];
  direction: MatchExplanationDirection;
}): string {
  const { heading, cards, direction } = args;

  const shared = sharedReasons(cards);
  const collapse = shared.length >= MIN_SHARED_TO_COLLAPSE;
  const sharedKeys = new Set(collapse ? shared.map((r) => r.key) : []);

  const sections: string[] = [`### ${heading}`];

  if (collapse) {
    const sharedTexts = shared.map((r) => normalizeReasonSpacing(r.text));
    sections.push(
      `_All ${cards.length} share: ${sharedTexts.join(" · ")}_`
    );
  }

  // What the top match has that the runner-up lacks — makes the order
  // read intentional instead of arbitrary.
  const edge =
    cards.length >= 2
      ? cards[0].reasons.filter(
          (reason) => !cards[1].reasons.some((r) => r.key === reason.key)
        )
      : [];

  const blocks = cards.map((card, index) => {
    const lines = [`**${index + 1}. ${card.displayLine}**`];
    const confidence = formatConfidenceLine(card);
    if (confidence) lines.push(confidence);
    lines.push("");

    const distinct = card.reasons.filter((reason) => !sharedKeys.has(reason.key));
    if (distinct.length > 0) {
      for (const reason of distinct) {
        lines.push(`- ${normalizeReasonSpacing(reason.text)}`);
      }
    } else {
      lines.push("- Matches on the shared signals above");
    }

    if (index === 0 && edge.length > 0) {
      const edgeTexts = edge.map((r) => normalizeReasonSpacing(r.text));
      lines.push("");
      lines.push(
        `_What sets ${firstNameOf(card.name)} apart from ${firstNameOf(cards[1].name)}: ${edgeTexts.join(" · ")}_`
      );
    }

    return lines.join("\n");
  });

  sections.push(blocks.join("\n\n---\n\n"));

  if (direction === "mentor" && cards.length > 0) {
    const questions = buildSuggestedQuestions(cards[0]);
    if (questions.length > 0) {
      sections.push(
        [
          `**Questions to ask ${firstNameOf(cards[0].name)}:**`,
          ...questions.map((q) => `- ${q}`),
        ].join("\n")
      );
    }
  }

  const thinData =
    cards.length > 0 &&
    (cards.every((card) => card.reasons.length <= THIN_DATA_MAX_REASONS) ||
      cards.some((card) => card.reasons.some((r) => r.code === "fallback_general")));
  if (thinData) {
    sections.push(
      "_These matches are based on limited profile data — they get sharper as members add goals, topics, and industries to their mentorship profiles._"
    );
  }

  return sections.join("\n\n");
}
