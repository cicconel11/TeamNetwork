import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";

/**
 * Hard-delete an enterprise after its 30-day soft-delete grace window expires.
 *
 * Mirrors deleteExpiredOrganization: cancel Stripe first (halt on real error so
 * we never purge data while still billing), then delete the enterprise row.
 *
 * Enterprise child tables (enterprise_subscriptions, enterprise_adoption_requests,
 * user_enterprise_roles, enterprise_invites, enterprise_deletion_requests) are all
 * ON DELETE CASCADE from enterprises, so deleting the enterprise row cleans them up.
 * enterprise_audit_logs has no FK and intentionally survives the purge (audit trail).
 */
export async function deleteExpiredEnterprise(
  enterpriseId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = createServiceClient();

  try {
    // Precondition re-check: refuse to purge if an org was re-attached during the
    // grace window. organizations has NO deleted_at column (orgs are hard-deleted),
    // so this is an unfiltered count. Leaving the request pending avoids a silent
    // ON DELETE SET NULL detach of live orgs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count: orgCount, error: orgCountError } = await (supabase as any)
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .eq("enterprise_id", enterpriseId);

    if (orgCountError) {
      console.error("[deleteExpiredEnterprise] org count failed:", orgCountError);
      return { success: false, error: orgCountError.message };
    }

    if ((orgCount ?? 0) > 0) {
      console.warn(
        "[deleteExpiredEnterprise] skipping purge: orgs re-attached during grace window",
        { enterpriseId, orgCount }
      );
      return { success: false, error: "Organizations still attached; purge skipped" };
    }

    // Cancel any active Stripe subscription (keyed on enterprise_id).
    const { data: subscription } = await supabase
      .from("enterprise_subscriptions")
      .select("stripe_subscription_id")
      .eq("enterprise_id", enterpriseId)
      .maybeSingle();

    if (subscription?.stripe_subscription_id) {
      try {
        const stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
        if (stripeSub.status !== "canceled") {
          await stripe.subscriptions.cancel(subscription.stripe_subscription_id);
        }
      } catch (stripeError) {
        const isNotFound =
          stripeError instanceof Error &&
          (stripeError.message.includes("No such subscription") ||
            stripeError.message.includes("resource_missing"));

        if (!isNotFound) {
          // Real error — halt deletion so we never purge data while still billing.
          console.error(
            "[deleteExpiredEnterprise] Stripe subscription cancel failed:",
            stripeError
          );
          return {
            success: false,
            error: "Failed to cancel Stripe subscription. Please try again or contact support.",
          };
        }
        // Subscription gone in Stripe — safe to continue.
      }
    }

    // Delete the enterprise row — CASCADE cleans all FK children.
    const { error: deleteError } = await supabase
      .from("enterprises")
      .delete()
      .eq("id", enterpriseId);

    if (deleteError) {
      console.error("[deleteExpiredEnterprise] Failed to delete enterprise:", deleteError);
      return { success: false, error: deleteError.message };
    }

    return { success: true };
  } catch (error) {
    console.error("[deleteExpiredEnterprise] Error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
