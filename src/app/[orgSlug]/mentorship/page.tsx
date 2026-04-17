import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { getOrgContext } from "@/lib/auth/roles";
import { MentorshipContextStrip } from "@/components/mentorship/MentorshipContextStrip";
import { MentorDirectory } from "@/components/mentorship/MentorDirectory";
import { MentorshipTabShell } from "@/components/mentorship/MentorshipTabShell";
import { MentorshipActivityTab } from "@/components/mentorship/MentorshipActivityTab";
import { MentorshipProposalsTab } from "@/components/mentorship/MentorshipProposalsTab";
import { MenteeIntakeBanner } from "@/components/mentorship/MenteeIntakeBanner";
import { MentorshipPageSkeleton } from "@/components/skeletons/pages/MentorshipPageSkeleton";
import { resolveLabel } from "@/lib/navigation/label-resolver";
import { getLocale, getTranslations } from "next-intl/server";
import type { NavConfig } from "@/lib/navigation/nav-items";
import { canLogMentorshipActivity } from "@/lib/mentorship/presentation";
import { parseMentorshipTab } from "@/lib/mentorship/view-state";
import { baseSchemas } from "@/lib/schemas";
import { resolveOrgTimezone } from "@/lib/utils/timezone";
import { decryptToken } from "@/lib/crypto/token-encryption";

interface MentorshipPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ tab?: string; pair?: string }>;
}

type MentorProfileExtra = {
  topics?: string[] | null;
  accepting_new?: boolean | null;
  current_mentee_count?: number | null;
  max_mentees?: number | null;
  meeting_preferences?: string[] | null;
  years_of_experience?: number | null;
};

type PairExtra = {
  proposed_at?: string | null;
  declined_at?: string | null;
  declined_reason?: string | null;
  match_score?: number | null;
  match_signals?: unknown;
};

