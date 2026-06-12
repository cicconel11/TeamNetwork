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
 * candidates are relevant but not how they differ. The goal here is not just
 * "show top mentors" but "help the member decide who to contact first, why
 * that person is relevant, and what to ask them". This renderer:
 *
 *  1. collapses reasons shared by EVERY suggestion into one "Common match
 *     signals" line, so per-person bullets only show differentiators;
 *  2. gives each card a "Best for" positioning line composed from that
 *     person's own role/company and signals (mentor direction);
 *  3. explains why #1 outranks #2 ("Why X ranks #1"), with career-stage-fit
 *     copy when the ranking turns on a closer graduation gap;
 *  4. appends a thin-data caveat when profiles carry too few signals to trust;
 *  5. (mentor direction only) suggests conversation-starter questions for the
 *     top match, derived from that match's actual reason codes.
 *
 * Grounding safety: full reason texts come from formatMatchExplanation, so
 * the codes a line claims are always backed by tool output. Compact phrases
 * ("Law industry", "Villanova University") and question wording deliberately
 * avoid the phrases in REASON_CODE_LABEL_PATTERNS, so they claim no codes at
 * all — which the verifier permits.
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

/** Render a "Match score: 92/100 (High)" line body, or null when unavailable. */
function formatMatchScoreLine(card: SuggestionCard): string | null {
  if (card.confidence == null) return null;
  const label = card.confidenceLabel ? ` (${card.confidenceLabel})` : "";
  return `Match score: ${card.confidence}/100${label}`;
}

function firstNameOf(full: string): string {
  return full.split(/\s+/)[0] || full;
}

