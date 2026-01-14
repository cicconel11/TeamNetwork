import { createClient } from "@/lib/supabase/server";
import { isOrgReadOnly, type SubscriptionStatus } from "@/lib/subscription/grace-period";

/**
 * Check if an organization is in read-only mode (grace period).
 * Use this in API routes to block mutations during grace period.
 * 
 * @returns { isReadOnly: boolean, subscription: SubscriptionStatus | null, error?: string }
 */
export async function checkOrgReadOnly(organizationId: string): Promise<{
  isReadOnly: boolean;
  subscription: SubscriptionStatus | null;
  error?: string;
}> {
  const supabase = await createClient();
  
  const { data: subscriptionData, error: queryError } = await supabase
    .from("organization_subscriptions")
    .select("status, grace_period_ends_at, current_period_end")
    .eq("organization_id", organizationId)
    .maybeSingle();

  // If query fails (RLS blocked, network error, etc.), fail closed (read-only)
  // to prevent writes when we can't verify subscription status
  if (queryError) {
    console.error("[checkOrgReadOnly] Query error, failing closed:", queryError.message);
    return {
      isReadOnly: true,
      subscription: null,
      error: queryError.message,
    };
  }

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
