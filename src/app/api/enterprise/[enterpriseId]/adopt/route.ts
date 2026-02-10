import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { requireEnterpriseOwner } from "@/lib/auth/enterprise-roles";
import { createAdoptionRequest } from "@/lib/enterprise/adoption";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";
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

    const respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    if (!user) {
      return respond({ error: "Unauthorized" }, 401);
    }

    const serviceSupabase = createServiceClient();
    const { data: resolved, error: resolveError } = await resolveEnterpriseParam(enterpriseId, serviceSupabase);
    if (resolveError) {
      return respond({ error: resolveError.message }, resolveError.status);
    }

    const resolvedEnterpriseId = resolved?.enterpriseId ?? enterpriseId;

    try {
      await requireEnterpriseOwner(resolvedEnterpriseId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Forbidden";
      if (message === "Unauthorized") {
        return respond({ error: "Unauthorized" }, 401);
      }
      return respond({ error: "Forbidden" }, 403);
    }

    const body = await validateJson(req, adoptSchema, { maxBodyBytes: 8_000 });
    const { organizationSlug } = body;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: org } = await (serviceSupabase as any)
      .from("organizations")
      .select("id")
      .eq("slug", organizationSlug)
      .maybeSingle() as { data: { id: string } | null };

    if (!org) {
      return respond({ error: "Organization not found" }, 404);
    }

    const result = await createAdoptionRequest(resolvedEnterpriseId, org.id, user.id);
    if (!result.success) {
      return respond({ error: result.error }, 400);
    }

    logEnterpriseAuditAction({
      actorUserId: user.id,
      actorEmail: user.email ?? "",
      action: "adopt_organization",
      enterpriseId: resolvedEnterpriseId,
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
