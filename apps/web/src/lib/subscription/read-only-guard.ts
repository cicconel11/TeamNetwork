import { createClient } from "@/lib/supabase/server";
import { isOrgReadOnly, type SubscriptionStatus } from "@/lib/subscription/grace-period";

/**
 * Check if an organization is in read-only mode (grace period).
 * Use this in API routes to block mutations during grace period.
 *
 * Uses the get_subscription_status RPC (SECURITY DEFINER) so that all
 * authenticated org members can check status — not just admins.
 * Querying organization_subscriptions directly would be blocked by
 * admin-only RLS for active_member / alumni callers.
 *
 * @returns { isReadOnly: boolean, subscription: SubscriptionStatus | null, error?: string }
 */
export async function checkOrgReadOnly(organizationId: string): Promise<{
  isReadOnly: boolean;
  subscription: SubscriptionStatus | null;
  error?: string;
}> {
  const supabase = await createClient();

  const { data: subscriptionRows, error: queryError } = await supabase
    .rpc("get_subscription_status", { p_org_id: organizationId });

  // If query fails (network error, etc.), fail closed (read-only)
  // to prevent writes when we can't verify subscription status
  if (queryError) {
    console.error("[checkOrgReadOnly] RPC error, failing closed:", queryError.message);
    return {
      isReadOnly: true,
      subscription: null,
      error: queryError.message,
    };
  }

  const subscriptionData = subscriptionRows?.[0] ?? null;

  const subscription: SubscriptionStatus | null = subscriptionData
    ? {
        status: subscriptionData.status,
        gracePeriodEndsAt: subscriptionData.grace_period_ends_at,
        currentPeriodEnd: subscriptionData.current_period_end,
      }
    : null;

  return {
    isReadOnly: isOrgReadOnly(subscription),
    subscription,
  };
}

/**
 * Helper to return a 403 response for read-only orgs
 */
export function readOnlyResponse() {
  return {
    error: "Organization is in read-only mode. Please resubscribe to make changes.",
    code: "ORG_READ_ONLY",
  };
}
