import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import type { EnterpriseRelationshipType } from "@/types/enterprise";
import { getEnterpriseApiContext, ENTERPRISE_ANY_ROLE } from "@/lib/auth/enterprise-api-context";

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

  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_ANY_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  // Get all organizations belonging to this enterprise with subscription status
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: organizations, error } = await (ctx.serviceSupabase as any)
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
    .eq("enterprise_id", ctx.enterpriseId)
    .order("name", { ascending: true }) as { data: OrganizationRow[] | null; error: Error | null };

  if (error) {
    console.error("[enterprise/organizations GET] DB error:", error);
    return respond({ error: "Internal server error" }, 500);
  }

  // Get alumni counts for each organization (parallel count-only queries)
  const orgIds = (organizations ?? []).map((org) => org.id);

  const alumniCounts: Record<string, number> = {};
  if (orgIds.length > 0) {
    const countResults = await Promise.all(
      orgIds.map((orgId) =>
        ctx.serviceSupabase
          .from("alumni")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .is("deleted_at", null)
      )
    );
    orgIds.forEach((orgId, i) => {
      alumniCounts[orgId] = countResults[i].count ?? 0;
    });
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
