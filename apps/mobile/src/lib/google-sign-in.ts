import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { buildMobileOAuthUrl, parseMobileAuthCallbackUrl } from "@/lib/auth-redirects";
import { consumeMobileAuthHandoff } from "@/lib/mobile-auth";
import { getWebAppUrl } from "@/lib/web-api";
import { captureException, track } from "@/lib/analytics";

export async function startGoogleSignIn(source: string = "unknown") {
  try {
    const redirectUri = makeRedirectUri({
      scheme: "teammeet",
      path: "callback",
    });
    const authUrl = buildMobileOAuthUrl("google", getWebAppUrl(), { mode: "login" });
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

    if (result.type !== "success" || !result.url) {
      return;
    }

    const callback = parseMobileAuthCallbackUrl(result.url);
    if (callback.type === "handoff") {
      await consumeMobileAuthHandoff(callback.code);
      track("user_logged_in", { method: "google", source });
      return;
    }
    if (callback.type === "error") {
      throw new Error(callback.message);
    }
  } catch (error) {
    captureException(error as Error, { context: "startGoogleSignIn", source });
    throw error;
  }
}
