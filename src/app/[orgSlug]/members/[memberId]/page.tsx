import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Avatar, Button, SoftDeleteButton } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { isOrgAdmin } from "@/lib/auth";

interface MemberDetailPageProps {
  params: Promise<{ orgSlug: string; memberId: string }>;
}

export default async function MemberDetailPage({ params }: MemberDetailPageProps) {
  const { orgSlug, memberId } = await params;
  const supabase = await createClient();

  // Fetch organization
  const { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .single();

  if (!org) return notFound();

  // Fetch member
  const { data: member } = await supabase
    .from("members")
    .select("*")
    .eq("id", memberId)
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .single();

  if (!member) return notFound();

  const isAdmin = await isOrgAdmin(org.id);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`${member.first_name} ${member.last_name}`}
        backHref={`/${orgSlug}/members`}
        actions={
          isAdmin && (
            <div className="flex items-center gap-2">
              <Link href={`/${orgSlug}/members/${memberId}/edit`}>
                <Button variant="secondary">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                  Edit
                </Button>
              </Link>
              <SoftDeleteButton
                table="members"
                id={memberId}
                organizationField="organization_id"
                organizationId={org.id}
                redirectTo={`/${orgSlug}/members`}
              />
            </div>
          )
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <Card className="p-6 lg:col-span-1">
          <div className="text-center">
            <Avatar
              src={member.photo_url}
              name={`${member.first_name} ${member.last_name}`}
              size="xl"
              className="mx-auto mb-4"
            />
            <h2 className="text-xl font-bold text-foreground">
              {member.first_name} {member.last_name}
            </h2>
            {member.role && (
              <p className="text-muted-foreground">{member.role}</p>
            )}
            <div className="flex justify-center gap-2 mt-3">
              <Badge variant={member.status === "active" ? "success" : "muted"}>
                {member.status}
              </Badge>
              {member.graduation_year && (
                <Badge variant="muted">Class of {member.graduation_year}</Badge>
              )}
            </div>
          </div>

          {member.email && (
            <div className="mt-6 pt-6 border-t border-border">
              <a
                href={`mailto:${member.email}`}
                className="flex items-center gap-3 text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
                {member.email}
              </a>
            </div>
          )}
        </Card>

        {/* Details Card */}
        <Card className="p-6 lg:col-span-2">
          <h3 className="font-semibold text-foreground mb-4">Member Details</h3>
          
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-muted-foreground">First Name</dt>
              <dd className="text-foreground font-medium">{member.first_name}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Last Name</dt>
              <dd className="text-foreground font-medium">{member.last_name}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Role/Position</dt>
              <dd className="text-foreground font-medium">{member.role || "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Status</dt>
              <dd className="text-foreground font-medium capitalize">{member.status}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Graduation Year</dt>
              <dd className="text-foreground font-medium">{member.graduation_year || "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Email</dt>
              <dd className="text-foreground font-medium">{member.email || "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Added</dt>
              <dd className="text-foreground font-medium">
                {new Date(member.created_at).toLocaleDateString()}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Last Updated</dt>
              <dd className="text-foreground font-medium">
                {new Date(member.updated_at).toLocaleDateString()}
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}

