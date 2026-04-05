/**
 * Branded string for regex-sanitized plain text. The brand communicates the
 * value contract at call sites, but it is still assignable to `string`, so it
 * is not a security boundary on its own.
 */
export type PlainText = string & { readonly __brand: "PlainText" };

const BLOCK_BREAK_TAGS = /<(?:br|\/p|\/div|\/li|\/ul|\/ol|\/h[1-6])\s*\/?>/gi;
const LIST_ITEM_TAGS = /<li\b[^>]*>/gi;
const SCRIPT_STYLE_TAGS = /<(script|style)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi;
const ALL_HTML_TAGS = /<[^>]*>/g;
const HTML_ENTITY_MAP: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
  "&#x2f;": "/",
  "&lt;": "<",
  "&gt;": ">",
};

function decodeHtmlEntities(input: string): string {
  return input.replace(/&(?:nbsp|amp|quot|lt|gt);|&#(?:x27|x2f|39);/gi, (entity) => {
    return HTML_ENTITY_MAP[entity.toLowerCase()] ?? entity;
  });
}

/**
 * Strips HTML to plain text via regex. The result is intended for text-node
 * rendering only and must never be passed to raw HTML sinks like
 * `dangerouslySetInnerHTML`.
 */
export function sanitizeRichTextToPlainText(input: unknown): PlainText | null {
  if (typeof input !== "string") {
    return null;
  }

  const sanitized = decodeHtmlEntities(
    input
      .replace(SCRIPT_STYLE_TAGS, "")
      .replace(LIST_ITEM_TAGS, "\n- ")
      .replace(BLOCK_BREAK_TAGS, "\n")
      .replace(ALL_HTML_TAGS, "")
  )
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  return (sanitized || null) as PlainText | null;
}
