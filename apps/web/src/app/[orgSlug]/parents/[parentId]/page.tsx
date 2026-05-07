import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Avatar, Button, SoftDeleteButton } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { resolveDataClient } from "@/lib/auth/dev-admin";
import { getOrgContext, getOrgRole } from "@/lib/auth/roles";
import { canEditNavItem } from "@/lib/navigation/permissions";
import type { NavConfig } from "@/lib/navigation/nav-items";
import type { Organization } from "@/types/database";
import { LinkedInProfileLink } from "@/components/shared";

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

  const orgContext = await getOrgContext(orgSlug);
  if (!orgContext.hasParentsAccess) {
    return notFound();
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const dataClient = resolveDataClient(user, supabase, "view_members");

  const { data: orgData, error: orgError } = await dataClient
    .from("organizations")
    .select("id, nav_config")
    .eq("slug", orgSlug)
    .limit(1);

  if (!orgData?.[0] || orgError) {
    return notFound();
  }

  const org = orgData[0] as Organization;
  const orgId = org.id;

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

  let systemAccess: { role: string; status: string } | null = null;
  let memberRecordId: string | null = null;
  if (canEditPage && parent.user_id) {
    const [accessResult, memberResult] = await Promise.all([
      dataClient
        .from("user_organization_roles")
        .select("role, status")
        .eq("organization_id", orgId)
        .eq("user_id", parent.user_id)
        .maybeSingle(),
      dataClient
        .from("members")
        .select("id")
        .eq("organization_id", orgId)
        .eq("user_id", parent.user_id)
        .is("deleted_at", null)
        .maybeSingle(),
    ]);
    if (accessResult.data) {
      systemAccess = { role: accessResult.data.role, status: accessResult.data.status };
    }
    if (memberResult.data) {
      memberRecordId = memberResult.data.id;
    }
  }

  const roleLabels: Record<string, string> = {
    admin: "Admin",
    active_member: "Active Member",
    alumni: "Alumni",
    parent: "Parent",
  };
  const statusLabels: Record<string, string> = {
    active: "Active",
    pending: "Pending",
    revoked: "Revoked",
  };

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
                  revalidatePaths={[`/${orgSlug}`, `/${orgSlug}/parents`]}
                />
              )}
            </div>
          )
        }
      />

      <div className="space-y-6 max-w-4xl">

        {/* ─── Hero Card ─── */}
        <Card padding="none" className="overflow-hidden">
          <div
            className="h-24 sm:h-28"
            style={{
              background: "linear-gradient(135deg, var(--color-org-primary) 0%, var(--color-org-secondary, var(--color-org-primary)) 100%)",
            }}
          />

          <div className="px-6 pb-6 -mt-12 sm:-mt-14">
            <div className="flex items-end gap-4 mb-4">
              <div className="ring-4 ring-[var(--card)] rounded-full shrink-0">
                <Avatar
                  src={parent.photo_url}
                  name={`${parent.first_name} ${parent.last_name}`}
                  size="xl"
                />
              </div>
              <div className="pt-14 sm:pt-16 min-w-0">
                <h2 className="font-display text-2xl font-bold text-foreground truncate">
                  {parent.first_name} {parent.last_name}
                </h2>
                {parent.student_name && (
                  <p className="text-muted-foreground text-sm mt-0.5">
                    Parent of {parent.student_name}
                  </p>
                )}
              </div>
            </div>

            {/* Badges */}
            <div className="flex flex-wrap gap-2 mb-4">
              {parent.relationship && (
                <Badge variant="primary">{parent.relationship}</Badge>
              )}
              <Badge variant="muted">Parent</Badge>
            </div>

            {/* Contact actions */}
            <div className="flex flex-wrap gap-2 pt-3 border-t border-border">
              {parent.email && (
                <a
                  href={`mailto:${parent.email}`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-[var(--muted)]/50 text-foreground hover:bg-[var(--muted)] transition-colors"
                >
                  <svg className="h-4 w-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                  </svg>
                  {parent.email}
                </a>
              )}
              {parent.phone_number && (
                <a
                  href={`tel:${parent.phone_number}`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-[var(--muted)]/50 text-foreground hover:bg-[var(--muted)] transition-colors"
                >
                  <svg className="h-4 w-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                  </svg>
                  {parent.phone_number}
                </a>
              )}
              {parent.linkedin_url && (
                <LinkedInProfileLink linkedinUrl={parent.linkedin_url} />
              )}
            </div>
          </div>
        </Card>

        {/* ─── About / Notes ─── */}
        {parent.notes && (
          <Card className="p-6">
            <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              Notes
            </h3>
            <p className="text-foreground/80 text-sm leading-relaxed whitespace-pre-wrap">{parent.notes}</p>
          </Card>
        )}

        {/* ─── Details ─── */}
        <Card className="p-6">
          <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
            <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            Details
          </h3>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
            {parent.student_name && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Student</dt>
                <dd className="text-foreground text-sm mt-0.5">{parent.student_name}</dd>
              </div>
            )}
            {parent.relationship && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Relationship</dt>
                <dd className="text-foreground text-sm mt-0.5">{parent.relationship}</dd>
              </div>
            )}
            {parent.email && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</dt>
                <dd className="text-foreground text-sm mt-0.5">
                  <a href={`mailto:${parent.email}`} className="hover:underline">{parent.email}</a>
                </dd>
              </div>
            )}
            {parent.phone_number && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Phone</dt>
                <dd className="text-foreground text-sm mt-0.5">{parent.phone_number}</dd>
              </div>
            )}
            {parent.linkedin_url && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">LinkedIn</dt>
                <dd className="text-sm mt-0.5">
                  <LinkedInProfileLink linkedinUrl={parent.linkedin_url} />
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Added</dt>
              <dd className="text-foreground text-sm mt-0.5">
                {parent.created_at ? new Date(parent.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "Unknown"}
              </dd>
            </div>
          </dl>
        </Card>

        {/* ─── System Access (admin only) ─── */}
        {canEditPage && systemAccess && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
                System Access
              </h3>
              {systemAccess.status === "revoked" && (
                <span className="px-3 py-1 bg-red-100 text-red-700 rounded-lg text-sm font-medium dark:bg-red-900/20 dark:text-red-300">
                  Access Revoked
                </span>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Role</dt>
                <dd className="text-foreground text-sm mt-0.5">{roleLabels[systemAccess.role] ?? systemAccess.role}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</dt>
                <dd className="text-foreground text-sm mt-0.5">{statusLabels[systemAccess.status] ?? systemAccess.status}</dd>
              </div>
            </dl>
            {memberRecordId && (
              <div className="pt-4 mt-4 border-t border-border flex justify-end">
                <Link href={`/${orgSlug}/members/${memberRecordId}/edit`}>
                  <Button variant="secondary">Manage Access</Button>
                </Link>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
