/**
 * Returns the application base URL from environment or production fallback.
 */
export function getAppUrl(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ];

  for (const candidate of candidates) {
    if (!candidate || candidate.trim() === "") {
      continue;
    }

    try {
      return new URL(candidate).origin;
    } catch {
      continue;
    }
  }

  return "https://www.myteamnetwork.com";
}
