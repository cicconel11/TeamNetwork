// Shared claim-parsing primitives used by tool and RAG grounding validators.

export function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function stripMarkdown(value: string): string {
  return value.replace(/[*_`~>#"]/g, "").replace(/\[(.*?)\]\((.*?)\)/g, "$1").trim();
}

export function extractEmails(content: string): string[] {
  return [...new Set(content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])];
}

export function extractQuotedTitles(content: string): string[] {
  return [...content.matchAll(/"([^"\n]+)"/g)].map((match) => stripMarkdown(match[1] ?? ""));
}

export function extractMentionedDates(content: string): string[] {
  const isoMatches = content.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  const longMatches = content.match(
    /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},\s+\d{4}\b/gi
  ) ?? [];
  return [...new Set([...isoMatches, ...longMatches].map((value) => value.toLowerCase()))];
}

// Extract every "$<amount>" token in content, returning whole-dollar values.
// Handles commas and optional k/K suffix. Skips malformed tokens.
export function extractAllCurrencyDollars(content: string): number[] {
  const result: number[] = [];
  const globalPattern = /\$([0-9][0-9,]*(?:\.[0-9]{1,2})?)(k|K)?(?![0-9.])/g;
  let match: RegExpExecArray | null;
  while ((match = globalPattern.exec(content)) !== null) {
    const parsed = Number.parseFloat(match[1].replace(/,/g, ""));
    if (!Number.isFinite(parsed)) continue;
    const scaled = match[2] ? parsed * 1000 : parsed;
    result.push(Math.round(scaled));
  }
  return result;
}

export function parseCurrencyClaim(content: string, label: string): number | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = /\$([0-9][0-9,]*(?:\.[0-9]{1,2})?)(k|K)?(?![0-9.])/;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!new RegExp(`\\b${escaped}\\b`, "i").test(line)) {
      continue;
    }

    const match = line.match(pattern);
    if (!match) {
      continue;
    }

    const parsed = Number.parseFloat(match[1].replace(/,/g, ""));
    if (!Number.isFinite(parsed)) {
      continue;
    }
    const scaled = match[2] ? parsed * 1000 : parsed;
    return Math.round(scaled);
  }

  return null;
}

export function extractListEntryHeads(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^([-*]|\d+\.)\s+/.test(line))
    .map((line) => {
      const stripped = stripMarkdown(line.replace(/^([-*]|\d+\.)\s+/, ""));
      return stripped.split(/\s*(?:[-—:|]|\bon\b)\s*/i)[0]?.trim() ?? "";
    })
    .filter(Boolean);
}

export function contentIsGroundingFallback(content: string): boolean {
  return /couldn[’']t verify|could not verify|unable to verify/i.test(content);
}
