import { canLogMentorshipActivity } from "@/lib/mentorship/presentation";
import { decryptToken } from "@/lib/crypto/token-encryption";
import { createClient } from "@/lib/supabase/server";
import type { MembershipStatus, Database } from "@/types/database";
import type { MentorshipTab } from "@/lib/mentorship/view-state";

type OrgRole = "admin" | "active_member" | "alumni" | "parent" | string | null;
type MentorshipSupabase = Awaited<ReturnType<typeof createClient>>;

type MentorProfileRow = Database["public"]["Tables"]["mentor_profiles"]["Row"] & {
  users: { id: string; name: string | null; email: string | null } | null;
  topics?: string[] | null;
  accepting_new?: boolean | null;
  current_mentee_count?: number | null;
  max_mentees?: number | null;
  meeting_preferences?: string[] | null;
  years_of_experience?: number | null;
  sports?: string[] | null;
  positions?: string[] | null;
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
type ActivityTask = {
  id: string;
  pair_id: string;
  title: string;
  description?: string | null;
  status: "todo" | "in_progress" | "done";
  due_date?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};
type ActivityMeeting = {
  id: string;
  pair_id: string;
  organization_id: string;
  title: string;
  scheduled_at: string;
  scheduled_end_at: string;
  duration_minutes: number;
  platform: string;
  meeting_link: string | null;
  calendar_event_id: string | null;
  calendar_sync_status: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
type ActivityLog = {
  id: string;
  pair_id: string;
  entry_date: string;
  notes: string | null;
  progress_metric: number | null;
  created_by: string;
};

const PROPOSAL_STATUSES = new Set(["proposed", "declined", "expired"]);

export type MentorshipTabData =
  | {
      tab: "activity";
      contextStrip: {
        role: string;
        orgId: string;
        orgSlug: string;
        myMentorName: string | null;
        myLastLogDate: string | null;
      };
      showMenteePreferencesCard: boolean;
      showMentorProfileCard: boolean;
      activity: {
        initialTasks: ActivityTask[];
        initialUpcoming: ActivityMeeting[];
        initialPast: ActivityMeeting[];
        initialLogs: ActivityLog[];
        pairs: Array<{
          id: string;
          mentorUserId: string;
          menteeUserId?: string;
          mentorName: string;
          menteeName: string;
        }>;
        initialPairId: string;
        isAdmin: boolean;
        canLogActivity: boolean;
        orgId: string;
        orgSlug: string;
        currentUserId: string;
        orgTimezone: string;
        userMap: Record<string, string>;
      };
    }
  | {
      tab: "directory";
      directory: {
        mentors: Array<{
          id: string;
          user_id: string;
          name: string;
          email: string | null;
          photo_url: string | null;
          industry: string | null;
          graduation_year: number | null;
          current_company: string | null;
          current_city: string | null;
          expertise_areas: string[] | null;
          topics: string[] | null;
          sports: string[] | null;
          positions: string[] | null;
          bio: string | null;
          contact_email: string | null;
          contact_linkedin: string | null;
          contact_phone: string | null;
          accepting_new: boolean;
          current_mentee_count: number;
          max_mentees: number;
          meeting_preferences: string[] | null;
          years_of_experience: number | null;
        }>;
        industries: string[];
        years: number[];
        sportOptions: string[];
        positionOptions: string[];
        orgHasAthleticData: boolean;
        pendingRequestMentorIds: string[];
        orgId: string;
        orgSlug: string;
        currentUserId: string;
        canRequestIntro: boolean;
        isAdmin: boolean;
      };
    }
  | {
      tab: "proposals";
      proposals: {
        orgId: string;
        orgSlug: string;
        currentUserId: string;
        isAdmin: boolean;
        proposals: Array<{
          id: string;
          status: string;
          mentor_user_id: string;
          mentee_user_id: string;
          proposed_at: string | null;
          declined_reason: string | null;
          match_score: number | null;
          match_signals: Array<{
            code: string;
            weight: number;
            value?: string | number;
          }>;
        }>;
        userMap: Record<string, string>;
        adminPendingCount: number;
      };
    }
  | {
      tab: "matches";
      matches: {
        organizationId: string;
        organizationSlug: string;
        userId: string;
        hasIntakeSubmission: boolean;
      };
    };

export interface LoadedMentorshipTabView {
  activeTab: MentorshipTab;
  showProposalsTab: boolean;
  showMatchesTab: boolean;
  proposalCount: number;
  adminPendingCount: number;
  data: MentorshipTabData;
}

interface LoadMentorshipTabViewParams {
  supabase: MentorshipSupabase;
  orgId: string;
  orgSlug: string;
  role: OrgRole;
  status: MembershipStatus | null;
  currentUserId: string;
  requestedTab: MentorshipTab;
  pairIdParam: string | null;
  orgTimezone: string;
}

export async function loadMentorshipTabView({
  supabase,
  orgId,
  orgSlug,
  role,
  status,
  currentUserId,
  requestedTab,
  pairIdParam,
  orgTimezone,
}: LoadMentorshipTabViewParams): Promise<LoadedMentorshipTabView> {
  const db = supabase;
  const isAdmin = role === "admin";
  const isMentee = role === "active_member";
  const canRequestIntro = isMentee && currentUserId.length > 0;
  const canLogActivity = canLogMentorshipActivity({ role, status });

  const { data: pairsRaw } = await db
    .from("mentorship_pairs")
    .select("*")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const pairs = (pairsRaw ?? []) as MentorshipPairRow[];
  const workingPairs = pairs.filter((pair) => !PROPOSAL_STATUSES.has(pair.status));
  const proposalPairs = pairs.filter((pair) => PROPOSAL_STATUSES.has(pair.status));

  const filteredPairs = isAdmin
    ? workingPairs
    : workingPairs.filter((pair) =>
        role === "active_member"
          ? pair.mentee_user_id === currentUserId
          : pair.mentor_user_id === currentUserId
      );

  const personalProposals = proposalPairs.filter(
    (pair) => pair.mentor_user_id === currentUserId || pair.mentee_user_id === currentUserId
  );
  const filteredProposals = isAdmin ? proposalPairs : personalProposals;
  const proposalCount = personalProposals.length;
  const adminPendingCount = proposalPairs.filter((pair) => pair.status === "proposed").length;
  const showProposalsTab = proposalCount > 0 || isAdmin;
  const showMatchesTab = isMentee;
  const activeTab: MentorshipTab =
    requestedTab === "proposals" && !showProposalsTab
      ? "activity"
      : requestedTab === "matches" && !showMatchesTab
        ? "activity"
        : requestedTab;

  const visiblePairIds = filteredPairs.map((pair) => pair.id);
  const initialPairId =
    pairIdParam && visiblePairIds.includes(pairIdParam)
      ? pairIdParam
      : visiblePairIds[0] ?? null;

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
        ? db
            .from("user_organization_roles")
            .select("user_id, users(name,email)")
            .eq("organization_id", orgId)
            .in("user_id", Array.from(pairUserIds))
        : Promise.resolve({ data: [] as UserRow[] }),
      visiblePairIds.length > 0
        ? db
            .from("mentorship_logs")
            .select("*")
            .eq("organization_id", orgId)
            .is("deleted_at", null)
            .in("pair_id", visiblePairIds)
            .order("entry_date", { ascending: false })
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as MentorshipLogRow[] }),
      visiblePairIds.length > 0
        ? db
            .from("mentorship_tasks")
            .select("*")
            .eq("organization_id", orgId)
            .is("deleted_at", null)
            .in("pair_id", visiblePairIds)
            .order("due_date", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as MentorshipTaskRow[] }),
      visiblePairIds.length > 0
        ? db
            .from("mentorship_meetings")
            .select("*")
            .eq("organization_id", orgId)
            .is("deleted_at", null)
            .in("pair_id", visiblePairIds)
            .order("scheduled_at", { ascending: true })
        : Promise.resolve({ data: [] as MentorshipMeetingRow[] }),
    ]);
    const logs = (logsRaw ?? []) as MentorshipLogRow[];
    const tasks = (tasksRaw ?? []) as MentorshipTaskRow[];
    const meetings = (meetingsRaw ?? []) as MentorshipMeetingRow[];

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
    const logsForClient: ActivityLog[] = logs.map((log: MentorshipLogRow) => ({
      id: log.id,
      pair_id: log.pair_id,
      entry_date: log.entry_date,
      notes: log.notes,
      progress_metric: log.progress_metric,
      created_by: log.created_by,
    }));
    const tasksForClient: ActivityTask[] = tasks.map((task: MentorshipTaskRow) => ({
      id: task.id,
      pair_id: task.pair_id,
      title: task.title,
      description: task.description,
      status: task.status as ActivityTask["status"],
      due_date: task.due_date,
      created_by: task.created_by,
      created_at: task.created_at,
      updated_at: task.updated_at,
    }));
    const pairsForTabs = filteredPairs.map((pair) => ({
      id: pair.id,
      mentorUserId: pair.mentor_user_id,
      menteeUserId: pair.mentee_user_id,
      mentorName:
        usersForClient.find((user) => user.id === pair.mentor_user_id)?.name ?? "Unknown",
      menteeName:
        usersForClient.find((user) => user.id === pair.mentee_user_id)?.name ?? "Unknown",
    }));
    const myPair = isMentee
      ? filteredPairs.find((pair) => pair.mentee_user_id === currentUserId) ?? null
      : null;
    const myMentorName = myPair
      ? usersForClient.find((user) => user.id === myPair.mentor_user_id)?.name ?? null
      : null;
    const myLastLogDate = myPair
      ? logsForClient.find((log) => log.pair_id === myPair.id)?.entry_date ?? null
      : null;

    const decryptedMeetings: ActivityMeeting[] = meetings
      .filter(
        (meeting: MentorshipMeetingRow) =>
          typeof meeting.scheduled_at === "string" &&
          typeof meeting.scheduled_end_at === "string"
      )
      .map((meeting: MentorshipMeetingRow) => ({
        id: meeting.id,
        pair_id: meeting.pair_id,
        organization_id: meeting.organization_id,
        title: meeting.title,
        scheduled_at: meeting.scheduled_at as string,
        scheduled_end_at: meeting.scheduled_end_at as string,
        duration_minutes: meeting.duration_minutes,
        platform: meeting.platform,
        meeting_link: decryptMeetingLink(meeting.meeting_link),
        calendar_event_id: meeting.calendar_event_id,
        calendar_sync_status: meeting.calendar_sync_status,
        created_by: meeting.created_by,
        created_at: meeting.created_at,
        updated_at: meeting.updated_at,
        deleted_at: meeting.deleted_at,
      }));
    const now = new Date();
    const upcomingMeetings = decryptedMeetings.filter(
      (meeting: ActivityMeeting) => new Date(meeting.scheduled_end_at) > now && !meeting.deleted_at
    );
    const pastMeetings = decryptedMeetings.filter(
      (meeting: ActivityMeeting) => new Date(meeting.scheduled_end_at) <= now && !meeting.deleted_at
    );

    return {
      activeTab,
      showProposalsTab,
      showMatchesTab,
      proposalCount,
      adminPendingCount,
      data: {
        tab: "activity",
        contextStrip: {
          role: role ?? "",
          orgId,
          orgSlug,
          myMentorName,
          myLastLogDate,
        },
        showMenteePreferencesCard: isMentee,
        showMentorProfileCard: role === "alumni" || role === "admin",
        activity: {
          initialTasks: tasksForClient,
          initialUpcoming: upcomingMeetings,
          initialPast: pastMeetings,
          initialLogs: logsForClient,
          pairs: pairsForTabs,
          initialPairId: initialPairId ?? "",
          isAdmin,
          canLogActivity,
          orgId,
          orgSlug,
          currentUserId,
          orgTimezone,
          userMap,
        },
      },
    };
  }

  if (activeTab === "directory") {
    const [{ data: mentorProfilesRaw }, { data: pendingPairsRaw }] = await Promise.all([
      db.from("mentor_profiles")
        .select("*, users!mentor_profiles_user_id_fkey(id, name, email)")
        .eq("organization_id", orgId)
        .eq("is_active", true),
      canRequestIntro
        ? db
            .from("mentorship_pairs")
            .select("mentor_user_id")
            .eq("organization_id", orgId)
            .eq("mentee_user_id", currentUserId)
            .in("status", ["proposed", "accepted", "active", "paused"])
            .is("deleted_at", null)
        : Promise.resolve({ data: [] as Array<{ mentor_user_id: string }> }),
    ]);

    const mentorProfiles = (mentorProfilesRaw ?? []) as MentorProfileRow[];
    const mentorUserIds = mentorProfiles.map((profile) => profile.user_id);
    const pendingRequestMentorIds = (
      (pendingPairsRaw ?? []) as Array<{ mentor_user_id: string }>
    ).map((row) => row.mentor_user_id);
    const sportOptions = Array.from(
      new Set(
        mentorProfiles
          .flatMap((profile) => profile.sports ?? [])
          .filter((sport): sport is string => typeof sport === "string" && sport.length > 0)
      )
    ).sort();
    const positionOptions = Array.from(
      new Set(
        mentorProfiles
          .flatMap((profile) => profile.positions ?? [])
          .filter(
            (position): position is string =>
              typeof position === "string" && position.length > 0
          )
      )
    ).sort();
    const orgHasAthleticData = sportOptions.length > 0 || positionOptions.length > 0;

    const { data: mentorAlumniRaw } =
      mentorUserIds.length > 0
        ? await db
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
        name: profile.users?.name ?? "Unknown",
        email: profile.users?.email ?? null,
        photo_url: alumni?.photo_url ?? null,
        industry: alumni?.industry ?? null,
        graduation_year: alumni?.graduation_year ?? null,
        current_company: alumni?.current_company ?? null,
        current_city: alumni?.current_city ?? null,
        expertise_areas: profile.expertise_areas ?? null,
        topics: profile.topics ?? null,
        sports: profile.sports ?? null,
        positions: profile.positions ?? null,
        bio: profile.bio ?? null,
        contact_email: profile.contact_email ?? null,
        contact_linkedin: profile.contact_linkedin ?? null,
        contact_phone: profile.contact_phone ?? null,
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

    return {
      activeTab,
      showProposalsTab,
      showMatchesTab,
      proposalCount,
      adminPendingCount,
      data: {
        tab: "directory",
        directory: {
          mentors: mentorsForDirectory,
          industries,
          years,
          sportOptions,
          positionOptions,
          orgHasAthleticData,
          pendingRequestMentorIds,
          orgId,
          orgSlug,
          currentUserId,
          canRequestIntro,
          isAdmin,
        },
      },
    };
  }

  if (activeTab === "proposals" && showProposalsTab) {
    const proposalUserIds = new Set<string>();
    filteredProposals.forEach((proposal) => {
      proposalUserIds.add(proposal.mentor_user_id);
      proposalUserIds.add(proposal.mentee_user_id);
    });

    const { data: usersRaw } =
      proposalUserIds.size > 0
        ? await db
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

    return {
      activeTab,
      showProposalsTab,
      showMatchesTab,
      proposalCount,
      adminPendingCount,
      data: {
        tab: "proposals",
        proposals: {
          orgId,
          orgSlug,
          currentUserId,
          isAdmin,
          proposals: proposalRows,
          userMap,
          adminPendingCount,
        },
      },
    };
  }

  const { data: intakeCheck } = await db
    .from("mentee_latest_intake")
    .select("id")
    .eq("user_id", currentUserId)
    .eq("organization_id", orgId)
    .maybeSingle();

  return {
    activeTab: showMatchesTab ? "matches" : "activity",
    showProposalsTab,
    showMatchesTab,
    proposalCount,
    adminPendingCount,
    data: {
      tab: "matches",
      matches: {
        organizationId: orgId,
        organizationSlug: orgSlug,
        userId: currentUserId,
        hasIntakeSubmission: Boolean(intakeCheck?.id),
      },
    },
  };
}

function decryptMeetingLink(raw: string | null): string | null {
  if (!raw) return null;
  const decryptionKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!decryptionKey) return null;
  try {
    return decryptToken(raw, decryptionKey);
  } catch {
    return null;
  }
}
