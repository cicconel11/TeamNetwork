import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  safeString,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { requireEnterpriseRole } from "@/lib/auth/enterprise-roles";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";
import { canEnterpriseAddSubOrg } from "@/lib/enterprise/quota";
import { getBillableOrgCount, getEnterpriseSubOrgPricing } from "@/lib/enterprise/pricing";
import type { PricingModel } from "@/types/enterprise";
import { ENTERPRISE_SEAT_PRICING } from "@/types/enterprise";

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

// Type for enterprise subscription row (until types are regenerated)
interface EnterpriseSubscriptionRow {
  id: string;
  enterprise_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  billing_interval: "month" | "year";
  pricing_model: PricingModel | null;
  sub_org_quantity: number | null;
  price_per_sub_org_cents: number | null;
  status: string;
  current_period_end: string | null;
}

const createOrgWithUpgradeSchema = z
  .object({
    name: safeString(120),
    slug: baseSchemas.slug,
    primary_color: baseSchemas.hexColor.optional(),
    upgradeIfNeeded: z.boolean(),
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
      // Require owner or org_admin role to create sub-organizations
      await requireEnterpriseRole(resolvedEnterpriseId, ["owner", "org_admin"]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Forbidden";
      if (message === "Unauthorized") {
        return respond({ error: "Unauthorized" }, 401);
      }
      return respond({ error: "Forbidden" }, 403);
    }

    const body = await validateJson(req, createOrgWithUpgradeSchema, { maxBodyBytes: 16_000 });
    const { name, slug, primary_color, upgradeIfNeeded } = body;

    // Check slug uniqueness across both organizations and enterprises
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingOrg } = await (serviceSupabase as any)
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle() as { data: { id: string } | null };

    if (existingOrg) {
      return respond({ error: "Slug is already taken" }, 409);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingEnterprise } = await (serviceSupabase as any)
      .from("enterprises")
      .select("id")
      .eq("slug", slug)
      .maybeSingle() as { data: { id: string } | null };

    if (existingEnterprise) {
      return respond({ error: "Slug is already taken" }, 409);
    }

    // Check enterprise exists and get its details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: enterprise } = await (serviceSupabase as any)
      .from("enterprises")
      .select("id, primary_color")
      .eq("id", resolvedEnterpriseId)
      .single() as { data: EnterpriseRow | null };

    if (!enterprise) {
      return respond({ error: "Enterprise not found" }, 404);
    }

    // Check current seat quota
    const seatQuota = await canEnterpriseAddSubOrg(resolvedEnterpriseId);

    // If at limit and upgradeIfNeeded is false, return needsUpgrade: true
    if (!seatQuota.allowed && !upgradeIfNeeded) {
      return respond({
        error: "Seat limit reached",
        message: `You have used all ${seatQuota.maxAllowed} enterprise-managed org seats. Set upgradeIfNeeded to true to automatically upgrade.`,
        currentCount: seatQuota.currentCount,
        maxAllowed: seatQuota.maxAllowed,
        needsUpgrade: true,
      }, 400);
    }

    let upgraded = false;

    // If at limit and upgradeIfNeeded is true, perform the upgrade
    if (!seatQuota.allowed && upgradeIfNeeded) {
      // Get current subscription for billing operations
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: subscription, error: subError } = await (serviceSupabase as any)
        .from("enterprise_subscriptions")
        .select("id, enterprise_id, stripe_customer_id, stripe_subscription_id, billing_interval, pricing_model, sub_org_quantity, price_per_sub_org_cents, status, current_period_end")
        .eq("enterprise_id", resolvedEnterpriseId)
        .maybeSingle() as { data: EnterpriseSubscriptionRow | null; error: Error | null };

      if (subError) {
        return respond({ error: subError.message }, 500);
      }

      if (!subscription) {
        return respond({ error: "Enterprise subscription not found" }, 404);
      }

      // Verify pricing model is per_sub_org for seat-based billing
      if (subscription.pricing_model !== "per_sub_org") {
        return respond(
          { error: "Seat quantity adjustment is only available for per-sub-org pricing. Please contact support to upgrade your pricing model." },
          400
        );
      }

      // Verify Stripe customer exists
      if (!subscription.stripe_customer_id) {
        return respond({ error: "Enterprise subscription is not linked to a Stripe customer" }, 400);
      }

      const currentQuantity = subscription.sub_org_quantity ?? 0;
      const newQuantity = currentQuantity + 1;
      const oldBillable = getBillableOrgCount(currentQuantity);
      const newBillable = getBillableOrgCount(newQuantity);

      try {
        let stripeSubscriptionId = subscription.stripe_subscription_id;
        let updatedStatus = subscription.status;
        let periodEnd: string | null = null;

        // Case 1: Was free, now needs subscription (crossing from 5 to 6 orgs)
        if (oldBillable === 0 && newBillable > 0) {
          // Determine price based on billing interval
          const billingInterval = subscription.billing_interval;
          const unitAmount = billingInterval === "month"
            ? ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsMonthly
            : ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsYearly;

          // Create a price for the subscription
          const price = await stripe.prices.create({
            currency: "usd",
            unit_amount: unitAmount,
            recurring: { interval: billingInterval },
            product_data: {
              name: "Enterprise Additional Organization",
              metadata: {
                description: `TeamNetwork Enterprise - Additional organizations beyond free tier (${ENTERPRISE_SEAT_PRICING.freeSubOrgs} free included)`,
              },
            },
          });

          // Create subscription with billable quantity
          const newSub = await stripe.subscriptions.create({
            customer: subscription.stripe_customer_id,
            items: [
              {
                price: price.id,
                quantity: newBillable,
              },
            ],
            metadata: {
              type: "enterprise",
              pricing_model: "per_sub_org",
              sub_org_quantity: newQuantity.toString(),
              enterprise_id: resolvedEnterpriseId,
            },
          });

          stripeSubscriptionId = newSub.id;
          updatedStatus = newSub.status;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const periodEndVal = (newSub as any).current_period_end;
          periodEnd = periodEndVal
            ? new Date(periodEndVal * 1000).toISOString()
            : null;
        }

        // Guard: If already in paid tier but no Stripe subscription, this is an invalid state
        else if (oldBillable > 0 && !subscription.stripe_subscription_id) {
          console.error("[create-with-upgrade] Invalid state: oldBillable > 0 but no stripe_subscription_id", {
            enterpriseId: resolvedEnterpriseId,
            oldBillable,
            newBillable,
            currentQuantity,
          });
          return respond({
            error: "Enterprise subscription is in paid tier but missing Stripe subscription. Please contact support.",
          }, 500);
        }

        // Case 2: Was paying, still paying (just increasing quantity)
        else if (oldBillable > 0 && newBillable > 0 && subscription.stripe_subscription_id) {
          const stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
          const itemId = stripeSub.items?.data?.[0]?.id;

          if (!itemId) {
            return respond({ error: "Stripe subscription items not found" }, 400);
          }

          const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
            items: [{ id: itemId, quantity: newBillable }],
            proration_behavior: "create_prorations",
            metadata: {
              sub_org_quantity: newQuantity.toString(),
            },
          });

          updatedStatus = updated.status;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const updatedPeriodEnd = (updated as any).current_period_end;
          periodEnd = updatedPeriodEnd
            ? new Date(updatedPeriodEnd * 1000).toISOString()
            : null;
        }

        // Update enterprise_subscriptions with new quantity
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: updateError } = await (serviceSupabase as any)
          .from("enterprise_subscriptions")
          .update({
            sub_org_quantity: newQuantity,
            stripe_subscription_id: stripeSubscriptionId,
            status: updatedStatus,
            current_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq("enterprise_id", resolvedEnterpriseId);

        if (updateError) {
          console.error("[create-with-upgrade] Failed to update subscription:", updateError);
          return respond({ error: "Failed to update enterprise subscription" }, 500);
        }

        upgraded = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to upgrade subscription";
        console.error("[create-with-upgrade] Stripe error:", error);
        return respond({ error: message }, 500);
      }
    }

    // Create organization under enterprise
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: newOrg, error: orgError } = await (serviceSupabase as any)
      .from("organizations")
      .insert({
        name,
        slug,
        description: null,
        primary_color: primary_color ?? enterprise.primary_color ?? "#1e3a5f",
        enterprise_id: resolvedEnterpriseId,
        enterprise_relationship_type: "created",
      })
      .select()
      .single() as { data: Record<string, unknown> | null; error: Error | null };

    if (orgError || !newOrg) {
      // If org creation fails after upgrading, we should log but not rollback Stripe
      // The extra seat can be used for future orgs
      if (upgraded) {
        console.error("[create-with-upgrade] Org creation failed after upgrade. Extra seat remains:", orgError);
      }
      return respond({ error: orgError?.message ?? "Unable to create organization" }, 400);
    }

    // Grant creator admin role on new organization
    const { error: roleError } = await serviceSupabase
      .from("user_organization_roles")
      .insert({
        user_id: user.id,
        organization_id: newOrg.id as string,
        role: "admin",
      });

    if (roleError) {
      // Cleanup if role assignment fails
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (serviceSupabase as any).from("organizations").delete().eq("id", newOrg.id);
      return respond({ error: roleError.message }, 400);
    }

    // Create subscription record for enterprise-managed org
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: subError } = await (serviceSupabase as any)
      .from("organization_subscriptions")
      .insert({
        organization_id: newOrg.id,
        status: "enterprise_managed",
        base_plan_interval: "month",
        alumni_bucket: "none",
      }) as { error: Error | null };

    if (subError) {
      // Cleanup if subscription creation fails
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (serviceSupabase as any).from("user_organization_roles").delete().eq("organization_id", newOrg.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (serviceSupabase as any).from("organizations").delete().eq("id", newOrg.id);
      return respond({ error: "Failed to create organization subscription" }, 500);
    }

    // Get updated quota info for response
    const updatedQuota = await canEnterpriseAddSubOrg(resolvedEnterpriseId);
    const pricing = getEnterpriseSubOrgPricing(updatedQuota.maxAllowed ?? updatedQuota.currentCount);

    return respond({
      organization: newOrg,
      upgraded,
      subscription: {
        currentCount: updatedQuota.currentCount,
        maxAllowed: updatedQuota.maxAllowed,
        availableSeats: updatedQuota.maxAllowed !== null
          ? updatedQuota.maxAllowed - updatedQuota.currentCount
          : null,
        freeOrgs: pricing.freeOrgs,
        billableOrgs: pricing.billableOrgs,
        totalCentsYearly: pricing.totalCentsYearly,
      },
    }, 201);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}
