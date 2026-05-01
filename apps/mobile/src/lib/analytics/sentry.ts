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

/** Fields commonly present on Supabase PostgREST / API error objects (plain objects, not Error). */
const EXTRA_FROM_OBJECT_KEYS = ["code", "details", "hint", "status"] as const;

function pickExtraFromUnknownError(error: unknown): Record<string, unknown> | undefined {
  if (error === null || typeof error !== "object" || error instanceof Error || Array.isArray(error)) {
    return undefined;
  }
  const o = error as Record<string, unknown>;
  const extra: Record<string, unknown> = {};
  for (const key of EXTRA_FROM_OBJECT_KEYS) {
    if (key in o) {
      extra[key] = o[key];
    }
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
}

/**
 * Ensure Sentry always receives an Error (avoids "Object captured as exception" for Supabase rejects).
 */
export function normalizeCaptureError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  if (error !== null && typeof error === "object") {
    const o = error as Record<string, unknown>;
    const msg = o.message;
    if (typeof msg === "string" && msg.length > 0) {
      return new Error(msg);
    }
    try {
      return new Error(JSON.stringify(error));
    } catch {
      return new Error(Object.prototype.toString.call(error));
    }
  }
  return new Error(String(error));
}

export function captureException(
  error: unknown,
  context?: Record<string, unknown>
): void {
  if (!initialized || !telemetryEnabled) return;
  const normalized = normalizeCaptureError(error);
  const fromObject = pickExtraFromUnknownError(error);
  const extra =
    fromObject === undefined
      ? context
      : context === undefined
        ? fromObject
        : { ...fromObject, ...context };
  Sentry.captureException(normalized, extra === undefined ? undefined : { extra });
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
