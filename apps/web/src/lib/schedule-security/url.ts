export function normalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  const normalized = trimmed.startsWith("webcal://")
    ? `https://${trimmed.slice("webcal://".length)}`
    : trimmed;
  const parsed = new URL(normalized);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must start with http(s) or webcal.");
  }

  return parsed.toString();
}

export function maskUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    const tail = rawUrl.slice(-6);
    return `${parsed.host}/...${tail}`;
  } catch {
    return "hidden";
  }
}
