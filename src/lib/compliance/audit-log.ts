import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import type { AgeBracket } from "@/lib/schemas/age-gate";

export type AgeGateEventType =
  | "age_gate_passed"
  | "age_gate_redirected"
  | "age_gate_invalid";

/**
 * Hash IP address using SHA-256 for privacy-preserving rate limiting.
 * Uses a salt to prevent rainbow table attacks.
 */
export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT || "team-network-coppa";
  return createHash("sha256")
    .update(`${salt}:${ip}`)
    .digest("hex");
}

/**
 * Extract client IP from request headers.
 * Checks various headers in order of reliability.
 */
export function getClientIp(request: Request): string | null {
  const headers = request.headers;

  // Cloudflare
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  // Vercel/standard proxy
  const xForwardedFor = headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const first = xForwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  // True-Client-IP (some CDNs)
  const trueClientIp = headers.get("true-client-ip");
  if (trueClientIp) return trueClientIp.trim();

  // x-real-ip (nginx)
  const xRealIp = headers.get("x-real-ip");
  if (xRealIp) return xRealIp.trim();

  return null;
}

/**
 * Log an age gate event to the compliance audit log.
 *
 * IMPORTANT: Never log DOB values - only derived age_bracket.
 *
 * Fails gracefully - logging errors should not block legitimate signups.
 */
export async function logAgeGateEvent(params: {
  eventType: AgeGateEventType;
  ageBracket: AgeBracket | null;
  clientIp: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const { eventType, ageBracket, clientIp } = params;

  try {
    const serviceClient = createServiceClient();

    const { error } = await serviceClient
      .from("compliance_audit_log")
      .insert({
        event_type: eventType,
        age_bracket: ageBracket,
        ip_hash: clientIp ? hashIp(clientIp) : null,
      });

    if (error) {
      console.error("[compliance/audit] Failed to log event:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    // Fail gracefully - don't block signups on logging errors
    console.error("[compliance/audit] Exception during logging:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
