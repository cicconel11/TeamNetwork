import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getEnterpriseApiContext, ENTERPRISE_ANY_ROLE } from "@/lib/auth/enterprise-api-context";
import { getCachedEnterpriseAlumniStats } from "@/lib/cached-queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise alumni stats",
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

  // Fetch cached RPC stats and lightweight org list in parallel.
  // The org list is needed to supply id+name for the filter dropdown,
  // which the RPC does not return.
  const [statsResult, orgsResult] = await Promise.all([
    getCachedEnterpriseAlumniStats(ctx.enterpriseId).catch(() => null),
    ctx.serviceSupabase
      .from("organizations")
      .select("id, name")
      .eq("enterprise_id", ctx.enterpriseId),
  ]);

  if (!statsResult) {
    return respond({ error: "Failed to load alumni stats" }, 500);
  }

  const organizations = orgsResult.data ?? [];

  return respond({
    totalCount: statsResult.total_count,
    orgStats: (statsResult.org_stats ?? []).map(({ name, count }) => ({ name, count })),
    topIndustries: statsResult.top_industries,
    organizations,
    filterOptions: statsResult.filter_options,
  });
}
