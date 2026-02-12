import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { Card, Badge, Avatar, Button, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { isOrgAdmin } from "@/lib/auth";
import { MembersFilter } from "@/components/members/MembersFilter";
import { resolveLabel, resolveActionLabel } from "@/lib/navigation/label-resolver";
import { canDevAdminPerform, getDevAdminEmails } from "@/lib/auth/dev-admin";
import type { NavConfig } from "@/lib/navigation/nav-items";
import { DirectoryViewTracker } from "@/components/analytics/DirectoryViewTracker";
import { DirectoryCardLink } from "@/components/analytics/DirectoryCardLink";

interface MembersPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ status?: string; role?: string }>;
}

// Extended member type with admin flag
interface MemberWithAdminFlag {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  photo_url: string | null;
  role: string | null;
  status: string | null;
  graduation_year: number | null;
  isAdmin: boolean;
}

export default async function MembersPage({ params, searchParams }: MembersPageProps) {
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

  // Fetch organization
  const { data: orgs, error: orgError } = await dataClient
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .limit(1);

  const org = orgs?.[0];

  if (!org || orgError) return null;

  const isAdmin = await isOrgAdmin(org.id);

  // Build query with filters
  const devAdminEmails = getDevAdminEmails();
  const devAdminEmailFilter = `(${devAdminEmails.map((email) => `"${email}"`).join(",")})`;

  // Step 1: Get user_ids with active_member or admin role
  const { data: memberRoles } = await dataClient
    .from("user_organization_roles")
    .select("user_id, role")
    .eq("organization_id", org.id)
    .in("role", ["active_member", "admin"])
    .eq("status", "active");

  const memberUserIds = memberRoles?.map((r) => r.user_id) || [];
  const adminUserIds = new Set(
    memberRoles?.filter((r) => r.role === "admin").map((r) => r.user_id) || []
  );

  // Step 2a: Query members WITH user accounts that have correct roles
  let linkedMembersQuery = dataClient
    .from("members")
    .select("id, first_name, last_name, email, photo_url, role, status, graduation_year, user_id")
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .not("email", "in", devAdminEmailFilter)
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
    .select("id, first_name, last_name, email, photo_url, role, status, graduation_year, user_id")
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .not("email", "in", devAdminEmailFilter)
    .is("user_id", null);

  // Apply filters to both queries
  // Default: show active members only unless explicitly filtered
  if (filters.status) {
    linkedMembersQuery = linkedMembersQuery.eq("status", filters.status);
    manualMembersQuery = manualMembersQuery.eq("status", filters.status);
  } else {
    linkedMembersQuery = linkedMembersQuery.eq("status", "active");
    manualMembersQuery = manualMembersQuery.eq("status", "active");
  }

  if (filters.role) {
    linkedMembersQuery = linkedMembersQuery.eq("role", filters.role);
    manualMembersQuery = manualMembersQuery.eq("role", filters.role);
  }

  // Apply ordering after all filters
  linkedMembersQuery = linkedMembersQuery.order("last_name");
  manualMembersQuery = manualMembersQuery.order("last_name");

  // Run queries in parallel
  const [{ data: linkedMembers }, { data: manualMembers }, { data: allMembers }] = await Promise.all([
    linkedMembersQuery,
    manualMembersQuery,
    dataClient
      .from("members")
      .select("role")
      .eq("organization_id", org.id)
      .is("deleted_at", null)
      .not("email", "in", devAdminEmailFilter),
  ]);

  // Combine and add isAdmin flag
  type MemberRow = {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    photo_url: string | null;
    role: string | null;
    status: string | null;
    graduation_year: number | null;
    user_id: string | null;
  };

  const members: MemberWithAdminFlag[] = [
    ...(linkedMembers || []).map((m: MemberRow) => ({
      id: m.id,
      first_name: m.first_name,
      last_name: m.last_name,
      email: m.email,
      photo_url: m.photo_url,
      role: m.role,
      status: m.status,
      graduation_year: m.graduation_year,
      isAdmin: m.user_id ? adminUserIds.has(m.user_id) : false,
    })),
    ...(manualMembers || []).map((m: MemberRow) => ({
      id: m.id,
      first_name: m.first_name,
      last_name: m.last_name,
      email: m.email,
      photo_url: m.photo_url,
      role: m.role,
      status: m.status,
      graduation_year: m.graduation_year,
      isAdmin: false,
    })),
  ].sort((a, b) => a.last_name.localeCompare(b.last_name));

  const roles = [...new Set(allMembers?.map((m) => m.role).filter(Boolean))];

  const navConfig = org.nav_config as NavConfig | null;
  const pageLabel = resolveLabel("/members", navConfig);
  const actionLabel = resolveActionLabel("/members", navConfig);

  return (
    <div className="animate-fade-in">
      <DirectoryViewTracker organizationId={org.id} directoryType="active_members" />
      <PageHeader
        title={pageLabel}
        description={`${members?.length || 0} ${filters.status === "inactive" ? "inactive" : "active"} ${pageLabel.toLowerCase()}`}
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

      {/* Members Grid */}
      {members && members.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
          {members.map((member) => (
            <DirectoryCardLink
              key={member.id}
              href={`/${orgSlug}/members/${member.id}`}
              organizationId={org.id}
              directoryType="active_members"
            >
              <Card interactive className="p-5">
                <div className="flex items-center gap-4">
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
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            }
            title={`No ${pageLabel.toLowerCase()} found`}
            description={filters.status === "inactive" ? `No inactive ${pageLabel.toLowerCase()}` : `No active ${pageLabel.toLowerCase()} yet`}
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
