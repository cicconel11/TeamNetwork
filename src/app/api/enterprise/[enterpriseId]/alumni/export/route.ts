import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getEnterpriseApiContext, ENTERPRISE_ANY_ROLE } from "@/lib/auth/enterprise-api-context";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";
import { sanitizeIlikeInput } from "@/lib/security/validation";

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

const alumniExportSchema = z.object({
  format: z.enum(["csv", "xlsx"]).default("csv"),
  fields: z
    .string()
    .max(2000)
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      const allowed = Object.keys(FIELD_LABELS);
      return val
        .split(",")
        .filter((f) => allowed.includes(f.trim()))
        .join(",") || undefined;
    }),
  ids: z
    .string()
    .max(10000)
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const parts = val.split(",").map((id) => id.trim());
      return parts.every((id) => uuidRegex.test(id))
        ? parts.join(",")
        : undefined;
    }),
  org: z.string().uuid().optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  industry: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  city: z.string().max(200).optional(),
  position: z.string().max(200).optional(),
  hasEmail: z.enum(["true", "false"]).optional(),
  hasPhone: z.enum(["true", "false"]).optional(),
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
    feature: "enterprise alumni export",
    limitPerIp: 20,
    limitPerUser: 10,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_ANY_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  // Parse and validate export parameters
  const rawParams = Object.fromEntries(
    [...searchParams.entries()].filter(([, v]) => v !== "")
  );
  const parsed = alumniExportSchema.safeParse(rawParams);

  if (!parsed.success) {
    const details = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "param"}: ${issue.message}`
    );
    return respond({ error: "Invalid export parameters", details }, 400);
  }

  const filters = parsed.data;
  const fields = filters.fields
    ? filters.fields.split(",")
    : Object.keys(FIELD_LABELS);

  // Get organization IDs for this enterprise
  const { data: orgs } = await ctx.serviceSupabase
    .from("organizations")
    .select("id, name, slug")
    .eq("enterprise_id", ctx.enterpriseId);

  if (!orgs || orgs.length === 0) {
    return respond({ error: "No organizations found" }, 404);
  }

  const orgIds = orgs.map((o) => o.id);
  const orgMap = new Map(orgs.map((o) => [o.id, o.name]));

  // Build query
  let query = ctx.serviceSupabase
    .from("alumni")
    .select("id, organization_id, first_name, last_name, email, phone_number, photo_url, linkedin_url, notes, graduation_year, major, industry, current_company, current_city, position_title, job_title")
    .in("organization_id", orgIds)
    .is("deleted_at", null);

  // Filter by specific IDs if provided
  if (filters.ids) {
    const ids = filters.ids.split(",");
    query = query.in("id", ids);
  }

  // Apply filters with sanitized ilike values
  if (filters.org && orgIds.includes(filters.org)) {
    query = query.eq("organization_id", filters.org);
  }
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

  query = query.order("last_name", { ascending: true });

  const { data: alumni, error } = await query;

  if (error) {
    console.error("[enterprise/alumni/export GET] DB error:", error);
    return respond({ error: "Internal server error" }, 500);
  }

  if (!alumni || alumni.length === 0) {
    return respond({ error: "No alumni found matching criteria" }, 404);
  }

  // Add organization name to alumni (explicit fields — no spread)
  const alumniWithOrg = alumni.map((alum) => ({
    id: alum.id,
    organization_id: alum.organization_id,
    first_name: alum.first_name,
    last_name: alum.last_name,
    email: alum.email,
    phone_number: alum.phone_number,
    photo_url: alum.photo_url,
    linkedin_url: alum.linkedin_url,
    notes: alum.notes,
    graduation_year: alum.graduation_year,
    major: alum.major,
    industry: alum.industry,
    current_company: alum.current_company,
    current_city: alum.current_city,
    position_title: alum.position_title,
    job_title: alum.job_title,
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

  if (filters.format === "csv") {
    const csvRows = [
      headers.join(","),
      ...alumniWithOrg.map((alum) =>
        validFields.map((field) => escapeCSV(alum[field as keyof typeof alum])).join(",")
      ),
    ];

    const csvContent = csvRows.join("\n");
    const now = new Date().toISOString().split("T")[0];
    const filename = `alumni-export-${now}.csv`;

    logEnterpriseAuditAction({
      actorUserId: ctx.userId,
      actorEmail: ctx.userEmail,
      action: "export_alumni_data",
      enterpriseId: ctx.enterpriseId,
      targetType: "alumni",
      targetId: ctx.enterpriseId,
      metadata: { format: filters.format, recordCount: alumniWithOrg.length, fields: validFields },
      ...extractRequestContext(req),
    });

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
  if (filters.format === "xlsx") {
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

    logEnterpriseAuditAction({
      actorUserId: ctx.userId,
      actorEmail: ctx.userEmail,
      action: "export_alumni_data",
      enterpriseId: ctx.enterpriseId,
      targetType: "alumni",
      targetId: ctx.enterpriseId,
      metadata: { format: filters.format, recordCount: alumniWithOrg.length, fields: validFields },
      ...extractRequestContext(req),
    });

    return new NextResponse(tsvContent, {
      status: 200,
      headers: {
        ...rateLimit.headers,
        "Content-Type": "text/tab-separated-values; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return respond({ error: "Invalid format. Use 'csv' or 'xlsx'." }, 400);
}
