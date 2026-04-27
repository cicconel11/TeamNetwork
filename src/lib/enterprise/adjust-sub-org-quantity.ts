import {
  extractRequestContext,
  logEnterpriseAuditAction,
  logEnterpriseAuditActionAwaited,
} from "@/lib/audit/enterprise-audit";
import { requireEnv } from "@/lib/env";
import { getBillableOrgCount, getSubOrgPricing } from "@/lib/enterprise/pricing";
import { stripe } from "@/lib/stripe";
import { extractSubscriptionPeriodEndEpoch } from "@/lib/stripe/subscription-period";
import type { Tables } from "@/types/database";
import type { BillingInterval } from "@/types/enterprise";

export type EnterpriseSubscriptionRow = Pick<
  Tables<"enterprise_subscriptions">,
  | "id"
  | "enterprise_id"
  | "stripe_customer_id"
  | "stripe_subscription_id"
  | "alumni_bucket_quantity"
  | "sub_org_quantity"
  | "status"
  | "current_period_end"
> & { billing_interval: BillingInterval };

interface EnterpriseManagedCountRow {
  enterprise_managed_org_count: number;
}

export interface AdjustSubOrgQuantityParams {
  serviceSupabase: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  enterpriseId: string;
  userId: string;
  userEmail: string;
  req: Request;
  newQuantity: number;
  expectedCurrentQuantity?: number;
}

export interface AdjustSubOrgQuantitySuccess {
  ok: true;
  subscription: {
    quantity: number;
    currentUsage: number;
    availableSeats: number;
    freeOrgs: number;
    billableOrgs: number;
    totalCents: number;
    status: string;
    currentPeriodEnd: string | null;
  };
  billingInterval: "month" | "year";
  bucketQuantity: number;
}

export interface AdjustSubOrgQuantityFailure {
  ok: false;
  status: number;
  body: Record<string, unknown>;
}

export type AdjustSubOrgQuantityResult =
  | AdjustSubOrgQuantitySuccess
  | AdjustSubOrgQuantityFailure;

async function retryDbWrite(
  writeFn: () => Promise<{ error: Error | null }>
): Promise<{ error: Error | null }> {
  const first = await writeFn();
  if (!first.error) return first;
  await new Promise((resolve) => setTimeout(resolve, 500));
  return writeFn();
}

async function reconcileSubscriptionFromStripe(
  serviceSupabase: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  subscription: EnterpriseSubscriptionRow,
  enterpriseId: string,
  auditContext: {
    userId: string;
    userEmail: string;
    req: Request;
  }
): Promise<EnterpriseSubscriptionRow> {
  if (!subscription.stripe_subscription_id) return subscription;

  let stripeSub;
  try {
    stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
  } catch (err) {
    console.warn("[billing/adjust] Reconciliation skipped - Stripe fetch failed:", err);
    return subscription;
  }

  const stripeSubOrgQty = stripeSub.metadata?.sub_org_quantity
    ? parseInt(stripeSub.metadata.sub_org_quantity, 10)
    : null;
  const stripeAlumniBucketQty = stripeSub.metadata?.alumni_bucket_quantity
    ? parseInt(stripeSub.metadata.alumni_bucket_quantity, 10)
    : null;

  const updates: Record<string, unknown> = {};
  const driftFields: string[] = [];

  if (
    stripeSubOrgQty !== null &&
    !Number.isNaN(stripeSubOrgQty) &&
    stripeSubOrgQty !== subscription.sub_org_quantity
  ) {
    updates.sub_org_quantity = stripeSubOrgQty;
    driftFields.push("sub_org_quantity");
  }

  if (
    stripeAlumniBucketQty !== null &&
    !Number.isNaN(stripeAlumniBucketQty) &&
    stripeAlumniBucketQty !== subscription.alumni_bucket_quantity
  ) {
    updates.alumni_bucket_quantity = stripeAlumniBucketQty;
    driftFields.push("alumni_bucket_quantity");
  }

  if (driftFields.length === 0) return subscription;

  updates.updated_at = new Date().toISOString();

  console.warn("[billing/adjust] Reconciling DB drift from Stripe:", {
    enterpriseId,
    driftFields,
    db: {
      sub_org_quantity: subscription.sub_org_quantity,
      alumni_bucket_quantity: subscription.alumni_bucket_quantity,
    },
    stripe: {
      sub_org_quantity: stripeSubOrgQty,
      alumni_bucket_quantity: stripeAlumniBucketQty,
    },
  });

  const { error: reconcileError } = await serviceSupabase
    .from("enterprise_subscriptions")
    .update(updates)
    .eq("enterprise_id", enterpriseId);

  if (reconcileError) {
    console.error("[billing/adjust] Reconciliation DB write failed:", reconcileError);
  }

  logEnterpriseAuditAction({
    actorUserId: auditContext.userId,
    actorEmail: auditContext.userEmail,
    action: "billing_reconciled",
    enterpriseId,
    targetType: "subscription",
    targetId: enterpriseId,
    metadata: { driftFields, stripeSubOrgQty, stripeAlumniBucketQty },
    ...extractRequestContext(auditContext.req),
  });

  return {
    ...subscription,
    sub_org_quantity: stripeSubOrgQty ?? subscription.sub_org_quantity,
    alumni_bucket_quantity: stripeAlumniBucketQty ?? subscription.alumni_bucket_quantity,
  };
}

