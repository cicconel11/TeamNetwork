/**
 * Sentry error tracking wrapper
 */

import * as Sentry from "@sentry/react-native";

let initialized = false;

export function init(dsn: string): void {
  if (initialized) return;
  Sentry.init({
    dsn,
    enableAutoSessionTracking: true,
    attachStacktrace: true,
    environment: __DEV__ ? "development" : "production",
  });
  initialized = true;
}

export function setUser(user: { id: string; email?: string } | null): void {
  Sentry.setUser(user);
}

export function captureException(
  error: Error,
  context?: Record<string, unknown>
): void {
  Sentry.captureException(error, { extra: context });
}

export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = "info"
): void {
  Sentry.captureMessage(message, level);
}

export function isInitialized(): boolean {
  return initialized;
}
