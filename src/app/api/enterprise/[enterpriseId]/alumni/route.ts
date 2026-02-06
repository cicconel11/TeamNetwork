import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { requireEnterpriseRole } from "@/lib/auth/enterprise-roles";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;
  const { searchParams } = new URL(req.url);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise alumni",
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

  try {
    await requireEnterpriseRole(resolvedEnterpriseId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    if (message === "Unauthorized") {
      return respond({ error: "Unauthorized" }, 401);
    }
    return respond({ error: "Forbidden" }, 403);
  }

  // Get organization IDs for this enterprise
  const { data: orgs } = await serviceSupabase
    .from("organizations")
    .select("id, name, slug")
    .eq("enterprise_id", resolvedEnterpriseId);

  if (!orgs || orgs.length === 0) {
    return respond({ alumni: [], total: 0 });
  }

  const orgIds = orgs.map((o) => o.id);
  const orgMap = new Map(orgs.map((o) => [o.id, { name: o.name, slug: o.slug }]));

  // Parse filters
  const orgFilter = searchParams.get("org");
  const yearFilter = searchParams.get("year");
  const industryFilter = searchParams.get("industry");
  const companyFilter = searchParams.get("company");
  const cityFilter = searchParams.get("city");
  const positionFilter = searchParams.get("position");
  const hasEmailFilter = searchParams.get("hasEmail");
  const hasPhoneFilter = searchParams.get("hasPhone");
  const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 500);
  const offset = parseInt(searchParams.get("offset") || "0");

  // Build query
  let query = serviceSupabase
    .from("alumni")
    .select("*", { count: "exact" })
    .is("deleted_at", null);

  // Filter by organization(s)
  if (orgFilter && orgIds.includes(orgFilter)) {
    query = query.eq("organization_id", orgFilter);
  } else {
    query = query.in("organization_id", orgIds);
  }

  // Apply filters
  if (yearFilter) {
    query = query.eq("graduation_year", parseInt(yearFilter));
  }
  if (industryFilter) {
    query = query.ilike("industry", industryFilter);
  }
  if (companyFilter) {
    query = query.ilike("current_company", companyFilter);
  }
  if (cityFilter) {
    query = query.ilike("current_city", cityFilter);
  }
  if (positionFilter) {
    query = query.ilike("position_title", positionFilter);
  }
  if (hasEmailFilter === "true") {
    query = query.not("email", "is", null);
  } else if (hasEmailFilter === "false") {
    query = query.is("email", null);
  }
  if (hasPhoneFilter === "true") {
    query = query.not("phone_number", "is", null);
  } else if (hasPhoneFilter === "false") {
    query = query.is("phone_number", null);
  }

  // Apply pagination and ordering
  query = query
    .order("graduation_year", { ascending: false, nullsFirst: false })
    .order("last_name", { ascending: true })
    .range(offset, offset + limit - 1);

  const { data: alumni, count, error } = await query;

  if (error) {
    return respond({ error: error.message }, 400);
  }

  // Add organization info to each alumni
  const alumniWithOrg = (alumni ?? []).map((alum) => {
    const org = orgMap.get(alum.organization_id);
    return {
      ...alum,
      organization_name: org?.name ?? "Unknown",
      organization_slug: org?.slug ?? "",
    };
  });

  return respond({
    alumni: alumniWithOrg,
    total: count ?? 0,
    limit,
    offset,
  });
}
