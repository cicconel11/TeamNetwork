/**
 * Identifies Sentry error events that represent normal client-side transport
 * failures (offline, airplane mode, flaky cell). These should not pollute
 * production error dashboards.
 */
export type SentryExceptionEventSlice = {
  exception?: { values?: Array<{ type?: string; value?: string }> };
};

export function shouldDropBenignClientTransportEvent(
  event: SentryExceptionEventSlice
): boolean {
  const values = event.exception?.values;
  if (!values) return false;

  for (const ex of values) {
    const type = ex.type ?? "";
    const value = (ex.value ?? "").toLowerCase();

    if (type === "NetworkUnreachableError") {
      return true;
    }

    if (type === "TypeError") {
      if (
        value.includes("network request failed") ||
        value.includes("failed to fetch") ||
        value.includes("network unreachable")
      ) {
        return true;
      }
    }

    if (type === "Error") {
      if (
        value.includes("network request failed") ||
        value.includes("failed to fetch") ||
        value === "network unreachable" ||
        value.includes("the internet connection appears to be offline") ||
        value.includes("the network connection was lost")
      ) {
        return true;
      }
    }
  }

  return false;
}
