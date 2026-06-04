import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { resolveEnrichedProfiles } from "@/lib/profile/enriched-fields";

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

  // Resolve each mentor's career signals from the row that backs their own
  // profile (members → alumni → parents), keyed by their own user_id, so a
  // stray/colliding alumni row can never inject another person's data into the
  // matcher. See resolveEnrichedProfiles for the single-row selection rule.
  const enrichedByUser = await resolveEnrichedProfiles(supabase, orgId, mentorUserIds);

  return mentorProfiles.map((p) => {
    const enriched = enrichedByUser.get(p.user_id as string);
    return {
      userId: p.user_id as string,
      orgId,
      topics: (p.topics as string[] | null) ?? [],
      expertiseAreas: (p.expertise_areas as string[] | null) ?? [],
      nativeSports: (p.sports as string[] | null) ?? [],
      nativePositions: (p.positions as string[] | null) ?? [],
      nativeIndustries: (p.industries as string[] | null) ?? [],
      nativeRoleFamilies: (p.role_families as string[] | null) ?? [],
      industry: enriched?.industry ?? null,
      jobTitle: enriched?.job_title ?? null,
      positionTitle: enriched?.position_title ?? null,
      currentCompany: enriched?.current_company ?? null,
      currentCity: enriched?.current_city ?? null,
      graduationYear: enriched?.graduation_year ?? null,
      workHistory: asJsonArray<import("@/lib/mentorship/matching-signals").EnrichedWorkEntry>(
        enriched?.work_history
      ),
      educationHistory: asJsonArray<
        import("@/lib/mentorship/matching-signals").EnrichedEducationEntry
      >(enriched?.education_history),
      skills: asStringArray(enriched?.skills),
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

  // Native preferences come from `mentee_preferences`. The mentee's own profile
  // facts (city/company/grad year + work/education history) are resolved from
  // the row that backs their profile (members → alumni → parents) via the shared
  // resolver, so a colliding alumni row can never leak another person's facts.
  const [prefsRes, enrichedByUser] = await Promise.all([
    sb
      .from("mentee_preferences")
      .select(
        "goals, preferred_topics, preferred_industries, preferred_role_families, preferred_sports, preferred_positions, required_attributes, nice_to_have_attributes, time_availability, communication_prefs, geographic_pref, derived_signals"
      )
      .eq("organization_id", orgId)
      .eq("user_id", menteeUserId)
      .maybeSingle(),
    resolveEnrichedProfiles(supabase, orgId, [menteeUserId]),
  ]);

  const prefs = (prefsRes.data as Record<string, unknown> | null) ?? null;
  const enriched = enrichedByUser.get(menteeUserId) ?? null;

  return menteeRowToInput(orgId, menteeUserId, prefs, enriched);
}

type EnrichedFields = ReturnType<
  Awaited<ReturnType<typeof resolveEnrichedProfiles>>["get"]
>;

/**
 * Map a `mentee_preferences` row + resolved enrichment into a `MenteeInput`.
 * Shared by the single-user and bulk loaders so the field mapping (including
 * the derived-signal union) lives in exactly one place.
 */
function menteeRowToInput(
  orgId: string,
  userId: string,
  prefs: Record<string, unknown> | null,
  enriched: EnrichedFields | null
): import("@/lib/mentorship/matching-signals").MenteeInput {
  type WorkEntry = import("@/lib/mentorship/matching-signals").EnrichedWorkEntry;
  type EduEntry = import("@/lib/mentorship/matching-signals").EnrichedEducationEntry;

  // Persisted derived signals (deterministic + LLM backfill) enrich the
  // structured arrays so the ranker fires for data-thin mentees with no
  // per-request LLM call. Union, never override.
  const derived = (prefs?.derived_signals as Record<string, unknown> | null) ?? null;
  const derivedIndustries = asStringArray(derived?.industries);
  const derivedRoleFamilies = asStringArray(derived?.roleFamilies);
  const derivedTopics = asStringArray(derived?.topics);
  const unionArr = (a: string[], b: string[]): string[] =>
    Array.from(new Set([...a, ...b]));

  return {
    userId,
    orgId,
    goals: typeof prefs?.goals === "string" ? prefs.goals : null,
    focusAreas: unionArr(asStringArray(prefs?.preferred_topics), derivedTopics),
    preferredIndustries: unionArr(
      asStringArray(prefs?.preferred_industries),
      derivedIndustries
    ),
    preferredRoleFamilies: unionArr(
      asStringArray(prefs?.preferred_role_families),
      derivedRoleFamilies
    ),
    preferredSports: asStringArray(prefs?.preferred_sports),
    preferredPositions: asStringArray(prefs?.preferred_positions),
    requiredMentorAttributes: asStringArray(prefs?.required_attributes),
    currentCity: enriched?.current_city ?? null,
    graduationYear: enriched?.graduation_year ?? null,
    currentCompany: enriched?.current_company ?? null,
    workHistory: asJsonArray<WorkEntry>(enriched?.work_history),
    educationHistory: asJsonArray<EduEntry>(enriched?.education_history),
  };
}

/**
 * Bulk-load `MenteeInput`s for every mentee in an org that has opted into
 * matching (`seeking_mentorship = true`). One preferences query + one bulk
 * enrichment resolve — used by the bi-directional "recommend mentees for a
 * mentor" path so it scales to org size without N round-trips.
 */
export async function loadSeekingMenteeInputs(
  supabase: SupabaseClient<Database>,
  orgId: string
): Promise<import("@/lib/mentorship/matching-signals").MenteeInput[]> {
  const sb = supabase as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: boolean) => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
  };

  const { data } = await sb
    .from("mentee_preferences")
    .select(
      "user_id, goals, preferred_topics, preferred_industries, preferred_role_families, preferred_sports, preferred_positions, required_attributes, derived_signals"
    )
    .eq("organization_id", orgId)
    .eq("seeking_mentorship", true);

  const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
  const userIds = rows
    .map((r) => (typeof r.user_id === "string" ? r.user_id : null))
    .filter((v): v is string => !!v);
  if (userIds.length === 0) return [];

  const enrichedByUser = await resolveEnrichedProfiles(supabase, orgId, userIds);

  return rows.map((row) =>
    menteeRowToInput(
      orgId,
      row.user_id as string,
      row,
      enrichedByUser.get(row.user_id as string) ?? null
    )
  );
}
