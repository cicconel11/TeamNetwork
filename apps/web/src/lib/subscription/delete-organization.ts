/* eslint-disable @typescript-eslint/no-explicit-any */
"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Complete deletion order for all tables with organization_id FK.
 * Leaf tables first, respecting foreign key constraints.
 */
const DELETION_ORDER = [
  // Chat
  "chat_messages",
  "chat_group_members",
  "chat_groups",

  // Feed
  "feed_comments",
  "feed_likes",
  "feed_posts",

  // Discussions
  "discussion_replies",
  "discussion_threads",

  // Competition
  "competition_points",
  "competition_teams",
  "competitions",

  // Calendar
  "event_calendar_entries",
  "calendar_events",
  "calendar_feeds",
  "calendar_sync_preferences",

  // Events
  "event_rsvps",
  "events",

  // Forms
  "form_document_submissions",
  "form_submissions",
  "form_documents",
  "forms",

  // Donations & Philanthropy
  "donations",
  "organization_donation_stats",
  "organization_donations",
  "org_donation_embeds",
  "philanthropy_events",
  "org_philanthropy_embeds",

  // Jobs
  "job_postings",

  // Media
  "media_items",
  "media_uploads",
  "media_albums",

  // Mentorship
  "mentorship_logs",
  "mentorship_pairs",
  "mentor_profiles",

  // Workouts
  "workout_logs",
  "workouts",

  // Members & Alumni
  "parent_invites",
  "parents",
  "members",
  "alumni",

  // Schedules
  "schedule_files",
  "academic_schedules",

  // Records & Expenses
  "records",
  "expenses",

  // Announcements
  "announcements",

  // Notifications
  "notifications",
  "notification_preferences",

  // Analytics (nullable org_id — delete where matching)
  "usage_events",
  "usage_summaries",
  "analytics_ops_events",

  // UI
  "ui_profiles",

  // Payment
  "payment_attempts",

  // Invites & Roles
  "organization_invites",
  "user_organization_roles",

  // Subscription (last before org)
  "organization_subscriptions",
] as const;

/**
 * Deletes all data belonging to an organization across all related tables.
 * Must be called with a service-role client (bypasses RLS).
 */
export async function deleteOrganizationData(
  db: SupabaseClient<any>,
  organizationId: string
): Promise<void> {
  for (const table of DELETION_ORDER) {
    const { error } = await (db as any)
      .from(table)
      .delete()
      .eq("organization_id", organizationId);

    if (error) {
      throw new Error(`Failed to delete from ${table}: ${error.message}`);
    }
  }
}

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
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as SupabaseClient<any>;
    await deleteOrganizationData(db, organizationId);

    // Finally, delete the organization itself
    const { error: orgError } = await supabase
      .from("organizations")
      .delete()
      .eq("id", organizationId);

    if (orgError) {
      console.error("[deleteExpiredOrganization] Failed to delete organization:", orgError);
      return { success: false, error: orgError.message };
    }

    return { success: true };
  } catch (error) {
    console.error("[deleteExpiredOrganization] Error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