export async function adjustEnterpriseSubOrgQuantity(
  params: AdjustSubOrgQuantityParams
): Promise<AdjustSubOrgQuantityResult> {
  const {
    serviceSupabase,
    enterpriseId,
    userId,
    userEmail,
    req,
    newQuantity,
    expectedCurrentQuantity,
  } = params;

  const { data: subscription, error: subError } = await serviceSupabase
    .from("enterprise_subscriptions")
    .select("id, enterprise_id, stripe_customer_id, stripe_subscription_id, billing_interval, alumni_bucket_quantity, sub_org_quantity, status, current_period_end")
    .eq("enterprise_id", enterpriseId)
    .maybeSingle() as {
    data: EnterpriseSubscriptionRow | null;
    error: Error | null;
  };

  if (subError) {
    console.error("[billing/adjust] DB error fetching subscription:", subError);
    return {
      ok: false,
      status: 500,
      body: { error: "Internal server error" },
    };
  }

  if (!subscription) {
    return {
      ok: false,
      status: 404,
      body: { error: "Enterprise subscription not found" },
    };
  }

  if (!subscription.stripe_customer_id) {
    return {
      ok: false,
      status: 400,
      body: { error: "Enterprise subscription is not linked to a Stripe customer" },
    };
  }

  const reconciledSubscription = await reconcileSubscriptionFromStripe(
    serviceSupabase,
    subscription,
    enterpriseId,
    { userId, userEmail, req }
  );

  if (
    expectedCurrentQuantity !== undefined &&
    reconciledSubscription.sub_org_quantity !== expectedCurrentQuantity
  ) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "Seat quantity changed. Please refresh and try again.",
        currentQuantity: reconciledSubscription.sub_org_quantity,
      },
    };
  }

  const { data: counts, error: countsError } = await serviceSupabase
    .from("enterprise_alumni_counts")
    .select("enterprise_managed_org_count")
    .eq("enterprise_id", enterpriseId)
    .maybeSingle() as { data: EnterpriseManagedCountRow | null; error: Error | null };

  if (countsError) {
    return {
      ok: false,
      status: 500,
      body: { error: "Failed to fetch current usage" },
    };
  }

  const currentManagedOrgCount = counts?.enterprise_managed_org_count ?? 0;

  if (newQuantity < currentManagedOrgCount) {
    return {
      ok: false,
      status: 400,
      body: {
        error: `Cannot reduce seat quantity below current usage. You currently have ${currentManagedOrgCount} enterprise-managed organization(s). Remove some organizations first or choose a quantity of at least ${currentManagedOrgCount}.`,
        currentUsage: currentManagedOrgCount,
        requestedQuantity: newQuantity,
      },
    };
  }

  const bucketQty = reconciledSubscription.alumni_bucket_quantity;
  const oldBillable = getBillableOrgCount(reconciledSubscription.sub_org_quantity ?? 0, bucketQty);
  const newBillable = getBillableOrgCount(newQuantity, bucketQty);

  try {
    let periodEnd: string | null = null;
    let updatedStatus = reconciledSubscription.status;

    if (oldBillable === 0 && newBillable === 0) {
      const { error: updateError } = await serviceSupabase
        .from("enterprise_subscriptions")
        .update({
          sub_org_quantity: newQuantity,
          updated_at: new Date().toISOString(),
        })
        .eq("enterprise_id", enterpriseId);

      if (updateError) {
        return {
          ok: false,
          status: 500,
          body: { error: "Failed to update subscription quantity" },
        };
      }

      const pricing = getSubOrgPricing(
        newQuantity,
        reconciledSubscription.billing_interval,
        bucketQty
      );

      logEnterpriseAuditAction({
        actorUserId: userId,
        actorEmail: userEmail,
        action: "adjust_billing",
        enterpriseId,
        targetType: "subscription",
        targetId: enterpriseId,
        metadata: {
          adjustType: "sub_org",
          newQuantity,
          previousQuantity: reconciledSubscription.sub_org_quantity,
        },
        ...extractRequestContext(req),
      });

      return {
        ok: true,
        subscription: {
          quantity: newQuantity,
          currentUsage: currentManagedOrgCount,
          availableSeats: newQuantity - currentManagedOrgCount,
          freeOrgs: pricing.freeOrgs,
          billableOrgs: pricing.billableOrgs,
          totalCents: pricing.totalCents,
          status: updatedStatus,
          currentPeriodEnd: periodEnd,
        },
        billingInterval: reconciledSubscription.billing_interval,
        bucketQuantity: bucketQty,
      };
    }

    if (oldBillable === 0 && newBillable > 0) {
      const priceId = reconciledSubscription.billing_interval === "month"
        ? requireEnv("STRIPE_PRICE_ENTERPRISE_SUB_ORG_MONTHLY")
        : requireEnv("STRIPE_PRICE_ENTERPRISE_SUB_ORG_YEARLY");

      if (!reconciledSubscription.stripe_subscription_id) {
        return {
          ok: false,
          status: 400,
          body: { error: "No Stripe subscription found. Please contact support." },
        };
      }

      const updated = await stripe.subscriptions.update(
        reconciledSubscription.stripe_subscription_id,
        {
          items: [{ price: priceId, quantity: newBillable }],
          proration_behavior: "create_prorations",
          metadata: {
            sub_org_quantity: newQuantity.toString(),
          },
        }
      );

      updatedStatus = updated.status;
      const resolvedEnd = extractSubscriptionPeriodEndEpoch(updated);
      periodEnd = resolvedEnd ? new Date(resolvedEnd * 1000).toISOString() : null;
    } else if (oldBillable > 0 && newBillable === 0) {
      if (reconciledSubscription.stripe_subscription_id) {
        const stripeSub = await stripe.subscriptions.retrieve(
          reconciledSubscription.stripe_subscription_id
        );

        const subOrgItem = stripeSub.items?.data?.find((item) => {
          const priceId = typeof item.price === "string" ? item.price : item.price.id;
          return priceId === requireEnv("STRIPE_PRICE_ENTERPRISE_SUB_ORG_MONTHLY")
            || priceId === requireEnv("STRIPE_PRICE_ENTERPRISE_SUB_ORG_YEARLY");
        });

        if (subOrgItem) {
          await stripe.subscriptionItems.del(subOrgItem.id, {
            proration_behavior: "create_prorations",
          });
        }

        const updated = await stripe.subscriptions.retrieve(
          reconciledSubscription.stripe_subscription_id,
          { expand: ["items.data"] }
        );
        updatedStatus = updated.status;
        const resolvedEnd = extractSubscriptionPeriodEndEpoch(updated);
        periodEnd = resolvedEnd ? new Date(resolvedEnd * 1000).toISOString() : null;
      }
    } else if (
      oldBillable > 0 &&
      newBillable > 0 &&
      reconciledSubscription.stripe_subscription_id
    ) {
      const stripeSub = await stripe.subscriptions.retrieve(
        reconciledSubscription.stripe_subscription_id
      );

      const subOrgItem = stripeSub.items?.data?.find((item) => {
        const priceId = typeof item.price === "string" ? item.price : item.price.id;
        return priceId === requireEnv("STRIPE_PRICE_ENTERPRISE_SUB_ORG_MONTHLY")
          || priceId === requireEnv("STRIPE_PRICE_ENTERPRISE_SUB_ORG_YEARLY");
      });

      if (!subOrgItem) {
        return {
          ok: false,
          status: 400,
          body: { error: "Sub-org line item not found in subscription" },
        };
      }

      const updated = await stripe.subscriptions.update(
        reconciledSubscription.stripe_subscription_id,
        {
          items: [{ id: subOrgItem.id, quantity: newBillable }],
          proration_behavior: "create_prorations",
          metadata: {
            sub_org_quantity: newQuantity.toString(),
          },
        }
      );

      updatedStatus = updated.status;
      const resolvedEnd = extractSubscriptionPeriodEndEpoch(updated);
      periodEnd = resolvedEnd ? new Date(resolvedEnd * 1000).toISOString() : null;
    }

    const dbWriteFn = () =>
      serviceSupabase
        .from("enterprise_subscriptions")
        .update({
          sub_org_quantity: newQuantity,
          status: updatedStatus,
          current_period_end: periodEnd,
          updated_at: new Date().toISOString(),
        })
        .eq("enterprise_id", enterpriseId) as Promise<{ error: Error | null }>;

    const { error: updateError } = await retryDbWrite(dbWriteFn);

    if (updateError) {
      console.error("[billing/adjust] DB write failed after Stripe update (with retry):", updateError);
      try {
        await logEnterpriseAuditActionAwaited({
          actorUserId: userId,
          actorEmail: userEmail,
          action: "billing_db_sync_failure",
          enterpriseId,
          targetType: "subscription",
          targetId: enterpriseId,
          metadata: {
            adjustType: "sub_org",
            newQuantity,
            stripeSubscriptionId: reconciledSubscription.stripe_subscription_id,
          },
          ...extractRequestContext(req),
        });
      } catch (auditError) {
        console.error("[billing/adjust] Failed to record billing_db_sync_failure audit:", auditError);
      }

      return {
        ok: false,
        status: 500,
        body: { error: "Billing updated but failed to save. Please contact support." },
      };
    }

    const pricing = getSubOrgPricing(
      newQuantity,
      reconciledSubscription.billing_interval,
      bucketQty
    );

    logEnterpriseAuditAction({
      actorUserId: userId,
      actorEmail: userEmail,
      action: "adjust_billing",
      enterpriseId,
      targetType: "subscription",
      targetId: enterpriseId,
      metadata: {
        adjustType: "sub_org",
        newQuantity,
        previousQuantity: reconciledSubscription.sub_org_quantity,
      },
      ...extractRequestContext(req),
    });

    return {
      ok: true,
      subscription: {
        quantity: newQuantity,
        currentUsage: currentManagedOrgCount,
        availableSeats: newQuantity - currentManagedOrgCount,
        freeOrgs: pricing.freeOrgs,
        billableOrgs: pricing.billableOrgs,
        totalCents: pricing.totalCents,
        status: updatedStatus,
        currentPeriodEnd: periodEnd,
      },
      billingInterval: reconciledSubscription.billing_interval,
      bucketQuantity: bucketQty,
    };
  } catch (error) {
    console.error("[billing/adjust] Stripe error (sub_org):", error);
    return {
      ok: false,
      status: 500,
      body: { error: "Failed to update subscription" },
    };
  }
}
