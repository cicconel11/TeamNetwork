import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { getOrgContext } from "@/lib/auth/roles";
import { MentorshipContextStrip } from "@/components/mentorship/MentorshipContextStrip";
import { MentorDirectory } from "@/components/mentorship/MentorDirectory";
import { MentorshipTabShell } from "@/components/mentorship/MentorshipTabShell";
import { MentorshipActivityTab } from "@/components/mentorship/MentorshipActivityTab";
import { MentorshipProposalsTab } from "@/components/mentorship/MentorshipProposalsTab";
import { MenteePreferencesCard } from "@/components/mentorship/MenteePreferencesCard";
import { MentorProfileCard } from "@/components/mentorship/MentorProfileCard";
import { MentorshipPageSkeleton } from "@/components/skeletons/pages/MentorshipPageSkeleton";
import { resolveLabel } from "@/lib/navigation/label-resolver";
import { getLocale, getTranslations } from "next-intl/server";
import type { NavConfig } from "@/lib/navigation/nav-items";
import { canLogMentorshipActivity } from "@/lib/mentorship/presentation";
import { parseMentorshipTab, type MentorshipTab } from "@/lib/mentorship/view-state";
import { baseSchemas } from "@/lib/schemas";
import { resolveOrgTimezone } from "@/lib/utils/timezone";
import { decryptToken } from "@/lib/crypto/token-encryption";
import type { Database } from "@/types/database";

interface MentorshipPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ tab?: string; pair?: string }>;
}

type MentorProfileRow = Database["public"]["Tables"]["mentor_profiles"]["Row"] & {
  users: { id: string; name: string | null; email: string | null } | null;
  topics?: string[] | null;
  accepting_new?: boolean | null;
  current_mentee_count?: number | null;
  max_mentees?: number | null;
  meeting_preferences?: string[] | null;
  years_of_experience?: number | null;
};

type MentorshipPairRow = Database["public"]["Tables"]["mentorship_pairs"]["Row"] & {
  proposed_at?: string | null;
  declined_at?: string | null;
  declined_reason?: string | null;
  match_score?: number | null;
  match_signals?: unknown;
};

type MentorshipLogRow = Database["public"]["Tables"]["mentorship_logs"]["Row"];
type MentorshipTaskRow = Database["public"]["Tables"]["mentorship_tasks"]["Row"];
type MentorshipMeetingRow = Database["public"]["Tables"]["mentorship_meetings"]["Row"];
type UserRow = { id: string; name: string | null; email: string | null };
type AlumniDirectoryRow = Pick<
  Database["public"]["Tables"]["alumni"]["Row"],
  | "user_id"
  | "photo_url"
  | "industry"
  | "graduation_year"
  | "current_company"
  | "current_city"
>;
const PROPOSAL_STATUSES = new Set(["proposed", "declined", "expired"]);

