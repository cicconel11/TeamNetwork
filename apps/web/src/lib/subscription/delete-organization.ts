"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Deletes an organization and all its related data.
 * This is called when the grace period expires.
 */
export async function deleteExpiredOrganization(organizationId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createServiceClient();

  try {
    // First, cancel any active Stripe subscription
    const { data: subscription } = await supabase
      .from("organization_subscriptions")
      .select("stripe_subscription_id")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (subscription?.stripe_subscription_id) {
      try {
        const stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
        // Only try to cancel if subscription is not already canceled
        if (stripeSub.status !== "canceled") {
          await stripe.subscriptions.cancel(subscription.stripe_subscription_id);
        }
      } catch (stripeError) {
        // Check if this is a "resource not found" error (subscription doesn't exist in Stripe)
        const isNotFound = stripeError instanceof Error && 
          (stripeError.message.includes("No such subscription") || 
           stripeError.message.includes("resource_missing"));
        
        if (!isNotFound) {
          // Real error - halt deletion to prevent billing the user after data is deleted
          console.error("[deleteExpiredOrganization] Stripe subscription cancel failed:", stripeError);
          return { 
            success: false, 
            error: "Failed to cancel Stripe subscription. Please try again or contact support." 
          };
        }
        // Subscription doesn't exist in Stripe - safe to continue with deletion
        console.log("[deleteExpiredOrganization] Stripe subscription not found, continuing with deletion");
      }
    }

    // Delete all related records in order (respecting foreign key constraints)
    // Using explicit table calls to satisfy TypeScript
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as SupabaseClient<any>;

    await db.from("competition_points").delete().eq("organization_id", organizationId);
    await db.from("competitions").delete().eq("organization_id", organizationId);
    await db.from("members").delete().eq("organization_id", organizationId);
    await db.from("alumni").delete().eq("organization_id", organizationId);
    await db.from("event_rsvps").delete().eq("organization_id", organizationId);
    await db.from("events").delete().eq("organization_id", organizationId);
    await db.from("announcements").delete().eq("organization_id", organizationId);
    await db.from("organization_donations").delete().eq("organization_id", organizationId);
    await db.from("records").delete().eq("organization_id", organizationId);
    await db.from("philanthropy_events").delete().eq("organization_id", organizationId);
    await db.from("notifications").delete().eq("organization_id", organizationId);
    await db.from("notification_preferences").delete().eq("organization_id", organizationId);
    await db.from("organization_invites").delete().eq("organization_id", organizationId);
    await db.from("user_organization_roles").delete().eq("organization_id", organizationId);
    await db.from("organization_subscriptions").delete().eq("organization_id", organizationId);
    await db.from("form_responses").delete().eq("organization_id", organizationId);
    await db.from("form_documents").delete().eq("organization_id", organizationId);
    await db.from("forms").delete().eq("organization_id", organizationId);
    await db.from("schedule_files").delete().eq("organization_id", organizationId);
    await db.from("academic_schedules").delete().eq("organization_id", organizationId);

    // Finally, delete the organization itself
    const { error: orgError } = await supabase
      .from("organizations")
      .delete()
      .eq("id", organizationId);

    if (orgError) {
      console.error("[deleteExpiredOrganization] Failed to delete organization:", orgError);
      return { success: false, error: orgError.message };
    }

    console.log("[deleteExpiredOrganization] Successfully deleted organization:", organizationId);
    return { success: true };
  } catch (error) {
    console.error("[deleteExpiredOrganization] Error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
