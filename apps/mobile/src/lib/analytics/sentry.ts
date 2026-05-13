/**
 * Sentry error tracking wrapper
 */

import * as Sentry from "@sentry/react-native";

let initialized = false;
let telemetryEnabled = false;

// Transient connectivity failures are not actionable bugs. Drop them at
// every entry point: the explicit captureException wrapper, the Sentry
// SDK's auto-instrumentation, and the beforeSend safety net.
function isTransientNetworkError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as { name?: string }).name ?? "";
  if (name === "NetworkUnreachableError" || name === "AbortError") return true;
  const message =
    typeof error === "string"
      ? error
      : ((error as { message?: string }).message ?? "");
  return /network request failed|failed to fetch|the network connection was lost|the internet connection appears to be offline/i.test(
    message,
  );
}

export function init(dsn: string): void {
  if (initialized) return;
  Sentry.init({
    dsn,
    enableAutoSessionTracking: true,
    attachStacktrace: true,
    environment: __DEV__ ? "development" : "production",
    sendDefaultPii: false,
    ignoreErrors: [
      "NetworkUnreachableError",
      /Network request failed/i,
      /Failed to fetch/i,
      /The network connection was lost/i,
      /The Internet connection appears to be offline/i,
    ],
    beforeSend(event, hint) {
      if (isTransientNetworkError(hint?.originalException)) return null;
      if (event.user) {
        delete event.user.email;
        delete event.user.username;
        delete event.user.ip_address;
      }
      return event;
    },
  });
  initialized = true;
}

export function setEnabled(value: boolean): void {
  telemetryEnabled = value;
  if (!value) {
    Sentry.setUser(null);
  }
}

export function setUser(user: { id: string } | null): void {
  if (!initialized) return;
  if (!telemetryEnabled && user !== null) return;
  Sentry.setUser(user);
}

export function captureException(
  error: Error,
  context?: Record<string, unknown>
): void {
  if (!initialized || !telemetryEnabled) return;
  if (isTransientNetworkError(error)) return;
  Sentry.captureException(error, { extra: context });
}

export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = "info"
): void {
  if (!initialized || !telemetryEnabled) return;
  Sentry.captureMessage(message, level);
}

export function isInitialized(): boolean {
  return initialized;
}
