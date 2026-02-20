import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  optionalSafeString,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import {
  getEnterpriseApiContext,
  ENTERPRISE_ANY_ROLE,
  ENTERPRISE_OWNER_ROLE,
} from "@/lib/auth/enterprise-api-context";
import type { Enterprise, EnterpriseSubscription } from "@/types/enterprise";
import { extractRequestContext } from "@/lib/audit/enterprise-audit";
import { updateEnterprise, isUpdateError } from "@/lib/enterprise/update-enterprise";

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

  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_ANY_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: enterprise, error } = await (ctx.serviceSupabase as any)
    .from("enterprises")
    .select("*")
    .eq("id", ctx.enterpriseId)
    .single() as { data: Enterprise | null; error: Error | null };

  if (error || !enterprise) {
    return respond({ error: "Enterprise not found" }, 404);
  }

  // Parallelize subscription and alumni counts queries
  const [
    { data: subscription, error: subscriptionError },
    { data: counts, error: countsError },
  ] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx.serviceSupabase as any)
      .from("enterprise_subscriptions")
      .select("*")
      .eq("enterprise_id", ctx.enterpriseId)
      .maybeSingle() as Promise<{ data: EnterpriseSubscription | null; error: Error | null }>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx.serviceSupabase as any)
      .from("enterprise_alumni_counts")
      .select("total_alumni_count, sub_org_count")
      .eq("enterprise_id", ctx.enterpriseId)
      .maybeSingle() as Promise<{ data: AlumniCountsRow | null; error: Error | null }>,
  ]);

  if (subscriptionError) {
    console.error("[enterprise/route] subscription query failed:", subscriptionError);
  }
  if (countsError) {
    console.error("[enterprise/route] alumni counts query failed:", countsError);
  }

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

    const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_OWNER_ROLE);
    if (!ctx.ok) return ctx.response;

    const respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    const body = await validateJson(req, patchSchema, { maxBodyBytes: 16_000 });

    const result = await updateEnterprise(
      ctx.serviceSupabase,
      ctx.enterpriseId,
      body,
      ctx.userId,
      ctx.userEmail,
      "update_enterprise",
      extractRequestContext(req)
    );

    if (isUpdateError(result)) {
      return respond({ error: result.error }, result.status);
    }

    return respond({ enterprise: result.enterprise });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}
