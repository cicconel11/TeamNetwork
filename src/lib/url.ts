/**
 * Returns the application base URL from environment or production fallback.
 */
export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://www.myteamnetwork.com";
}
