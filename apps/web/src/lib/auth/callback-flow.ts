import { isValidAgeBracket, verifyAgeValidationToken, type AgeValidationResult } from "@/lib/auth/age-validation";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";

type CallbackUser = {
  id: string;
  created_at?: string;
  user_metadata?: Record<string, unknown> | null;
};

type PersistedAgeMetadata = {
  age_bracket: "13_17" | "18_plus";
  is_minor: boolean;
  age_validation_token: string;
};

type AgeGateOutcome =
  | { kind: "allow" }
  | { kind: "redirect"; location: string };

interface RunAgeValidationGateArgs {
  requestUrl: URL;
  siteUrl: string;
  requestedRedirect?: string | null;
  user: CallbackUser;
  persistAgeMetadata?: (metadata: PersistedAgeMetadata) => Promise<void>;
  cleanupUnvalidatedSignup?: () => Promise<void>;
}

const MSG_AGE_REQUIRED = "Age verification required. Please complete the signup process.";
const MSG_AGE_EXPIRED = "Age verification expired. Please try again.";
const MSG_AGE_PERSIST_FAILED = "We couldn't complete age verification. Please try again.";
const MSG_INVALID_AGE_DATA = "Invalid age data";

function buildAuthRedirect(
  siteUrl: string,
  path: string,
  params: Record<string, string | null | undefined>,
  requestedRedirect: string | null | undefined
): string {
  const url = new URL(path, siteUrl);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  const safeRedirect = sanitizeRedirectPath(requestedRedirect ?? null);
  if (requestedRedirect && safeRedirect !== "/app") {
    url.searchParams.set("redirect", safeRedirect);
  }
  return url.toString();
}

export function buildSignupRedirect(siteUrl: string, message: string, requestedRedirect: string | null | undefined): string {
  return buildAuthRedirect(siteUrl, "/auth/signup", { error: message }, requestedRedirect);
}

export function buildErrorRedirect(
  siteUrl: string,
  message: string,
  requestedRedirect: string | null | undefined,
  mode: string | null | undefined
): string {
  return buildAuthRedirect(siteUrl, "/auth/error", { message, mode }, requestedRedirect);
}

function isNewUserWithoutAgeData(user: CallbackUser): boolean {
  if (!user.created_at) {
    return false;
  }

  return (Date.now() - new Date(user.created_at).getTime()) < 60000;
}

function shouldEnforceSignupAgeGate(mode: string | null, hasAgeQueryParams: boolean): boolean {
  if (hasAgeQueryParams) {
    return true;
  }

  return mode === "signup";
}

function getValidatedOAuthAgeMetadata(
  oauthAgeBracket: string,
  tokenResult: AgeValidationResult,
  oauthAgeToken: string
): PersistedAgeMetadata {
  return {
    age_bracket: oauthAgeBracket as PersistedAgeMetadata["age_bracket"],
    is_minor: tokenResult.isMinor ?? (oauthAgeBracket !== "18_plus"),
    age_validation_token: oauthAgeToken,
  };
}

export async function runAgeValidationGate(args: RunAgeValidationGateArgs): Promise<AgeGateOutcome> {
  const requestedRedirect = args.requestedRedirect ?? args.requestUrl.searchParams.get("redirect");
  const mode = args.requestUrl.searchParams.get("mode");

  const userMeta = args.user.user_metadata ?? {};
  const ageBracket = userMeta.age_bracket;
  const oauthAgeBracket = args.requestUrl.searchParams.get("age_bracket");
  const oauthAgeToken = args.requestUrl.searchParams.get("age_token");
  const hasAgeQueryParams = Boolean(oauthAgeBracket || oauthAgeToken);

  if (typeof ageBracket === "string" && ageBracket.length > 0) {
    if (!isValidAgeBracket(ageBracket)) {
      return { kind: "redirect", location: buildErrorRedirect(args.siteUrl, MSG_INVALID_AGE_DATA, requestedRedirect, mode) };
    }

    if (ageBracket === "under_13") {
      return { kind: "redirect", location: `${args.siteUrl}/auth/parental-consent` };
    }

    return { kind: "allow" };
  }

  if (hasAgeQueryParams) {
    if (!oauthAgeBracket) {
      return {
        kind: "redirect",
        location: buildSignupRedirect(args.siteUrl, MSG_AGE_REQUIRED, requestedRedirect),
      };
    }

    if (!isValidAgeBracket(oauthAgeBracket)) {
      return { kind: "redirect", location: buildErrorRedirect(args.siteUrl, MSG_INVALID_AGE_DATA, requestedRedirect, mode) };
    }

    if (oauthAgeBracket === "under_13") {
      return { kind: "redirect", location: `${args.siteUrl}/auth/parental-consent` };
    }

    if (!oauthAgeToken) {
      return {
        kind: "redirect",
        location: buildSignupRedirect(args.siteUrl, MSG_AGE_REQUIRED, requestedRedirect),
      };
    }

    const tokenResult = verifyAgeValidationToken(oauthAgeToken);
    if (!tokenResult.valid) {
      return {
        kind: "redirect",
        location: buildSignupRedirect(args.siteUrl, MSG_AGE_EXPIRED, requestedRedirect),
      };
    }

    if (tokenResult.ageBracket !== oauthAgeBracket) {
      return { kind: "redirect", location: buildErrorRedirect(args.siteUrl, MSG_INVALID_AGE_DATA, requestedRedirect, mode) };
    }

    if (args.persistAgeMetadata) {
      try {
        await args.persistAgeMetadata(getValidatedOAuthAgeMetadata(oauthAgeBracket, tokenResult, oauthAgeToken));
      } catch {
        if (args.cleanupUnvalidatedSignup) {
          await args.cleanupUnvalidatedSignup();
        }

        return {
          kind: "redirect",
          location: buildSignupRedirect(args.siteUrl, MSG_AGE_PERSIST_FAILED, requestedRedirect),
        };
      }
    }

    return { kind: "allow" };
  }

  if (isNewUserWithoutAgeData(args.user) && shouldEnforceSignupAgeGate(mode, hasAgeQueryParams)) {
    return {
      kind: "redirect",
      location: buildSignupRedirect(args.siteUrl, MSG_AGE_REQUIRED, requestedRedirect),
    };
  }

  return { kind: "allow" };
}
