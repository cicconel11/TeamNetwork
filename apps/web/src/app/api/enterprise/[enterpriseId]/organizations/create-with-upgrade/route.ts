import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  optionalSafeString,
  safeString,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { getEnterpriseApiContext, ENTERPRISE_CREATE_ORG_ROLE } from "@/lib/auth/enterprise-api-context";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";
import { adjustEnterpriseSubOrgQuantity } from "@/lib/enterprise/adjust-sub-org-quantity";
import { canEnterpriseAddSubOrg } from "@/lib/enterprise/quota";
import { getFreeSubOrgCount, getSubOrgPricing } from "@/lib/enterprise/pricing";
import { resolveCurrentQuantity } from "@/lib/enterprise/quota-logic";
import {
  createEnterpriseSubOrg,
  ensureEnterpriseSlugAvailable,
} from "@/lib/enterprise/create-sub-org";

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

interface EnterpriseSubscriptionContext {
  alumni_bucket_quantity: number;
  billing_interval: "month" | "year";
  sub_org_quantity: number | null;
}

interface EnterpriseManagedCountsRow {
  enterprise_managed_org_count: number;
}

const createOrgWithUpgradeSchema = z
  .object({
    name: safeString(120),
    slug: baseSchemas.slug,
    purpose: optionalSafeString(500).optional(),
    primary_color: baseSchemas.hexColor.optional(),
    expectedCurrentQuantity: z.number().int().min(1).max(1000).optional(),
    billingType: z.literal("enterprise_managed").default("enterprise_managed"),
    // Hard block: client must explicitly confirm the upgrade before we bump
    // the seat quantity and charge. Absence returns 402 with a cost preview
    // so the frontend can surface a confirmation modal. See requirements doc:
    // docs/brainstorms/2026-04-20-enterprise-bulk-org-wizard-requirements.md
    confirmUpgrade: z.boolean().optional(),
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
    const serviceSupabase = ctx.serviceSupabase;

    const respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    const body = await validateJson(req, createOrgWithUpgradeSchema, { maxBodyBytes: 16_000 });
    const {
      name,
      slug,
      purpose,
      primary_color,
      expectedCurrentQuantity,
      confirmUpgrade,
    } = body;

    const slugAvailability = await ensureEnterpriseSlugAvailable(
      ctx.serviceSupabase,
      slug
    );

    if (!slugAvailability.available) {
      return respond(
        { error: slugAvailability.error ?? "Failed to verify slug availability" },
        slugAvailability.status ?? 500
      );
    }

    const [
      { data: enterprise },
      { data: subscription, error: subscriptionError },
      { data: counts, error: countsError },
    ] = await Promise.all([
      serviceSupabase
        .from("enterprises")
        .select("id, primary_color")
        .eq("id", ctx.enterpriseId)
        .single() as unknown as Promise<{ data: EnterpriseRow | null }>,
      serviceSupabase
        .from("enterprise_subscriptions")
        .select("alumni_bucket_quantity, billing_interval, sub_org_quantity")
        .eq("enterprise_id", ctx.enterpriseId)
        .single() as unknown as Promise<{
          data: EnterpriseSubscriptionContext | null;
          error: { message?: string } | null;
        }>,
      serviceSupabase
        .from("enterprise_alumni_counts")
        .select("enterprise_managed_org_count")
        .eq("enterprise_id", ctx.enterpriseId)
        .maybeSingle() as unknown as Promise<{
          data: EnterpriseManagedCountsRow | null;
          error: { message?: string } | null;
        }>,
    ]);

    if (!enterprise) {
      return respond({ error: "Enterprise not found" }, 404);
    }

    if (subscriptionError || !subscription) {
      return respond({ error: "Unable to verify seat limit. Please try again." }, 503);
    }

    if (countsError) {
      return respond({ error: "Unable to verify seat limit. Please try again." }, 503);
    }

    const bucketQuantity = subscription.alumni_bucket_quantity ?? 1;
    const currentQuantity = resolveCurrentQuantity(
      subscription.sub_org_quantity,
      counts?.enterprise_managed_org_count ?? 0,
      getFreeSubOrgCount(bucketQuantity)
    );
    const requestedQuantity = currentQuantity + 1;

    // Hard block: this route bumps the paid seat quantity by +1. Per the
    // bulk-org-wizard requirements, admins must explicitly confirm before we
    // charge. Mirrors the 402 needsUpgrade convention from batch-create so the
    // frontend can render a confirm modal with cost preview, then retry with
    // confirmUpgrade: true.
    if (confirmUpgrade !== true) {
      const currentPricing = getSubOrgPricing(
        currentQuantity,
        subscription.billing_interval,
        bucketQuantity
      );
      const projectedPricing = getSubOrgPricing(
        requestedQuantity,
        subscription.billing_interval,
        bucketQuantity
      );

      return respond(
        {
          error: "Upgrade confirmation required to add another organization",
          needsUpgrade: true,
          currentCount: counts?.enterprise_managed_org_count ?? 0,
          maxAllowed: subscription.sub_org_quantity,
          remaining:
            subscription.sub_org_quantity != null
              ? Math.max(
                  subscription.sub_org_quantity -
                    (counts?.enterprise_managed_org_count ?? 0),
                  0
                )
              : null,
          currentQuantity,
          requestedQuantity,
          billingInterval: subscription.billing_interval,
          costPreview: {
            current: {
              freeOrgs: currentPricing.freeOrgs,
              billableOrgs: currentPricing.billableOrgs,
              totalCents: currentPricing.totalCents,
            },
            projected: {
              freeOrgs: projectedPricing.freeOrgs,
              billableOrgs: projectedPricing.billableOrgs,
              totalCents: projectedPricing.totalCents,
            },
            additionalCents: projectedPricing.totalCents - currentPricing.totalCents,
            unitCents: projectedPricing.unitCents,
          },
        },
        402
      );
    }

    const adjustment = await adjustEnterpriseSubOrgQuantity({
      serviceSupabase: ctx.serviceSupabase,
      enterpriseId: ctx.enterpriseId,
      userId: ctx.userId,
      userEmail: ctx.userEmail,
      req,
      newQuantity: requestedQuantity,
      expectedCurrentQuantity,
    });

    if (!adjustment.ok) {
      return respond(adjustment.body, adjustment.status);
    }

    const result = await createEnterpriseSubOrg({
      serviceSupabase: ctx.serviceSupabase,
      enterpriseId: ctx.enterpriseId,
      userId: ctx.userId,
      name,
      slug,
      purpose: purpose ?? null,
      primaryColor: primary_color,
      enterprisePrimaryColor: enterprise.primary_color,
    });

    if (!result.ok) {
      if (result.kind === "org_limit") {
        return respond(
          {
            error: result.error,
            needsUpgrade: true,
            currentCount: result.quota?.currentCount ?? null,
            maxAllowed: result.quota?.maxAllowed ?? null,
            remaining: result.quota?.remaining ?? null,
          },
          result.status
        );
      }

      return respond({ error: result.error }, result.status);
    }

    logEnterpriseAuditAction({
      actorUserId: ctx.userId,
      actorEmail: ctx.userEmail,
      action: "create_sub_org_with_upgrade",
      enterpriseId: ctx.enterpriseId,
      targetType: "organization",
      targetId: result.orgId,
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
    const pricing = getSubOrgPricing(
      updatedQuota.currentCount,
      adjustment.billingInterval,
      adjustment.bucketQuantity
    );

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
