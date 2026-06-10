import { MENTORSHIP_REASON_ORDER } from "./matching-weights";

export interface MentorshipPairSummary {
  id: string;
  mentor_user_id: string;
  mentee_user_id: string;
  status?: string;
}

export function getMentorshipSectionOrder(params: {
  hasPairs: boolean;
  isAdmin: boolean;
}): "pairs-first" | "directory-first" {
  return params.hasPairs && !params.isAdmin ? "pairs-first" : "directory-first";
}

export function getVisibleMentorshipPairs<T extends MentorshipPairSummary>(
  pairs: T[],
  deletedPairIds: readonly string[]
): T[] {
  if (deletedPairIds.length === 0) return pairs;
  const deleted = new Set(deletedPairIds);
  return pairs.filter((pair) => !deleted.has(pair.id));
}

export function isUserInMentorshipPair(
  pair: MentorshipPairSummary,
  currentUserId?: string
): boolean {
  if (!currentUserId) return false;
  return (
    pair.mentee_user_id === currentUserId || pair.mentor_user_id === currentUserId
  );
}

export function canLogMentorshipActivity(params: {
  role: string | null | undefined;
  status: string | null | undefined;
}): boolean {
  return (
    params.status === "active" &&
    (params.role === "admin" || params.role === "active_member")
  );
}

export function getMentorshipStatusTranslationKey(status: string): string {
  switch (status) {
    case "completed":
      return "statusCompleted";
    case "paused":
      return "statusPaused";
    default:
      return "statusActive";
  }
}

const REASON_LABELS: Record<string, string> = {
  shared_sport: "Shared sport",
  shared_position: "Shared position",
  shared_topics: "Shared topics",
  shared_industry: "Shared industry",
  shared_role_family: "Shared role family",
  graduation_gap_fit: "Graduation gap fit",
  shared_city: "Shared city",
  shared_company: "Shared company",
  // Signals derived from rich LinkedIn-enriched profile data.
  career_trajectory: "Walked your path",
  shared_school: "Same school",
  aspirational_skill: "Skills you want",
  past_employer_overlap: "Worked at the same company",
  fallback_general: "Suggested match",
};

/**
 * Human-readable label for a mentorship reason code.
 * Returns the code itself (title-cased) for unknown codes so new codes
 * added to `matching-weights.ts` never silently disappear.
 */
