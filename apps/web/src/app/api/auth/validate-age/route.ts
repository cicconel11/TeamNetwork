import { NextResponse } from "next/server";
import { z } from "zod";
import { createApiRoute } from "@/lib/api/route";
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
export const POST = createApiRoute({
  body: requestSchema,
  before: async (request) => {
    const rateLimit = checkRateLimit(request, {
      limitPerIp: 5,
      limitPerUser: 0,
      windowMs: 10 * 60 * 1000,
      feature: "age verification",
    });

    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);
  },
  onValidationError: async ({ request }) => {
    logAgeGateEvent({
      eventType: "age_gate_invalid",
      ageBracket: null,
      clientIp: getClientIp(request),
    }).catch((err) => {
      console.error("[validate-age] Audit logging failed:", err);
    });
  },
  handler: async ({ request, body }) => {
    const { ageBracket } = body;
    const clientIp = getClientIp(request);
    const isMinor = ageBracket !== "18_plus";

    const eventType = ageBracket === "under_13" ? "age_gate_redirected" : "age_gate_passed";

    logAgeGateEvent({ eventType, ageBracket, clientIp }).catch((err) => {
      console.error("[validate-age] Audit logging failed:", err);
    });

    if (ageBracket === "under_13") {
      return NextResponse.json({
        redirect: "/auth/parental-consent",
        message: "Parental consent required for users under 13",
      });
    }

    const token = createAgeValidationToken(ageBracket);

    return NextResponse.json({
      token,
      ageBracket,
      isMinor,
    });
  },
});
