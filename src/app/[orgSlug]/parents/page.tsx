import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { Card, Badge, Avatar, Button, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { ParentsFilters } from "@/components/parents";
import { resolveLabel, resolveActionLabel } from "@/lib/navigation/label-resolver";
import { canDevAdminPerform } from "@/lib/auth/dev-admin";
import { getOrgContext, getOrgRole } from "@/lib/auth/roles";
import { canEditNavItem } from "@/lib/navigation/permissions";
import type { NavConfig } from "@/lib/navigation/nav-items";
import { DirectoryViewTracker } from "@/components/analytics/DirectoryViewTracker";
import { DirectoryCardLink } from "@/components/analytics/DirectoryCardLink";
import { sanitizeIlikeInput } from "@/lib/security/validation";

const PAGE_SIZE = 50;

interface ParentsPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    relationship?: string;
    student_name?: string;
    page?: string;
  }>;
}

interface ParentRecord {
  id: string;
  first_name: string;
  last_name: string;
  photo_url: string | null;
  relationship: string | null;
  student_name: string | null;
  email: string | null;
}

export default async function ParentsPage({ params, searchParams }: ParentsPageProps) {
  const { orgSlug } = await params;

  const orgContext = await getOrgContext(orgSlug);
  if (!orgContext.hasParentsAccess) {
    redirect(`/${orgSlug}`);
  }

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
  const canEdit = canEditNavItem(navConfig, "/parents", role, ["admin"]);

  const currentPage = Math.max(1, parseInt(filters.page ?? "1", 10) || 1);
  const offset = (currentPage - 1) * PAGE_SIZE;

  // Query parents table with exact count for pagination
  let query = dataClient
    .from("parents")
    .select("id, first_name, last_name, photo_url, relationship, student_name, email", { count: "exact" })
    .eq("organization_id", org.id)
    .is("deleted_at", null);

  // Apply filters
  const relationship = normalize(filters.relationship);
  if (relationship) {
    query = query.eq("relationship", relationship);
  }
  const studentName = normalize(filters.student_name);
  if (studentName) {
    query = query.ilike("student_name", `%${sanitizeIlikeInput(studentName)}%`);
  }

  query = query.order("last_name", { ascending: true }).range(offset, offset + PAGE_SIZE - 1);

  // Fetch page of parents and distinct relationship options in parallel
  const [{ data: rawParents, count: totalCount }, { data: relRows }] = await Promise.all([
    query,
    dataClient.rpc("get_parents_relationship_options", { p_org_id: org.id }),
  ]);

  const parents: ParentRecord[] = (rawParents as ParentRecord[] | null) || [];
  const total = totalCount ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const relationships = (relRows as Array<{ relationship: string }> | null ?? []).map((r) => r.relationship);

  const hasActiveFilters = filters.relationship || filters.student_name;

  const pageLabel = resolveLabel("/parents", navConfig) || "Parents";
  const actionLabel = resolveActionLabel("/parents", navConfig) || "Add Parent";

  // Build filter params for pagination links so active filters are preserved across pages
  const filterParams = new URLSearchParams();
  if (filters.relationship) filterParams.set("relationship", filters.relationship);
  if (filters.student_name) filterParams.set("student_name", filters.student_name);
  const paginationBase = filterParams.toString() ? `?${filterParams.toString()}&` : "?";

  return (
    <div className="animate-fade-in">
      <DirectoryViewTracker organizationId={org.id} directoryType="parents" />
      <PageHeader
        title={pageLabel}
        description={`${total} ${pageLabel.toLowerCase()}${hasActiveFilters ? " (filtered)" : " in our network"}`}
        actions={
          canEdit && (
            <Link href={`/${orgSlug}/parents/new`}>
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

      <ParentsFilters orgId={org.id} relationships={relationships} />

      {parents.length > 0 ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
            {parents.map((parent) => (
              <DirectoryCardLink
                key={parent.id}
                href={`/${orgSlug}/parents/${parent.id}`}
                organizationId={org.id}
                directoryType="parents"
              >
                <Card interactive className="p-5">
                  <div className="flex items-center gap-4">
                    <Avatar
                      src={parent.photo_url}
                      name={`${parent.first_name} ${parent.last_name}`}
                      size="lg"
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate">
                        {parent.first_name} {parent.last_name}
                      </h3>
                      {parent.student_name && (
                        <p className="text-sm text-muted-foreground truncate">
                          Parent of {parent.student_name}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {parent.relationship && (
                          <Badge variant="muted">{parent.relationship}</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              </DirectoryCardLink>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <p className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </p>
              <div className="flex gap-2">
                {currentPage > 1 && (
                  <Link href={`/${orgSlug}/parents${paginationBase}page=${currentPage - 1}`}>
                    <Button variant="secondary" size="sm">Previous</Button>
                  </Link>
                )}
                {currentPage < totalPages && (
                  <Link href={`/${orgSlug}/parents${paginationBase}page=${currentPage + 1}`}>
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
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            }
            title={`No ${pageLabel.toLowerCase()} found`}
            description={hasActiveFilters ? "Try adjusting your filters" : `No ${pageLabel.toLowerCase()} in the directory yet`}
            action={
              canEdit && !hasActiveFilters && (
                <Link href={`/${orgSlug}/parents/new`}>
                  <Button>{resolveActionLabel("/parents", navConfig, "Add First Parent")}</Button>
                </Link>
              )
            }
          />
        </Card>
      )}
    </div>
  );
}
