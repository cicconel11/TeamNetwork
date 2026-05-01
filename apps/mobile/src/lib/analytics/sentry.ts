/**
 * Sentry error tracking wrapper
 */

import * as Sentry from "@sentry/react-native";

let initialized = false;
let telemetryEnabled = false;

export function init(dsn: string): void {
  if (initialized) return;
  Sentry.init({
    dsn,
    enableAutoSessionTracking: true,
    attachStacktrace: true,
    environment: __DEV__ ? "development" : "production",
    sendDefaultPii: false,
    beforeSend(event) {
      const ev = event as { message?: string; logentry?: { message?: string } };
      const message =
        typeof ev.message === "string"
          ? ev.message
          : typeof ev.logentry?.message === "string"
            ? ev.logentry.message
            : "";
      // Third-party / bridge warning (e.g. auth session surface not ready yet); not actionable as an app error.
      if (message === "auth_surface_unreachable" || message.endsWith(": auth_surface_unreachable")) {
        return null;
      }
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
