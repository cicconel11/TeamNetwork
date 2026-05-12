const NETWORK_FAILURE_MESSAGE_RE =
  /network request failed|failed to fetch|network unreachable/i;

/**
 * Connectivity-layer failures (offline, captive portal, DNS blips) that we
 * surface in-app but should not treat as product bugs in Sentry.
 */
export function isExpectedClientNetworkFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const { name, message } = error as Error;
  if (name === "NetworkUnreachableError") {
    return true;
  }
  return typeof message === "string" && message.length > 0 && NETWORK_FAILURE_MESSAGE_RE.test(message);
}
