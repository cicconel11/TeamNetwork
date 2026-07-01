function normalizeOrigin(siteUrl: string): string {
  return siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
}

export type MobileAuthMode = "login" | "signup";
export type MobileAgeBracket = "under_13" | "13_17" | "18_plus";
export type MobileOAuthProvider = "google" | "linkedin" | "microsoft";

export function buildMobileRecoveryRedirectTo(
  siteUrl: string,
  innerRedirect = "/auth/login"
): string {
  const base = normalizeOrigin(siteUrl);
  const resetPage = `/auth/reset-password?redirect=${encodeURIComponent(innerRedirect)}`;
  return `${base}/auth/callback?redirect=${encodeURIComponent(resetPage)}`;
}

export function buildMobileEmailSignupCallbackUrl(siteUrl: string): string {
  const url = new URL("/auth/callback", normalizeOrigin(siteUrl));
  url.searchParams.set("mobile", "1");
  url.searchParams.set("mode", "signup");
  url.searchParams.set("redirect", "/app");
  return url.toString();
}

export function buildMobileOAuthUrl(
  provider: MobileOAuthProvider,
  siteUrl: string,
  params: {
    mode: MobileAuthMode;
    redirect?: string;
    ageBracket?: Exclude<MobileAgeBracket, "under_13">;
    isMinor?: boolean;
    ageToken?: string;
  }
): string {
  const url = new URL(`/auth/mobile/${provider}`, normalizeOrigin(siteUrl));
  url.searchParams.set("mode", params.mode);
  url.searchParams.set("redirect", params.redirect ?? "/app");

  if (params.ageBracket) {
    url.searchParams.set("age_bracket", params.ageBracket);
  }
  if (typeof params.isMinor === "boolean") {
    url.searchParams.set("is_minor", String(params.isMinor));
  }
  if (params.ageToken) {
    url.searchParams.set("age_token", params.ageToken);
  }

  return url.toString();
}

export function buildMobileGoogleAuthUrl(
  siteUrl: string,
  params: Parameters<typeof buildMobileOAuthUrl>[2]
): string {
  return buildMobileOAuthUrl("google", siteUrl, params);
}

export type MobileAuthCallbackResult =
  | { type: "handoff"; code: string }
  | { type: "error"; error: string; message: string }
  | { type: "ignored" };

export function parseMobileAuthCallbackUrl(url: string): MobileAuthCallbackResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { type: "ignored" };
  }

  if (parsed.protocol !== "teammeet:" || parsed.hostname !== "callback") {
    return { type: "ignored" };
  }

  const error = parsed.searchParams.get("error");
  if (error) {
    return {
      type: "error",
      error,
      message: parsed.searchParams.get("error_description") || error,
    };
  }

  const handoffCode = parsed.searchParams.get("handoff_code");
  if (handoffCode) {
    return { type: "handoff", code: handoffCode };
  }

  return { type: "ignored" };
}

export function getMobileAuthCallbackErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case "access_denied":
      return "Sign-in was cancelled.";
    case "unsupported_provider":
      return "This sign-in provider is not supported in the app.";
    case "oauth_init_failed":
      return "Could not start sign-in. Please try again.";
    case "auth_callback_failed":
      return "Authentication could not be completed. Please try again.";
    case "handoff_failed":
      return "Could not complete sign-in. Please try again.";
    case "terms_acceptance_required":
      return "Please finish creating your account on the web before signing in.";
    case "parental_consent_required":
      return "Parental consent is required before this account can be used.";
    case "age_validation_failed":
      return "Please finish age verification on the web before signing in.";
    default:
      return "Sign-in didn't complete. Please try again.";
  }
}
