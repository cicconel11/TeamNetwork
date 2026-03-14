/**
 * Pure decision function for whether the LinkedIn URL prompt should show.
 * Extracted for testability — used by LinkedInUrlPrompt component and tests.
 */
export function shouldShowLinkedInPrompt(
  connection: { status: string } | null,
  linkedinUrl: string | null,
  dismissed: boolean
): boolean {
  if (dismissed) return false;
  const isConnected = connection?.status === "connected";
  const hasUrl = Boolean(linkedinUrl);
  return isConnected && !hasUrl;
}
