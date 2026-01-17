import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isDevAdmin } from "@/lib/auth/dev-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/dev-admin/organizations
 *
 * Returns all organizations in the database with key details.
 * Only accessible by dev-admins.
 */
export async function GET(_request: Request) {
  try {
    // 1. Check authentication
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // 2. Verify dev-admin access
    if (!isDevAdmin(user)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // 3. Use service client to bypass RLS and get all data
    const serviceClient = createServiceClient();

    // 4. Query all organizations with related data
    const { data: orgs, error } = await serviceClient
      .from("organizations")
      .select(`
        id,
        name,
        slug,
        created_at,
        stripe_connect_account_id,
        organization_subscriptions(
          status,
          stripe_subscription_id,
          current_period_end
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching organizations:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 5. Get member counts for each organization
    const orgsWithCounts = await Promise.all(
      (orgs ?? []).map(async (org) => {
        const { count } = await serviceClient
          .from("user_organization_roles")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", org.id)
          .eq("status", "active");

        return {
          ...org,
          member_count: count ?? 0,
          subscription: org.organization_subscriptions?.[0] ?? null,
        };
      })
    );

    return NextResponse.json({ organizations: orgsWithCounts });
  } catch (error) {
    console.error("Unexpected error in dev-admin organizations endpoint:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
