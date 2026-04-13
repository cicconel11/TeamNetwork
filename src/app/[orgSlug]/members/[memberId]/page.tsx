import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Avatar, Button, SoftDeleteButton } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { ReinstateCard } from "@/components/members/ReinstateCard";
import { isOrgAdmin } from "@/lib/auth";
import { resolveDataClient } from "@/lib/auth/dev-admin";
import type { Member } from "@/types/database";
import { LinkedInProfileLink } from "@/components/shared";
import { ConnectedAccountsSection } from "@/components/members/ConnectedAccountsSection";
import { sanitizeRichTextToPlainText } from "@/lib/security/rich-text";

interface MemberDetailPageProps {
  params: Promise<{ orgSlug: string; memberId: string }>;
}

export default async function MemberDetailPage({ params }: MemberDetailPageProps) {
  const { orgSlug, memberId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const dataClient = resolveDataClient(user, supabase, "view_members");

  const { data: orgs, error: orgError } = await dataClient
    .from("organizations")
    .select("id, name")
    .eq("slug", orgSlug)
    .limit(1);

  const org = orgs?.[0];
  if (!org || orgError) return notFound();

  const { data: memberData } = await dataClient
    .from("members")
    .select("*")
    .eq("id", memberId)
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .single();

  if (!memberData) return notFound();

  const member = memberData as Member;
  const memberUserId = (memberData as Member & { user_id?: string | null }).user_id || null;

  // Fetch org role + LinkedIn enrichment data in parallel
  const [orgRoleResult, enrichmentResult] = await Promise.all([
    memberUserId
      ? dataClient
          .from("user_organization_roles")
          .select("role")
          .eq("organization_id", org.id)
          .eq("user_id", memberUserId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    memberUserId
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (dataClient as any)
          .from("user_linkedin_connections")
          .select("linkedin_data")
          .eq("user_id", memberUserId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const userOrgRole = orgRoleResult.data?.role || null;

  // Extract enrichment data from LinkedIn connection (stored by Bright Data sync)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkedinData = (enrichmentResult as any)?.data?.linkedin_data;
  const enrichment = linkedinData?.enrichment;
  const linkedinBio: string | null = enrichment?.about || enrichment?.summary || null;

  // Experience and education from enrichment JSON
  interface EnrichmentExperience {
    title?: string | null;
    company?: string | null;
    company_id?: string | null;
    location?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    description_html?: string | null;
    company_logo_url?: string | null;
  }
  interface EnrichmentEducation {
    title?: string | null; // school name
    degree?: string | null;
    field_of_study?: string | null;
    start_year?: string | null;
    end_year?: string | null;
    description?: string | null;
    institute_logo_url?: string | null;
  }

  const enrichmentExperience: EnrichmentExperience[] = Array.isArray(enrichment?.experience) ? enrichment.experience : [];
  const enrichmentEducation: EnrichmentEducation[] = Array.isArray(enrichment?.education) ? enrichment.education : [];

  const isAdmin = await isOrgAdmin(org.id);
  const currentUserId = user?.id ?? null;
  const canEdit = isAdmin || (currentUserId && memberUserId === currentUserId);
  const isOwnProfile = currentUserId !== null && currentUserId === memberUserId;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = member as Member & Record<string, any>;

  // member.role is the job title field (confusingly named "role" in the members table)
  const jobTitle = m.role || null;
  const currentCompany = m.current_company || null;
  const school = m.school || null;
  const memberBio = m.bio || null;
  const currentCity = m.current_city || null;
  const major = m.major || null;

  // Determine what to show: prefer enrichment data, fall back to flat fields
  const hasEnrichmentExperience = enrichmentExperience.length > 0;
  const hasEnrichmentEducation = enrichmentEducation.length > 0;

  // Org role label for the badge
  const orgRoleLabels: Record<string, string> = {
    admin: "Admin",
    active_member: "Member",
    alumni: "Alumni",
    parent: "Parent",
  };
  const orgRoleLabel = userOrgRole ? (orgRoleLabels[userOrgRole] ?? userOrgRole) : null;

  const statusVariant = member.status === "active" ? "success" : member.status === "pending" ? "warning" : "muted";

  return (
    <div className="animate-fade-in" data-testid="member-detail">
      <PageHeader
        title={`${member.first_name} ${member.last_name}`}
        backHref={`/${orgSlug}/members`}
        actions={
          canEdit && (
            <div className="flex items-center gap-2">
              <Link href={`/${orgSlug}/members/${memberId}/edit`}>
                <Button variant="secondary" data-testid="member-edit-button">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                  Edit
                </Button>
              </Link>
              {isAdmin && (
                <SoftDeleteButton
                  table="members"
                  id={memberId}
                  organizationField="organization_id"
                  organizationId={org.id}
                  redirectTo={`/${orgSlug}/members`}
                  revalidatePaths={[`/${orgSlug}`, `/${orgSlug}/members`]}
                  data-testid="member-delete-button"
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
                  src={member.photo_url}
                  name={`${member.first_name} ${member.last_name}`}
                  size="xl"
                />
              </div>
              <div className="pt-14 sm:pt-16 min-w-0">
                <h2 className="font-display text-2xl font-bold text-foreground truncate">
                  {member.first_name} {member.last_name}
                </h2>
                {/* Show job title as the headline, not the org role */}
                {jobTitle && (
                  <p className="text-muted-foreground text-sm mt-0.5 line-clamp-2">
                    {jobTitle}{currentCompany ? ` at ${currentCompany}` : ""}
                  </p>
                )}
              </div>
            </div>

            {/* Location + Company row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground mb-3">
              {currentCompany && (
                <span className="flex items-center gap-1.5">
                  <svg className="h-4 w-4 shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                  </svg>
                  {currentCompany}
                </span>
              )}
              {school && (
                <span className="flex items-center gap-1.5">
                  <svg className="h-4 w-4 shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
                  </svg>
                  {school}
                </span>
              )}
            </div>

            {/* Badges — org role + status + graduation */}
            <div className="flex flex-wrap gap-2 mb-4">
              {orgRoleLabel && (
                <Badge variant="muted">{orgRoleLabel}</Badge>
              )}
              <Badge variant={statusVariant}>
                {member.status}
              </Badge>
              {member.graduation_year && (
                <Badge variant="primary">Class of {member.graduation_year}</Badge>
              )}
            </div>

            {/* Contact actions */}
            <div className="flex flex-wrap gap-2 pt-3 border-t border-border">
              {member.email && (
                <a
                  href={`mailto:${member.email}`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-[var(--muted)]/50 text-foreground hover:bg-[var(--muted)] transition-colors"
                >
                  <svg className="h-4 w-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                  </svg>
                  {member.email}
                </a>
              )}
              {member.linkedin_url && (
                <LinkedInProfileLink linkedinUrl={member.linkedin_url} />
              )}
              {isOwnProfile && (
                <Link
                  href="/settings/account"
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-[var(--muted)]/50 text-foreground hover:bg-[var(--muted)] transition-colors"
                >
                  <svg className="h-4 w-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  User Settings
                </Link>
              )}
            </div>
          </div>
        </Card>

        {/* ─── Bio / About ─── */}
        {(linkedinBio || memberBio) && (
          <Card className="p-6">
            <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              About
            </h3>
            <p className="text-foreground/80 text-sm leading-relaxed whitespace-pre-wrap">{linkedinBio || memberBio}</p>
          </Card>
        )}

        {/* ─── Experience ─── */}
        {(hasEnrichmentExperience || jobTitle || currentCompany) && (
          <Card className="p-6">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
              </svg>
              Experience
            </h3>

            <div className="space-y-0">
              {hasEnrichmentExperience ? (
                enrichmentExperience.map((job, i) => {
                  const descriptionText = sanitizeRichTextToPlainText(job.description_html);

                  return (
                    <div key={i} className={`flex gap-4 py-4 ${i > 0 ? "border-t border-border/50" : ""}`}>
                      <div className="shrink-0 w-12 h-12 rounded-lg bg-[var(--muted)]/60 flex items-center justify-center text-muted-foreground">
                        {job.company_logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={job.company_logo_url} alt="" className="w-12 h-12 rounded-lg object-cover" />
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
                        {descriptionText && (
                          <p className="text-foreground/70 text-sm mt-2 leading-relaxed whitespace-pre-wrap">
                            {descriptionText}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex gap-4 py-1">
                  <div className="shrink-0 w-12 h-12 rounded-lg bg-[var(--muted)]/60 flex items-center justify-center">
                    <svg className="h-6 w-6 text-muted-foreground opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground text-sm">{jobTitle}</p>
                    {currentCompany && <p className="text-muted-foreground text-sm">{currentCompany}</p>}
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* ─── Education ─── */}
        {(hasEnrichmentEducation || school || member.graduation_year) && (
          <Card className="p-6">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
              </svg>
              Education
            </h3>

            <div className="space-y-0">
              {hasEnrichmentEducation ? (
                enrichmentEducation.map((edu, i) => (
                  <div key={i} className={`flex gap-4 py-4 ${i > 0 ? "border-t border-border/50" : ""}`}>
                    <div className="shrink-0 w-12 h-12 rounded-lg bg-[var(--muted)]/60 flex items-center justify-center">
                      {edu.institute_logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={edu.institute_logo_url} alt="" className="w-12 h-12 rounded-lg object-cover" />
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
                      {edu.description && (
                        <p className="text-foreground/70 text-sm mt-2 leading-relaxed whitespace-pre-wrap">
                          {edu.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex gap-4 py-1">
                  <div className="shrink-0 w-12 h-12 rounded-lg bg-[var(--muted)]/60 flex items-center justify-center">
                    <svg className="h-6 w-6 text-muted-foreground opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    {school && <p className="font-medium text-foreground text-sm">{school}</p>}
                    {member.graduation_year && (
                      <p className="text-muted-foreground text-sm">Class of {member.graduation_year}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
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
            {member.email && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</dt>
                <dd className="text-foreground text-sm mt-0.5">
                  <a href={`mailto:${member.email}`} className="hover:underline">{member.email}</a>
                </dd>
              </div>
            )}
            {member.linkedin_url && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">LinkedIn</dt>
                <dd className="text-sm mt-0.5">
                  <LinkedInProfileLink linkedinUrl={member.linkedin_url} />
                </dd>
              </div>
            )}
            {currentCity && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Location</dt>
                <dd className="text-foreground text-sm mt-0.5">{currentCity}</dd>
              </div>
            )}
            {major && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Major</dt>
                <dd className="text-foreground text-sm mt-0.5">{major}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</dt>
              <dd className="text-foreground text-sm mt-0.5 capitalize">{member.status}</dd>
            </div>
            {member.graduation_year && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Graduation Year</dt>
                <dd className="text-foreground text-sm mt-0.5">{member.graduation_year}</dd>
              </div>
            )}
            {member.expected_graduation_date && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Expected Graduation</dt>
                <dd className="text-foreground text-sm mt-0.5">
                  {new Date(member.expected_graduation_date).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Member Since</dt>
              <dd className="text-foreground text-sm mt-0.5">
                {member.created_at ? new Date(member.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "Unknown"}
              </dd>
            </div>
          </dl>
        </Card>

        {/* ─── Reinstate Banner ─── */}
        {isAdmin && userOrgRole === "alumni" && (
          <ReinstateCard
            orgId={org.id}
            memberId={memberId}
            memberName={`${member.first_name} ${member.last_name}`}
          />
        )}
      </div>

      {/* Connected Accounts (own profile only) */}
      {isOwnProfile && (
        <div className="max-w-4xl mt-6">
          <ConnectedAccountsSection orgSlug={orgSlug} orgId={org.id} orgName={org.name} />
        </div>
      )}
    </div>
  );
}
