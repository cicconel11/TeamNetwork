export function normalizeAiMessage(message: string): string {
  return message
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAiMessageForExactMatch(message: string): string {
  return normalizeAiMessage(message)
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
