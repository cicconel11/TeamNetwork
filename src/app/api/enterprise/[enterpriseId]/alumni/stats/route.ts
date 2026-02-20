import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getEnterpriseApiContext, ENTERPRISE_ANY_ROLE } from "@/lib/auth/enterprise-api-context";
import { uniqueStringsCaseInsensitive } from "@/lib/string-utils";

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

  // Get all organizations for this enterprise
  const { data: orgs } = await ctx.serviceSupabase
    .from("organizations")
    .select("id, name, slug")
    .eq("enterprise_id", ctx.enterpriseId);

  if (!orgs || orgs.length === 0) {
    return respond({
      totalCount: 0,
      orgStats: [],
      topIndustries: [],
      organizations: [],
      filterOptions: {
        years: [],
        industries: [],
        companies: [],
        cities: [],
        positions: [],
      },
    });
  }

  const orgIds = orgs.map((o) => o.id);

  // Get all alumni for these organizations (select only needed fields for stats)
  // Limit prevents unbounded full-table scans on large enterprises
  const { data: alumni } = await ctx.serviceSupabase
    .from("alumni")
    .select("id, organization_id, graduation_year, industry, current_company, current_city, position_title")
    .in("organization_id", orgIds)
    .is("deleted_at", null)
    .limit(10000);

  const alumniList = alumni ?? [];
  const totalCount = alumniList.length;

  // Calculate org stats
  const orgCounts = new Map<string, number>();
  for (const alum of alumniList) {
    const count = orgCounts.get(alum.organization_id) || 0;
    orgCounts.set(alum.organization_id, count + 1);
  }

  const orgStats = orgs
    .map((org) => ({
      name: org.name,
      count: orgCounts.get(org.id) || 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Calculate industry stats
  const industryCounts = new Map<string, number>();
  for (const alum of alumniList) {
    if (alum.industry) {
      const normalized = alum.industry.toLowerCase().trim();
      const count = industryCounts.get(normalized) || 0;
      industryCounts.set(normalized, count + 1);
    }
  }

  const topIndustries = Array.from(industryCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((i) => ({
      name: i.name.charAt(0).toUpperCase() + i.name.slice(1),
      count: i.count,
    }));

  // Build filter options
  const years = [...new Set(alumniList.map((a) => a.graduation_year).filter(Boolean))].sort(
    (a, b) => (b ?? 0) - (a ?? 0)
  );
  const industries = uniqueStringsCaseInsensitive(
    alumniList.map((a) => a.industry).filter(Boolean) as string[]
  ).sort();
  const companies = uniqueStringsCaseInsensitive(
    alumniList.map((a) => a.current_company).filter(Boolean) as string[]
  ).sort();
  const cities = uniqueStringsCaseInsensitive(
    alumniList.map((a) => a.current_city).filter(Boolean) as string[]
  ).sort();
  const positions = uniqueStringsCaseInsensitive(
    alumniList.map((a) => a.position_title).filter(Boolean) as string[]
  ).sort();

  return respond({
    totalCount,
    orgStats,
    topIndustries,
    organizations: orgs.map((o) => ({ id: o.id, name: o.name })),
    filterOptions: {
      years,
      industries,
      companies,
      cities,
      positions,
    },
  });
}
