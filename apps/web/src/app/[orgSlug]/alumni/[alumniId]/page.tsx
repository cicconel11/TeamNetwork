import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Avatar, Button } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { resolveDataClient } from "@/lib/auth/dev-admin";
import { getOrgRole } from "@/lib/auth/roles";
import { canEditNavItem } from "@/lib/navigation/permissions";
import type { NavConfig } from "@/lib/navigation/nav-items";
import type { Organization, Alumni } from "@/types/database";
import { checkOrgReadOnly } from "@/lib/subscription/read-only-guard";
import { DeleteAlumniButton } from "@/components/alumni/DeleteAlumniButton";
import { LinkedInProfileLink } from "@/components/shared";

interface AlumniDetailPageProps {
  params: Promise<{ orgSlug: string; alumniId: string }>;
}

interface WorkHistoryEntry {
  title?: string | null;
  company?: string | null;
  company_id?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  description_html?: string | null;
  company_logo_url?: string | null;
}

interface EducationEntry {
  title?: string | null; // school name
  degree?: string | null;
  field_of_study?: string | null;
  start_year?: string | null;
  end_year?: string | null;
  description?: string | null;
  institute_logo_url?: string | null;
}

export default async function AlumniDetailPage({ params }: AlumniDetailPageProps) {
  const { orgSlug, alumniId } = await params;
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

  const [{ data: alumData }, { role, userId: currentUserId }, { isReadOnly }] = await Promise.all([
    dataClient
      .from("alumni")
      .select("*")
      .eq("id", alumniId)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .single(),
    getOrgRole({ orgId, userId: user?.id }),
    checkOrgReadOnly(orgId),
  ]);

  if (!alumData) {
    return notFound();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const alum = alumData as Alumni & Record<string, any>;

  const navConfig = org.nav_config as NavConfig | null;
  const canEditPage = canEditNavItem(navConfig, "/alumni", role, ["admin"]);
  const alumUserId = alum.user_id;
  const isSelf = Boolean(currentUserId && alumUserId === currentUserId);
  const canEdit = canEditPage || isSelf;
  const canModifyExisting = canEdit && !isReadOnly;
  const canDelete = canEditPage && !isReadOnly;

  // Extract enrichment data (may not exist if migration hasn't run)
  const workHistory: WorkHistoryEntry[] = Array.isArray(alum.work_history) ? alum.work_history as WorkHistoryEntry[] : [];
  const educationHistory: EducationEntry[] = Array.isArray(alum.education_history) ? alum.education_history as EducationEntry[] : [];
  const headline = alum.headline || alum.position_title || alum.job_title || null;
  const about = alum.summary || alum.notes || null;

  // Build experience entries: prefer work_history JSONB, fall back to flat fields
  const hasWorkHistory = workHistory.length > 0;
  const hasEducationHistory = educationHistory.length > 0;
  const hasCurrentJob = Boolean(alum.position_title || alum.job_title || alum.current_company);
  const hasSchool = Boolean(alum.major || alum.graduation_year);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`${alum.first_name} ${alum.last_name}`}
        backHref={`/${orgSlug}/alumni`}
        actions={
          canEdit && (
            <div className="flex items-center gap-2">
              {canModifyExisting ? (
                <Link href={`/${orgSlug}/alumni/${alumniId}/edit`} data-testid="alumni-edit-link">
                  <Button variant="secondary">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                    </svg>
                    Edit
                  </Button>
                </Link>
              ) : (
                <Button variant="secondary" disabled>
                  Edit Disabled
                </Button>
              )}
              {canDelete ? (
                <DeleteAlumniButton
                  organizationId={orgId}
                  alumniId={alumniId}
                  redirectTo={`/${orgSlug}/alumni`}
                />
              ) : (
                canEditPage && <Button variant="danger" disabled>Delete Disabled</Button>
              )}
            </div>
          )
        }
      />

      {isReadOnly && (
        <div className="mb-6 rounded-xl bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          This organization is in its billing grace period. You can still add new alumni, but editing and deleting existing alumni are disabled until billing is restored.
        </div>
      )}

      <div className="space-y-6 max-w-4xl">

        {/* ─── Hero Card ─── */}
        <Card padding="none" className="overflow-hidden">
          {/* Cover gradient */}
          <div
            className="h-24 sm:h-28"
            style={{
              background: "linear-gradient(135deg, var(--color-org-primary) 0%, var(--color-org-secondary, var(--color-org-primary)) 100%)",
            }}
          />

          <div className="px-6 pb-6 -mt-12 sm:-mt-14">
            {/* Avatar */}
            <div className="flex items-end gap-4 mb-4">
              <div className="ring-4 ring-[var(--card)] rounded-full shrink-0">
                <Avatar
                  src={alum.photo_url}
                  name={`${alum.first_name} ${alum.last_name}`}
                  size="xl"
                />
              </div>
              <div className="pt-14 sm:pt-16 min-w-0">
                <h2 className="font-display text-2xl font-bold text-foreground truncate">
                  {alum.first_name} {alum.last_name}
                </h2>
                {headline && (
                  <p className="text-muted-foreground text-sm mt-0.5 line-clamp-2">{headline}</p>
                )}
              </div>
            </div>

            {/* Location + Company row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground mb-3">
              {alum.current_company && (
                <span className="flex items-center gap-1.5">
                  <svg className="h-4 w-4 shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                  </svg>
                  {alum.current_company}
                </span>
              )}
              {alum.current_city && (
                <span className="flex items-center gap-1.5">
                  <svg className="h-4 w-4 shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                  {alum.current_city}
                </span>
              )}
            </div>

            {/* Badges */}
            <div className="flex flex-wrap gap-2 mb-4">
              {alum.graduation_year && (
                <Badge variant="primary">Class of {alum.graduation_year}</Badge>
              )}
              {alum.major && (
                <Badge variant="muted">{alum.major}</Badge>
              )}
              {alum.industry && (
                <Badge variant="muted">{alum.industry}</Badge>
              )}
            </div>

            {/* Contact actions */}
            <div className="flex flex-wrap gap-2 pt-3 border-t border-border">
              {alum.email && (
                <a
                  href={`mailto:${alum.email}`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-[var(--muted)]/50 text-foreground hover:bg-[var(--muted)] transition-colors"
                >
                  <svg className="h-4 w-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                  </svg>
                  {alum.email}
                </a>
              )}
              {alum.phone_number && (
                <a
                  href={`tel:${alum.phone_number}`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-[var(--muted)]/50 text-foreground hover:bg-[var(--muted)] transition-colors"
                >
                  <svg className="h-4 w-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                  </svg>
                  {alum.phone_number}
                </a>
              )}
              {alum.linkedin_url && (
                <LinkedInProfileLink linkedinUrl={alum.linkedin_url} />
              )}
            </div>
          </div>
        </Card>

        {/* ─── About ─── */}
        {about && (
          <Card className="p-6">
            <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              About
            </h3>
            <p className="text-foreground/80 text-sm leading-relaxed whitespace-pre-wrap">{about}</p>
          </Card>
        )}

        {/* ─── Experience ─── */}
        {(hasWorkHistory || hasCurrentJob) && (
          <Card className="p-6">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
              </svg>
              Experience
            </h3>

            <div className="space-y-0">
              {hasWorkHistory ? (
                workHistory.map((job, i) => (
                  <div
                    key={i}
                    className={`flex gap-4 py-4 ${i > 0 ? "border-t border-border/50" : ""}`}
                  >
                    {/* Company logo placeholder */}
                    <div className="shrink-0 w-12 h-12 rounded-lg bg-[var(--muted)]/60 flex items-center justify-center text-muted-foreground">
                      {job.company_logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={job.company_logo_url}
                          alt=""
                          className="w-12 h-12 rounded-lg object-cover"
                        />
                      ) : (
                        <svg className="h-6 w-6 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground text-sm">{job.title || "Position"}</p>
                      <p className="text-muted-foreground text-sm">
                        {job.company}
                        {job.location && <span className="text-muted-foreground/60"> &middot; {job.location}</span>}
                      </p>
                      {(job.start_date || job.end_date) && (
                        <p className="text-muted-foreground/60 text-xs mt-0.5">
                          {job.start_date || "?"} &ndash; {job.end_date || "Present"}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                /* Fallback: single entry from flat fields */
                <div className="flex gap-4 py-1">
                  <div className="shrink-0 w-12 h-12 rounded-lg bg-[var(--muted)]/60 flex items-center justify-center">
                    <svg className="h-6 w-6 text-muted-foreground opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground text-sm">
                      {alum.position_title || alum.job_title}
                    </p>
                    {alum.current_company && (
                      <p className="text-muted-foreground text-sm">{alum.current_company}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* ─── Education ─── */}
        {(hasEducationHistory || hasSchool) && (
          <Card className="p-6">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
              </svg>
              Education
            </h3>

            <div className="space-y-0">
              {hasEducationHistory ? (
                educationHistory.map((edu, i) => (
                  <div
                    key={i}
                    className={`flex gap-4 py-4 ${i > 0 ? "border-t border-border/50" : ""}`}
                  >
                    <div className="shrink-0 w-12 h-12 rounded-lg bg-[var(--muted)]/60 flex items-center justify-center">
                      {edu.institute_logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={edu.institute_logo_url}
                          alt=""
                          className="w-12 h-12 rounded-lg object-cover"
                        />
                      ) : (
                        <svg className="h-6 w-6 text-muted-foreground opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground text-sm">{edu.title || "School"}</p>
                      {(edu.degree || edu.field_of_study) && (
                        <p className="text-muted-foreground text-sm">
                          {[edu.degree, edu.field_of_study].filter(Boolean).join(", ")}
                        </p>
                      )}
                      {(edu.start_year || edu.end_year) && (
                        <p className="text-muted-foreground/60 text-xs mt-0.5">
                          {edu.start_year || "?"} &ndash; {edu.end_year || "Present"}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                /* Fallback: single entry from flat fields */
                <div className="flex gap-4 py-1">
                  <div className="shrink-0 w-12 h-12 rounded-lg bg-[var(--muted)]/60 flex items-center justify-center">
                    <svg className="h-6 w-6 text-muted-foreground opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground text-sm">
                      {alum.major ? `${alum.major}` : "Education"}
                    </p>
                    {alum.graduation_year && (
                      <p className="text-muted-foreground text-sm">Class of {alum.graduation_year}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* ─── Contact & Details ─── */}
        <Card className="p-6">
          <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
            <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            Details
          </h3>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
            {alum.email && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</dt>
                <dd className="text-foreground text-sm mt-0.5">
                  <a href={`mailto:${alum.email}`} className="hover:underline">{alum.email}</a>
                </dd>
              </div>
            )}
            {alum.phone_number && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Phone</dt>
                <dd className="text-foreground text-sm mt-0.5">{alum.phone_number}</dd>
              </div>
            )}
            {alum.linkedin_url && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">LinkedIn</dt>
                <dd className="text-sm mt-0.5">
                  <LinkedInProfileLink linkedinUrl={alum.linkedin_url} />
                </dd>
              </div>
            )}
            {alum.current_city && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Location</dt>
                <dd className="text-foreground text-sm mt-0.5">{alum.current_city}</dd>
              </div>
            )}
            {alum.industry && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Industry</dt>
                <dd className="text-foreground text-sm mt-0.5">{alum.industry}</dd>
              </div>
            )}
            {alum.graduation_year && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Graduation Year</dt>
                <dd className="text-foreground text-sm mt-0.5">{alum.graduation_year}</dd>
              </div>
            )}
            {alum.major && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Major</dt>
                <dd className="text-foreground text-sm mt-0.5">{alum.major}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Member Since</dt>
              <dd className="text-foreground text-sm mt-0.5">
                {alum.created_at ? new Date(alum.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "Unknown"}
              </dd>
            </div>
          </dl>

          {alum.notes && !alum.summary && (
            <div className="mt-5 pt-5 border-t border-border">
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Notes</dt>
              <dd className="text-foreground/80 text-sm whitespace-pre-wrap">{alum.notes}</dd>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
