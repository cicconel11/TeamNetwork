import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlumniBucket, Database, SubscriptionInterval } from "@/types/database";
import { maskPII } from "@/lib/debug";

export type OrgMetadata = {
  organizationId: string | null;
  organizationSlug: string | null;
  organizationName: string | null;
  organizationDescription: string | null;
  organizationColor: string | null;
  createdBy: string | null;
  baseInterval: SubscriptionInterval;
  alumniBucket: AlumniBucket;
  isTrial: boolean;
};

type OrgProvisionerDeps = {
  supabase: SupabaseClient<Database>;
  debugLog: (tag: string, ...args: unknown[]) => void;
};

export function createOrgProvisioner({ supabase, debugLog }: OrgProvisionerDeps) {
  const orgSubs = () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.from("organization_subscriptions") as any;

  const normalizeInterval = (value?: string | null): SubscriptionInterval =>
    value === "year" ? "year" : "month";

  const normalizeBucket = (value?: string | null): AlumniBucket => {
    const allowed: AlumniBucket[] = ["none", "0-250", "251-500", "501-1000", "1001-2500", "2500-5000", "5000+"];
    return allowed.includes(value as AlumniBucket) ? (value as AlumniBucket) : "none";
  };

  const parseOrgMetadata = (metadata?: Stripe.Metadata | null): OrgMetadata => ({
    organizationId: (metadata?.organization_id as string | undefined) ?? null,
    organizationSlug: (metadata?.organization_slug as string | undefined) ?? null,
    organizationName: (metadata?.organization_name as string | undefined) ?? null,
    organizationDescription: (metadata?.organization_description as string | undefined) ?? null,
    organizationColor: (metadata?.organization_color as string | undefined) ?? null,
    // SECURITY FIX: Never trust created_by from Stripe metadata - will be resolved from payment_attempts
    createdBy: null,
    baseInterval: normalizeInterval((metadata?.base_interval as string | undefined) ?? null),
    alumniBucket: normalizeBucket((metadata?.alumni_bucket as string | undefined) ?? null),
    isTrial: metadata?.is_trial === "true",
  });

  const resolveCreatorFromPaymentAttempt = async (
    paymentAttemptId: string | null
  ): Promise<string | null> => {
    if (!paymentAttemptId) return null;

    const { data, error } = await supabase
      .from("payment_attempts")
      .select("user_id")
      .eq("id", paymentAttemptId)
      .maybeSingle();

    if (error) {
      throw new Error(`[resolveCreatorFromPaymentAttempt] DB query failed: ${error.message}`);
    }

    return data?.user_id ?? null;
  };

  const ensureOrganizationFromMetadata = async (metadata: OrgMetadata) => {
    if (!metadata.organizationId && !metadata.organizationSlug) return null;

    if (metadata.organizationId) {
      const { data: existingById } = await supabase
        .from("organizations")
        .select("id")
        .eq("id", metadata.organizationId)
        .maybeSingle();
      if (existingById?.id) return existingById.id;
    }

    if (metadata.organizationSlug) {
      const { data: existingBySlug } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", metadata.organizationSlug)
        .maybeSingle();
      if (existingBySlug?.id) return existingBySlug.id;
    }

    if (!metadata.organizationName || !metadata.organizationSlug) {
      debugLog("stripe-webhook", "Missing organization name/slug in metadata; cannot provision org");
      return null;
    }

    const { data: org, error: orgInsertError } = await supabase
      .from("organizations")
      .insert({
        id: metadata.organizationId ?? undefined,
        name: metadata.organizationName,
        slug: metadata.organizationSlug,
        description: metadata.organizationDescription || null,
        primary_color: metadata.organizationColor || "#1e3a5f",
      })
      .select("id")
      .single();

    if (orgInsertError || !org) {
      console.error("[stripe-webhook] Failed to provision organization from metadata", orgInsertError?.message);
      return null;
    }

    return org.id;
  };

  const grantAdminRole = async (organizationId: string, paymentAttemptId: string | null): Promise<boolean> => {
    const createdBy = await resolveCreatorFromPaymentAttempt(paymentAttemptId);
    if (createdBy) {
      console.warn("[SECURITY-AUDIT] Admin role granted via webhook", {
        organizationId: maskPII(organizationId),
        userId: maskPII(createdBy),
        paymentAttemptId: maskPII(paymentAttemptId),
        timestamp: new Date().toISOString(),
      });

      const { error } = await supabase
        .from("user_organization_roles")
        .upsert(
          {
            user_id: createdBy,
            organization_id: organizationId,
            role: "admin",
            status: "active",
          },
          { onConflict: "organization_id,user_id" },
        );

      if (error) {
        console.error("[stripe-webhook] Failed to grant admin role", {
          organizationId: maskPII(organizationId),
          userId: maskPII(createdBy),
          error: error.message,
        });
        return false;
      }
      return true;
    } else {
      console.error("[stripe-webhook] CRITICAL: No creator found in payment_attempts - org has no admin", {
        organizationId: maskPII(organizationId),
        paymentAttemptId: maskPII(paymentAttemptId),
      });
      return false;
    }
  };

  const ensureSubscriptionSeed = async (orgId: string, metadata: OrgMetadata) => {
    const baseInterval = metadata.baseInterval || "month";
    const alumniBucket = metadata.alumniBucket || "none";
    const alumniPlanInterval = alumniBucket === "none" || alumniBucket === "5000+" ? null : baseInterval;

    const { data: existing, error: existingError } = await orgSubs()
      .select("id")
      .eq("organization_id", orgId)
      .maybeSingle();

    if (existingError) {
      throw new Error(`[ensureSubscriptionSeed] Existence check failed: ${existingError.message}`);
    }

    if (existing?.id) {
      const payload = {
        base_plan_interval: baseInterval,
        alumni_bucket: alumniBucket,
        alumni_plan_interval: alumniPlanInterval,
        is_trial: metadata.isTrial,
        status: "pending",
        updated_at: new Date().toISOString(),
      } satisfies Database["public"]["Tables"]["organization_subscriptions"]["Update"];

      const { error } = await orgSubs()
        .update(payload)
        .eq("organization_id", orgId);
      if (error) {
        throw new Error(`Failed to seed subscription row: ${error.message}`);
      }
    } else {
      const insertPayload = {
        organization_id: orgId,
        base_plan_interval: baseInterval,
        alumni_bucket: alumniBucket,
        alumni_plan_interval: alumniPlanInterval,
        is_trial: metadata.isTrial,
        status: "pending",
      } satisfies Database["public"]["Tables"]["organization_subscriptions"]["Insert"];

      const { error } = await orgSubs().insert(insertPayload);
      if (error) {
        throw new Error(`Failed to create subscription row: ${error.message}`);
      }
    }
  };

  const resolveOrgForSubscriptionFlow = async (
    metadata: Stripe.Metadata | null | undefined,
    paymentAttemptId?: string | null
  ): Promise<{ organizationId: string | null; parsed: OrgMetadata; adminGranted: boolean }> => {
    const parsed = parseOrgMetadata(metadata);
    const organizationId = await ensureOrganizationFromMetadata(parsed);
    let adminGranted = false;
    if (organizationId) {
      await ensureSubscriptionSeed(organizationId, parsed);
      // Grant admin role from verified payment_attempts, not from untrusted metadata
      if (paymentAttemptId) {
        adminGranted = await grantAdminRole(organizationId, paymentAttemptId);
      }
    }
    return { organizationId, parsed, adminGranted };
  };

  /**
   * Validates that webhook metadata matches the organization's Stripe resources.
   * Prevents cross-org subscription hijacking while allowing legitimate re-subscribe flows.
   */
  const validateOrgOwnsStripeResource = async (
    organizationId: string,
    stripeCustomerId: string | null,
    stripeSubscriptionId: string | null
  ): Promise<boolean> => {
    const { data: subscription } = await supabase
      .from("organization_subscriptions")
      .select("stripe_customer_id, stripe_subscription_id, organization_id, status")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!subscription) {
      return true; // New organization - no existing subscription
    }

    const status = subscription.status || "";
    const replaceableStatuses = ["canceled", "incomplete_expired"];
    const matchRequiredStatuses = ["unpaid", "past_due", "canceling"];
    const canReplaceIds = replaceableStatuses.includes(status);
    const requiresMatch = matchRequiredStatuses.includes(status);

    // If no existing Stripe IDs stored, allow the update
    if (!subscription.stripe_customer_id && !subscription.stripe_subscription_id) {
      return true;
    }

    // If subscription is fully inactive, allow new Stripe IDs (re-subscribe flow)
    if (canReplaceIds) {
      debugLog("stripe-webhook", "Allowing Stripe ID update for inactive subscription", {
        organizationId: maskPII(organizationId),
        status,
        oldCustomerId: maskPII(subscription.stripe_customer_id),
        newCustomerId: maskPII(stripeCustomerId),
      });
      return true;
    }

    // For unpaid/past_due/canceling subscriptions, require matching IDs
    if (requiresMatch) {
      if (subscription.stripe_customer_id) {
        if (!stripeCustomerId || subscription.stripe_customer_id !== stripeCustomerId) {
          console.error("[SECURITY] Stripe customer ID mismatch on troubled subscription", {
            organizationId: maskPII(organizationId),
            expected: maskPII(subscription.stripe_customer_id),
            provided: maskPII(stripeCustomerId),
            status,
          });
          return false;
        }
      }

      if (subscription.stripe_subscription_id && stripeSubscriptionId) {
        if (subscription.stripe_subscription_id !== stripeSubscriptionId) {
          console.error("[SECURITY] Stripe subscription ID mismatch on troubled subscription", {
            organizationId: maskPII(organizationId),
            expected: maskPII(subscription.stripe_subscription_id),
            provided: maskPII(stripeSubscriptionId),
            status,
          });
          return false;
        }
      }

      return true;
    }

    // For active subscriptions, validate IDs match
    if (subscription.stripe_customer_id && stripeCustomerId) {
      if (subscription.stripe_customer_id !== stripeCustomerId) {
        console.error("[SECURITY] Stripe customer ID mismatch on active subscription", {
          organizationId: maskPII(organizationId),
          expected: maskPII(subscription.stripe_customer_id),
          provided: maskPII(stripeCustomerId),
          status: subscription.status,
        });
        return false;
      }
    }

    if (subscription.stripe_subscription_id && stripeSubscriptionId) {
      if (subscription.stripe_subscription_id !== stripeSubscriptionId) {
        console.error("[SECURITY] Stripe subscription ID mismatch on active subscription", {
          organizationId: maskPII(organizationId),
          expected: maskPII(subscription.stripe_subscription_id),
          provided: maskPII(stripeSubscriptionId),
          status: subscription.status,
        });
        return false;
      }
    }

    return true;
  };

  return {
    parseOrgMetadata,
    resolveCreatorFromPaymentAttempt,
    ensureOrganizationFromMetadata,
    grantAdminRole,
    ensureSubscriptionSeed,
    resolveOrgForSubscriptionFlow,
    validateOrgOwnsStripeResource,
  };
}
