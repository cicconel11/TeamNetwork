/**
 * Shared surfacing for mobile auth handoff failures.
 *
 * Classification lives in `consumeMobileAuthHandoff` (the only place that sees
 * the HTTP status). Surfacing — Sentry capture + user-visible toast + optional
 * retry affordance — lives here so BOTH consume paths (the WebBrowser promise in
 * `mobile-oauth-flow.ts` and the OS-listener fallback in `deep-link.ts`) behave
 * identically. Before this helper the OS-listener path only captured to Sentry
 * and failed silently for the user.
 */

import { captureException } from "@/lib/analytics";
import { showToast } from "@/components/ui/Toast";
import { MobileAuthError, type MobileAuthErrorStatus } from "@/lib/mobile-auth";

const GENERIC_MESSAGE = "Could not complete sign in. Please try again.";

// Retryable classes: "restart sign-in from login". We never re-POST the
// single-use handoff code (a reused code returns 400/expired), so retry means
// navigating back to the login screen, not re-driving the failed request.
const RETRYABLE_STATUSES: ReadonlySet<MobileAuthErrorStatus> = new Set([
  "server",
  "network",
]);

const LOGIN_ROUTE = "/(auth)/login";

/**
 * Capture a failed handoff consume to Sentry and surface a distinguishable
 * toast to the user. For retryable failures (server/network), attaches a
 * "Try again" action that restarts sign-in via `navigate` when provided.
 *
 * @param error   The thrown error (ideally a `MobileAuthError`).
 * @param context Sentry breadcrumb context. A string is normalized to
 *   `{ context }`; pass an object to attach extra diagnostics (e.g. sanitized
 *   URL fields) without a `context` key being lost.
 * @param navigate Optional navigation callback used by the retry action. When
 *   omitted (no navigator in scope), the toast is shown without a retry button.
 */
export function surfaceMobileAuthError(
  error: unknown,
  context: string | Record<string, unknown>,
  navigate?: (route: string) => void
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const captureContext =
    typeof context === "string" ? { context } : context;
  captureException(err, captureContext);

  const status = error instanceof MobileAuthError ? error.status : undefined;
  const message =
    error instanceof MobileAuthError ? error.message : GENERIC_MESSAGE;

  const showRetry = navigate && status && RETRYABLE_STATUSES.has(status);
  if (showRetry) {
    showToast(message, "error", {
      label: "Try again",
      onPress: () => navigate(LOGIN_ROUTE),
    });
    return;
  }

  showToast(message, "error");
}
