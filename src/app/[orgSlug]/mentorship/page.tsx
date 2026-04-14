import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { getOrgContext } from "@/lib/auth/roles";
import { MentorshipContextStrip } from "@/components/mentorship/MentorshipContextStrip";
import { MentorshipPairsList } from "@/components/mentorship/MentorshipPairsList";
import { MentorDirectory } from "@/components/mentorship/MentorDirectory";
import { MentorshipTabShell } from "@/components/mentorship/MentorshipTabShell";
import { MentorshipTasksTab } from "@/components/mentorship/MentorshipTasksTab";
import { MentorshipMeetingsTab } from "@/components/mentorship/MentorshipMeetingsTab";
import { MentorshipPageSkeleton } from "@/components/skeletons/pages/MentorshipPageSkeleton";
import { resolveLabel } from "@/lib/navigation/label-resolver";
import { getLocale, getTranslations } from "next-intl/server";
import type { NavConfig } from "@/lib/navigation/nav-items";
import { getMentorshipSectionOrder } from "@/lib/mentorship/presentation";
import { parseMentorshipTab } from "@/lib/mentorship/view-state";
import { baseSchemas } from "@/lib/schemas";
import { resolveOrgTimezone } from "@/lib/utils/timezone";

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

  // Parse tab parameter
  const activeTab = parseMentorshipTab(tabParam);

  // Validate pair param as UUID
  const pairIdParam =
    pairParam && baseSchemas.uuid.safeParse(pairParam).success
      ? pairParam
      : null;

  // Stage 1: pairs + currentUserProfile + mentorProfiles in parallel (all independent)
  const [{ data: pairs }, { data: currentUserProfile }, { data: mentorProfiles }] = await Promise.all([
    supabase
      .from("mentorship_pairs")
      .select("*")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    orgCtx.userId
      ? supabase
          .from("mentor_profiles")
          .select("id")
          .eq("organization_id", orgId)
          .eq("user_id", orgCtx.userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("mentor_profiles")
      .select("*, users!mentor_profiles_user_id_fkey(id, name, email)")
      .eq("organization_id", orgId)
      .eq("is_active", true),
  ]);

  const pairIds = pairs?.map((p) => p.id) || [];

  const userIds = new Set<string>();
  pairs?.forEach((p) => {
    userIds.add(p.mentor_user_id);
    userIds.add(p.mentee_user_id);
  });

  // Stage 2: alumni data + logs + users + tasks + meetings in parallel (depend on mentorProfiles / pairs)
  const mentorUserIds = mentorProfiles?.map((p) => p.user_id) || [];
  const [{ data: mentorAlumni }, { data: logs }, { data: users }, { data: tasks }, { data: meetings }] = await Promise.all([
    mentorUserIds.length > 0
      ? supabase
          .from("alumni")
          .select("user_id, first_name, last_name, photo_url, industry, graduation_year, current_company, current_city")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .in("user_id", mentorUserIds)
      : Promise.resolve({ data: [] as never[] }),
    pairIds.length > 0
      ? supabase
          .from("mentorship_logs")
          .select("*")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .in("pair_id", pairIds)
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
    userIds.size > 0
      ? supabase.from("users").select("id,name,email").in("id", Array.from(userIds))
      : Promise.resolve({ data: [] as never[] }),
    pairIds.length > 0
      ? supabase
          .from("mentorship_tasks")
          .select("*")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .in("pair_id", pairIds)
          .order("due_date", { ascending: true, nullsLast: true })
      : Promise.resolve({ data: [] as never[] }),
    pairIds.length > 0
      ? supabase
          .from("mentorship_meetings")
          .select("*")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .in("pair_id", pairIds)
          .order("scheduled_at", { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const filteredPairs =
    orgCtx.isAdmin
      ? pairs || []
      : (pairs || []).filter((p) =>
          orgCtx.role === "active_member"
            ? p.mentee_user_id === orgCtx.userId
            : p.mentor_user_id === orgCtx.userId
        );

  // Determine initial pair
  const visiblePairIds = filteredPairs.map((p) => p.id);
  const initialPairId =
    pairIdParam && visiblePairIds.includes(pairIdParam)
      ? pairIdParam
      : visiblePairIds[0] ?? null;

  // Split meetings into upcoming and past
  const now = new Date();
  const upcomingMeetings = (meetings || []).filter(
    (m) => new Date(m.scheduled_end_at) > now && !m.deleted_at
  );
  const pastMeetings = (meetings || []).filter(
    (m) => new Date(m.scheduled_end_at) <= now && !m.deleted_at
  );

  // Prepare logs for the client component
  const logsForClient = (logs || []).map((log) => ({
    id: log.id,
    pair_id: log.pair_id,
    entry_date: log.entry_date,
    notes: log.notes,
    progress_metric: log.progress_metric,
    created_by: log.created_by,
  }));

  // Prepare users for the client component
  const usersForClient = (users || []).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
  }));

  // Prepare mentor directory data
  const alumniMap = new Map(
    (mentorAlumni || []).map((a) => [a.user_id, a])
  );

  const mentorsForDirectory = (mentorProfiles || []).map((profile) => {
    const user = profile.users as { id: string; name: string; email: string | null } | null;
    const alumni = alumniMap.get(profile.user_id);

    return {
      id: profile.id,
      user_id: profile.user_id,
      name: user?.name || "Unknown",
      email: user?.email || null,
      photo_url: alumni?.photo_url || null,
      industry: alumni?.industry || null,
      graduation_year: alumni?.graduation_year || null,
      current_company: alumni?.current_company || null,
      current_city: alumni?.current_city || null,
      expertise_areas: profile.expertise_areas || null,
      bio: profile.bio || null,
      contact_email: profile.contact_email || null,
      contact_linkedin: profile.contact_linkedin || null,
      contact_phone: profile.contact_phone || null,
    };
  });

  // Extract unique industries and years for filters
  const industries = Array.from(
    new Set(
      mentorsForDirectory
        .map((m) => m.industry)
        .filter((i): i is string => i !== null)
    )
  ).sort();

  const years = Array.from(
    new Set(
      mentorsForDirectory
        .map((m) => m.graduation_year)
        .filter((y): y is number => y !== null)
    )
  ).sort((a, b) => b - a);

  const navConfig = orgCtx.organization.nav_config as NavConfig | null;
  const [tNav, tMentorship, locale] = await Promise.all([
    getTranslations("nav.items"),
    getTranslations("mentorship"),
    getLocale(),
  ]);
  const t = (key: string) => tNav(key);
  const pageLabel = resolveLabel("/mentorship", navConfig, t, locale);

  // Compute "my pair" context for the active member header strip.
  const hasPairs = filteredPairs.length > 0;

  const myPair =
    orgCtx.role === "active_member"
      ? filteredPairs.find((p) => p.mentee_user_id === orgCtx.userId) ?? null
      : null;

  const myMentorName = myPair
    ? usersForClient.find((u) => u.id === myPair.mentor_user_id)?.name ?? null
    : null;

  const myLastLogDate = myPair
    ? logsForClient.find((l) => l.pair_id === myPair.id)?.entry_date ?? null
    : null;

  // Format pairs for tab components
  const pairsForTabs = filteredPairs.map((p) => ({
    id: p.id,
    mentorName:
      usersForClient.find((u) => u.id === p.mentor_user_id)?.name || "Unknown",
    menteeName:
      usersForClient.find((u) => u.id === p.mentee_user_id)?.name || "Unknown",
  }));

  const pairsList = (
    <MentorshipPairsList
      initialPairs={filteredPairs}
      logs={logsForClient}
      users={usersForClient}
      isAdmin={orgCtx.isAdmin}
      canLogActivity={orgCtx.isAdmin || orgCtx.isActiveMember}
      orgId={orgId}
      currentUserId={orgCtx.userId ?? undefined}
      emptyStateAction={
        orgCtx.role === "active_member" ? (
          <a
            href="#mentor-directory"
            className="text-sm text-[color:var(--color-org-secondary)] hover:underline"
          >
            {tMentorship("browseMentors")} ↓
          </a>
        ) : undefined
      }
    />
  );

  const directory = (
    <MentorDirectory
      mentors={mentorsForDirectory}
      industries={industries}
      years={years}
      showRegistration={orgCtx.role === "alumni" && !currentUserProfile}
      orgId={orgId}
      orgSlug={orgSlug}
    />
  );

  // Order: active members & alumni with a pair see their pairs first;
  // admins always see the directory first (they scan while managing).
  const sectionOrder = getMentorshipSectionOrder({
    hasPairs,
    isAdmin: orgCtx.isAdmin,
  });

  const isMentor = (pairs || []).some((p) => p.mentor_user_id === orgCtx.userId);
  const isAdmin = orgCtx.isAdmin;
  const currentUserId = orgCtx.userId ?? "";

  const overviewContent = (
    <>
      <MentorshipContextStrip
        role={orgCtx.role ?? ""}
        orgId={orgId}
        orgSlug={orgSlug}
        myMentorName={myMentorName}
        myLastLogDate={myLastLogDate}
      />

      {sectionOrder === "pairs-first" ? (
        <>
          {pairsList}
          {directory}
        </>
      ) : (
        <>
          {directory}
          {pairsList}
        </>
      )}
    </>
  );

  const tasksContent = (
    <MentorshipTasksTab
      initialTasks={tasks || []}
      pairs={pairsForTabs}
      initialPairId={initialPairId || ""}
      isMentor={isMentor}
      isAdmin={isAdmin}
      orgId={orgId}
      orgSlug={orgSlug}
      currentUserId={currentUserId}
    />
  );

  const orgTimezone = resolveOrgTimezone(orgCtx.organization.timezone);

  const meetingsContent = (
    <MentorshipMeetingsTab
      initialUpcoming={upcomingMeetings}
      initialPast={pastMeetings}
      pairs={pairsForTabs}
      initialPairId={initialPairId || ""}
      isMentor={isMentor}
      isAdmin={isAdmin}
      orgId={orgId}
      orgSlug={orgSlug}
      currentUserId={currentUserId}
      orgTimezone={orgTimezone}
    />
  );

  const directoryContent = directory;

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        title={pageLabel}
        description={tMentorship("editorialStrapline")}
        variant="editorial"
      />

      <Suspense fallback={<MentorshipPageSkeleton />}>
        <MentorshipTabShell
          initialTab={activeTab}
          orgSlug={orgSlug}
          overview={overviewContent}
          tasks={tasksContent}
          meetings={meetingsContent}
          directory={directoryContent}
        />
      </Suspense>
    </div>
  );
}
