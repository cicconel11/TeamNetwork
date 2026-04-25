import { NextResponse } from "next/server";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  rankMentorsForMentee,
  type MentorInput,
} from "@/lib/mentorship/matching";
import { sendNotificationBlast } from "@/lib/notifications";
import { proposalReceivedTemplate } from "@/lib/notifications/templates/mentorship/proposal_received";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

type PairRow = {
  id: string;
  status: string;
  mentor_user_id: string;
  mentee_user_id: string;
  proposed_at: string | null;
  match_score: number | null;
  match_signals: unknown;
  [k: string]: unknown;
};

type MentorProfileRow = {
  user_id: string;
  topics: string[] | null;
  expertise_areas: string[] | null;
  sports: string[] | null;
  positions: string[] | null;
  industries: string[] | null;
  role_families: string[] | null;
  bio: string | null;
  max_mentees: number | null;
  current_mentee_count: number | null;
  accepting_new: boolean | null;
};

type MenteePreferencesRow = {
  user_id: string;
  goals: string | null;
  seeking_mentorship?: boolean | null;
  preferred_topics: string[] | null;
  preferred_industries: string[] | null;
  preferred_role_families: string[] | null;
  preferred_sports: string[] | null;
  preferred_positions: string[] | null;
  required_attributes: string[] | null;
  nice_to_have_attributes: string[] | null;
  time_availability: string | null;
  communication_prefs: string[] | null;
  geographic_pref: string | null;
};

type UserRow = { id: string; name: string | null; email: string | null };
type OrgMemberRow = { user_id: string; role: string; status: string };
type AlumniRow = {
  user_id: string;
  industry: string | null;
  job_title: string | null;
  position_title: string | null;
  current_company: string | null;
  current_city: string | null;
  graduation_year: number | null;
};

