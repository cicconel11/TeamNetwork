import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  optionalSafeString,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import {
  requireEnterpriseRole,
  requireEnterpriseOwner,
} from "@/lib/auth/enterprise-roles";
import type { Enterprise, EnterpriseSubscription } from "@/types/enterprise";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

// Type for alumni counts view (until types are regenerated)
interface AlumniCountsRow {
  enterprise_id: string;
  total_alumni_count: number;
  sub_org_count: number;
}

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: optionalSafeString(800),
    logo_url: z.string().url().max(500).optional().nullable(),
    primary_color: baseSchemas.hexColor.optional().nullable(),
    billing_contact_email: baseSchemas.email.optional(),
  })
  .strict();

export async function GET(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise details",
    limitPerIp: 60,
    limitPerUser: 40,
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
    // Check enterprise membership
    await requireEnterpriseRole(resolvedEnterpriseId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    if (message === "Unauthorized") {
      return respond({ error: "Unauthorized" }, 401);
    }
    return respond({ error: "Forbidden" }, 403);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: enterprise, error } = await (serviceSupabase as any)
    .from("enterprises")
    .select("*")
    .eq("id", resolvedEnterpriseId)
    .single() as { data: Enterprise | null; error: Error | null };

  if (error || !enterprise) {
    return respond({ error: "Enterprise not found" }, 404);
  }

  // Get subscription info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subscription } = await (serviceSupabase as any)
    .from("enterprise_subscriptions")
    .select("*")
    .eq("enterprise_id", resolvedEnterpriseId)
    .maybeSingle() as { data: EnterpriseSubscription | null };

  // Get alumni counts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: counts } = await (serviceSupabase as any)
    .from("enterprise_alumni_counts")
    .select("total_alumni_count, sub_org_count")
    .eq("enterprise_id", resolvedEnterpriseId)
    .maybeSingle() as { data: AlumniCountsRow | null };

  return respond({
    enterprise,
    subscription,
    alumniCount: counts?.total_alumni_count ?? 0,
    subOrgCount: counts?.sub_org_count ?? 0,
  });
}

export async function PATCH(req: Request, { params }: RouteParams) {
  try {
    const { enterpriseId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "enterprise settings",
      limitPerIp: 30,
      limitPerUser: 20,
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
      // Require owner role for updates
      await requireEnterpriseOwner(resolvedEnterpriseId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Forbidden";
      if (message === "Unauthorized") {
        return respond({ error: "Unauthorized" }, 401);
      }
      return respond({ error: "Forbidden" }, 403);
    }

    const body = await validateJson(req, patchSchema, { maxBodyBytes: 16_000 });

    // Build update payload with only provided fields
    const updatePayload: Record<string, unknown> = {};
    if (body.name !== undefined) updatePayload.name = body.name;
    if (body.description !== undefined) updatePayload.description = body.description;
    if (body.logo_url !== undefined) updatePayload.logo_url = body.logo_url;
    if (body.primary_color !== undefined) updatePayload.primary_color = body.primary_color;
    if (body.billing_contact_email !== undefined) updatePayload.billing_contact_email = body.billing_contact_email;

    if (Object.keys(updatePayload).length === 0) {
      return respond({ error: "No valid fields to update" }, 400);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error: updateError } = await (serviceSupabase as any)
      .from("enterprises")
      .update(updatePayload)
      .eq("id", resolvedEnterpriseId)
      .select()
      .single() as { data: Enterprise | null; error: Error | null };

    if (updateError) {
      return respond({ error: updateError.message }, 400);
    }

    logEnterpriseAuditAction({
      actorUserId: user.id,
      actorEmail: user.email ?? "",
      action: "update_enterprise",
      enterpriseId: resolvedEnterpriseId,
      targetType: "enterprise",
      targetId: resolvedEnterpriseId,
      metadata: { updatedFields: Object.keys(updatePayload) },
      ...extractRequestContext(req),
    });

    return respond({ enterprise: updated });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}
