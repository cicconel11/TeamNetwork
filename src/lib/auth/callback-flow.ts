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

function getSanitizedRedirect(requestedRedirect: string | null | undefined): string {
  return sanitizeRedirectPath(requestedRedirect ?? null);
}

export function buildSignupRedirect(siteUrl: string, message: string, requestedRedirect: string | null | undefined): string {
  const signupUrl = new URL("/auth/signup", siteUrl);
  signupUrl.searchParams.set("error", message);

  const safeRedirect = getSanitizedRedirect(requestedRedirect);
  if (requestedRedirect && safeRedirect !== "/app") {
    signupUrl.searchParams.set("redirect", safeRedirect);
  }

  return signupUrl.toString();
}

export function buildErrorRedirect(
  siteUrl: string,
  message: string,
  requestedRedirect: string | null | undefined,
  mode: string | null | undefined
): string {
  const url = new URL("/auth/error", siteUrl);
  url.searchParams.set("message", message);

  const safeRedirect = getSanitizedRedirect(requestedRedirect);
  if (requestedRedirect && safeRedirect !== "/app") {
    url.searchParams.set("redirect", safeRedirect);
  }

  if (mode) {
    url.searchParams.set("mode", mode);
  }

  return url.toString();
}

function isNewUserWithoutAgeData(user: CallbackUser): boolean {
  if (!user.created_at) {
    return false;
  }

  return (Date.now() - new Date(user.created_at).getTime()) < 60000;
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
      return { kind: "redirect", location: buildErrorRedirect(args.siteUrl, "Invalid age data", requestedRedirect, mode) };
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
        location: buildSignupRedirect(
          args.siteUrl,
          "Age verification required. Please complete the signup process.",
          requestedRedirect
        ),
      };
    }

    if (!isValidAgeBracket(oauthAgeBracket)) {
      return { kind: "redirect", location: buildErrorRedirect(args.siteUrl, "Invalid age data", requestedRedirect, mode) };
    }

    if (oauthAgeBracket === "under_13") {
      return { kind: "redirect", location: `${args.siteUrl}/auth/parental-consent` };
    }

    if (!oauthAgeToken) {
      return {
        kind: "redirect",
        location: buildSignupRedirect(
          args.siteUrl,
          "Age verification required. Please complete the signup process.",
          requestedRedirect
        ),
      };
    }

    const tokenResult = verifyAgeValidationToken(oauthAgeToken);
    if (!tokenResult.valid) {
      return {
        kind: "redirect",
        location: buildSignupRedirect(args.siteUrl, "Age verification expired. Please try again.", requestedRedirect),
      };
    }

    if (tokenResult.ageBracket !== oauthAgeBracket) {
      return { kind: "redirect", location: buildErrorRedirect(args.siteUrl, "Invalid age data", requestedRedirect, mode) };
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
          location: buildSignupRedirect(
            args.siteUrl,
            "We couldn't complete age verification. Please try again.",
            requestedRedirect
          ),
        };
      }
    }

    return { kind: "allow" };
  }

  if (isNewUserWithoutAgeData(args.user)) {
    return {
      kind: "redirect",
      location: buildSignupRedirect(
        args.siteUrl,
        "Age verification required. Please complete the signup process.",
        requestedRedirect
      ),
    };
  }

  return { kind: "allow" };
}
