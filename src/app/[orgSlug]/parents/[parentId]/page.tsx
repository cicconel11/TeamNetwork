import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { Card, Badge, Avatar, Button, SoftDeleteButton } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { canDevAdminPerform } from "@/lib/auth/dev-admin";
import { getOrgContext, getOrgRole } from "@/lib/auth/roles";
import { canEditNavItem } from "@/lib/navigation/permissions";
import type { NavConfig } from "@/lib/navigation/nav-items";
import type { Organization } from "@/types/database";

// Extends the generated Row with fields added by the 20260609000000 migration
interface ParentRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  photo_url: string | null;
  linkedin_url: string | null;
  phone_number: string | null;
  notes: string | null;
  student_name: string | null;
  relationship: string | null;
  created_at: string;
  deleted_at: string | null;
}

interface ParentDetailPageProps {
  params: Promise<{ orgSlug: string; parentId: string }>;
}

export default async function ParentDetailPage({ params }: ParentDetailPageProps) {
  const { orgSlug, parentId } = await params;

  // Gate: org must have parents feature enabled
  const orgContext = await getOrgContext(orgSlug);
  if (!orgContext.hasParentsAccess) {
    return notFound();
  }

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
  const { data: orgData, error: orgError } = await dataClient
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .limit(1);

  if (!orgData?.[0] || orgError) {
    return notFound();
  }

  const org = orgData[0] as Organization;
  const orgId = org.id;

  // Fetch parent
  const { data: parentData } = await dataClient
    .from("parents")
    .select("*")
    .eq("id", parentId)
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .single();

  if (!parentData) {
    return notFound();
  }

  const parent = parentData as unknown as ParentRow;

  const { role, userId: currentUserId } = await getOrgRole({ orgId });
  const navConfig = org.nav_config as NavConfig | null;
  const canEditPage = canEditNavItem(navConfig, "/parents", role, ["admin"]);
  const isSelf = Boolean(currentUserId && parent.user_id === currentUserId);
  const canEdit = canEditPage || isSelf;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`${parent.first_name} ${parent.last_name}`}
        backHref={`/${orgSlug}/parents`}
        actions={
          canEdit && (
            <div className="flex items-center gap-2">
              <Link href={`/${orgSlug}/parents/${parentId}/edit`}>
                <Button variant="secondary">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                  Edit
                </Button>
              </Link>
              {canEditPage && (
                <SoftDeleteButton
                  table="parents"
                  id={parentId}
                  organizationField="organization_id"
                  organizationId={orgId}
                  redirectTo={`/${orgSlug}/parents`}
                />
              )}
            </div>
          )
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <Card className="p-6 lg:col-span-1">
          <div className="text-center">
            <Avatar
              src={parent.photo_url}
              name={`${parent.first_name} ${parent.last_name}`}
              size="xl"
              className="mx-auto mb-4"
            />
            <h2 className="text-xl font-bold text-foreground">
              {parent.first_name} {parent.last_name}
            </h2>
            {parent.student_name && (
              <p className="text-muted-foreground">Parent of {parent.student_name}</p>
            )}
            <div className="flex flex-wrap justify-center gap-2 mt-3">
              {parent.relationship && (
                <Badge variant="primary">{parent.relationship}</Badge>
              )}
            </div>
          </div>

          {parent.email && (
            <div className="mt-6 pt-6 border-t border-border">
              <a
                href={`mailto:${parent.email}`}
                className="flex items-center gap-3 text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
                {parent.email}
              </a>
            </div>
          )}
        </Card>

        {/* Details Card */}
        <Card className="p-6 lg:col-span-2">
          <h3 className="font-semibold text-foreground mb-4">Parent Details</h3>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-muted-foreground">First Name</dt>
              <dd className="text-foreground font-medium">{parent.first_name}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Last Name</dt>
              <dd className="text-foreground font-medium">{parent.last_name}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Student Name</dt>
              <dd className="text-foreground font-medium">{parent.student_name || "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Relationship</dt>
              <dd className="text-foreground font-medium">{parent.relationship || "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Email</dt>
              <dd className="text-foreground font-medium">{parent.email || "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Phone</dt>
              <dd className="text-foreground font-medium">{parent.phone_number || "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">LinkedIn</dt>
              <dd className="text-foreground font-medium">
                {parent.linkedin_url ? (
                  <a
                    href={parent.linkedin_url}
                    className="text-org-primary hover:underline break-all"
                    target="_blank"
                    rel="noreferrer"
                  >
                    View profile
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Added</dt>
              <dd className="text-foreground font-medium">
                {parent.created_at ? new Date(parent.created_at).toLocaleDateString() : "—"}
              </dd>
            </div>
          </dl>

          {parent.notes && (
            <div className="mt-6 pt-6 border-t border-border">
              <h4 className="text-sm text-muted-foreground mb-2">Notes</h4>
              <p className="text-foreground whitespace-pre-wrap">{parent.notes}</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
