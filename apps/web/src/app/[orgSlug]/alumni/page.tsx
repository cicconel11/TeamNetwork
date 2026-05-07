import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Avatar, Button, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { AlumniFilters, AlumniActionsProvider, AlumniActionsMenu, AlumniImportPanel, AlumniSelectableGrid } from "@/components/alumni";
import { uniqueStringsCaseInsensitive } from "@/lib/string-utils";
import { resolveLabel, resolveActionLabel } from "@/lib/navigation/label-resolver";
import { getLocale, getTranslations } from "next-intl/server";
import { resolveDataClient } from "@/lib/auth/dev-admin";
import { getOrgRole } from "@/lib/auth/roles";
import { canEditNavItem } from "@/lib/navigation/permissions";
import type { NavConfig } from "@/lib/navigation/nav-items";
import { DirectoryViewTracker } from "@/components/analytics/DirectoryViewTracker";
import { DirectoryCardLink } from "@/components/analytics/DirectoryCardLink";
import { LinkedInBadge } from "@/components/shared";
import { sanitizeIlikeInput } from "@/lib/security/validation";

const PAGE_SIZE = 50;
const FACET_ROW_CAP = 5000;

interface AlumniPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    year?: string;
    birthYear?: string;
    industry?: string;
    company?: string;
    city?: string;
    position?: string;
    page?: string;
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
  birth_year: number | null;
  industry: string | null;
  current_city: string | null;
  linkedin_url: string | null;
}