export async function GET(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  if (!baseSchemas.uuid.safeParse(organizationId).success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const { supabase, user } = await createAuthenticatedApiClient(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const { data: role } = await service
    .from("user_organization_roles")
    .select("role,status")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (role?.role !== "admin" || role?.status !== "active") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const sort = url.searchParams.get("sort") ?? "score";

  const { data: pairsRaw, error } = await service
    .from("mentorship_pairs")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("status", "proposed")
    .is("deleted_at", null);

  if (error) {
    console.error("[mentorship admin queue] fetch failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (pairsRaw ?? []) as unknown as PairRow[];
  const userIds = Array.from(
    new Set(rows.flatMap((p) => [p.mentor_user_id, p.mentee_user_id]))
  );

  const svc = service as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        in?: (col: string, vals: string[]) => Promise<{ data: unknown[] | null }>;
        eq: (col: string, val: string) => {
          in: (col: string, vals: string[]) => Promise<{ data: unknown[] | null }>;
        };
      };
    };
  };

  const [{ data: users }, { data: prefsRowsRaw }, { data: mentorProfilesRaw }] = await Promise.all([
    userIds.length > 0
      ? (service.from("users").select("id,name,email").in("id", userIds) as unknown as Promise<{ data: UserRow[] | null }>)
      : Promise.resolve({ data: [] as UserRow[] }),
    userIds.length > 0
      ? svc
          .from("mentee_preferences")
          .select(
            "user_id, goals, preferred_topics, preferred_industries, preferred_role_families, preferred_sports, preferred_positions, required_attributes, nice_to_have_attributes, time_availability, communication_prefs, geographic_pref"
          )
          .eq("organization_id", organizationId)
          .in("user_id", userIds)
      : Promise.resolve({ data: [] as unknown[] }),
    userIds.length > 0
      ? svc
          .from("mentor_profiles")
          .select(
            "user_id, topics, expertise_areas, sports, positions, industries, role_families, bio, max_mentees, current_mentee_count, accepting_new"
          )
          .eq("organization_id", organizationId)
          .in("user_id", userIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const prefsRows = (prefsRowsRaw ?? []) as MenteePreferencesRow[];
  const mentorProfiles = (mentorProfilesRaw ?? []) as MentorProfileRow[];

  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  const prefsByUser = new Map(prefsRows.map((r) => [r.user_id, r]));
  const mentorByUser = new Map(mentorProfiles.map((p) => [p.user_id, p]));

  const enriched = rows.map((p) => ({
    ...p,
    mentor: mentorByUser.get(p.mentor_user_id) ?? null,
    mentor_user: userById.get(p.mentor_user_id) ?? null,
    mentee_user: userById.get(p.mentee_user_id) ?? null,
    mentee_preferences: prefsByUser.get(p.mentee_user_id) ?? null,
  }));

  enriched.sort((a, b) => {
    if (sort === "proposed_at") {
      return (b.proposed_at ?? "").localeCompare(a.proposed_at ?? "");
    }
    if (sort === "mentee_name") {
      return (a.mentee_user?.name ?? "").localeCompare(b.mentee_user?.name ?? "");
    }
    return Number(b.match_score ?? 0) - Number(a.match_score ?? 0);
  });

  return NextResponse.json({ queue: enriched });
}

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  if (!baseSchemas.uuid.safeParse(organizationId).success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const { supabase, user } = await createAuthenticatedApiClient(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = checkRateLimit(req, {
    userId: user.id,
    orgId: organizationId,
    feature: "mentorship run_round",
    limitPerUser: 6,
    windowMs: 60 * 60 * 1000,
  });
  if (!rl.ok) return buildRateLimitResponse(rl);

  const service = createServiceClient();
  const { data: role } = await service
    .from("user_organization_roles")
    .select("role,status")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (role?.role !== "admin" || role?.status !== "active") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const svc = service as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string | boolean) => {
          eq: (
            col: string,
            val: string | boolean
          ) => Promise<{ data: unknown[] | null; error?: { message: string } | null }>;
          in: (
            col: string,
            vals: string[]
          ) => Promise<{ data: unknown[] | null; error?: { message: string } | null }>;
          maybeSingle: () => Promise<{
            data: Record<string, unknown> | null;
            error?: { message: string } | null;
          }>;
        };
      };
      insert: (values: unknown) => {
        select: (cols: string) => {
          maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { code?: string; message: string } | null }>;
        };
      };
    };
    rpc: (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
  };

  const [
    { data: orgMembersRaw },
    { data: mentorProfilesRaw },
    { data: existingPairsRaw },
    { data: orgRowRaw },
  ] = await Promise.all([
    service
      .from("user_organization_roles")
      .select("user_id,role,status")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .eq("role", "active_member"),
    svc
      .from("mentor_profiles")
      .select(
        "user_id, topics, expertise_areas, sports, positions, industries, role_families, max_mentees, current_mentee_count, accepting_new, is_active"
      )
      .eq("organization_id", organizationId)
      .eq("is_active", true),
    service
      .from("mentorship_pairs")
      .select("mentor_user_id, mentee_user_id, status")
      .eq("organization_id", organizationId)
      .in("status", ["proposed", "accepted", "active", "paused"])
      .is("deleted_at", null),
    svc
      .from("organizations")
      .select("slug,settings")
      .eq("id", organizationId)
      .maybeSingle(),
  ]);

  const orgMembers = (orgMembersRaw ?? []) as OrgMemberRow[];
  const mentorProfiles = (mentorProfilesRaw ?? []) as Array<{
    user_id: string;
    topics: string[] | null;
    expertise_areas: string[] | null;
    sports: string[] | null;
    positions: string[] | null;
    industries: string[] | null;
    role_families: string[] | null;
    max_mentees: number | null;
    current_mentee_count: number | null;
    accepting_new: boolean | null;
    is_active: boolean;
  }>;
  const existingPairs = (existingPairsRaw ?? []) as Array<{
    mentor_user_id: string;
    mentee_user_id: string;
    status: string;
  }>;
  const orgRow = orgRowRaw as { slug?: string; settings?: unknown } | null;

  const candidateMenteeIds = orgMembers
    .map((row) => row.user_id)
    .filter((userId) => !existingPairs.some((pair) => pair.mentee_user_id === userId));

  if (candidateMenteeIds.length === 0 || mentorProfiles.length === 0) {
    return NextResponse.json({
      created: 0,
      skipped_existing: orgMembers.length - candidateMenteeIds.length,
      skipped_no_match: 0,
      notifications_sent: 0,
    });
  }

  const mentorUserIds = mentorProfiles.map((profile) => profile.user_id);
  const peopleUserIds = Array.from(new Set([...candidateMenteeIds, ...mentorUserIds]));

  const [{ data: alumniRowsRaw }, { data: usersRaw }, { data: prefsRowsRaw }] = await Promise.all([
    peopleUserIds.length > 0
      ? service
          .from("alumni")
          .select("user_id, industry, job_title, position_title, current_company, current_city, graduation_year")
          .eq("organization_id", organizationId)
          .in("user_id", peopleUserIds)
      : Promise.resolve({ data: [] as AlumniRow[] }),
    peopleUserIds.length > 0
      ? service
          .from("users")
          .select("id,name,email")
          .in("id", peopleUserIds)
      : Promise.resolve({ data: [] as UserRow[] }),
    candidateMenteeIds.length > 0
      ? svc
          .from("mentee_preferences")
          .select(
            "user_id, seeking_mentorship, preferred_topics, preferred_industries, preferred_role_families, preferred_sports, preferred_positions, required_attributes"
          )
          .eq("organization_id", organizationId)
          .in("user_id", candidateMenteeIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const alumniRows = (alumniRowsRaw ?? []) as AlumniRow[];
  const users = (usersRaw ?? []) as UserRow[];
  const prefsRows = (prefsRowsRaw ?? []) as MenteePreferencesRow[];

  const alumniByUser = new Map(alumniRows.map((row) => [row.user_id, row]));
  const userById = new Map(users.map((row) => [row.id, row]));
  const prefsByUser = new Map(prefsRows.map((row) => [row.user_id, row]));

  const mentorInputs: MentorInput[] = mentorProfiles.map((profile) => {
    const alumni = alumniByUser.get(profile.user_id);
    return {
      userId: profile.user_id,
      orgId: organizationId,
      topics: profile.topics ?? [],
      expertiseAreas: profile.expertise_areas ?? [],
      nativeSports: profile.sports ?? [],
      nativePositions: profile.positions ?? [],
      nativeIndustries: profile.industries ?? [],
      nativeRoleFamilies: profile.role_families ?? [],
      industry: alumni?.industry ?? null,
      jobTitle: alumni?.job_title ?? null,
      positionTitle: alumni?.position_title ?? null,
      currentCompany: alumni?.current_company ?? null,
      currentCity: alumni?.current_city ?? null,
      graduationYear: alumni?.graduation_year ?? null,
      maxMentees: profile.max_mentees ?? 3,
      currentMenteeCount: profile.current_mentee_count ?? 0,
      acceptingNew: profile.accepting_new ?? true,
      isActive: profile.is_active,
    };
  });

  let created = 0;
  let skippedNoMatch = 0;
  let skippedExisting = orgMembers.length - candidateMenteeIds.length;
  let notificationsSent = 0;

  const stringArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];

  for (const menteeUserId of candidateMenteeIds) {
    const prefs = prefsByUser.get(menteeUserId) ?? null;
    if (!prefs?.seeking_mentorship) {
      skippedNoMatch += 1;
      continue;
    }
    const alumni = alumniByUser.get(menteeUserId) ?? null;
    const preferredPositions = (() => {
      const explicit = stringArr(prefs?.preferred_positions);
      if (explicit.length > 0) return explicit;
      return alumni?.position_title ? [alumni.position_title] : [];
    })();
    const matches = rankMentorsForMentee(
      {
        userId: menteeUserId,
        orgId: organizationId,
        focusAreas: stringArr(prefs?.preferred_topics),
        preferredIndustries: stringArr(prefs?.preferred_industries),
        preferredRoleFamilies: stringArr(prefs?.preferred_role_families),
        preferredSports: stringArr(prefs?.preferred_sports),
        preferredPositions,
        requiredMentorAttributes: stringArr(prefs?.required_attributes),
        currentCity: alumni?.current_city ?? null,
        graduationYear: alumni?.graduation_year ?? null,
        currentCompany: alumni?.current_company ?? null,
      },
      mentorInputs,
      { orgSettings: orgRow?.settings ?? null }
    );

    const topMatch = matches[0] ?? null;
    if (!topMatch) {
      skippedNoMatch += 1;
      continue;
    }

    const { data: rpcData, error: rpcError } = await svc.rpc("admin_propose_pair", {
      p_organization_id: organizationId,
      p_mentor_user_id: topMatch.mentorUserId,
      p_mentee_user_id: menteeUserId,
      p_match_score: topMatch.score,
      p_match_signals: topMatch.signals,
      p_actor_user_id: user.id,
    });

    if (rpcError) {
      if (rpcError.code === "23505") {
        skippedExisting += 1;
        continue;
      }
      console.error("[mentorship admin queue] create proposal failed", rpcError);
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    const rpcRow = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
      | { pair_id?: string; reused?: boolean }
      | null;

    if (!rpcRow?.pair_id) {
      skippedNoMatch += 1;
      continue;
    }

    if (rpcRow.reused) {
      skippedExisting += 1;
      continue;
    }

    const inserted = { id: rpcRow.pair_id };
    created += 1;

    try {
      await (service as unknown as {
        from: (t: string) => { insert: (v: unknown) => Promise<{ error: { message: string } | null }> };
      })
        .from("mentorship_audit_log")
        .insert({
          organization_id: organizationId,
          actor_user_id: user.id,
          kind: "admin_matched",
          pair_id: inserted.id as string,
          metadata: {
            match_score: topMatch.score,
            source: "run_round",
          },
        });
    } catch (auditError) {
      console.error("[mentorship admin queue] audit log failed", auditError);
    }

    try {
      const menteeUser = userById.get(menteeUserId);
      const menteeName = menteeUser?.name?.trim() || menteeUser?.email?.trim() || "A mentee";
      const reviewLink = orgRow?.slug ? `/${orgRow.slug}/mentorship?tab=proposals` : "/mentorship";
      const { title, body } = proposalReceivedTemplate({ menteeName, reviewLink });

      await sendNotificationBlast({
        supabase: service,
        organizationId,
        audience: "both",
        channel: "email",
        title,
        body,
        targetUserIds: [topMatch.mentorUserId],
        category: "mentorship",
      });
      notificationsSent += 1;
    } catch (notifyError) {
      console.error("[mentorship admin queue] notify failed", notifyError);
    }
  }

  return NextResponse.json({
    created,
    skipped_existing: skippedExisting,
    skipped_no_match: skippedNoMatch,
    notifications_sent: notificationsSent,
  });
}
