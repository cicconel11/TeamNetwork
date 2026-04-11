import { BlackbaudApiError, type BlackbaudClient } from "./client";

export interface HealthResult {
  ok: boolean;
  reason?: "unauthorized" | "forbidden" | "quota_exhausted" | "api_error" | "network_error";
  status?: number;
  error?: string;
  retryAfterHuman?: string | null;
}

/**
 * Lightweight credential check — calls a minimal Blackbaud endpoint
 * to verify the access token and subscription key are valid.
 */
export async function checkBlackbaudHealth(
  client: BlackbaudClient
): Promise<HealthResult> {
  try {
    await client.getList("/constituent/v1/constituents", { limit: "1" });
    return { ok: true };
  } catch (err) {
    if (err instanceof BlackbaudApiError) {
      if (err.isQuotaExhausted) {
        return { ok: false, reason: "quota_exhausted", status: err.status, error: err.message, retryAfterHuman: err.retryAfterHuman };
      }
      if (err.status === 401) {
        return { ok: false, reason: "unauthorized", status: 401, error: err.message };
      }
      if (err.status === 403) {
        return { ok: false, reason: "forbidden", status: 403, error: err.message };
      }
      return { ok: false, reason: "api_error", status: err.status, error: err.message };
    }

    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "network_error", error: message };
  }
}

export function formatBlackbaudHealthError(result: HealthResult): string {
  if (result.reason === "quota_exhausted") {
    const retryPart = result.retryAfterHuman ? ` Quota resets in ${result.retryAfterHuman}.` : "";
    return `Blackbaud API quota exhausted.${retryPart}`;
  }
  return `Blackbaud health check failed: ${result.reason}${result.error ? ` — ${result.error}` : ""}`;
}
