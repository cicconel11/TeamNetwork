import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import {
  buildMobileOAuthUrl,
  parseMobileAuthCallbackUrl,
  type MobileAgeBracket,
  type MobileAuthMode,
  type MobileOAuthProvider,
} from "@/lib/auth-redirects";
import { consumeMobileAuthHandoff } from "@/lib/mobile-auth";
import { getWebAppUrl } from "@/lib/web-api";
import { captureException, captureMessage, track } from "@/lib/analytics";

export type MobileOAuthResult =
  | { ok: true }
  | { ok: false; canceled?: boolean; error?: string };

type SignupContext = {
  ageBracket: Exclude<MobileAgeBracket, "under_13">;
  isMinor: boolean;
  ageToken: string;
};

/**
 * Drives the mobile OAuth → web handoff → session flow for Google / LinkedIn /
 * Microsoft.
 *
 * The web app (`/auth/mobile/[provider]`) initiates OAuth and redirects back to
 * `teammeet://callback?handoff_code=…`; we exchange that code for a session via
 * {@link consumeMobileAuthHandoff}, which sets the Supabase session and lets the
 * root layout route the user into the app.
 *
 * Failures are RETURNED (never thrown) and logged to Sentry + device console so
 * the caller can surface them — previously they were swallowed, silently
 * dropping the user back on the landing screen with no feedback.
 */
export async function runMobileOAuth(
  provider: MobileOAuthProvider,
  source: string,
  options: { mode: MobileAuthMode; signup?: SignupContext }
): Promise<MobileOAuthResult> {
  const redirectUri = makeRedirectUri({ scheme: "teammeet", path: "callback" });
  const authUrl = buildMobileOAuthUrl(provider, getWebAppUrl(), {
    mode: options.mode,
    ...(options.signup
      ? {
          ageBracket: options.signup.ageBracket,
          isMinor: options.signup.isMinor,
          ageToken: options.signup.ageToken,
        }
      : {}),
  });

  let result: Awaited<ReturnType<typeof WebBrowser.openAuthSessionAsync>>;
  try {
    result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
  } catch (error) {
    captureException(error as Error, { context: "runMobileOAuth.open", provider, source });
    return { ok: false, error: "Could not start sign-in. Please try again." };
  }

  const hasUrl = result.type === "success" && !!result.url;
  // Breadcrumb so a failed sign-in is debuggable from Sentry / device logs.
  const diag = `provider=${provider} mode=${options.mode} type=${result.type} hasUrl=${hasUrl}`;
  console.log(`[mobile-oauth] ${diag}`);
  captureMessage(`[mobile-oauth] ${diag}`, "info");

  // User dismissed the sheet, or iOS delivered the callback to the app as a deep
  // link instead of returning it here — the global deep-link listener in
  // _layout handles that case, so there's nothing to do.
  if (result.type === "cancel" || result.type === "dismiss") {
    return { ok: false, canceled: true };
  }

  if (result.type !== "success" || !result.url) {
    captureException(new Error(`Mobile OAuth returned no callback URL (${diag})`), {
      context: "runMobileOAuth",
      provider,
      source,
    });
    return { ok: false, error: "Sign-in didn't complete. Please try again." };
  }

  const callback = parseMobileAuthCallbackUrl(result.url);
  if (callback.type === "error") {
    captureException(new Error(`Mobile OAuth callback error: ${callback.message}`), {
      context: "runMobileOAuth",
      provider,
      source,
    });
    return { ok: false, error: callback.message };
  }
  if (callback.type !== "handoff") {
    captureException(new Error(`Mobile OAuth unrecognized callback (${diag})`), {
      context: "runMobileOAuth",
      provider,
      source,
    });
    return { ok: false, error: "Sign-in didn't complete. Please try again." };
  }

  try {
    await consumeMobileAuthHandoff(callback.code);
  } catch (error) {
    captureException(error as Error, { context: "runMobileOAuth.consume", provider, source });
    return { ok: false, error: (error as Error).message || "Could not complete sign in." };
  }

  track("user_logged_in", { method: provider, source });
  return { ok: true };
}
