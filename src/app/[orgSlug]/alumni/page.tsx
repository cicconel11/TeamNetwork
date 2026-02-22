import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { Card, Badge, Avatar, Button, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { AlumniFilters } from "@/components/alumni";
import { uniqueStringsCaseInsensitive } from "@/lib/string-utils";
import { resolveLabel, resolveActionLabel } from "@/lib/navigation/label-resolver";
import { canDevAdminPerform } from "@/lib/auth/dev-admin";
import { getOrgRole } from "@/lib/auth/roles";
import { canEditNavItem } from "@/lib/navigation/permissions";
import type { NavConfig } from "@/lib/navigation/nav-items";
import { DirectoryViewTracker } from "@/components/analytics/DirectoryViewTracker";
import { DirectoryCardLink } from "@/components/analytics/DirectoryCardLink";
import { sanitizeIlikeInput } from "@/lib/security/validation";

interface AlumniPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    year?: string;
    industry?: string;
    company?: string;
    city?: string;
    position?: string;
  }>;
}

interface AlumniRecord {
  id: string;
  first_name: string;
  last_name: string;
  photo_url: string | null;
  position_title: string | null;
  job_title: string | null;
  current_company: string | null;
  graduation_year: number | null;
  industry: string | null;
  current_city: string | null;
}

export default async function AlumniPage({ params, searchParams }: AlumniPageProps) {
  const { orgSlug } = await params;
  const filters = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isDevAdmin = canDevAdminPerform(user, "view_members");
  let dataClient = supabase;
  if (isDevAdmin) {
    try {
      dataClient = createServiceClient();
    } catch (error) {
      console.warn("DevAdmin: Failed to create service client (missing key?)", error);
    }
  }

  const normalize = (value?: string) => value?.trim() || "";

  // Fetch organization
  const { data: orgs, error: orgError } = await dataClient
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .limit(1);

  const org = orgs?.[0];

  if (!org || orgError) return null;

  const navConfig = org.nav_config as NavConfig | null;
  const { role } = await getOrgRole({ orgId: org.id });
  const canEdit = canEditNavItem(navConfig, "/alumni", role, ["admin"]);

  // Query alumni directly — the alumni table is the source of truth
  let query = dataClient
    .from("alumni")
    .select(`
      id, first_name, last_name, photo_url, position_title, job_title, current_company,
      graduation_year, industry, current_city
    `)
    .eq("organization_id", org.id)
    .is("deleted_at", null);

  // Apply filters
  if (filters.year) {
    query = query.eq("graduation_year", parseInt(filters.year));
  }
  const industry = normalize(filters.industry);
  if (industry) {
    query = query.ilike("industry", sanitizeIlikeInput(industry));
  }
  const company = normalize(filters.company);
  if (company) {
    query = query.ilike("current_company", sanitizeIlikeInput(company));
  }
  const city = normalize(filters.city);
  if (city) {
    query = query.ilike("current_city", sanitizeIlikeInput(city));
  }
  const position = normalize(filters.position);
  if (position) {
    query = query.ilike("position_title", sanitizeIlikeInput(position));
  }

  // Apply ordering after all filters
  query = query.order("graduation_year", { ascending: false });

  const { data: rawAlumni } = await query;

  const alumni: AlumniRecord[] = (rawAlumni as AlumniRecord[] | null) || [];

  // Get unique values for filter dropdowns (from all alumni, not just filtered)
  const { data: allAlumni } = await dataClient
    .from("alumni")
    .select("graduation_year, industry, current_company, current_city, position_title")
    .eq("organization_id", org.id)
    .is("deleted_at", null);

  const years = [...new Set(allAlumni?.map((a) => a.graduation_year).filter(Boolean))];
  const industries = uniqueStringsCaseInsensitive(allAlumni?.map((a) => a.industry) ?? []).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  const companies = uniqueStringsCaseInsensitive(allAlumni?.map((a) => a.current_company) ?? []).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  const cities = uniqueStringsCaseInsensitive(allAlumni?.map((a) => a.current_city) ?? []).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  const positions = uniqueStringsCaseInsensitive(allAlumni?.map((a) => a.position_title) ?? []).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  const hasActiveFilters =
    filters.year || filters.industry || filters.company || filters.city || filters.position;

  const pageLabel = resolveLabel("/alumni", navConfig);
  const actionLabel = resolveActionLabel("/alumni", navConfig);

  return (
    <div className="animate-fade-in">
      <DirectoryViewTracker organizationId={org.id} directoryType="alumni" />
      <PageHeader
        title={pageLabel}
        description={`${alumni?.length || 0} ${pageLabel.toLowerCase()}${hasActiveFilters ? " (filtered)" : " in our network"}`}
        actions={
          canEdit && (
            <Link href={`/${orgSlug}/alumni/new`}>
              <Button>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                {actionLabel}
              </Button>
            </Link>
          )
        }
      />

      {/* Dynamic Filters */}
      <AlumniFilters
        orgId={org.id}
        years={years}
        industries={industries}
        companies={companies}
        cities={cities}
        positions={positions}
      />

      {/* Alumni Grid */}
      {alumni && alumni.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
          {alumni.map((alum) => (
            <DirectoryCardLink
              key={alum.id}
              href={`/${orgSlug}/alumni/${alum.id}`}
              organizationId={org.id}
              directoryType="alumni"
            >
              <Card interactive className="p-5">
                <div className="flex items-center gap-4">
                  <Avatar
                    src={alum.photo_url}
                    name={`${alum.first_name} ${alum.last_name}`}
                    size="lg"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground truncate">
                      {alum.first_name} {alum.last_name}
                    </h3>
                    {(alum.position_title || alum.job_title) && (
                      <p className="text-sm text-muted-foreground truncate">
                        {alum.position_title || alum.job_title}
                        {alum.current_company && ` at ${alum.current_company}`}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {alum.graduation_year && (
                        <Badge variant="muted">Class of {alum.graduation_year}</Badge>
                      )}
                      {alum.industry && (
                        <Badge variant="primary">{alum.industry}</Badge>
                      )}
                      {alum.current_city && (
                        <span className="text-xs text-muted-foreground truncate">
                          {alum.current_city}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            </DirectoryCardLink>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
              </svg>
            }
            title={`No ${pageLabel.toLowerCase()} found`}
            description={hasActiveFilters ? "Try adjusting your filters" : `No ${pageLabel.toLowerCase()} in the directory yet`}
            action={
              canEdit && !hasActiveFilters && (
                <Link href={`/${orgSlug}/alumni/new`}>
                  <Button>{resolveActionLabel("/alumni", navConfig, "Add First")}</Button>
                </Link>
              )
            }
          />
        </Card>
      )}
    </div>
  );
}
