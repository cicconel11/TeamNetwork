import { runMobileOAuth, type MobileOAuthResult } from "@/lib/mobile-oauth-flow";

/**
 * Landing-screen "Continue with Google". Delegates to the shared mobile OAuth
 * flow, which handles the web handoff, session exchange, error reporting, and
 * instrumentation. Returns the result so the caller can surface failures.
 */
export async function startGoogleSignIn(source: string = "unknown"): Promise<MobileOAuthResult> {
  return runMobileOAuth("google", source, { mode: "login" });
}
