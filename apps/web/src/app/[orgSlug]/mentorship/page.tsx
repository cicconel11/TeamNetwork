import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { getOrgContext } from "@/lib/auth/roles";
import { MentorshipTabShell } from "@/components/mentorship/MentorshipTabShell";
import { MentorshipPageSkeleton } from "@/components/skeletons/pages/MentorshipPageSkeleton";
import { resolveLabel } from "@/lib/navigation/label-resolver";
import { getLocale, getTranslations } from "next-intl/server";
import type { NavConfig } from "@/lib/navigation/nav-items";
import { parseMentorshipTab } from "@/lib/mentorship/view-state";
import { baseSchemas } from "@/lib/schemas";
import { resolveOrgTimezone } from "@/lib/utils/timezone";
import { loadMentorshipTabView } from "@/lib/mentorship/tab-data";

interface MentorshipPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ tab?: string; pair?: string }>;
}

export default async function MentorshipPage({ params, searchParams }: MentorshipPageProps) {
  const { orgSlug } = await params;
  const { tab: tabParam, pair: pairParam } = await searchParams;

  const orgCtx = await getOrgContext(orgSlug);
  const supabase = await createClient();

  if (!orgCtx.organization) return null;

  const orgId = orgCtx.organization.id;
  const currentUserId = orgCtx.userId ?? "";
  const requestedTab = parseMentorshipTab(tabParam);
  const pairIdParam =
    pairParam && baseSchemas.uuid.safeParse(pairParam).success ? pairParam : null;
  const orgTimezone = resolveOrgTimezone(orgCtx.organization.timezone);

  const [view, tNav, tMentorship, locale] = await Promise.all([
    loadMentorshipTabView({
      supabase,
      orgId,
      orgSlug,
      role: orgCtx.role,
      status: orgCtx.status,
      currentUserId,
      requestedTab,
      pairIdParam,
      orgTimezone,
    }),
    getTranslations("nav.items"),
    getTranslations("mentorship"),
    getLocale(),
  ]);

  const navConfig = orgCtx.organization.nav_config as NavConfig | null;
  const pageLabel = resolveLabel("/mentorship", navConfig, (key: string) => tNav(key), locale);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={pageLabel}
        description={tMentorship("editorialStrapline")}
      />

      <Suspense fallback={<MentorshipPageSkeleton />}>
        <MentorshipTabShell
          activeTab={view.activeTab}
          orgId={orgId}
          initialTabData={view.data}
          showProposalsTab={view.showProposalsTab}
          showMatchesTab={view.showMatchesTab}
          proposalCount={view.proposalCount}
        />
      </Suspense>
    </div>
  );
}
