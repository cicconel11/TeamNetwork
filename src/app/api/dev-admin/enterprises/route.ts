import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  isDevAdmin,
  logDevAdminAction,
  extractRequestContext,
} from "@/lib/auth/dev-admin";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import type {
  Enterprise,
  EnterpriseSubscription,
  EnterpriseRole,
} from "@/types/enterprise";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface AlumniCountsRow {
  enterprise_id: string;
  total_alumni_count: number;
  sub_org_count: number;
  enterprise_managed_org_count: number;
}

interface EnterpriseRoleRow {
  user_id: string;
  enterprise_id: string;
  role: EnterpriseRole;
}

interface SubOrgRow {
  id: string;
  name: string;
  slug: string;
  enterprise_id: string;
  enterprise_relationship_type: string | null;
}

interface OrgSubscriptionRow {
  organization_id: string;
  status: string;
}

interface EnterpriseAdminInfo {
  user_id: string;
  role: EnterpriseRole;
  email: string | null;
}

interface EnterpriseResponse {
  id: string;
  name: string;
  slug: string;
  billing_contact_email: string | null;
  created_at: string;
  subscription: {
    status: string;
    pricing_model: string;
    sub_org_quantity: number | null;
    alumni_tier: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
  } | null;
  counts: {
    total_alumni_count: number;
    sub_org_count: number;
    enterprise_managed_org_count: number;
  };
  admins: EnterpriseAdminInfo[];
  sub_orgs: {
    id: string;
    name: string;
    slug: string;
    relationship_type: string | null;
    subscription_status: string | null;
  }[];
}

/**
 * GET /api/dev-admin/enterprises
 *
 * Returns all enterprises with subscription, counts, admins, and sub-orgs.
 * Only accessible by dev-admins.
 */
