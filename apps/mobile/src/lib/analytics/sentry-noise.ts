/**
 * Filters expected client-side noise (offline / no route to host) from Sentry.
 * See REACT-NATIVE-17: NetworkUnreachableError from Supabase/fetch on iOS.
 */

export interface SentryExceptionFrameLike {
  type?: string;
  value?: string;
}

export interface SentryEventLike {
  exception?: { values?: SentryExceptionFrameLike[] };
}

export interface SentryHintLike {
  syntheticException?: unknown;
  originalException?: unknown;
}

function textFromUnknown(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name} ${value.message}`;
  }
  if (typeof value === "string") {
    return value;
  }
  return "";
}

function collectExceptionStrings(event: SentryEventLike, hint?: SentryHintLike): string {
  const parts: string[] = [];

  for (const v of event.exception?.values ?? []) {
    if (v.type) parts.push(v.type);
    if (v.value) parts.push(v.value);
  }

  parts.push(textFromUnknown(hint?.originalException));
  parts.push(textFromUnknown(hint?.syntheticException));

  return parts.join(" ").toLowerCase();
}

/**
 * Returns true when the event should be dropped (not sent to Sentry).
 */
export function shouldDropBenignNetworkNoise(event: SentryEventLike, hint?: SentryHintLike): boolean {
  const blob = collectExceptionStrings(event, hint);
  if (!blob) return false;

  if (blob.includes("networkunreachableerror") || blob.includes("network unreachable")) {
    return true;
  }

  // RN / fetch offline paths (often surfaced from Supabase or other HTTP clients)
  if (blob.includes("failed to fetch") || blob.includes("load failed") || blob.includes("network request failed")) {
    return true;
  }

  if (blob.includes("err_network_changed") || blob.includes("err_internet_disconnected")) {
    return true;
  }

  return false;
}

export function isBenignNetworkFailure(error: unknown): boolean {
  const t = textFromUnknown(error).toLowerCase();
  if (!t) return false;
  if (t.includes("networkunreachableerror") || t.includes("network unreachable")) return true;
  if (t.includes("failed to fetch") || t.includes("load failed") || t.includes("network request failed")) {
    return true;
  }
  if (t.includes("err_network_changed") || t.includes("err_internet_disconnected")) return true;
  return false;
}
