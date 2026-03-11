import { sanitizeRedirectPath } from "./redirect";

const AGE_GATE_RESET_ERROR_PATTERNS = [
  /age verification expired/i,
  /age verification required/i,
  /invalid age data/i,
  /complete age verification/i,
];

export function buildEmailSignupCallbackUrl(siteUrl: string, redirectTo: string): string {
  const base = siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
  const url = new URL("/auth/callback", base);
  url.searchParams.set("redirect", sanitizeRedirectPath(redirectTo));
  url.searchParams.set("mode", "signup");
  return url.toString();
}

export function buildAuthRetryHref(mode: string | null | undefined, redirect: string | null | undefined): string {
  const basePath = mode === "signup" ? "/auth/signup" : "/auth/login";
  const safeRedirect = sanitizeRedirectPath(redirect ?? null);
  if (safeRedirect === "/app") {
    return basePath;
  }
  return `${basePath}?redirect=${encodeURIComponent(safeRedirect)}`;
}

export function shouldResumeSignupRegistration(input: {
  initialError?: string | null;
  hasStoredAgeGateData: boolean;
}): boolean {
  if (!input.hasStoredAgeGateData) return false;
  const initialError = input.initialError ?? "";
  if (initialError === "") return true;
  return !AGE_GATE_RESET_ERROR_PATTERNS.some((pattern) => pattern.test(initialError));
}
