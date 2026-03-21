import type { BlackbaudClient } from "./client";

export interface HealthResult {
  ok: boolean;
  reason?: "unauthorized" | "forbidden" | "api_error" | "network_error";
  status?: number;
  error?: string;
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
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("(401)")) {
      return { ok: false, reason: "unauthorized", status: 401, error: message };
    }
    if (message.includes("(403)")) {
      return { ok: false, reason: "forbidden", status: 403, error: message };
    }

    const statusMatch = message.match(/\((\d{3})\)/);
    if (statusMatch) {
      return {
        ok: false,
        reason: "api_error",
        status: Number(statusMatch[1]),
        error: message,
      };
    }

    return { ok: false, reason: "network_error", error: message };
  }
}

export function formatBlackbaudHealthError(result: HealthResult): string {
  return `Blackbaud health check failed: ${result.reason}${result.error ? ` — ${result.error}` : ""}`;
}
