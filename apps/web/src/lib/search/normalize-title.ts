/**
 * Collapse runs of the same token into a single token so seed/test data like
 * "Baseball Baseball Baseball Baseball" renders as "Baseball". Case-insensitive
 * on match, preserves the casing of the first occurrence.
 */
export function normalizeRepeatedTitle(title: string | null | undefined): string {
  if (!title) return "";
  const trimmed = title.trim();
  if (!trimmed) return "";
  const tokens = trimmed.split(/\s+/);
  const out: string[] = [];
  let prevLower = "";
  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    if (lower === prevLower) continue;
    out.push(tok);
    prevLower = lower;
  }
  return out.join(" ");
}
