import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Avatar, Button, SoftDeleteButton } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { isOrgAdmin } from "@/lib/auth";
import type { Organization, Alumni } from "@teammeet/types";

interface AlumniDetailPageProps {
  params: Promise<{ orgSlug: string; alumniId: string }>;
}

export default async function AlumniDetailPage({ params }: AlumniDetailPageProps) {
  const { orgSlug, alumniId } = await params;
  const supabase = await createClient();

  // Fetch organization
  const { data: orgData, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .limit(1);

  if (!orgData?.[0] || orgError) {
    return notFound();
  }

  const org = orgData[0] as Organization;
  const orgId = org.id;

  // Fetch alumni
  const { data: alumData } = await supabase
    .from("alumni")
    .select("*")
    .eq("id", alumniId)
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .single();

  if (!alumData) {
    return notFound();
  }

  const alum = alumData as Alumni;

  const isAdmin = await isOrgAdmin(orgId);
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const currentUserId = session?.user?.id ?? null;
  const alumUserId = (alum as Alumni & { user_id?: string | null }).user_id || null;
  const canEdit = isAdmin || (currentUserId && alumUserId === currentUserId);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`${alum.first_name} ${alum.last_name}`}
        backHref={`/${orgSlug}/alumni`}
        actions={
          canEdit && (
            <div className="flex items-center gap-2">
              <Link href={`/${orgSlug}/alumni/${alumniId}/edit`}>
                <Button variant="secondary">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                  Edit
                </Button>
              </Link>
              {isAdmin && (
                <SoftDeleteButton
                  table="alumni"
                  id={alumniId}
                  organizationField="organization_id"
                  organizationId={orgId}
                  redirectTo={`/${orgSlug}/alumni`}
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
              src={alum.photo_url}
              name={`${alum.first_name} ${alum.last_name}`}
              size="xl"
              className="mx-auto mb-4"
            />
            <h2 className="text-xl font-bold text-foreground">
              {alum.first_name} {alum.last_name}
            </h2>
            {alum.job_title && (
              <p className="text-muted-foreground">{alum.job_title}</p>
            )}
            <div className="flex flex-wrap justify-center gap-2 mt-3">
              {alum.graduation_year && (
                <Badge variant="primary">Class of {alum.graduation_year}</Badge>
              )}
              {alum.major && (
                <Badge variant="muted">{alum.major}</Badge>
              )}
            </div>
          </div>

          {alum.email && (
            <div className="mt-6 pt-6 border-t border-border">
              <a
                href={`mailto:${alum.email}`}
                className="flex items-center gap-3 text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
                {alum.email}
              </a>
            </div>
          )}
        </Card>

        {/* Details Card */}
        <Card className="p-6 lg:col-span-2">
          <h3 className="font-semibold text-foreground mb-4">Alumni Details</h3>
          
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-muted-foreground">First Name</dt>
              <dd className="text-foreground font-medium">{alum.first_name}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Last Name</dt>
              <dd className="text-foreground font-medium">{alum.last_name}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Graduation Year</dt>
              <dd className="text-foreground font-medium">{alum.graduation_year || "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Major</dt>
              <dd className="text-foreground font-medium">{alum.major || "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Position Title</dt>
              <dd className="text-foreground font-medium">{alum.position_title || alum.job_title || "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Company</dt>
              <dd className="text-foreground font-medium">{alum.current_company || "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Industry</dt>
              <dd className="text-foreground font-medium">{alum.industry || "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">City</dt>
              <dd className="text-foreground font-medium">{alum.current_city || "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Email</dt>
              <dd className="text-foreground font-medium">{alum.email || "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Phone</dt>
              <dd className="text-foreground font-medium">{alum.phone_number || "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">LinkedIn</dt>
              <dd className="text-foreground font-medium">
                {alum.linkedin_url ? (
                  <a
                    href={alum.linkedin_url}
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
                {alum.created_at ? new Date(alum.created_at).toLocaleDateString() : "—"}
              </dd>
            </div>
          </dl>

          {alum.notes && (
            <div className="mt-6 pt-6 border-t border-border">
              <h4 className="text-sm text-muted-foreground mb-2">Notes</h4>
              <p className="text-foreground whitespace-pre-wrap">{alum.notes}</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
