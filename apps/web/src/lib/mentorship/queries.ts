import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Coerce a jsonb column into a typed array. supabase-js returns jsonb already
 * parsed, but rows can be dirty (null, object, string) — guard defensively so a
 * single bad row never breaks matching.
 */
function asJsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
}

/**
 * Alumni-wins merge: prefer the alumni value, fall back to the members value
 * only when the alumni side is empty. Mirrors the people-graph projection rule
 * where alumni career data is authoritative over members.
 */
function pickEnriched<T>(alumniValue: T[], membersValue: T[]): T[] {
  return alumniValue.length > 0 ? alumniValue : membersValue;
}

export interface PairableOrgMember {
  user_id: string;
  name: string | null;
  email: string | null;
}

interface PairableMembers {
  /** Eligible mentors: alumni + admins. */
  mentors: PairableOrgMember[];
  /** Eligible mentees: active members. */
  mentees: PairableOrgMember[];
}

const MENTOR_ROLES = ["alumni", "admin"] as const;
const MENTEE_ROLES = ["active_member"] as const;

/**
 * Fetch the two role-segmented lists used by the mentorship pair-creation
 * dropdowns.
 *
 * Mentors are alumni + admins (admins act as alumni in this org's data — the
 * existing `mentorship_pairs` table contains admin/admin pairs that the
 * original UI couldn't reproduce). Mentees are active members only.
 *
 * Both queries hit `user_organization_roles` filtered to `status='active'`,
 * so revoked users never appear. A single fetch with an `IN` filter is used
 * and the result is partitioned in memory — one round-trip instead of two.
 */
export async function getPairableOrgMembers(
  supabase: SupabaseClient<Database>,
  orgId: string
): Promise<PairableMembers> {
  const { data, error } = await supabase
    .from("user_organization_roles")
    .select("user_id, role, users(name, email)")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .in("role", [...MENTOR_ROLES, ...MENTEE_ROLES]);

  if (error) {
    throw new Error(`Failed to load pairable org members: ${error.message}`);
  }

  const mentorsById = new Map<string, PairableOrgMember>();
  const menteesById = new Map<string, PairableOrgMember>();

  for (const row of data ?? []) {
    const userInfo = Array.isArray(row.users) ? row.users[0] : row.users;
    const member: PairableOrgMember = {
      user_id: row.user_id,
      name: userInfo?.name ?? null,
      email: userInfo?.email ?? null,
    };
    if ((MENTOR_ROLES as readonly string[]).includes(row.role)) {
      // A user can hold only one row per (user_id, organization_id), but the
      // Map dedupe is defensive in case the schema ever changes.
      if (!mentorsById.has(member.user_id)) {
        mentorsById.set(member.user_id, member);
      }
    }
    if ((MENTEE_ROLES as readonly string[]).includes(row.role)) {
      if (!menteesById.has(member.user_id)) {
        menteesById.set(member.user_id, member);
      }
    }
  }

  return {
    mentors: sortByDisplayLabel(Array.from(mentorsById.values())),
    mentees: sortByDisplayLabel(Array.from(menteesById.values())),
  };
}

export function memberDisplayLabel(member: PairableOrgMember): string {
  return member.name ?? member.email ?? "Member";
}

function sortByDisplayLabel(members: PairableOrgMember[]): PairableOrgMember[] {
  return [...members].sort((a, b) =>
    memberDisplayLabel(a)
      .toLowerCase()
      .localeCompare(memberDisplayLabel(b).toLowerCase())
  );
}

/**
 * Hydrate MentorInput[] for all active mentors in an organization.
 * Joins mentor_profiles with alumni table for career signals.
 *
 * Phase 2 columns are not in generated DB types — explicit type assertions used.
 */
