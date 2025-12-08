import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Avatar, Button, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { isOrgAdmin } from "@/lib/auth";

interface MembersPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ status?: string; role?: string }>;
}

export default async function MembersPage({ params, searchParams }: MembersPageProps) {
  const { orgSlug } = await params;
  const filters = await searchParams;
  const supabase = await createClient();

  // Fetch organization
  const { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .single();

  if (!org) return null;

  const isAdmin = await isOrgAdmin(org.id);

  // Build query with filters
  let query = supabase
    .from("members")
    .select("*")
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .order("last_name");

  // Apply filters
  // Default: show active members only unless explicitly filtered
  if (filters.status) {
    query = query.eq("status", filters.status);
  } else {
    query = query.eq("status", "active");
  }

  if (filters.role) {
    query = query.eq("role", filters.role);
  }

  const { data: members } = await query;

  // Get unique roles for filter
  const { data: allMembers } = await supabase
    .from("members")
    .select("role")
    .eq("organization_id", org.id)
    .is("deleted_at", null);
  
  const roles = [...new Set(allMembers?.map((m) => m.role).filter(Boolean))];

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Members"
        description={`${members?.length || 0} ${filters.status === "inactive" ? "inactive" : "active"} members`}
        actions={
          isAdmin && (
            <Link href={`/${orgSlug}/members/new`}>
              <Button>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add Member
              </Button>
            </Link>
          )
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href={`/${orgSlug}/members`}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            !filters.status || filters.status === "active"
              ? "bg-org-primary text-white"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          Active
        </Link>
        <Link
          href={`/${orgSlug}/members?status=inactive`}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            filters.status === "inactive"
              ? "bg-org-primary text-white"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          Inactive
        </Link>
        {roles.map((role) => (
          <Link
            key={role}
            href={`/${orgSlug}/members?role=${encodeURIComponent(role!)}`}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              filters.role === role
                ? "bg-org-primary text-white"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {role}
          </Link>
        ))}
      </div>

      {/* Members Grid */}
      {members && members.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
          {members.map((member) => (
            <Link key={member.id} href={`/${orgSlug}/members/${member.id}`}>
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
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant={member.status === "active" ? "success" : "muted"}>
                        {member.status}
                      </Badge>
                      {member.graduation_year && (
                        <span className="text-xs text-muted-foreground">
                          &apos;{member.graduation_year.toString().slice(-2)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
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
            title="No members found"
            description={filters.status === "inactive" ? "No inactive members" : "No active members yet"}
            action={
              isAdmin && (
                <Link href={`/${orgSlug}/members/new`}>
                  <Button>Add First Member</Button>
                </Link>
              )
            }
          />
        </Card>
      )}
    </div>
  );
}