export async function GET(req: Request) {
  try {
    // 1. Rate limit by IP before any auth backend calls
    const ipRateLimit = checkRateLimit(req, {
      feature: "dev-admin",
      limitPerIp: 30,
      limitPerUser: 0,
    });
    if (!ipRateLimit.ok) {
      return buildRateLimitResponse(ipRateLimit);
    }

    // 2. Check authentication
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // 3. Rate limit authenticated users (separate from IP limit above)
    const userRateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "dev-admin",
      limitPerIp: 0,
      limitPerUser: 20,
    });
    if (!userRateLimit.ok) {
      return buildRateLimitResponse(userRateLimit);
    }

    // 4. Verify dev-admin access
    if (!isDevAdmin(user)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Log dev-admin action
    if (user) {
      logDevAdminAction({
        adminUserId: user.id,
        adminEmail: user.email ?? "",
        action: "view_enterprise",
        targetType: "enterprise",
        ...extractRequestContext(req),
        metadata: { listAll: true },
      });
    }

    // 3. Use service client to bypass RLS
    const serviceClient = createServiceClient();

    // 4. Query all enterprises
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: enterprises, error: entError } = await (serviceClient as any)
      .from("enterprises")
      .select("*")
      .order("created_at", { ascending: false }) as {
      data: Enterprise[] | null;
      error: { message: string } | null;
    };

    if (entError) {
      console.error("Error fetching enterprises:", entError);
      return NextResponse.json(
        { error: entError.message },
        { status: 500 }
      );
    }

    const enterpriseList = enterprises ?? [];
    if (enterpriseList.length === 0) {
      return NextResponse.json({ enterprises: [] });
    }

    const enterpriseIds = enterpriseList.map((e) => e.id);

    // 5. Batch-fetch related data in parallel
    const [
      { data: subscriptions },
      { data: allCounts },
      { data: allRoles },
      { data: allSubOrgs },
    ] = await Promise.all([
      // Subscriptions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (serviceClient as any)
        .from("enterprise_subscriptions")
        .select(
          "enterprise_id, status, pricing_model, sub_org_quantity, alumni_tier, stripe_customer_id, stripe_subscription_id"
        )
        .in("enterprise_id", enterpriseIds) as Promise<{
        data: (EnterpriseSubscription & { enterprise_id: string })[] | null;
      }>,
      // Alumni counts view
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (serviceClient as any)
        .from("enterprise_alumni_counts")
        .select(
          "enterprise_id, total_alumni_count, sub_org_count, enterprise_managed_org_count"
        )
        .in("enterprise_id", enterpriseIds) as Promise<{
        data: AlumniCountsRow[] | null;
      }>,
      // Roles
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (serviceClient as any)
        .from("user_enterprise_roles")
        .select("user_id, enterprise_id, role")
        .in("enterprise_id", enterpriseIds) as Promise<{
        data: EnterpriseRoleRow[] | null;
      }>,
      // Sub-organizations (cast needed for enterprise_* columns not in generated types)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (serviceClient as any)
        .from("organizations")
        .select("id, name, slug, enterprise_id, enterprise_relationship_type")
        .in("enterprise_id", enterpriseIds) as Promise<{
        data: SubOrgRow[] | null;
      }>,
    ]);

    // 6. Resolve admin emails from auth system
    const rolesList = allRoles ?? [];
    const uniqueUserIds = [...new Set(rolesList.map((r) => r.user_id))];

    const emailMap = new Map<string, string | null>();
    if (uniqueUserIds.length > 0) {
      const {
        data: { users: authUsers },
      } = await serviceClient.auth.admin.listUsers({ perPage: 1000 });

      for (const authUser of authUsers) {
        if (uniqueUserIds.includes(authUser.id)) {
          emailMap.set(authUser.id, authUser.email ?? null);
        }
      }
    }

    // 7. Get subscription status for each sub-org
    const subOrgList = allSubOrgs ?? [];
    const subOrgIds = subOrgList.map((o) => o.id);

    let orgSubMap = new Map<string, string | null>();
    if (subOrgIds.length > 0) {
      const { data: orgSubs } = await serviceClient
        .from("organization_subscriptions")
        .select("organization_id, status")
        .in("organization_id", subOrgIds) as {
        data: OrgSubscriptionRow[] | null;
      };

      orgSubMap = new Map(
        (orgSubs ?? []).map((s) => [s.organization_id, s.status])
      );
    }

    // 8. Build indexed lookups
    const subMap = new Map<string, EnterpriseSubscription>();
    for (const s of subscriptions ?? []) {
      subMap.set(s.enterprise_id, s);
    }

    const countsMap = new Map<string, AlumniCountsRow>();
    for (const c of allCounts ?? []) {
      countsMap.set(c.enterprise_id, c);
    }

    const rolesMap = new Map<string, EnterpriseAdminInfo[]>();
    for (const r of rolesList) {
      const existing = rolesMap.get(r.enterprise_id) ?? [];
      rolesMap.set(r.enterprise_id, [
        ...existing,
        {
          user_id: r.user_id,
          role: r.role,
          email: emailMap.get(r.user_id) ?? null,
        },
      ]);
    }

    const subOrgsMap = new Map<
      string,
      { id: string; name: string; slug: string; relationship_type: string | null; subscription_status: string | null }[]
    >();
    for (const org of subOrgList) {
      const existing = subOrgsMap.get(org.enterprise_id) ?? [];
      subOrgsMap.set(org.enterprise_id, [
        ...existing,
        {
          id: org.id,
          name: org.name,
          slug: org.slug,
          relationship_type: org.enterprise_relationship_type,
          subscription_status: orgSubMap.get(org.id) ?? null,
        },
      ]);
    }

    // 9. Assemble response
    const result: EnterpriseResponse[] = enterpriseList.map((ent) => {
      const sub = subMap.get(ent.id);
      const counts = countsMap.get(ent.id);

      return {
        id: ent.id,
        name: ent.name,
        slug: ent.slug,
        billing_contact_email: ent.billing_contact_email,
        created_at: ent.created_at,
        subscription: sub
          ? {
              status: sub.status,
              pricing_model: sub.pricing_model,
              sub_org_quantity: sub.sub_org_quantity,
              alumni_tier: sub.alumni_tier,
              stripe_customer_id: sub.stripe_customer_id,
              stripe_subscription_id: sub.stripe_subscription_id,
            }
          : null,
        counts: {
          total_alumni_count: counts?.total_alumni_count ?? 0,
          sub_org_count: counts?.sub_org_count ?? 0,
          enterprise_managed_org_count:
            counts?.enterprise_managed_org_count ?? 0,
        },
        admins: rolesMap.get(ent.id) ?? [],
        sub_orgs: subOrgsMap.get(ent.id) ?? [],
      };
    });

    return NextResponse.json({ enterprises: result });
  } catch (error) {
    console.error(
      "Unexpected error in dev-admin enterprises endpoint:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
