import { sanitizeRedirectPath, buildAuthLink } from "./redirect";

const AGE_GATE_RESET_ERROR_PATTERNS = [
  /age verification expired/i,
  /age verification required/i,
  /invalid age data/i,
  /complete age verification/i,
];

export function buildAuthRetryHref(mode: string | null | undefined, redirect: string | null | undefined): string {
  const basePath = mode === "signup" ? "/auth/signup" : "/auth/login";
  return buildAuthLink(basePath, sanitizeRedirectPath(redirect ?? null));
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
