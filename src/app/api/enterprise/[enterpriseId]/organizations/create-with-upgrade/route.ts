import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  safeString,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { getEnterpriseApiContext, ENTERPRISE_CREATE_ORG_ROLE } from "@/lib/auth/enterprise-api-context";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";
import { canEnterpriseAddSubOrg } from "@/lib/enterprise/quota";
import { getSubOrgPricing } from "@/lib/enterprise/pricing";
import { createEnterpriseSubOrg } from "@/lib/enterprise/create-sub-org";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

// Type for enterprise row (until types are regenerated)
interface EnterpriseRow {
  id: string;
  primary_color: string | null;
}

const createOrgWithUpgradeSchema = z
  .object({
    name: safeString(120),
    slug: baseSchemas.slug,
    primary_color: baseSchemas.hexColor.optional(),
    billingType: z.literal("enterprise_managed").default("enterprise_managed"),
  })
  .strict();

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { enterpriseId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "create sub-organization with upgrade",
      limitPerIp: 20,
      limitPerUser: 10,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_CREATE_ORG_ROLE);
    if (!ctx.ok) return ctx.response;

    const respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    const body = await validateJson(req, createOrgWithUpgradeSchema, { maxBodyBytes: 16_000 });
    const { name, slug, primary_color } = body;

    // Fetch enterprise to get primary_color fallback
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: enterprise } = await (ctx.serviceSupabase as any)
      .from("enterprises")
      .select("id, primary_color")
      .eq("id", ctx.enterpriseId)
      .single() as { data: EnterpriseRow | null };

    if (!enterprise) {
      return respond({ error: "Enterprise not found" }, 404);
    }

    // Check current seat quota (hybrid model: always allowed, billing kicks in after free tier)
    const seatQuota = await canEnterpriseAddSubOrg(ctx.enterpriseId);
    if (seatQuota.error) {
      return respond(
        { error: "Unable to verify seat limit. Please try again." },
        503
      );
    }

    const result = await createEnterpriseSubOrg({
      serviceSupabase: ctx.serviceSupabase,
      enterpriseId: ctx.enterpriseId,
      userId: ctx.userId,
      name,
      slug,
      primaryColor: primary_color,
      enterprisePrimaryColor: enterprise.primary_color,
    });

    if (!result.ok) {
      return respond({ error: result.error }, result.status);
    }

    logEnterpriseAuditAction({
      actorUserId: ctx.userId,
      actorEmail: ctx.userEmail,
      action: "create_sub_org_with_upgrade",
      enterpriseId: ctx.enterpriseId,
      targetType: "organization",
      targetId: result.org.id as string,
      metadata: { name, slug },
      ...extractRequestContext(req),
    });

    // Get updated quota info for response
    const updatedQuota = await canEnterpriseAddSubOrg(ctx.enterpriseId);
    if (updatedQuota.error) {
      // Org was already created — return success with stale quota rather than failing
      return respond({
        organization: result.org,
        subscription: null,
      }, 201);
    }
    const pricing = getSubOrgPricing(updatedQuota.currentCount, "year");

    return respond({
      organization: result.org,
      subscription: {
        currentCount: updatedQuota.currentCount,
        maxAllowed: updatedQuota.maxAllowed,
        availableSeats: updatedQuota.maxAllowed !== null
          ? updatedQuota.maxAllowed - updatedQuota.currentCount
          : null,
        freeOrgs: pricing.freeOrgs,
        billableOrgs: pricing.billableOrgs,
        totalCents: pricing.totalCents,
      },
    }, 201);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}
