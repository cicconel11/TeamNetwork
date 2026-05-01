/**
 * Filters expected connectivity noise so Sentry stays actionable (offline / no route).
 */

const NETWORK_UNREACHABLE_MESSAGE_RE = /network\s+(?:is\s+)?unreachable/i;

export function shouldIgnoreSentryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const ctorName = error.constructor?.name ?? "";
  const msg = typeof error.message === "string" ? error.message : "";
  if (ctorName === "NetworkUnreachableError") return true;
  if (NETWORK_UNREACHABLE_MESSAGE_RE.test(msg)) return true;
  return false;
}

/** Narrow shape for Sentry ErrorEvent.exception without importing heavy SDK types */
interface SentryExceptionLike {
  exception?: {
    values?: Array<{ type?: string; value?: string } | null | undefined>;
  };
}

export function shouldIgnoreSentryEvent(event: SentryExceptionLike): boolean {
  const values = event.exception?.values;
  if (!values?.length) return false;
  for (const exc of values) {
    if (!exc) continue;
    const type = exc.type ?? "";
    const value = exc.value ?? "";
    if (type === "NetworkUnreachableError") return true;
    if (NETWORK_UNREACHABLE_MESSAGE_RE.test(value)) return true;
  }
  return false;
}
