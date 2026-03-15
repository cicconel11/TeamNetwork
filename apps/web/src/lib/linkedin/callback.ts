import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  exchangeLinkedInCode,
  recordLinkedInSyncWarning,
  storeLinkedInConnection,
  syncLinkedInProfileFields,
  getLinkedInOAuthErrorMessage,
} from "@/lib/linkedin/oauth";
import {
  LINKEDIN_STATE_COOKIE,
  getLinkedInOAuthStateClearCookie,
  validateLinkedInOAuthState,
} from "@/lib/linkedin/state";
import { getAppUrl } from "@/lib/url";

function withClearedStateCookie(response: NextResponse) {
  const clearCookie = getLinkedInOAuthStateClearCookie();
  response.cookies.set(clearCookie.name, clearCookie.value, clearCookie.options);
  return response;
}

function buildSettingsUrl(redirectPath: string): string {
  return `${getAppUrl()}${redirectPath}`;
}

function buildSuccessRedirect(
  redirectPath: string,
  params: Record<string, string> = {},
) {
  const successUrl = new URL(buildSettingsUrl(redirectPath));
  successUrl.searchParams.set("linkedin", "connected");
  for (const [key, value] of Object.entries(params)) {
    successUrl.searchParams.set(key, value);
  }
  return withClearedStateCookie(NextResponse.redirect(successUrl));
}

function buildErrorRedirect(
  redirectPath: string,
  code: string,
  message: string,
) {
  const errorUrl = new URL(buildSettingsUrl(redirectPath));
  errorUrl.searchParams.set("error", code);
  errorUrl.searchParams.set("error_message", message);
  return withClearedStateCookie(NextResponse.redirect(errorUrl));
}

export async function handleLinkedInOAuthCallback(
  request: Request,
  defaultRedirectPath: string,
) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateFromQuery = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const cookieStore = await cookies();
  const stateFromCookie = cookieStore.get(LINKEDIN_STATE_COOKIE)?.value ?? null;
  const initialState = validateLinkedInOAuthState({
    stateFromQuery,
    stateFromCookie,
    defaultRedirectPath,
  });
  const redirectPath = initialState.redirectPath;

  if (error) {
    console.error("[linkedin-callback] OAuth error from LinkedIn:", error);
    return buildErrorRedirect(
      redirectPath,
      error,
      getLinkedInOAuthErrorMessage(error),
    );
  }

  if (!code) {
    console.error("[linkedin-callback] Missing authorization code");
    return buildErrorRedirect(
      redirectPath,
      "missing_code",
      "Authorization code was not provided. Please try again.",
    );
  }

  if (!initialState.ok) {
    console.error("[linkedin-callback] Invalid state:", initialState.error);
    const errorMessage =
      initialState.error === "state_expired"
        ? "The authorization request has expired. Please try again."
        : initialState.error === "state_mismatch"
          ? "Session mismatch. Please try connecting again."
          : "Invalid request. Please try connecting again.";

    return buildErrorRedirect(redirectPath, initialState.error, errorMessage);
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error("[linkedin-callback] User not authenticated");
      return withClearedStateCookie(
        NextResponse.redirect(
          new URL(
            `/auth/login?error=unauthorized&next=${encodeURIComponent(redirectPath)}`,
            getAppUrl(),
          ),
        ),
      );
    }

    const validatedState = validateLinkedInOAuthState({
      stateFromQuery,
      stateFromCookie,
      defaultRedirectPath,
      currentUserId: user.id,
    });

    if (!validatedState.ok) {
      console.error("[linkedin-callback] State verification failed:", validatedState.error);
      const errorMessage =
        validatedState.error === "state_expired"
          ? "The authorization request has expired. Please try again."
          : "Session mismatch. Please try connecting again.";
      return buildErrorRedirect(
        validatedState.redirectPath,
        validatedState.error,
        errorMessage,
      );
    }

    const tokens = await exchangeLinkedInCode(code);
    const serviceClient = createServiceClient();
    const result = await storeLinkedInConnection(serviceClient, user.id, tokens);

    if (!result.success) {
      console.error("[linkedin-callback] Failed to store connection:", result.error);
      return buildErrorRedirect(
        validatedState.redirectPath,
        "storage_failed",
        "Failed to save your LinkedIn connection. Please try again.",
      );
    }

    const syncResult = await syncLinkedInProfileFields(serviceClient, user.id, tokens.profile);

    if (!syncResult.success) {
      console.error("[linkedin-callback] Failed to sync org profile fields:", syncResult.error);
      const warningMessage =
        "Your LinkedIn account was connected, but we could not sync your organization profile yet. You can try syncing again from Settings.";
      const warningPersisted = await recordLinkedInSyncWarning(
        serviceClient,
        user.id,
        syncResult.error || "Failed to sync your LinkedIn profile to your organization profile.",
      );
      if (!warningPersisted) {
        console.error("[linkedin-callback] Failed to persist LinkedIn sync warning");
      }
      return buildSuccessRedirect(validatedState.redirectPath, {
        warning: "profile_sync_failed",
        warning_message: warningMessage,
      });
    }

    return buildSuccessRedirect(validatedState.redirectPath);
  } catch (err) {
    console.error("[linkedin-callback] Error processing callback:", err);

    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    const safePatterns = [
      "No access token received",
      "Failed to exchange LinkedIn authorization code",
      "Failed to fetch LinkedIn profile",
    ];
    const configPatterns = [
      "Missing required environment variable",
      "ENCRYPTION_KEY",
      "must be 64 hex",
      "LINKEDIN_CLIENT",
      "LINKEDIN_REDIRECT",
    ];

    const isSafe = safePatterns.some((pattern) => errorMessage.includes(pattern));
    const isConfig = configPatterns.some((pattern) => errorMessage.includes(pattern));

    if (isSafe) {
      return buildErrorRedirect(redirectPath, "callback_failed", errorMessage);
    }

    if (isConfig) {
      console.error("[linkedin-callback] Server config error:", errorMessage);
      return buildErrorRedirect(
        redirectPath,
        "server_config_error",
        "There is a server configuration issue. Please contact support.",
      );
    }

    console.error("[linkedin-callback] Unclassified error:", errorMessage);
    return buildErrorRedirect(
      redirectPath,
      "callback_failed",
      "An unexpected error occurred while connecting your LinkedIn account. Please try again later.",
    );
  }
}
