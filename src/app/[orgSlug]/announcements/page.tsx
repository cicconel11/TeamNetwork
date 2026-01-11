import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Button, EmptyState, SoftDeleteButton } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { isOrgAdmin } from "@/lib/auth";
import { getOrgRole } from "@/lib/auth/roles";
import { filterAnnouncementsForUser } from "@/lib/announcements";
import { resolveLabel, resolveActionLabel } from "@/lib/navigation/label-resolver";
import type { NavConfig } from "@/lib/navigation/nav-items";

interface AnnouncementsPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function AnnouncementsPage({ params }: AnnouncementsPageProps) {
  const { orgSlug } = await params;
  const supabase = await createClient();

  // Fetch organization
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .limit(1);

  const org = orgs?.[0];

  if (!org || orgError) return null;

  const isAdmin = await isOrgAdmin(org.id);
  const membership = await getOrgRole({ orgId: org.id });

  // Fetch announcements, pinned first, then by date
  const { data: announcements } = await supabase
    .from("announcements")
    .select("*")
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .order("is_pinned", { ascending: false })
    .order("published_at", { ascending: false });

  const visibleAnnouncements = filterAnnouncementsForUser(announcements, {
    role: membership.role,
    status: membership.status,
    userId: membership.userId,
  });

  const navConfig = org.nav_config as NavConfig | null;
  const pageLabel = resolveLabel("/announcements", navConfig);
  const actionLabel = resolveActionLabel("/announcements", navConfig, "New");

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={pageLabel}
        description={`${visibleAnnouncements.length} ${pageLabel.toLowerCase()}`}
        actions={
          isAdmin && (
            <Link href={`/${orgSlug}/announcements/new`}>
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

      {/* Announcements List */}
      {visibleAnnouncements && visibleAnnouncements.length > 0 ? (
        <div className="space-y-4 stagger-children">
          {visibleAnnouncements.map((announcement) => (
            <Card key={announcement.id} className="p-6">
              <div className="flex items-start gap-4">
                {/* Pin indicator */}
                {announcement.is_pinned && (
                  <div className="flex-shrink-0 mt-1">
                    <div className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                      <svg className="h-4 w-4 text-amber-600 dark:text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M16 4v2.586l-3.293 3.293A1 1 0 0012 10.586V16H9v-5.414a1 1 0 00-.293-.707L5.414 6.586 4.586 7.414l3.293 3.293V18a1 1 0 001 1h6a1 1 0 001-1v-7.293l3.293-3.293.707.707L17.414 6H20V4H16z"/>
                      </svg>
                    </div>
                  </div>
                )}

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-foreground">{announcement.title}</h3>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {announcement.published_at
                          ? new Date(announcement.published_at).toLocaleDateString("en-US", {
                              weekday: "short",
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })
                          : "Scheduled"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {announcement.is_pinned && (
                        <Badge variant="warning">Pinned</Badge>
                      )}
                      {isAdmin && (
                        <>
                          <Link href={`/${orgSlug}/announcements/${announcement.id}/edit`}>
                            <Button variant="ghost" size="sm">
                              Edit
                            </Button>
                          </Link>
                          <SoftDeleteButton
                            table="announcements"
                            id={announcement.id}
                            organizationField="organization_id"
                            organizationId={org.id}
                            redirectTo={`/${orgSlug}/announcements`}
                            label="Delete"
                          />
                        </>
                      )}
                    </div>
                  </div>
                  
                  {announcement.body && (
                    <p className="text-muted-foreground mt-3 whitespace-pre-wrap">
                      {announcement.body}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46" />
              </svg>
            }
            title={`No ${pageLabel.toLowerCase()} yet`}
            description={`${pageLabel} from your organization will appear here`}
            action={
              isAdmin && (
                <Link href={`/${orgSlug}/announcements/new`}>
                  <Button>{resolveActionLabel("/announcements", navConfig, "Create First")}</Button>
                </Link>
              )
            }
          />
        </Card>
      )}
    </div>
  );
}
