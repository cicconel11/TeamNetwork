const FALLBACK_LABELS: Record<string, string> = {
  shared_sport: "Same sport",
  shared_position: "Same position",
  shared_topics: "Shared topics",
  shared_industry: "Same industry",
  shared_role_family: "Same role family",
  graduation_gap_fit: "Graduation gap fit",
  shared_city: "Same city",
  shared_company: "Same company",
};

function humanize(code: string): string {
  return code
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Label a match signal code. Prefer i18n translation when present.
 * Falls back to curated English label, then humanized code. Never returns
 * `mentorship.signal.undefined` style keys.
 */
export function labelMatchSignal(
  code: string | null | undefined,
  tFn?: (key: string) => string
): string {
  if (typeof code !== "string" || code.length === 0) return "Match signal";
  if (tFn) {
    try {
      const translated = tFn(`signal.${code}`);
      if (translated && translated !== `signal.${code}` && !translated.endsWith(".undefined")) {
        return translated;
      }
    } catch {
      // fall through
    }
  }
  return FALLBACK_LABELS[code] ?? humanize(code);
}

/**
 * Normalize a match-signal record to its canonical code. Accepts `{ code }`
 * (current) and legacy `{ kind }` so older DB rows still render.
 */
export function pickSignalCode(signal: unknown): string | null {
  if (!signal || typeof signal !== "object") return null;
  const s = signal as { code?: unknown; kind?: unknown };
  if (typeof s.code === "string" && s.code.length > 0) return s.code;
  if (typeof s.kind === "string" && s.kind.length > 0) return s.kind;
  return null;
}
