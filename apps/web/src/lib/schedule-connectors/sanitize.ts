const MAX_TITLE_LENGTH = 200;
const DEFAULT_TITLE = "Untitled Event";

function stripHtmlTags(input: string): string {
  return input
    // Remove script/style blocks first
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    // Strip all remaining HTML tags
    .replace(/<[^>]*>/g, "")
    // Decode ONLY safe entities (NOT < or >)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/gi, "'");
    // NOTE: &lt; and &gt; are intentionally NOT decoded
}

export function sanitizeEventTitle(rawTitle: unknown): string {
  if (typeof rawTitle !== "string") {
    return DEFAULT_TITLE;
  }

  let sanitized = stripHtmlTags(rawTitle)
    .replace(/\s+/g, " ")
    .trim();

  if (sanitized.length > MAX_TITLE_LENGTH) {
    sanitized = sanitized.slice(0, MAX_TITLE_LENGTH - 3) + "...";
  }

  return sanitized || DEFAULT_TITLE;
}

export function getTitleForHash(rawTitle: string | undefined, title: string): string {
  const trimmed = rawTitle?.trim();
  return trimmed || title;
}

export function escapeHtml(input: string): string {
  const escapeMap: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#x27;",
  };
  return input.replace(/[&<>"']/g, (char) => escapeMap[char] || char);
}

export function sanitizeEventTitleForEmail(rawTitle: unknown): string {
  return escapeHtml(sanitizeEventTitle(rawTitle));
}