function titleCaseWords(text: string): string {
  return text.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** First entry of a comma-joined signal value, trimmed. */
function firstValueOf(value: string | number | null): string | null {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return null;
  const first = value.split(",")[0]?.trim();
  return first || null;
}

function splitValues(value: string | number | null): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Collapse shared reasons only when at least this many repeat on every card. */
const MIN_SHARED_TO_COLLAPSE = 2;
/** A list where every card has at most this many signals is "thin data". */
const THIN_DATA_MAX_REASONS = 2;
const MAX_SUGGESTED_QUESTIONS = 3;

/**
 * Compact phrasing for the "Common match signals" line. Deliberately avoids
 * REASON_CODE_LABEL_PATTERNS phrases ("same industry", "shared topics", …) so
 * the line claims no reason codes. Codes without a compact form fall back to
 * the full explanation text (which claims its own, backed, code).
 */
function compactSignalTexts(reason: SuggestionReason): string[] {
  switch (reason.code) {
    case "shared_topics":
      return splitValues(reason.value).map((t) => `${titleCaseWords(t)} interests`);
    case "shared_industry": {
      const v = firstValueOf(reason.value);
      return v ? [`${v} industry`] : [];
    }
    case "shared_role_family": {
      // "X career path" never matches the grounding pattern, which requires
      // the full phrase "same career path".
      const v = firstValueOf(reason.value);
      return v ? [`${v} career path`] : [];
    }
    case "shared_school":
      return splitValues(reason.value).map(titleCaseWords);
    case "shared_city": {
      const v = firstValueOf(reason.value);
      return v ? [`based in ${v}`] : [];
    }
    default:
      return [normalizeReasonSpacing(reason.text)];
  }
}

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

/** Numeric graduation-gap value for a card, or null. */
function gapYearsOf(card: SuggestionCard): number | null {
  const gap = card.reasons.find((r) => r.code === "graduation_gap_fit");
  return typeof gap?.value === "number" ? gap.value : null;
}

/** Split a "Name — Role at Company" display line into its parts (best-effort). */
function splitSubtitle(displayLine: string): {
  role: string | null;
  company: string | null;
} {
  const dash = displayLine.indexOf(" — ");
  if (dash < 0) return { role: null, company: null };
  const subtitle = displayLine.slice(dash + 3);
  const at = subtitle.indexOf(" at ");
  if (at < 0) return { role: subtitle || null, company: null };
  return {
    role: subtitle.slice(0, at) || null,
    company: subtitle.slice(at + 4) || null,
  };
}

/**
 * Compact "Best for" phrasing for one matching signal. Entirely value-driven —
 * the copy works for any org (law firm alumni, sports clubs, finance, …)
 * because every concrete noun comes from the signal's own value. Wording
 * avoids REASON_CODE_LABEL_PATTERNS phrases so these claim no reason codes.
 */
function bestForSignalText(reason: SuggestionReason): string | null {
  switch (reason.code) {
    case "career_trajectory": {
      const area = firstValueOf(reason.value);
      return area ? `firsthand ${area} experience` : null;
    }
    case "past_employer_overlap":
    case "shared_company": {
      const company = firstValueOf(reason.value);
      return company ? `an inside view of ${company}` : null;
    }
    case "shared_industry": {
      const industry = firstValueOf(reason.value);
      return industry ? `${industry} industry insight` : null;
    }
    case "shared_topics": {
      const topics = splitValues(reason.value).slice(0, 2);
      return topics.length > 0 ? `guidance on ${topics.join(" and ")}` : null;
    }
    case "aspirational_skill": {
      const skill = firstValueOf(reason.value);
      return skill ? `building ${skill} abilities` : null;
    }
    case "shared_role_family": {
      const role = firstValueOf(reason.value);
      return role ? `navigating the ${role} track` : null;
    }
    case "shared_school": {
      const school = firstValueOf(reason.value);
      return school ? `the ${titleCaseWords(school)} network` : null;
    }
    case "shared_city": {
      const city = firstValueOf(reason.value);
      return city ? `local connections in ${city}` : null;
    }
    default:
      return null;
  }
}

const MAX_BEST_FOR_PARTS = 2;

/**
 * "Best for" positioning line, composed only from this card's own match
 * signals — career-stage gap relative to the rest of the list, then the
 * signals unique to this person (industry, topics, employers, skills, …),
 * then their role/company as a vantage point, and only then signals shared
 * with the whole list. Signal-driven so it generalizes across orgs; never
 * invents expertise.
 */
function buildBestForLine(
  card: SuggestionCard,
  allCards: SuggestionCard[],
  sharedKeys: ReadonlySet<string>
): string | null {
  const parts: string[] = [];

  // 1. Career-stage positioning, relative to the other matches.
  const gap = gapYearsOf(card);
  if (gap != null) {
    const gaps = allCards.map(gapYearsOf).filter((g): g is number => g != null);
    const isClosest = gaps.length > 1 && gap === Math.min(...gaps);
    const isFurthest = gaps.length > 1 && gap === Math.max(...gaps) && gap !== Math.min(...gaps);
    if (isClosest) {
      parts.push("early-career advice close to your stage");
    } else if (isFurthest) {
      parts.push("a more seasoned view of the path");
    }
  }

  // 2. Signals unique to this person — the real differentiators.
  for (const reason of card.reasons) {
    if (parts.length >= MAX_BEST_FOR_PARTS) break;
    if (sharedKeys.has(reason.key)) continue;
    if (reason.code === "graduation_gap_fit") continue; // handled above
    const text = bestForSignalText(reason);
    if (text) parts.push(text);
  }

  // 3. Their role/company vantage point (per-person data, not a signal).
  if (parts.length < MAX_BEST_FOR_PARTS) {
    const { role, company } = splitSubtitle(card.displayLine);
    if (role && company) {
      parts.push(`the ${role} perspective from ${company}`);
    } else if (role) {
      parts.push(`the ${role} perspective`);
    }
  }

  // 4. Last resort: phrase a shared signal rather than render nothing.
  if (parts.length === 0) {
    for (const reason of card.reasons) {
      const text = bestForSignalText(reason);
      if (text) {
        parts.push(text);
        break;
      }
    }
  }

  if (parts.length === 0) return null;
  const capped = parts.slice(0, MAX_BEST_FOR_PARTS);
  return `Best for: ${capped.join(" and ")}`;
}

/**
 * "Why X ranks #1" line. When the ranking turns on a closer graduation gap
 * (both top cards carry one and #1's is smaller), say so explicitly — that is
 * "why 9 years ahead beats 12" answered. Otherwise list the signals #1 has
 * that #2 lacks. Returns null when the top two are indistinguishable.
 */
function buildWhyFirstLine(cards: SuggestionCard[]): {
  line: string;
  consumedKeys: Set<string>;
} | null {
  if (cards.length < 2) return null;
  const [first, second] = cards;

  const edge = first.reasons.filter(
    (reason) => !second.reasons.some((r) => r.key === reason.key)
  );
  if (edge.length === 0) return null;

  const consumedKeys = new Set<string>();
  const parts: string[] = [];

  const firstGap = gapYearsOf(first);
  const secondGap = gapYearsOf(second);
  if (firstGap != null && secondGap != null && firstGap < secondGap) {
    parts.push(
      `closest career-stage fit of these matches (${firstGap} years ahead vs ${secondGap}) — recent enough to speak to your next steps`
    );
    const gapReason = first.reasons.find((r) => r.code === "graduation_gap_fit");
    if (gapReason) consumedKeys.add(gapReason.key);
  }

  for (const reason of edge) {
    if (consumedKeys.has(reason.key)) continue;
    parts.push(normalizeReasonSpacing(reason.text));
    consumedKeys.add(reason.key);
  }

  if (parts.length === 0) return null;
  return {
    line: `_Why ${firstNameOf(first.name)} ranks #1: ${parts.join(" · ")}_`,
    consumedKeys,
  };
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
    const compact = shared.flatMap((r) => compactSignalTexts(r));
    sections.push(
      `_Common match signals across all ${cards.length}: ${compact.join(" · ")}_`
    );
  }

  const whyFirst = direction === "mentor" ? buildWhyFirstLine(cards) : null;

  const blocks = cards.map((card, index) => {
    const lines = [`**${index + 1}. ${card.displayLine}**`];
    const score = formatMatchScoreLine(card);
    if (score) lines.push(score);

    const bestFor =
      direction === "mentor" ? buildBestForLine(card, cards, sharedKeys) : null;
    if (bestFor) lines.push(bestFor);

    // Bullets: this card's non-shared signals, minus anything the why-first
    // line already explains for the top card.
    const consumed =
      index === 0 && whyFirst ? whyFirst.consumedKeys : new Set<string>();
    const distinct = card.reasons.filter(
      (reason) => !sharedKeys.has(reason.key) && !consumed.has(reason.key)
    );
    if (distinct.length > 0) {
      lines.push("");
      for (const reason of distinct) {
        lines.push(`- ${normalizeReasonSpacing(reason.text)}`);
      }
    } else if (!bestFor && !(index === 0 && whyFirst)) {
      // Never leave a card with nothing but a score: anchor it to the shared
      // signals when no specific line exists for it.
      lines.push("");
      lines.push("- Matches on the shared signals above");
    }

    if (index === 0 && whyFirst) {
      lines.push("");
      lines.push(whyFirst.line);
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
