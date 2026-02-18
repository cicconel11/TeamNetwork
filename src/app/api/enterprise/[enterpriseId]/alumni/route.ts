import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getEnterpriseApiContext, ENTERPRISE_ANY_ROLE } from "@/lib/auth/enterprise-api-context";
import { sanitizeIlikeInput } from "@/lib/security/validation";

const alumniSearchSchema = z.object({
  org: z.string().uuid().optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  industry: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  city: z.string().max(200).optional(),
  position: z.string().max(200).optional(),
  hasEmail: z.enum(["true", "false"]).optional(),
  hasPhone: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

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

  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_ANY_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  // Get organization IDs for this enterprise
  const { data: orgs } = await ctx.serviceSupabase
    .from("organizations")
    .select("id, name, slug")
    .eq("enterprise_id", ctx.enterpriseId);

  if (!orgs || orgs.length === 0) {
    return respond({ alumni: [], total: 0 });
  }

  const orgIds = orgs.map((o) => o.id);
  const orgMap = new Map(orgs.map((o) => [o.id, { name: o.name, slug: o.slug }]));

  // Parse and validate filters
  const rawParams = Object.fromEntries(
    [...searchParams.entries()].filter(([, v]) => v !== "")
  );
  const parsed = alumniSearchSchema.safeParse(rawParams);

  if (!parsed.success) {
    const details = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "param"}: ${issue.message}`
    );
    return respond({ error: "Invalid search parameters", details }, 400);
  }

  const filters = parsed.data;

  // Build query
  let query = ctx.serviceSupabase
    .from("alumni")
    .select("*", { count: "exact" })
    .is("deleted_at", null);

  // Filter by organization(s)
  if (filters.org && orgIds.includes(filters.org)) {
    query = query.eq("organization_id", filters.org);
  } else {
    query = query.in("organization_id", orgIds);
  }

  // Apply filters with sanitized ilike values
  if (filters.year !== undefined) {
    query = query.eq("graduation_year", filters.year);
  }
  if (filters.industry) {
    query = query.ilike("industry", `%${sanitizeIlikeInput(filters.industry)}%`);
  }
  if (filters.company) {
    query = query.ilike("current_company", `%${sanitizeIlikeInput(filters.company)}%`);
  }
  if (filters.city) {
    query = query.ilike("current_city", `%${sanitizeIlikeInput(filters.city)}%`);
  }
  if (filters.position) {
    query = query.ilike("position_title", `%${sanitizeIlikeInput(filters.position)}%`);
  }
  if (filters.hasEmail === "true") {
    query = query.not("email", "is", null);
  } else if (filters.hasEmail === "false") {
    query = query.is("email", null);
  }
  if (filters.hasPhone === "true") {
    query = query.not("phone_number", "is", null);
  } else if (filters.hasPhone === "false") {
    query = query.is("phone_number", null);
  }

  // Apply pagination and ordering
  query = query
    .order("graduation_year", { ascending: false, nullsFirst: false })
    .order("last_name", { ascending: true })
    .range(filters.offset, filters.offset + filters.limit - 1);

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
    limit: filters.limit,
    offset: filters.offset,
  });
}
