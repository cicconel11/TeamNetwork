const SESSION_ID_KEY = "tn_session_id";

/**
 * Get or create a stable anonymous session ID.
 * Used for error correlation across requests.
 *
 * Client-side only - returns null on server.
 */
export function getSessionId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    let sessionId = sessionStorage.getItem(SESSION_ID_KEY);

    if (!sessionId) {
      sessionId = generateSessionId();
      sessionStorage.setItem(SESSION_ID_KEY, sessionId);
    }

    return sessionId;
  } catch {
    // sessionStorage may be disabled (private browsing, etc.)
    return null;
  }
}

/**
 * Generate a new session ID.
 * Format: sess_<random>_<timestamp>
 */
function generateSessionId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  const timestamp = Date.now().toString(36);
  return `sess_${random}_${timestamp}`;
}