export default async function MentorshipPage({ params, searchParams }: MentorshipPageProps) {
  const { orgSlug } = await params;
  const { tab: tabParam, pair: pairParam } = await searchParams;

  const orgCtx = await getOrgContext(orgSlug);
  const supabase = await createClient();

  if (!orgCtx.organization) return null;

  const orgId = orgCtx.organization.id;

  const requestedTab = parseMentorshipTab(tabParam);
  const isAdmin = orgCtx.isAdmin;
  const currentUserId = orgCtx.userId ?? "";
  const isMentee = orgCtx.role === "active_member";
  const canRequestIntro = isMentee && currentUserId.length > 0;
  const canLogActivity = canLogMentorshipActivity({
    role: orgCtx.role,
    status: orgCtx.status,
  });
  const orgTimezone = resolveOrgTimezone(orgCtx.organization.timezone);

  const pairIdParam =
    pairParam && baseSchemas.uuid.safeParse(pairParam).success ? pairParam : null;

  const { data: pairsRaw } = await supabase
    .from("mentorship_pairs")
    .select("*")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const pairs = (pairsRaw ?? []) as MentorshipPairRow[];
  const workingPairs = pairs.filter((pair) => !PROPOSAL_STATUSES.has(pair.status));
  const proposalPairs = pairs.filter((pair) => PROPOSAL_STATUSES.has(pair.status));

  const filteredPairs =
    isAdmin
      ? workingPairs
      : workingPairs.filter((p) =>
          orgCtx.role === "active_member"
            ? p.mentee_user_id === orgCtx.userId
            : p.mentor_user_id === orgCtx.userId
        );

  const personalProposals = proposalPairs.filter(
    (p) => p.mentor_user_id === orgCtx.userId || p.mentee_user_id === orgCtx.userId
  );
  const filteredProposals = personalProposals;
  const proposalCount = personalProposals.length;
  const adminPendingCount = proposalPairs.filter((p) => p.status === "proposed").length;
  const showProposalsTab = proposalCount > 0 || isAdmin;
  const activeTab: MentorshipTab =
    requestedTab === "proposals" && !showProposalsTab ? "activity" : requestedTab;

  const visiblePairIds = filteredPairs.map((p) => p.id);
  const initialPairId =
    pairIdParam && visiblePairIds.includes(pairIdParam)
      ? pairIdParam
      : visiblePairIds[0] ?? null;

  const navConfig = orgCtx.organization.nav_config as NavConfig | null;
  const [tNav, locale] = await Promise.all([
    getTranslations("nav.items"),
    getLocale(),
  ]);
  const t = (key: string) => tNav(key);
  const pageLabel = resolveLabel("/mentorship", navConfig, t, locale);

  let tabContent: React.ReactNode = null;

  if (activeTab === "activity") {
    const pairUserIds = new Set<string>();
    filteredPairs.forEach((pair) => {
      pairUserIds.add(pair.mentor_user_id);
      pairUserIds.add(pair.mentee_user_id);
    });

    const [
      { data: usersRaw },
      { data: logsRaw },
      { data: tasksRaw },
      { data: meetingsRaw },
    ] = await Promise.all([
      pairUserIds.size > 0
        ? supabase
            .from("user_organization_roles")
            .select("user_id, users(name,email)")
            .eq("organization_id", orgId)
            .in("user_id", Array.from(pairUserIds))
        : Promise.resolve({ data: [] as UserRow[] }),
      visiblePairIds.length > 0
        ? supabase
            .from("mentorship_logs")
            .select("*")
            .eq("organization_id", orgId)
            .is("deleted_at", null)
            .in("pair_id", visiblePairIds)
            .order("entry_date", { ascending: false })
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as MentorshipLogRow[] }),
      visiblePairIds.length > 0
        ? supabase
            .from("mentorship_tasks")
            .select("*")
            .eq("organization_id", orgId)
            .is("deleted_at", null)
            .in("pair_id", visiblePairIds)
            .order("due_date", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as MentorshipTaskRow[] }),
      visiblePairIds.length > 0
        ? supabase
            .from("mentorship_meetings")
            .select("*")
            .eq("organization_id", orgId)
            .is("deleted_at", null)
            .in("pair_id", visiblePairIds)
            .order("scheduled_at", { ascending: true })
        : Promise.resolve({ data: [] as MentorshipMeetingRow[] }),
    ]);

    const usersForClient = ((usersRaw ?? []) as Array<{
      user_id: string;
      users:
        | { name: string | null; email: string | null }
        | Array<{ name: string | null; email: string | null }>
        | null;
    }>).map((row) => {
      const user = Array.isArray(row.users) ? row.users[0] : row.users;
      return {
        id: row.user_id,
        name: user?.name ?? null,
        email: user?.email ?? null,
      };
    });
    const userMap: Record<string, string> = Object.fromEntries(
      usersForClient.map((user) => [user.id, user.name || user.email || "Unknown"])
    );
    const logsForClient = (logsRaw ?? []).map((log) => ({
      id: log.id,
      pair_id: log.pair_id,
      entry_date: log.entry_date,
      notes: log.notes,
      progress_metric: log.progress_metric,
      created_by: log.created_by,
    }));
    const pairsForTabs = filteredPairs.map((pair) => ({
      id: pair.id,
      mentorUserId: pair.mentor_user_id,
      menteeUserId: pair.mentee_user_id,
      mentorName:
        usersForClient.find((user) => user.id === pair.mentor_user_id)?.name || "Unknown",
      menteeName:
        usersForClient.find((user) => user.id === pair.mentee_user_id)?.name || "Unknown",
    }));
    const myPair =
      isMentee
        ? filteredPairs.find((pair) => pair.mentee_user_id === currentUserId) ?? null
        : null;
    const myMentorName = myPair
      ? usersForClient.find((user) => user.id === myPair.mentor_user_id)?.name ?? null
      : null;
    const myLastLogDate = myPair
      ? logsForClient.find((log) => log.pair_id === myPair.id)?.entry_date ?? null
      : null;

    const decryptionKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    const decryptedMeetings = (meetingsRaw ?? []).map((meeting) => ({
      ...meeting,
      meeting_link:
        meeting.meeting_link && decryptionKey
          ? (() => {
              try {
                return decryptToken(meeting.meeting_link, decryptionKey);
              } catch {
                return null;
              }
            })()
          : null,
    }));
    const now = new Date();
    const upcomingMeetings = decryptedMeetings.filter(
      (meeting) => new Date(meeting.scheduled_end_at) > now && !meeting.deleted_at
    );
    const pastMeetings = decryptedMeetings.filter(
      (meeting) => new Date(meeting.scheduled_end_at) <= now && !meeting.deleted_at
    );
    tabContent = (
      <>
        <MentorshipContextStrip
          role={orgCtx.role ?? ""}
          orgId={orgId}
          orgSlug={orgSlug}
          myMentorName={myMentorName}
          myLastLogDate={myLastLogDate}
        />

        {isMentee && <MenteePreferencesCard orgId={orgId} />}

        {(orgCtx.role === "alumni" || orgCtx.role === "admin") && (
          <MentorProfileCard orgId={orgId} />
        )}

        <MentorshipActivityTab
          initialTasks={tasksRaw ?? []}
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
  }

  if (activeTab === "directory") {
    const [
      { data: mentorProfilesRaw },
      { data: pendingPairsRaw },
    ] = await Promise.all([
      supabase
        .from("mentor_profiles")
        .select("*, users!mentor_profiles_user_id_fkey(id, name, email)")
        .eq("organization_id", orgId)
        .eq("is_active", true),
      canRequestIntro
        ? supabase
            .from("mentorship_pairs")
            .select("mentor_user_id")
            .eq("organization_id", orgId)
            .eq("mentee_user_id", currentUserId)
            .in("status", ["proposed", "accepted", "active", "paused"])
            .is("deleted_at", null)
        : Promise.resolve({ data: [] as Array<{ mentor_user_id: string }> }),
    ]);

    const mentorProfiles = (mentorProfilesRaw ?? []) as Array<
      MentorProfileRow & {
        sports?: string[] | null;
        positions?: string[] | null;
      }
    >;
    const mentorUserIds = mentorProfiles.map((profile) => profile.user_id);
    const pendingRequestMentorIds = (
      (pendingPairsRaw ?? []) as Array<{ mentor_user_id: string }>
    ).map((row) => row.mentor_user_id);
    const sportOptions = Array.from(
      new Set(
        mentorProfiles
          .flatMap((p) => p.sports ?? [])
          .filter((s): s is string => typeof s === "string" && s.length > 0)
      )
    ).sort();
    const positionOptions = Array.from(
      new Set(
        mentorProfiles
          .flatMap((p) => p.positions ?? [])
          .filter((s): s is string => typeof s === "string" && s.length > 0)
      )
    ).sort();
    const orgHasAthleticData = sportOptions.length > 0 || positionOptions.length > 0;
    const { data: mentorAlumniRaw } =
      mentorUserIds.length > 0
        ? await supabase
            .from("alumni")
            .select(
              "user_id, photo_url, industry, graduation_year, current_company, current_city"
            )
            .eq("organization_id", orgId)
            .is("deleted_at", null)
            .in("user_id", mentorUserIds)
        : { data: [] as AlumniDirectoryRow[] };

    const alumniMap = new Map(
      ((mentorAlumniRaw ?? []) as AlumniDirectoryRow[]).map((alumni) => [alumni.user_id, alumni])
    );
    const mentorsForDirectory = mentorProfiles.map((profile) => {
      const alumni = alumniMap.get(profile.user_id);
      return {
        id: profile.id,
        user_id: profile.user_id,
        name: profile.users?.name || "Unknown",
        email: profile.users?.email || null,
        photo_url: alumni?.photo_url || null,
        industry: alumni?.industry || null,
        graduation_year: alumni?.graduation_year || null,
        current_company: alumni?.current_company || null,
        current_city: alumni?.current_city || null,
        expertise_areas: profile.expertise_areas || null,
        topics: profile.topics ?? null,
        sports: profile.sports ?? null,
        positions: profile.positions ?? null,
        bio: profile.bio || null,
        contact_email: profile.contact_email || null,
        contact_linkedin: profile.contact_linkedin || null,
        contact_phone: profile.contact_phone || null,
        accepting_new: profile.accepting_new ?? true,
        current_mentee_count: profile.current_mentee_count ?? 0,
        max_mentees: profile.max_mentees ?? 3,
        meeting_preferences: profile.meeting_preferences ?? null,
        years_of_experience: profile.years_of_experience ?? null,
      };
    });
    const industries = Array.from(
      new Set(
        mentorsForDirectory
          .map((mentor) => mentor.industry)
          .filter((industry): industry is string => industry !== null)
      )
    ).sort();
    const years = Array.from(
      new Set(
        mentorsForDirectory
          .map((mentor) => mentor.graduation_year)
          .filter((year): year is number => year !== null)
      )
    ).sort((a, b) => b - a);

    tabContent = (
      <MentorDirectory
        mentors={mentorsForDirectory}
        industries={industries}
        years={years}
        sportOptions={sportOptions}
        positionOptions={positionOptions}
        orgHasAthleticData={orgHasAthleticData}
        pendingRequestMentorIds={pendingRequestMentorIds}
        orgId={orgId}
        orgSlug={orgSlug}
        currentUserId={currentUserId}
        canRequestIntro={canRequestIntro}
        isAdmin={isAdmin}
      />
    );
  }

  if (activeTab === "proposals" && showProposalsTab) {
    const proposalUserIds = new Set<string>();
    filteredProposals.forEach((proposal) => {
      proposalUserIds.add(proposal.mentor_user_id);
      proposalUserIds.add(proposal.mentee_user_id);
    });

    const { data: usersRaw } =
      proposalUserIds.size > 0
        ? await supabase
            .from("user_organization_roles")
            .select("user_id, users(name,email)")
            .eq("organization_id", orgId)
            .in("user_id", Array.from(proposalUserIds))
        : { data: [] as UserRow[] };

    const userMap: Record<string, string> = Object.fromEntries(
      ((usersRaw ?? []) as Array<{
        user_id: string;
        users:
          | { name: string | null; email: string | null }
          | Array<{ name: string | null; email: string | null }>
          | null;
      }>).map((row) => {
        const user = Array.isArray(row.users) ? row.users[0] : row.users;
        return [row.user_id, user?.name || user?.email || "Unknown"];
      })
    );
    const proposalRows = filteredProposals.map((proposal) => ({
      id: proposal.id,
      status: proposal.status,
      mentor_user_id: proposal.mentor_user_id,
      mentee_user_id: proposal.mentee_user_id,
      proposed_at: proposal.proposed_at ?? null,
      declined_reason: proposal.declined_reason ?? null,
      match_score: proposal.match_score ?? null,
      match_signals: Array.isArray(proposal.match_signals)
        ? (proposal.match_signals as Array<{
            code: string;
            weight: number;
            value?: string | number;
          }>)
        : [],
    }));

    tabContent = (
      <MentorshipProposalsTab
        orgId={orgId}
        orgSlug={orgSlug}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        proposals={proposalRows}
        userMap={userMap}
        adminPendingCount={adminPendingCount}
      />
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title={pageLabel} />

      <Suspense fallback={<MentorshipPageSkeleton />}>
        <MentorshipTabShell
          activeTab={activeTab}
          orgSlug={orgSlug}
          content={tabContent}
          showProposalsTab={showProposalsTab}
          proposalCount={proposalCount}
        />
      </Suspense>
    </div>
  );
}
