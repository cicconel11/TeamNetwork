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

// Field mappings for export
const FIELD_LABELS: Record<string, string> = {
  first_name: "First Name",
  last_name: "Last Name",
  email: "Email",
  phone_number: "Phone",
  organization_name: "Organization",
  graduation_year: "Graduation Year",
  major: "Major",
  industry: "Industry",
  current_company: "Company",
  position_title: "Position",
  current_city: "City",
  linkedin_url: "LinkedIn URL",
  notes: "Notes",
};

export async function GET(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;
  const { searchParams } = new URL(req.url);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise alumni export",
    limitPerIp: 20,
    limitPerUser: 10,
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

  // Parse export parameters
  const format = searchParams.get("format") || "csv";
  const fieldsParam = searchParams.get("fields");
  const idsParam = searchParams.get("ids");
  const fields = fieldsParam ? fieldsParam.split(",") : Object.keys(FIELD_LABELS);

  // Get organization IDs for this enterprise
  const { data: orgs } = await serviceSupabase
    .from("organizations")
    .select("id, name, slug")
    .eq("enterprise_id", resolvedEnterpriseId)
    .is("deleted_at", null);

  if (!orgs || orgs.length === 0) {
    return respond({ error: "No organizations found" }, 404);
  }

  const orgIds = orgs.map((o) => o.id);
  const orgMap = new Map(orgs.map((o) => [o.id, o.name]));

  // Build query
  let query = serviceSupabase
    .from("alumni")
    .select("*")
    .in("organization_id", orgIds)
    .is("deleted_at", null);

  // Filter by specific IDs if provided
  if (idsParam) {
    const ids = idsParam.split(",");
    query = query.in("id", ids);
  }

  // Apply same filters as list endpoint
  const orgFilter = searchParams.get("org");
  const yearFilter = searchParams.get("year");
  const industryFilter = searchParams.get("industry");
  const companyFilter = searchParams.get("company");
  const cityFilter = searchParams.get("city");
  const positionFilter = searchParams.get("position");
  const hasEmailFilter = searchParams.get("hasEmail");
  const hasPhoneFilter = searchParams.get("hasPhone");

  if (orgFilter && orgIds.includes(orgFilter)) {
    query = query.eq("organization_id", orgFilter);
  }
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

  query = query.order("last_name", { ascending: true });

  const { data: alumni, error } = await query;

  if (error) {
    return respond({ error: error.message }, 400);
  }

  if (!alumni || alumni.length === 0) {
    return respond({ error: "No alumni found matching criteria" }, 404);
  }

  // Add organization name to alumni
  const alumniWithOrg = alumni.map((alum) => ({
    ...alum,
    organization_name: orgMap.get(alum.organization_id) ?? "Unknown",
  }));

  // Generate export
  const validFields = fields.filter((f) => FIELD_LABELS[f]);
  const headers = validFields.map((f) => FIELD_LABELS[f]);

  // Escape CSV value
  const escapeCSV = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  if (format === "csv") {
    const csvRows = [
      headers.join(","),
      ...alumniWithOrg.map((alum) =>
        validFields.map((field) => escapeCSV(alum[field as keyof typeof alum])).join(",")
      ),
    ];

    const csvContent = csvRows.join("\n");
    const now = new Date().toISOString().split("T")[0];
    const filename = `alumni-export-${now}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        ...rateLimit.headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // For XLSX, return a simpler format that the client can use
  // Full XLSX generation would require a library like exceljs
  // For now, return tab-separated values that Excel can open
  if (format === "xlsx") {
    const tsvRows = [
      headers.join("\t"),
      ...alumniWithOrg.map((alum) =>
        validFields.map((field) => {
          const value = alum[field as keyof typeof alum];
          if (value === null || value === undefined) return "";
          return String(value).replace(/\t/g, " ").replace(/\n/g, " ");
        }).join("\t")
      ),
    ];

    const tsvContent = tsvRows.join("\n");
    const now = new Date().toISOString().split("T")[0];
    const filename = `alumni-export-${now}.xls`;

    return new NextResponse(tsvContent, {
      status: 200,
      headers: {
        ...rateLimit.headers,
        "Content-Type": "application/vnd.ms-excel",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return respond({ error: "Invalid format. Use 'csv' or 'xlsx'." }, 400);
}
