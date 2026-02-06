import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  isDevAdmin,
  logDevAdminAction,
  extractRequestContext,
} from "@/lib/auth/dev-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/dev-admin/organizations
 *
 * Returns all organizations in the database with key details.
 * Only accessible by dev-admins.
 */
export async function GET(req: Request) {
  try {
    // 1. Check authentication
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // 2. Verify dev-admin access
    if (!isDevAdmin(user)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Log dev-admin action on list fetch
    if (user) {
      logDevAdminAction({
        adminUserId: user.id,
        adminEmail: user.email ?? "",
        action: "view_org",
        ...extractRequestContext(req),
        metadata: { listAll: true },
      });
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
        enterprise_id,
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

    // 5. Batch-fetch enterprise names/slugs for orgs with enterprise_id
    const enterpriseIds = [
      ...new Set(
        (orgs ?? [])
          .map((org) => org.enterprise_id)
          .filter((id): id is string => id != null)
      ),
    ];

    const enterpriseMap = new Map<
      string,
      { name: string; slug: string }
    >();

    if (enterpriseIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: enterprises } = (await (serviceClient as any)
        .from("enterprises")
        .select("id, name, slug")
        .in("id", enterpriseIds)) as {
        data: Array<{ id: string; name: string; slug: string }> | null;
      };

      for (const ent of enterprises ?? []) {
        enterpriseMap.set(ent.id, { name: ent.name, slug: ent.slug });
      }
    }

    // 6. Get member counts for each organization
    const orgsWithCounts = await Promise.all(
      (orgs ?? []).map(async (org) => {
        const { count } = await serviceClient
          .from("members")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", org.id)
          .is("deleted_at", null);

        const enterprise = org.enterprise_id
          ? enterpriseMap.get(org.enterprise_id)
          : null;

        return {
          ...org,
          member_count: count ?? 0,
          subscription: org.organization_subscriptions?.[0] ?? null,
          enterprise_id: org.enterprise_id ?? null,
          enterprise_name: enterprise?.name ?? null,
          enterprise_slug: enterprise?.slug ?? null,
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
