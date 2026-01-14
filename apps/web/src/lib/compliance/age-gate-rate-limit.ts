import { createServiceClient } from "@/lib/supabase/service";
import { hashIp } from "./audit-log";

const RATE_LIMIT = 5; // Max attempts
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export interface AgeGateRateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Check if IP has exceeded age gate rate limit.
 * Uses compliance_audit_log as the source of truth.
 *
 * Rate limit: 5 attempts per IP per 10 minutes
 *
 * Fails open on errors (allows the request) to avoid blocking legitimate users.
 */
export async function checkAgeGateRateLimit(
  clientIp: string | null
): Promise<AgeGateRateLimitResult> {
  if (!clientIp) {
    // Can't rate limit without IP - allow but log warning
    console.warn("[age-gate-rate-limit] No client IP available");
    return { allowed: true, remaining: RATE_LIMIT };
  }

  try {
    const serviceClient = createServiceClient();
    const ipHash = hashIp(clientIp);
    const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

    // Count recent attempts from this IP
    const { count, error } = await serviceClient
      .from("compliance_audit_log")
      .select("*", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", windowStart);

    if (error) {
      console.error("[age-gate-rate-limit] Query error:", error);
      // Fail open on error (allow the request)
      return { allowed: true, remaining: RATE_LIMIT };
    }

    const attemptCount = count ?? 0;
    const remaining = Math.max(0, RATE_LIMIT - attemptCount);

    return {
      allowed: attemptCount < RATE_LIMIT,
      remaining,
    };
  } catch (err) {
    // Fail open on exception
    console.error("[age-gate-rate-limit] Exception:", err);
    return { allowed: true, remaining: RATE_LIMIT };
  }
}