export function formatMentorshipReasonLabel(code: string): string {
  return REASON_LABELS[code] ?? code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Human-readable explanation sentence for a single match signal.
 * Custom attributes (codes like "custom:sport") use the value field
 * which contains "Label:matchedValue" (e.g., "Sport:Lacrosse").
 */
export function formatMatchExplanation(
  signal: { code: string; value?: string | number }
): string {
  const { code, value } = signal;

  // Custom attribute — value is "Label:matchedValue(s)"
  if (code.startsWith("custom:") && typeof value === "string") {
    const colonIdx = value.indexOf(":");
    if (colonIdx > 0) {
      const label = value.slice(0, colonIdx);
      const matched = value.slice(colonIdx + 1);
      const values = matched.split(",").filter(Boolean);
      if (values.length === 1) return `Shared ${label.toLowerCase()}: ${values[0]}`;
      return `Shared ${label.toLowerCase()}: ${values.join(", ")}`;
    }
    return `Shared: ${value}`;
  }

  // Built-in signals
  switch (code) {
    case "shared_topics": {
      const topics = typeof value === "string" ? value.split(",").filter(Boolean) : [];
      if (topics.length === 1) return `Shared topic: ${topics[0]}`;
      if (topics.length > 1) return `Shared topics: ${topics.join(", ")}`;
      return "Shared topics";
    }
    case "shared_industry":
      return typeof value === "string" ? `Same industry: ${value}` : "Same industry";
    case "shared_role_family":
      return typeof value === "string" ? `Same career path: ${value}` : "Same career path";
    case "graduation_gap_fit":
      return typeof value === "number" ? `${value} years ahead in career` : "Good career gap";
    case "shared_city":
      return typeof value === "string" ? `Same city: ${value}` : "Same city";
    case "shared_company":
      return typeof value === "string" ? `Same company: ${value}` : "Same company";
    case "career_trajectory": {
      const hits = typeof value === "string" ? value.split(",").filter(Boolean) : [];
      return hits.length > 0 ? `Has worked in ${hits.join(", ")}` : "Walked a path you want";
    }
    case "shared_school": {
      const schools = typeof value === "string" ? value.split(",").filter(Boolean) : [];
      if (schools.length === 1) return `Same school: ${schools[0]}`;
      if (schools.length > 1) return `Same school: ${schools.join(", ")}`;
      return "Same school";
    }
    case "aspirational_skill": {
      const skills = typeof value === "string" ? value.split(",").filter(Boolean) : [];
      return skills.length > 0
        ? `Has skills you want to build: ${skills.join(", ")}`
        : "Has skills you want to build";
    }
    case "past_employer_overlap": {
      const companies = typeof value === "string" ? value.split(",").filter(Boolean) : [];
      if (companies.length === 1) return `Both worked at ${companies[0]}`;
      if (companies.length > 1) return `Both worked at ${companies.join(", ")}`;
      return "Worked at the same company";
    }
    case "fallback_general":
      return "Suggested while we learn more about this student";
    default:
      return formatMentorshipReasonLabel(code);
  }
}

/* ------------------------------------------------------------------ */
/*  Reason code ⇄ label patterns (single source of truth)             */
/* ------------------------------------------------------------------ */

/**
 * Maps each mentorship reason code to the regex patterns that identify its
 * rendered label/explanation in free text. This is the single source of truth
 * the grounding verifier (`extractMentorReasonCodes`) consumes to map a
 * model-written "why" line back to the engine codes it claims — colocated with
 * the labels in {@link REASON_LABELS} / {@link formatMatchExplanation} so the
 * two never drift (enforced by a table-driven test).
 *
 * ORDER MATTERS. `past_employer_overlap` ("Worked at the same company", "Both
 * worked at X") is listed before `shared_company` ("Same company: X") and its
 * patterns are matched first; a line that matches a more-specific earlier code
 * masks the span so the generic `shared_company` pattern cannot also fire on
 * the word "company". Every {@link BuiltInReasonCode} must appear exactly once.
 */
export const REASON_CODE_LABEL_PATTERNS: ReadonlyArray<{
  code: string;
  patterns: RegExp[];
}> = [
  { code: "shared_topics", patterns: [/shared topics?/] },
  { code: "career_trajectory", patterns: [/has worked in|walked a path you want|walked your path/] },
  { code: "aspirational_skill", patterns: [/skills you want(?: to build)?|has skills you want/] },
  { code: "shared_school", patterns: [/same school|shared school/] },
  { code: "shared_sport", patterns: [/shared sport|same sport/] },
  { code: "shared_position", patterns: [/shared position|same position/] },
  { code: "graduation_gap_fit", patterns: [/years? ahead(?: in career)?|good career gap|graduation gap fit|graduation fit/] },
  // past_employer_overlap MUST precede shared_company so "worked at the same
  // company" / "both worked at X" never collapse into the generic company code.
  { code: "past_employer_overlap", patterns: [/worked at the same company|both worked at|past employer/] },
  { code: "shared_company", patterns: [/same company|shared company/] },
  { code: "shared_industry", patterns: [/same industry|shared industry/] },
  { code: "shared_role_family", patterns: [/same career path|shared role family|same role family|similar role/] },
  { code: "shared_city", patterns: [/same city|shared city|both (?:live|based|located) in/] },
  { code: "fallback_general", patterns: [/suggested (?:match|while we learn)/] },
];

/**
 * Extract the mentorship reason codes a single line of model text claims,
 * driven by {@link REASON_CODE_LABEL_PATTERNS}. Earlier (more specific) codes
 * win: once a code's pattern matches, its matched spans are blanked out before
 * later codes are tested, so `past_employer_overlap` cannot also surface as
 * `shared_company`.
 */
export function extractReasonCodesFromLine(line: string): string[] {
  let remaining = line.toLowerCase();
  const matched: string[] = [];

  for (const { code, patterns } of REASON_CODE_LABEL_PATTERNS) {
    let hit = false;
    for (const pattern of patterns) {
      const re = new RegExp(pattern.source, "g");
      if (re.test(remaining)) {
        hit = true;
        remaining = remaining.replace(new RegExp(pattern.source, "g"), " ");
      }
    }
    if (hit) matched.push(code);
  }

  return matched;
}

/**
 * Compose a single human-readable "why" sentence from a match's signals.
 * Orders signals by `MENTORSHIP_REASON_ORDER`, takes the strongest few, and
 * joins their explanations. Used both as the default render and as the
 * deterministic fallback when the LLM "why" generator is unavailable.
 */
export function buildDeterministicWhy(
  signals: ReadonlyArray<{ code: string; value?: string | number; weight?: number }>,
  maxReasons = 3
): string {
  if (!Array.isArray(signals) || signals.length === 0) return "";
  const orderIndex = (code: string): number => {
    const idx = MENTORSHIP_REASON_ORDER.indexOf(code as never);
    return idx >= 0 ? idx : MENTORSHIP_REASON_ORDER.length;
  };
  const ordered = [...signals].sort((a, b) => orderIndex(a.code) - orderIndex(b.code));
  const parts = ordered
    .slice(0, maxReasons)
    .map((s) => formatMatchExplanation(s))
    .filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return `${parts[0]}.`;
  const last = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(", ")}, and ${last}.`;
}

export type MatchQualityTier = "strong" | "good" | "possible";

/**
 * Map a raw score to a qualitative tier.
 * Thresholds are percentage of theoretical max score.
 */
export function getMatchQualityTier(
  score: number,
  theoreticalMax: number
): MatchQualityTier | null {
  if (theoreticalMax <= 0) return null;
  const pct = score / theoreticalMax;
  if (pct >= 0.75) return "strong";
  if (pct >= 0.50) return "good";
  if (pct >= 0.25) return "possible";
  return null; // below threshold — hide from results
}

export type ConfidenceLabel = "High" | "Good" | "Moderate" | "Low";

/**
 * Convert a raw match score (an unbounded sum of weighted signals) into a
 * tier-calibrated **confidence out of 100** for display.
 *
 * Rather than a flat `score/theoreticalMax * 100` (which buries realistic
 * matches at 30–60%), the raw fraction is mapped piecewise-linearly onto
 * confidence bands aligned with the qualitative tiers, so a strong match reads
 * "High" and a data-thin fallback never reads 0:
 *
 *   pct ≥ 0.75 (strong)   → 85–100
 *   0.50–0.75 (good)      → 65–84
 *   0.25–0.50 (possible)  → 45–64
 *   < 0.25   (thin)       → 30–44  (floored at 30)
 *
 * Result is clamped to 0–100 and rounded.
 */
export function scoreToConfidence(score: number, theoreticalMax: number): number {
  if (!Number.isFinite(score) || theoreticalMax <= 0) return 0;
  const pct = Math.max(0, score) / theoreticalMax;
  // Piecewise-linear interpolation within each band.
  const interp = (
    lo: number,
    hi: number,
    outLo: number,
    outHi: number
  ): number => {
    const t = Math.min(1, Math.max(0, (pct - lo) / (hi - lo)));
    return outLo + t * (outHi - outLo);
  };
  let confidence: number;
  if (pct >= 0.75) confidence = interp(0.75, 1.0, 85, 100);
  else if (pct >= 0.5) confidence = interp(0.5, 0.75, 65, 84);
  else if (pct >= 0.25) confidence = interp(0.25, 0.5, 45, 64);
  else confidence = interp(0, 0.25, 30, 44);
  return Math.min(100, Math.max(0, Math.round(confidence)));
}

/**
 * Bucket a 0–100 confidence into a short label for badges/chips.
 */
export function confidenceLabel(confidence: number): ConfidenceLabel {
  if (confidence >= 85) return "High";
  if (confidence >= 65) return "Good";
  if (confidence >= 45) return "Moderate";
  return "Low";
}
