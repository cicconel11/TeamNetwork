import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Avatar, Button, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { getCurrentUser, getOrgContext } from "@/lib/auth/roles";
import { MembersFilter } from "@/components/members/MembersFilter";
import { resolveLabel, resolveActionLabel } from "@/lib/navigation/label-resolver";
import { resolveDataClient, getDevAdminEmails } from "@/lib/auth/dev-admin";
import type { NavConfig } from "@/lib/navigation/nav-items";
import { DirectoryViewTracker } from "@/components/analytics/DirectoryViewTracker";
import { DirectoryCardLink } from "@/components/analytics/DirectoryCardLink";
import { LinkedInBadge } from "@/components/shared";
import {
  buildMemberDirectoryEntries,
  type LinkedMemberDirectoryRow,
  type MemberDirectoryEntry,
  type ParentDirectoryRow,
} from "@/lib/members/directory";

// Pragmatic cap per source until we replace the union with a paginating RPC
// (see follow-up: get_org_member_directory).
const SOURCE_CAP = 500;

interface MembersPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ status?: string; role?: string }>;
}

export default async function MembersPage({ params, searchParams }: MembersPageProps) {
  const { orgSlug } = await params;
  const filters = await searchParams;
  const { organization: org, isAdmin } = await getOrgContext(orgSlug);
  if (!org) notFound();

  const supabase = await createClient();
  const user = await getCurrentUser();
  const dataClient = resolveDataClient(user, supabase, "view_members");

  // Build query with filters
  const devAdminEmails = getDevAdminEmails();
  const devAdminEmailFilter = `(${devAdminEmails.map((email) => `"${email}"`).join(",")})`;

  // Step 1: Get user_ids with active_member, admin, or parent role
  const { data: memberRoles } = await dataClient
    .from("user_organization_roles")
    .select("user_id, role")
    .eq("organization_id", org.id)
    .in("role", ["active_member", "admin", "parent"])
    .eq("status", "active");

  const memberUserIds = memberRoles?.map((r) => r.user_id) || [];
  const parentUserIds = memberRoles
    ?.filter((r) => r.role === "parent")
    .map((r) => r.user_id) || [];
  const adminUserIds = new Set(
    memberRoles?.filter((r) => r.role === "admin").map((r) => r.user_id) || []
  );

  // Step 2a: Query members WITH user accounts that have correct roles
  // Note: no dev-admin email exclusion here — the user_organization_roles
  // check (memberUserIds) already ensures only real org members appear.
  let linkedMembersQuery = dataClient
    .from("members")
    .select("id, first_name, last_name, email, photo_url, role, status, graduation_year, linkedin_url, user_id")
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .not("user_id", "is", null);

  // Only filter by role-matched user_ids if there are any
  if (memberUserIds.length > 0) {
    linkedMembersQuery = linkedMembersQuery.in("user_id", memberUserIds);
  } else {
    // No users with active_member/admin role - return no linked members
    linkedMembersQuery = linkedMembersQuery.in("user_id", ["__no_match__"]);
  }

  // Step 2b: Query members WITHOUT user accounts (manually added) - always show in members tab
  let manualMembersQuery = dataClient
    .from("members")
    .select("id, first_name, last_name, email, photo_url, role, status, graduation_year, linkedin_url, user_id")
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .not("email", "in", devAdminEmailFilter)
    .is("user_id", null);

  let parentProfilesQuery = dataClient
    .from("parents")
    .select("id, first_name, last_name, email, photo_url, linkedin_url, relationship, student_name, user_id")
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .not("user_id", "is", null);

  if (parentUserIds.length > 0) {
    parentProfilesQuery = parentProfilesQuery.in("user_id", parentUserIds);
  } else {
    parentProfilesQuery = parentProfilesQuery.in("user_id", ["__no_match__"]);
  }

  // Apply filters to both queries
  // Default: show active members only unless explicitly filtered
  if (filters.status) {
    linkedMembersQuery = linkedMembersQuery.eq("status", filters.status);
    manualMembersQuery = manualMembersQuery.eq("status", filters.status);
    if (filters.status !== "active") {
      parentProfilesQuery = parentProfilesQuery.in("user_id", ["__no_match__"]);
    }
  } else {
    linkedMembersQuery = linkedMembersQuery.eq("status", "active");
    manualMembersQuery = manualMembersQuery.eq("status", "active");
  }

  if (filters.role) {
    linkedMembersQuery = linkedMembersQuery.eq("role", filters.role);
    manualMembersQuery = manualMembersQuery.eq("role", filters.role);
    parentProfilesQuery = parentProfilesQuery.in("user_id", ["__no_match__"]);
  }

  // Apply ordering after all filters. Cap each source at SOURCE_CAP so the
  // page cannot OOM on large orgs; render a truncation banner if any
  // source returns the full cap.
  linkedMembersQuery = linkedMembersQuery.order("last_name").limit(SOURCE_CAP);
  manualMembersQuery = manualMembersQuery.order("last_name").limit(SOURCE_CAP);
  parentProfilesQuery = parentProfilesQuery.order("last_name").limit(SOURCE_CAP);

  // Run queries in parallel
  const [{ data: linkedMembers }, { data: manualMembers }, { data: parentProfiles }, { data: allMembers }] = await Promise.all([
    linkedMembersQuery,
    manualMembersQuery,
    parentProfilesQuery,
    dataClient
      .from("members")
      .select("role")
      .eq("organization_id", org.id)
      .is("deleted_at", null)
      .limit(1000),
  ]);

  const members: MemberDirectoryEntry[] = buildMemberDirectoryEntries({
    orgSlug,
    linkedMembers: ((linkedMembers || []) as LinkedMemberDirectoryRow[]),
    manualMembers: ((manualMembers || []) as LinkedMemberDirectoryRow[]),
    parentProfiles: ((parentProfiles || []) as ParentDirectoryRow[]),
    adminUserIds,
  });

  const isTruncated =
    (linkedMembers?.length ?? 0) >= SOURCE_CAP ||
    (manualMembers?.length ?? 0) >= SOURCE_CAP ||
    (parentProfiles?.length ?? 0) >= SOURCE_CAP;

  const roles = [...new Set(allMembers?.map((m) => m.role).filter(Boolean))];

  const navConfig = org.nav_config as NavConfig | null;
  const [tNav, locale] = await Promise.all([getTranslations("nav.items"), getLocale()]);
  const t = (key: string) => tNav(key);
  const pageLabel = resolveLabel("/members", navConfig, t, locale);
  const actionLabel = resolveActionLabel("/members", navConfig, "Add", t, locale);
  const tPagesMembers = await getTranslations("pages.members");

  return (
    <div className="animate-fade-in">
      <DirectoryViewTracker organizationId={org.id} directoryType="active_members" />
      <PageHeader
        title={pageLabel}
        description={`${members?.length || 0} ${filters.status === "inactive" ? tPagesMembers("inactive") : tPagesMembers("active")} ${pageLabel.toLowerCase()}`}
        actions={
          isAdmin && (
            <Link href={`/${orgSlug}/members/new`}>
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

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        <MembersFilter
          orgSlug={orgSlug}
          orgId={org.id}
          currentStatus={filters.status}
          currentRole={filters.role}
          roles={roles}
        />
      </div>

      {isTruncated && (
        <div
          data-testid="members-truncation-banner"
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          Showing the first {SOURCE_CAP} entries per source. Use filters to narrow results;
          full pagination is coming soon.
        </div>
      )}

      {/* Members Grid */}
      {members && members.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
          {members.map((member) => (
            <Card key={member.id} interactive className="p-5">
              <div className="flex items-center gap-4">
                <DirectoryCardLink
                  href={member.profileHref}
                  organizationId={org.id}
                  directoryType="active_members"
                  className="flex min-w-0 flex-1 items-center gap-4"
                >
                  <Avatar
                    src={member.photo_url}
                    name={`${member.first_name} ${member.last_name}`}
                    size="lg"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground truncate">
                      {member.first_name} {member.last_name}
                    </h3>
                    {member.role && (
                      <p className="text-sm text-muted-foreground">{member.role}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <Badge variant={member.status === "active" ? "success" : "muted"}>
                        {member.status}
                      </Badge>
                      {member.isParent && (
                        <Badge variant="primary">Parent</Badge>
                      )}
                      {member.isAdmin && (
                        <Badge variant="warning">Admin</Badge>
                      )}
                      {member.graduation_year && (
                        <span className="text-xs text-muted-foreground">
                          &apos;{member.graduation_year.toString().slice(-2)}
                        </span>
                      )}
                    </div>
                  </div>
                </DirectoryCardLink>
                <LinkedInBadge linkedinUrl={member.linkedin_url} className="shrink-0" />
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            }
            title={tPagesMembers("noMembersFound", { label: pageLabel.toLowerCase() })}
            description={filters.status === "inactive" ? tPagesMembers("noInactiveMembers", { label: pageLabel.toLowerCase() }) : tPagesMembers("noActiveMembers", { label: pageLabel.toLowerCase() })}
            action={
              isAdmin && (
                <Link href={`/${orgSlug}/members/new`}>
                  <Button>{resolveActionLabel("/members", navConfig, "Add First")}</Button>
                </Link>
              )
            }
          />
        </Card>
      )}
    </div>
  );
}
