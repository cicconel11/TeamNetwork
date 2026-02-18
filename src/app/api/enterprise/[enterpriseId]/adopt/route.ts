import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { getEnterpriseApiContext, ENTERPRISE_OWNER_ROLE } from "@/lib/auth/enterprise-api-context";
import { createAdoptionRequest } from "@/lib/enterprise/adoption";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

const adoptSchema = z
  .object({
    organizationSlug: baseSchemas.slug,
  })
  .strict();

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { enterpriseId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "create adoption request",
      limitPerIp: 20,
      limitPerUser: 10,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_OWNER_ROLE);
    if (!ctx.ok) return ctx.response;

    const respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    const body = await validateJson(req, adoptSchema, { maxBodyBytes: 8_000 });
    const { organizationSlug } = body;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: org } = await (ctx.serviceSupabase as any)
      .from("organizations")
      .select("id")
      .eq("slug", organizationSlug)
      .maybeSingle() as { data: { id: string } | null };

    if (!org) {
      return respond({ error: "Organization not found" }, 404);
    }

    const result = await createAdoptionRequest(ctx.enterpriseId, org.id, ctx.userId);
    if (!result.success) {
      return respond({ error: result.error }, 400);
    }

    logEnterpriseAuditAction({
      actorUserId: ctx.userId,
      actorEmail: ctx.userEmail,
      action: "adopt_organization",
      enterpriseId: ctx.enterpriseId,
      targetType: "organization",
      targetId: org.id,
      metadata: { organizationSlug, requestId: result.requestId },
      ...extractRequestContext(req),
    });

    return respond({ requestId: result.requestId }, 201);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}
