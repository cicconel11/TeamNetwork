import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth/roles";
import { filterAnnouncementsForUserViaRpc } from "@/lib/announcements";
import { resolveLabel, resolveActionLabel } from "@/lib/navigation/label-resolver";
import { getLocale, getTranslations } from "next-intl/server";
import { AnnouncementsFeed } from "@/components/announcements/AnnouncementsFeed";
import { InlineBanner } from "@/components/ui";
import type { NavConfig } from "@/lib/navigation/nav-items";

interface AnnouncementsPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function AnnouncementsPage({ params }: AnnouncementsPageProps) {
  const { orgSlug } = await params;

  const orgCtx = await getOrgContext(orgSlug);
  if (!orgCtx.organization) return null;
  const org = orgCtx.organization;

  const supabase = await createClient();

  const { data: announcements, error: announcementsError } = await supabase
    .from("announcements")
    .select("*")
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .order("is_pinned", { ascending: false })
    .order("published_at", { ascending: false });

  if (announcementsError)
    console.error("[announcements] Failed to fetch announcements:", announcementsError.message);

  const visibleAnnouncements = await filterAnnouncementsForUserViaRpc(
    supabase,
    org.id,
    announcements,
    {
      role: orgCtx.role,
      status: orgCtx.status,
      userId: orgCtx.userId,
    },
  );

  const navConfig = org.nav_config as NavConfig | null;
  const [tNav, locale] = await Promise.all([getTranslations("nav.items"), getLocale()]);
  const t = (key: string) => tNav(key);
  const pageLabel = resolveLabel("/announcements", navConfig, t, locale);

  return (
    <>
      {announcementsError && (
        <InlineBanner variant="error" className="mb-6">
          Couldn&apos;t load {pageLabel.toLowerCase()}. Refresh to try again.
        </InlineBanner>
      )}
      <AnnouncementsFeed
        announcements={visibleAnnouncements}
        orgSlug={orgSlug}
        isAdmin={orgCtx.isAdmin}
        pageLabel={pageLabel}
        actionLabel={resolveActionLabel("/announcements", navConfig, "New", t, locale)}
      />
    </>
  );
}
