/* eslint-disable @typescript-eslint/no-explicit-any */
import { sanitizeIlikeInput } from "@/lib/security/validation";
import type { ListEnterpriseAlumniArgs } from "../definitions";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EnterpriseToolSupabase = any;

export async function listEnterpriseAlumni(
  serviceSupabase: EnterpriseToolSupabase,
  enterpriseId: string,
  args: ListEnterpriseAlumniArgs,
) {
  const limit = Math.min(args.limit ?? 25, 100);
  const offset = Math.max(args.offset ?? 0, 0);

  const { data: orgRows, error: orgError } = await serviceSupabase
    .from("organizations")
    .select("id, name, slug")
    .eq("enterprise_id", enterpriseId)
    .order("name", { ascending: true });

  if (orgError) {
    return { data: null, error: orgError };
  }

  const organizations = Array.isArray(orgRows) ? orgRows : [];
  const normalizedOrgFilter = args.org?.trim().toLowerCase() ?? "";
  const matchingOrganizations =
    normalizedOrgFilter.length === 0
      ? organizations
      : organizations.filter((organization) => {
          const matchesId =
            UUID_PATTERN.test(normalizedOrgFilter) &&
            organization.id.toLowerCase() === normalizedOrgFilter;
          const matchesSlug = organization.slug.toLowerCase() === normalizedOrgFilter;
          const matchesName = organization.name.toLowerCase().includes(normalizedOrgFilter);
          return matchesId || matchesSlug || matchesName;
        });

  if (normalizedOrgFilter.length > 0 && matchingOrganizations.length === 0) {
    return {
      data: {
        total: 0,
        limit,
        offset,
        matched_orgs: [],
        results: [],
      },
      error: null,
    };
  }

  let query = serviceSupabase
    .from("enterprise_alumni_directory")
    .select(
      "id, first_name, last_name, graduation_year, industry, current_company, current_city, position_title, job_title, linkedin_url, email, phone_number, organization_id, organization_name, organization_slug",
      { count: "exact" },
    )
    .eq("enterprise_id", enterpriseId)
    .order("graduation_year", { ascending: false, nullsFirst: false })
    .order("last_name", { ascending: true });

  if (matchingOrganizations.length > 0) {
    query = query.in(
      "organization_id",
      matchingOrganizations.map((organization) => organization.id),
    );
  }
  if (args.graduation_year !== undefined) {
    query = query.eq("graduation_year", args.graduation_year);
  }
  if (args.industry) {
    query = query.ilike("industry", `%${sanitizeIlikeInput(args.industry)}%`);
  }
  if (args.company) {
    query = query.ilike("current_company", `%${sanitizeIlikeInput(args.company)}%`);
  }
  if (args.city) {
    query = query.ilike("current_city", `%${sanitizeIlikeInput(args.city)}%`);
  }
  if (args.position) {
    const sanitizedPosition = sanitizeIlikeInput(args.position);
    query = query.or(
      `position_title.ilike.%${sanitizedPosition}%,job_title.ilike.%${sanitizedPosition}%`,
    );
  }
  if (args.has_email === true) {
    query = query.not("email", "is", null);
  } else if (args.has_email === false) {
    query = query.is("email", null);
  }
  if (args.has_phone === true) {
    query = query.not("phone_number", "is", null);
  } else if (args.has_phone === false) {
    query = query.is("phone_number", null);
  }

  const { data, count, error } = await query.range(offset, offset + limit - 1);

  if (error) {
    return { data: null, error };
  }

  return {
    data: {
      total: count ?? 0,
      limit,
      offset,
      matched_orgs: matchingOrganizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      })),
      results: Array.isArray(data)
        ? data.map((row) => ({
            id: row.id,
            name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
            graduation_year: row.graduation_year ?? null,
            industry: row.industry ?? null,
            current_company: row.current_company ?? null,
            current_city: row.current_city ?? null,
            title: row.position_title ?? row.job_title ?? null,
            linkedin_url: row.linkedin_url ?? null,
            email: row.email ?? null,
            phone_number: row.phone_number ?? null,
            organization_id: row.organization_id ?? null,
            organization_name: row.organization_name ?? null,
            organization_slug: row.organization_slug ?? null,
          }))
        : [],
    },
    error: null,
  };
}
