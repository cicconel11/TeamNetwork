/**
 * Sentry error tracking wrapper
 */

import * as Sentry from "@sentry/react-native";
import * as Application from "expo-application";

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

const PII_KEYS = new Set([
  "email",
  "userEmail",
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "apiKey",
  "secret",
  "phone",
  "phoneNumber",
  "ssn",
  "creditCard",
  "cardNumber",
  "query",
  "firstName",
  "lastName",
  "name",
]);

function scrubPii(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (PII_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

export function init(dsn: string): void {
  if (initialized) return;
  // Tag events with the app version + build so errors are attributable to a
  // release and Release Health (crash-free sessions/users) works. Native build
  // number doubles as the Sentry `dist`, matching the source maps uploaded by
  // the @sentry/react-native/expo build plugin. Values are read synchronously
  // from the native app metadata (null in Expo Go / bare JS contexts).
  const version = Application.nativeApplicationVersion;
  const build = Application.nativeBuildVersion;
  Sentry.init({
    dsn,
    release:
      version && Application.applicationId
        ? `${Application.applicationId}@${version}+${build ?? "0"}`
        : undefined,
    dist: build ?? undefined,
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
      if (event.extra) event.extra = scrubPii(event.extra);
      if (event.tags) event.tags = scrubPii(event.tags) as typeof event.tags;
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((bc) =>
          bc.data ? { ...bc, data: scrubPii(bc.data) } : bc,
        );
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