export async function loadMentorInputs(
  supabase: SupabaseClient<Database>,
  orgId: string
): Promise<import("@/lib/mentorship/matching-signals").MentorInput[]> {
  type QueryResult = Promise<{ data: Array<Record<string, unknown>> | null; error: unknown }>;
  type ChainMethods = {
    eq: (c: string, v: string | boolean) => ChainMethods & QueryResult;
    in: (c: string, vals: string[]) => ChainMethods & QueryResult;
  };
  const sb = supabase as unknown as {
    from: (t: string) => {
      select: (cols: string) => ChainMethods & QueryResult;
    };
  };

  const mentorProfilesRes = await sb
    .from("mentor_profiles")
    .select(
      "user_id, topics, expertise_areas, sports, positions, industries, role_families, max_mentees, current_mentee_count, accepting_new, is_active, meeting_preferences, years_of_experience, custom_attributes"
    )
    .eq("organization_id", orgId)
    .eq("is_active", true);

  const mentorProfiles = mentorProfilesRes.data ?? [];
  const mentorUserIds = mentorProfiles.map((p) => p.user_id as string);

  if (mentorUserIds.length === 0) return [];

  const alumniRes = await sb
    .from("alumni")
    .select(
      "user_id, industry, job_title, position_title, current_company, current_city, graduation_year, work_history, education_history, skills"
    )
    .eq("organization_id", orgId)
    .in("user_id", mentorUserIds);

  const alumniByUser = new Map<string, Record<string, unknown>>();
  for (const row of (alumniRes.data ?? []) as Array<{ user_id: string } & Record<string, unknown>>) {
    alumniByUser.set(row.user_id, row);
  }

  return mentorProfiles.map((p) => {
    const alumni = alumniByUser.get(p.user_id as string) ?? {};
    return {
      userId: p.user_id as string,
      orgId,
      topics: (p.topics as string[] | null) ?? [],
      expertiseAreas: (p.expertise_areas as string[] | null) ?? [],
      nativeSports: (p.sports as string[] | null) ?? [],
      nativePositions: (p.positions as string[] | null) ?? [],
      nativeIndustries: (p.industries as string[] | null) ?? [],
      nativeRoleFamilies: (p.role_families as string[] | null) ?? [],
      industry: (alumni.industry as string | null) ?? null,
      jobTitle: (alumni.job_title as string | null) ?? null,
      positionTitle: (alumni.position_title as string | null) ?? null,
      currentCompany: (alumni.current_company as string | null) ?? null,
      currentCity: (alumni.current_city as string | null) ?? null,
      graduationYear: (alumni.graduation_year as number | null) ?? null,
      workHistory: asJsonArray<import("@/lib/mentorship/matching-signals").EnrichedWorkEntry>(
        alumni.work_history
      ),
      educationHistory: asJsonArray<
        import("@/lib/mentorship/matching-signals").EnrichedEducationEntry
      >(alumni.education_history),
      skills: asStringArray(alumni.skills),
      maxMentees: (p.max_mentees as number | null) ?? 3,
      currentMenteeCount: (p.current_mentee_count as number | null) ?? 0,
      acceptingNew: (p.accepting_new as boolean | null) ?? true,
      isActive: true,
      customAttributes: (p.custom_attributes as Record<string, string | string[]> | null) ?? null,
    };
  });
}

/**
 * Load native mentee_preferences row and merge with alumni profile facts
 * (city, company, graduation year).
 *
 * Replaces `loadMenteeIntakeInput` as the canonical path once Phase 1 lands.
 * Returns MenteeInput shape — same contract as existing matcher.
 *
 * Table is column-typed but generated DB types may lag the migration;
 * explicit assertions used for safety.
 */
export async function loadMenteePreferences(
  supabase: SupabaseClient<Database>,
  orgId: string,
  menteeUserId: string
): Promise<import("@/lib/mentorship/matching-signals").MenteeInput> {
  type QueryResult = Promise<{ data: unknown; error: unknown }>;
  type EqChain = {
    eq: (col: string, val: string) => EqChain & QueryResult & {
      maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
    };
    maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  };
  const sb = supabase as unknown as {
    from: (t: string) => {
      select: (cols: string) => EqChain;
    };
  };

  const [prefsRes, alumniRes, memberRes] = await Promise.all([
    sb
      .from("mentee_preferences")
      .select(
        "goals, preferred_topics, preferred_industries, preferred_role_families, preferred_sports, preferred_positions, required_attributes, nice_to_have_attributes, time_availability, communication_prefs, geographic_pref"
      )
      .eq("organization_id", orgId)
      .eq("user_id", menteeUserId)
      .maybeSingle(),
    sb
      .from("alumni")
      .select("current_city, current_company, graduation_year, work_history, education_history")
      .eq("organization_id", orgId)
      .eq("user_id", menteeUserId)
      .maybeSingle(),
    // Mentees are active members — their enriched data lives on `members`.
    sb
      .from("members")
      .select("work_history, education_history")
      .eq("organization_id", orgId)
      .eq("user_id", menteeUserId)
      .maybeSingle(),
  ]);

  const prefs = (prefsRes.data as Record<string, unknown> | null) ?? null;
  const alumni = (alumniRes.data as Record<string, unknown> | null) ?? null;
  const member = (memberRes.data as Record<string, unknown> | null) ?? null;

  type WorkEntry = import("@/lib/mentorship/matching-signals").EnrichedWorkEntry;
  type EduEntry = import("@/lib/mentorship/matching-signals").EnrichedEducationEntry;

  return {
    userId: menteeUserId,
    orgId,
    focusAreas: asStringArray(prefs?.preferred_topics),
    preferredIndustries: asStringArray(prefs?.preferred_industries),
    preferredRoleFamilies: asStringArray(prefs?.preferred_role_families),
    preferredSports: asStringArray(prefs?.preferred_sports),
    preferredPositions: asStringArray(prefs?.preferred_positions),
    requiredMentorAttributes: asStringArray(prefs?.required_attributes),
    currentCity: (alumni?.current_city as string | null) ?? null,
    graduationYear: (alumni?.graduation_year as number | null) ?? null,
    currentCompany: (alumni?.current_company as string | null) ?? null,
    workHistory: pickEnriched(
      asJsonArray<WorkEntry>(alumni?.work_history),
      asJsonArray<WorkEntry>(member?.work_history)
    ),
    educationHistory: pickEnriched(
      asJsonArray<EduEntry>(alumni?.education_history),
      asJsonArray<EduEntry>(member?.education_history)
    ),
  };
}
