/**
 * Sentry error tracking wrapper
 */

import * as Sentry from "@sentry/react-native";

let initialized = false;
let telemetryEnabled = false;

/**
 * Postgrest / Supabase client errors are plain objects { code, message, details, hint }.
 * Passing them to Sentry shows "Object captured as exception" with a useless title.
 */
export function toSentryError(value: unknown): { error: Error; extraFromValue?: Record<string, unknown> } {
  if (value instanceof Error) {
    return { error: value };
  }
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const message = typeof o.message === "string" ? o.message : JSON.stringify(value);
    const err = new Error(message);
    const extra: Record<string, unknown> = {};
    if (typeof o.code === "string") {
      extra.postgrest_code = o.code;
    }
    if (o.details != null) {
      extra.postgrest_details = o.details;
    }
    if (typeof o.hint === "string") {
      extra.postgrest_hint = o.hint;
    }
    return Object.keys(extra).length > 0 ? { error: err, extraFromValue: extra } : { error: err };
  }
  return { error: new Error(String(value)) };
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
  const { error: normalized, extraFromValue } = toSentryError(error);
  const extra =
    extraFromValue && context ? { ...extraFromValue, ...context } : extraFromValue ?? context;
  Sentry.captureException(normalized, extra ? { extra } : undefined);
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
