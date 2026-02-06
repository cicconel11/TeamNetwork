import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import type { EnterpriseRelationshipType } from "@/types/enterprise";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

// Type for organization with enterprise fields (until types are regenerated)
interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  primary_color: string | null;
  logo_url: string | null;
  enterprise_relationship_type: EnterpriseRelationshipType | null;
  enterprise_adopted_at: string | null;
  created_at: string;
  organization_subscriptions: { status: string }[] | null;
}

export async function GET(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise organizations",
    limitPerIp: 60,
    limitPerUser: 40,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return respond({ error: "Unauthorized" }, 401);
  }

  const serviceSupabase = createServiceClient();
  const { data: resolved, error: resolveError } = await resolveEnterpriseParam(enterpriseId, serviceSupabase);
  if (resolveError) {
    return respond({ error: resolveError.message }, resolveError.status);
  }

  const resolvedEnterpriseId = resolved?.enterpriseId ?? enterpriseId;

  // Check enterprise membership via service client (bypasses RLS)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: userRole } = await (serviceSupabase as any)
    .from("user_enterprise_roles")
    .select("role")
    .eq("enterprise_id", resolvedEnterpriseId)
    .eq("user_id", user.id)
    .single() as { data: { role: string } | null };

  if (!userRole) {
    return respond({ error: "Forbidden" }, 403);
  }

  // Get all organizations belonging to this enterprise with subscription status
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: organizations, error } = await (serviceSupabase as any)
    .from("organizations")
    .select(`
      id,
      name,
      slug,
      description,
      primary_color,
      logo_url,
      enterprise_relationship_type,
      enterprise_adopted_at,
      created_at,
      organization_subscriptions (
        status
      )
    `)
    .eq("enterprise_id", resolvedEnterpriseId)
    .order("name", { ascending: true }) as { data: OrganizationRow[] | null; error: Error | null };

  if (error) {
    return respond({ error: error.message }, 400);
  }

  // Get alumni counts for each organization
  const orgIds = (organizations ?? []).map((org) => org.id);

  let alumniCounts: Record<string, number> = {};
  if (orgIds.length > 0) {
    const { data: counts } = await serviceSupabase
      .from("alumni")
      .select("organization_id")
      .in("organization_id", orgIds)
      .is("deleted_at", null);

    if (counts) {
      alumniCounts = counts.reduce((acc, row) => {
        const orgId = row.organization_id;
        acc[orgId] = (acc[orgId] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
    }
  }

  // Combine organizations with their alumni counts and billing status
  const orgsWithCounts = (organizations ?? []).map((org) => {
    const subscriptionStatus = org.organization_subscriptions?.[0]?.status ?? null;
    const billingType = subscriptionStatus === "enterprise_managed"
      ? "enterprise_managed"
      : "independent";

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      description: org.description,
      primary_color: org.primary_color,
      logo_url: org.logo_url,
      enterprise_relationship_type: org.enterprise_relationship_type,
      enterprise_adopted_at: org.enterprise_adopted_at,
      created_at: org.created_at,
      alumniCount: alumniCounts[org.id] || 0,
      subscriptionStatus,
      billingType,
    };
  });

  return respond({ organizations: orgsWithCounts });
}
