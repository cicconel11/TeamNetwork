/**
 * Sentry error tracking wrapper
 */

import * as Sentry from "@sentry/react-native";

let initialized = false;
let telemetryEnabled = false;

/**
 * Coerce unknown thrown values (e.g. Supabase AuthApiError-shaped plain objects)
 * into a real Error so Sentry records a proper exception instead of
 * "Object captured as exception with keys: ...".
 */
export function normalizeUnknownToError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (error === null || error === undefined) {
    return new Error("Unknown error");
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  if (typeof error === "object") {
    const o = error as Record<string, unknown>;
    const message =
      typeof o.message === "string" && o.message.length > 0 ? o.message : JSON.stringify(error);
    const err = new Error(message);
    if (typeof o.code === "string" && o.code.length > 0) {
      err.name = `Error(${o.code})`;
    }
    return err;
  }
  return new Error(String(error));
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
  error: unknown,
  context?: Record<string, unknown>
): void {
  if (!initialized || !telemetryEnabled) return;
  Sentry.captureException(normalizeUnknownToError(error), { extra: context });
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
