/**
 * Sentry error tracking wrapper
 */

import * as Sentry from "@sentry/react-native";

let initialized = false;
let telemetryEnabled = false;

/** Next.js API routes return `{ error: "Unauthorized" }` for 401 — noisy when the mobile session is stale. */
export function isBenignWebApiUnauthorizedSentryEvent(event: {
  exception?: { values?: { value?: string | undefined; type?: string | undefined }[] };
}): boolean {
  const values = event.exception?.values;
  if (!values?.length) return false;
  return values.some((entry) => entry.value === "Unauthorized");
}

export function init(dsn: string): void {
  if (initialized) return;
  Sentry.init({
    dsn,
    enableAutoSessionTracking: true,
    attachStacktrace: true,
    environment: __DEV__ ? "development" : "production",
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.user) {
        delete event.user.email;
        delete event.user.username;
        delete event.user.ip_address;
      }
      if (isBenignWebApiUnauthorizedSentryEvent(event)) return null;
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