export default async function AlumniPage({ params, searchParams }: AlumniPageProps) {
  const { orgSlug } = await params;

  const filters = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Alumni access gate removed — all org members can view the alumni directory
  const dataClient = resolveDataClient(user, supabase, "view_members");

  const normalize = (value?: string) => value?.trim() || "";

  // Fetch organization
  const { data: orgs, error: orgError } = await dataClient
    .from("organizations")
    .select("id, slug, nav_config")
    .eq("slug", orgSlug)
    .limit(1);

  const org = orgs?.[0];

  if (!org || orgError) return null;

  const navConfig = org.nav_config as NavConfig | null;
  const { role } = await getOrgRole({ orgId: org.id });
  const canEdit = canEditNavItem(navConfig, "/alumni", role, ["admin"]);

  const currentPage = Math.max(1, parseInt(filters.page ?? "1", 10) || 1);
  const offset = (currentPage - 1) * PAGE_SIZE;

  // Query alumni directly — the alumni table is the source of truth
  let query = dataClient
    .from("alumni")
    .select(
      `
      id, first_name, last_name, photo_url, position_title, job_title, current_company,
      graduation_year, birth_year, industry, current_city, linkedin_url
    `,
      { count: "exact" },
    )
    .eq("organization_id", org.id)
    .is("deleted_at", null);

  // Apply filters
  if (filters.year) {
    query = query.eq("graduation_year", parseInt(filters.year));
  }
  if (filters.birthYear) {
    query = query.eq("birth_year", parseInt(filters.birthYear));
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

  // Apply ordering + pagination window
  query = query
    .order("graduation_year", { ascending: false, nullsFirst: false })
    .order("last_name", { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);

  const { data: rawAlumni, count: totalCount } = await query;

  const alumni: AlumniRecord[] = (rawAlumni as AlumniRecord[] | null) || [];
  const total = totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Get unique values for filter dropdowns (from all alumni, not just filtered).
  // Cap at FACET_ROW_CAP rows — follow-up: move to RPC get_alumni_facet_options.
  const { data: allAlumni } = await dataClient
    .from("alumni")
    .select("graduation_year, birth_year, industry, current_company, current_city, position_title")
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .limit(FACET_ROW_CAP);

  const years = [...new Set(allAlumni?.map((a) => a.graduation_year).filter(Boolean))];
  const birthYears = [...new Set(allAlumni?.map((a) => a.birth_year).filter(Boolean))];
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
    filters.year || filters.birthYear || filters.industry || filters.company || filters.city || filters.position;

  const [tNav, locale] = await Promise.all([getTranslations("nav.items"), getLocale()]);
  const t = (key: string) => tNav(key);
  const pageLabel = resolveLabel("/alumni", navConfig, t, locale);
  const actionLabel = resolveActionLabel("/alumni", navConfig, "Add", t, locale);
  const tAlumni = await getTranslations("alumni");
  const tMembers2 = await getTranslations("members");
  const tActions = await getTranslations("pages.actions");

  // Preserve active filters across pagination links
  const filterParams = new URLSearchParams();
  if (filters.year) filterParams.set("year", filters.year);
  if (filters.birthYear) filterParams.set("birthYear", filters.birthYear);
  if (filters.industry) filterParams.set("industry", filters.industry);
  if (filters.company) filterParams.set("company", filters.company);
  if (filters.city) filterParams.set("city", filters.city);
  if (filters.position) filterParams.set("position", filters.position);
  const paginationBase = filterParams.toString() ? `?${filterParams.toString()}&` : "?";

  const pageContent = (
    <div className="animate-fade-in">
      <DirectoryViewTracker organizationId={org.id} directoryType="alumni" />
      <PageHeader
        title={pageLabel}
        description={`${total} ${pageLabel.toLowerCase()}${hasActiveFilters ? ` ${tActions("filtered")}` : ` ${tActions("inOurNetwork")}`}`}
        actions={
          canEdit && (
            <AlumniActionsMenu
              orgSlug={orgSlug}
              actionLabel={actionLabel}
            />
          )
        }
      />

      {/* Dynamic Filters */}
      <AlumniFilters
        orgId={org.id}
        years={years}
        birthYears={birthYears}
        industries={industries}
        companies={companies}
        cities={cities}
        positions={positions}
      />

      {/* Import panel (admin only, toggled from dropdown) */}
      {canEdit && <AlumniImportPanel organizationId={org.id} orgSlug={orgSlug} />}

      {/* Alumni Grid */}
      {alumni && alumni.length > 0 ? (
        <>
        {canEdit ? (
          <AlumniSelectableGrid
            alumni={alumni}
            orgSlug={orgSlug}
            organizationId={org.id}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
            {alumni.map((alum) => (
              <Card key={alum.id} interactive className="p-5" data-testid="alumni-row">
                <div className="flex items-center gap-4">
                  <DirectoryCardLink
                    href={`/${orgSlug}/alumni/${alum.id}`}
                    organizationId={org.id}
                    directoryType="alumni"
                    className="flex min-w-0 flex-1 items-center gap-4"
                  >
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
                          <Badge variant="muted">{tMembers2("classOf", { year: alum.graduation_year })}</Badge>
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
                  </DirectoryCardLink>
                  <LinkedInBadge linkedinUrl={alum.linkedin_url} className="shrink-0" />
                </div>
              </Card>
            ))}
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6">
            <p className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </p>
            <div className="flex gap-2">
              {currentPage > 1 && (
                <Link href={`/${orgSlug}/alumni${paginationBase}page=${currentPage - 1}`}>
                  <Button variant="secondary" size="sm">Previous</Button>
                </Link>
              )}
              {currentPage < totalPages && (
                <Link href={`/${orgSlug}/alumni${paginationBase}page=${currentPage + 1}`}>
                  <Button variant="secondary" size="sm">Next</Button>
                </Link>
              )}
            </div>
          </div>
        )}
        </>
      ) : (
        <Card>
          <EmptyState
            icon={
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
              </svg>
            }
            title={tAlumni("noAlumniFound", { label: pageLabel.toLowerCase() })}
            description={hasActiveFilters ? tAlumni("tryAdjustingFilters") : tAlumni("noAlumniInDirectory", { label: pageLabel.toLowerCase() })}
            action={
              canEdit && !hasActiveFilters && (
                <Link href={`/${orgSlug}/alumni/new`}>
                  <Button>{resolveActionLabel("/alumni", navConfig, "Add First", t, locale)}</Button>
                </Link>
              )
            }
          />
        </Card>
      )}
    </div>
  );

  // Wrap with provider so the menu (in header) can toggle the import panel (in body)
  if (canEdit) {
    return <AlumniActionsProvider>{pageContent}</AlumniActionsProvider>;
  }

  return pageContent;
}
