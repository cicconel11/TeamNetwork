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

export function sanitizeRichTextToPlainText(input: unknown): string | null {
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

  return sanitized || null;
}
