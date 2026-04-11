import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, logAgeGateEvent } from "@/lib/compliance/audit-log";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { createAgeValidationToken } from "@/lib/auth/age-validation";
import { ageBracketSchema } from "@/lib/schemas/age-gate";

const requestSchema = z.object({
  ageBracket: ageBracketSchema,
});

/**
 * POST /api/auth/validate-age
 *
 * Validates age gate completion and returns a signed token.
 * - Rate limited: 5 attempts per IP per 10 minutes
 * - Logs events to compliance_audit_log
 * - Returns redirect instruction for under-13 users
 * - Returns signed token for 13+ users
 */
export async function POST(request: Request) {
  const clientIp = getClientIp(request);

  // Rate limit check (before any processing) - 5 attempts per IP per 10 minutes
  const rateLimit = checkRateLimit(request, {
    limitPerIp: 5,
    limitPerUser: 0,
    windowMs: 10 * 60 * 1000,
    feature: "age verification",
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  // Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logAgeGateEvent({ eventType: "age_gate_invalid", ageBracket: null, clientIp }).catch((err) => {
      console.error("[validate-age] Audit logging failed:", err);
    });
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    logAgeGateEvent({ eventType: "age_gate_invalid", ageBracket: null, clientIp }).catch((err) => {
      console.error("[validate-age] Audit logging failed:", err);
    });
    return NextResponse.json(
      { error: "Invalid request data" },
      { status: 400 }
    );
  }

  const { ageBracket } = parsed.data;
  const isMinor = ageBracket !== "18_plus";

  // Log to compliance audit (fails gracefully)
  const eventType =
    ageBracket === "under_13" ? "age_gate_redirected" : "age_gate_passed";

  // Fire and forget - don't block on logging errors
  logAgeGateEvent({ eventType, ageBracket, clientIp }).catch((err) => {
    console.error("[validate-age] Audit logging failed:", err);
  });

  // Under-13: return redirect instruction (no token)
  if (ageBracket === "under_13") {
    return NextResponse.json({
      redirect: "/auth/parental-consent",
      message: "Parental consent required for users under 13",
    });
  }

  // Generate validation token for 13+ users
  const token = createAgeValidationToken(ageBracket);

  return NextResponse.json({
    token,
    ageBracket,
    isMinor,
  });
}