export default async function MentorshipPage({ params, searchParams }: MentorshipPageProps) {
  const { orgSlug } = await params;
  const { tab: tabParam, pair: pairParam } = await searchParams;

  const orgCtx = await getOrgContext(orgSlug);
  const supabase = await createClient();

  if (!orgCtx.organization) return null;

  const orgId = orgCtx.organization.id;

  const activeTab = parseMentorshipTab(tabParam);

  const pairIdParam =
    pairParam && baseSchemas.uuid.safeParse(pairParam).success ? pairParam : null;

  const [{ data: pairs }, { data: currentUserProfile }, { data: mentorProfiles }, { data: intakeForm }, { data: intakeSubmission }] = await Promise.all([
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
    // forms extended with system_key in Phase 2
    (supabase.from("forms") as unknown as { select: (cols: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { is: (c: string, v: null) => { maybeSingle: () => Promise<{ data: { id: string } | null }> } } } } })
      .select("id")
      .eq("organization_id", orgId)
      .eq("system_key", "mentee_intake_v1")
      .is("deleted_at", null)
      .maybeSingle(),
    orgCtx.role === "active_member" && orgCtx.userId
      ? ((supabase.from("mentee_latest_intake") as unknown as {
          select: (cols: string) => {
            eq: (c: string, v: string) => {
              eq: (c: string, v: string) => {
                maybeSingle: () => Promise<{ data: { id: string } | null }>;
              };
            };
          };
        })
          .select("id")
          .eq("user_id", orgCtx.userId)
          .eq("organization_id", orgId)
          .maybeSingle())
      : Promise.resolve({ data: null }),
  ]);

  const proposalStatuses = new Set(["proposed", "declined", "expired"]);
  const workingPairs = (pairs || []).filter((p) => !proposalStatuses.has(p.status));
  const proposalPairs = (pairs || []).filter((p) => proposalStatuses.has(p.status));
  const workingPairIds = workingPairs.map((p) => p.id);

  const userIds = new Set<string>();
  pairs?.forEach((p) => {
    userIds.add(p.mentor_user_id);
    userIds.add(p.mentee_user_id);
  });

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
    workingPairIds.length > 0
      ? supabase
          .from("mentorship_logs")
          .select("*")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .in("pair_id", workingPairIds)
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
    userIds.size > 0
      ? supabase.from("users").select("id,name,email").in("id", Array.from(userIds))
      : Promise.resolve({ data: [] as never[] }),
    workingPairIds.length > 0
      ? supabase
          .from("mentorship_tasks")
          .select("*")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .in("pair_id", workingPairIds)
          .order("due_date", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
    workingPairIds.length > 0
      ? supabase
          .from("mentorship_meetings")
          .select("*")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .in("pair_id", workingPairIds)
          .order("scheduled_at", { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const filteredPairs =
    orgCtx.isAdmin
      ? workingPairs
      : workingPairs.filter((p) =>
          orgCtx.role === "active_member"
            ? p.mentee_user_id === orgCtx.userId
            : p.mentor_user_id === orgCtx.userId
        );

  const filteredProposals =
    orgCtx.isAdmin
      ? proposalPairs
      : proposalPairs.filter(
          (p) => p.mentor_user_id === orgCtx.userId || p.mentee_user_id === orgCtx.userId
        );

  const visiblePairIds = filteredPairs.map((p) => p.id);
  const initialPairId =
    pairIdParam && visiblePairIds.includes(pairIdParam)
      ? pairIdParam
      : visiblePairIds[0] ?? null;

  const decryptionKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  const decryptedMeetings = (meetings || []).map((m) => ({
    ...m,
    meeting_link: m.meeting_link && decryptionKey
      ? (() => { try { return decryptToken(m.meeting_link, decryptionKey); } catch { return null; } })()
      : null,
  }));

  const now = new Date();
  const upcomingMeetings = decryptedMeetings.filter(
    (m) => new Date(m.scheduled_end_at) > now && !m.deleted_at
  );
  const pastMeetings = decryptedMeetings.filter(
    (m) => new Date(m.scheduled_end_at) <= now && !m.deleted_at
  );

  const logsForClient = (logs || []).map((log) => ({
    id: log.id,
    pair_id: log.pair_id,
    entry_date: log.entry_date,
    notes: log.notes,
    progress_metric: log.progress_metric,
    created_by: log.created_by,
  }));

  const usersForClient = (users || []).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
  }));

  const alumniMap = new Map((mentorAlumni || []).map((a) => [a.user_id, a]));

  const mentorsForDirectory = (mentorProfiles || []).map((profile) => {
    const user = profile.users as { id: string; name: string; email: string | null } | null;
    const alumni = alumniMap.get(profile.user_id);
    const extra = profile as unknown as MentorProfileExtra;

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
      topics: extra.topics ?? null,
      bio: profile.bio || null,
      contact_email: profile.contact_email || null,
      contact_linkedin: profile.contact_linkedin || null,
      contact_phone: profile.contact_phone || null,
      accepting_new: extra.accepting_new ?? true,
      current_mentee_count: extra.current_mentee_count ?? 0,
      max_mentees: extra.max_mentees ?? 3,
      meeting_preferences: extra.meeting_preferences ?? null,
      years_of_experience: extra.years_of_experience ?? null,
    };
  });

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

  const pairsForTabs = filteredPairs.map((p) => ({
    id: p.id,
    mentorUserId: p.mentor_user_id,
    mentorName:
      usersForClient.find((u) => u.id === p.mentor_user_id)?.name || "Unknown",
    menteeName:
      usersForClient.find((u) => u.id === p.mentee_user_id)?.name || "Unknown",
  }));
  const isAdmin = orgCtx.isAdmin;
  const canLogActivity = canLogMentorshipActivity({
    role: orgCtx.role,
    status: orgCtx.status,
  });
  const currentUserId = orgCtx.userId ?? "";
  const orgTimezone = resolveOrgTimezone(orgCtx.organization.timezone);

  const userMap: Record<string, string> = Object.fromEntries(
    usersForClient.map((u) => [u.id, u.name || u.email || "Unknown"])
  );

  const proposalRows = filteredProposals.map((p) => {
    const extra = p as unknown as PairExtra;
    return {
      id: p.id,
      status: p.status,
      mentor_user_id: p.mentor_user_id,
      mentee_user_id: p.mentee_user_id,
      proposed_at: extra.proposed_at ?? null,
      declined_reason: extra.declined_reason ?? null,
      match_score: extra.match_score ?? null,
    };
  });

  const intakeFormId = (intakeForm as { id?: string } | null)?.id ?? null;
  const hasIntakeSubmission = Boolean((intakeSubmission as { id?: string } | null)?.id);
  const isMentee = orgCtx.role === "active_member";
  const canRequestIntro = isMentee && !!orgCtx.userId;

  const activityContent = (
    <>
      <MentorshipContextStrip
        role={orgCtx.role ?? ""}
        orgId={orgId}
        orgSlug={orgSlug}
        myMentorName={myMentorName}
        myLastLogDate={myLastLogDate}
      />

      {isMentee && !hasIntakeSubmission && (
        <MenteeIntakeBanner orgSlug={orgSlug} intakeFormId={intakeFormId} />
      )}

      <MentorshipActivityTab
        initialTasks={tasks || []}
        initialUpcoming={upcomingMeetings}
        initialPast={pastMeetings}
        initialLogs={logsForClient}
        pairs={pairsForTabs}
        initialPairId={initialPairId || ""}
        isAdmin={isAdmin}
        canLogActivity={canLogActivity}
        orgId={orgId}
        orgSlug={orgSlug}
        currentUserId={currentUserId}
        orgTimezone={orgTimezone}
        userMap={userMap}
      />
    </>
  );

  const directoryContent = (
    <MentorDirectory
      mentors={mentorsForDirectory}
      industries={industries}
      years={years}
      showRegistration={orgCtx.role === "alumni" && !currentUserProfile}
      orgId={orgId}
      orgSlug={orgSlug}
      currentUserId={currentUserId}
      canRequestIntro={canRequestIntro}
      isAdmin={isAdmin}
    />
  );

  const proposalsContent = proposalRows.length > 0 || isAdmin ? (
    <MentorshipProposalsTab
      orgId={orgId}
      currentUserId={currentUserId}
      isAdmin={isAdmin}
      proposals={proposalRows}
      userMap={userMap}
    />
  ) : null;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={pageLabel}
        description={tMentorship("editorialStrapline")}
      />

      <Suspense fallback={<MentorshipPageSkeleton />}>
        <MentorshipTabShell
          initialTab={activeTab}
          orgSlug={orgSlug}
          activity={activityContent}
          directory={directoryContent}
          proposals={proposalsContent}
          proposalCount={proposalRows.length}
        />
      </Suspense>
    </div>
  );
}
