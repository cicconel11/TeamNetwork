export const DEFAULT_MICROSOFT_REDIRECT_PATH = "/settings/notifications";

const ALLOWED_REDIRECT_PATHS = new Set([
  "/settings/notifications",
  "/settings",
  "/",
]);
const ORG_CALENDAR_REDIRECT_PATTERN = /^\/[^/]+\/calendar(?:\/[^?#]+(?:\/[^?#]+)*)?$/;

export function sanitizeMicrosoftRedirectPath(rawPath: string): string {
  const basePath = rawPath.split("?")[0].trim();

  if (!basePath.startsWith("/")) {
    return DEFAULT_MICROSOFT_REDIRECT_PATH;
  }

  if (basePath.startsWith("//") || basePath.includes("://") || basePath.includes("\\")) {
    return DEFAULT_MICROSOFT_REDIRECT_PATH;
  }

  if (/[\x00-\x1f]/.test(basePath)) {
    return DEFAULT_MICROSOFT_REDIRECT_PATH;
  }

  if (ALLOWED_REDIRECT_PATHS.has(basePath) || ORG_CALENDAR_REDIRECT_PATTERN.test(basePath)) {
    return basePath;
  }

  return DEFAULT_MICROSOFT_REDIRECT_PATH;
}
