export const DEFAULT_CALENDAR_OAUTH_REDIRECT_PATH = "/settings/notifications";

const ALLOWED_REDIRECT_PATHS = new Set([
  "/settings/notifications",
  "/settings",
  "/",
]);

const ORG_CALENDAR_REDIRECT_PATTERN = /^\/[^/]+\/calendar(?:\/[^?#]+(?:\/[^?#]+)*)?$/;
const ORG_MENTORSHIP_REDIRECT_PATTERN = /^\/[^/]+\/mentorship(?:\/[^?#]+(?:\/[^?#]+)*)?$/;

export function sanitizeCalendarOAuthRedirectPath(rawPath: string): string {
  const normalizedPath = rawPath.trim();
  const basePath = normalizedPath.split("?")[0];

  if (!basePath.startsWith("/")) {
    return DEFAULT_CALENDAR_OAUTH_REDIRECT_PATH;
  }

  if (basePath.startsWith("//") || basePath.includes("://") || basePath.includes("\\")) {
    return DEFAULT_CALENDAR_OAUTH_REDIRECT_PATH;
  }

  if (/[\x00-\x1f]/.test(basePath)) {
    return DEFAULT_CALENDAR_OAUTH_REDIRECT_PATH;
  }

  if (
    ALLOWED_REDIRECT_PATHS.has(basePath) ||
    ORG_CALENDAR_REDIRECT_PATTERN.test(basePath) ||
    ORG_MENTORSHIP_REDIRECT_PATTERN.test(basePath)
  ) {
    return normalizedPath;
  }

  return DEFAULT_CALENDAR_OAUTH_REDIRECT_PATH;
}
