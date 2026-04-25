import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { rankMentorsForMentee, type MentorMatch } from "@/lib/mentorship/matching";
import type { MentorInput } from "@/lib/mentorship/matching-signals";
import { loadMentorInputs, loadMenteePreferences } from "@/lib/mentorship/queries";
import { formatMentorshipReasonLabel } from "@/lib/mentorship/presentation";
import type { MentorshipReasonCode } from "@/lib/mentorship/matching-weights";

/* ------------------------------------------------------------------ */
/*  Public types                                                      */
/* ------------------------------------------------------------------ */

export type SuggestMentorsState =
  | "resolved"
  | "ambiguous"
  | "not_found"
  | "no_suggestions"
  | "unauthorized";

export interface DisplayReadyMentorPerson {
  user_id: string;
  name: string;
  subtitle: string | null;
}

export interface DisplayReadyMentorReason {
  code: MentorshipReasonCode;
  label: string;
  weight: number;
  value?: string | number;
}

export interface DisplayReadyMentorSuggestion {
  mentor: DisplayReadyMentorPerson;
  score: number;
  reasons: DisplayReadyMentorReason[];
}

export interface SuggestMentorsResult {
  state: SuggestMentorsState;
  mentee: DisplayReadyMentorPerson | null;
  suggestions: DisplayReadyMentorSuggestion[];
  disambiguation_options?: DisplayReadyMentorPerson[];
}

/* ------------------------------------------------------------------ */
/*  Options                                                           */
/* ------------------------------------------------------------------ */

export interface SuggestMentorsOptions {
  menteeUserId?: string;
  menteeQuery?: string;
  focusAreas?: string[];
  limit?: number;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                  */
/* ------------------------------------------------------------------ */

interface UserDisplayRow {
  id?: string;
  user_id?: string;
  name: string | null;
  email: string | null;
}

async function loadUserDisplayMap(
  supabase: SupabaseClient<Database>,
  userIds: string[]
): Promise<Map<string, { name: string | null; email: string | null }>> {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("users")
    .select("id, name, email")
    .in("id", uniqueIds);

  if (error) {
    return new Map();
  }

  const byId = new Map<string, { name: string | null; email: string | null }>();
  for (const row of data ?? []) {
    const user = row as UserDisplayRow;
    const id = user.id ?? user.user_id;
    if (!id) continue;
    byId.set(id, {
      name: user.name ?? null,
      email: user.email ?? null,
    });
  }

  return byId;
}

async function resolveMentee(
  supabase: SupabaseClient<Database>,
  orgId: string,
  opts: SuggestMentorsOptions
): Promise<
  | { state: "resolved"; userId: string; display: DisplayReadyMentorPerson }
  | { state: "not_found" }
  | { state: "ambiguous"; options: DisplayReadyMentorPerson[] }
> {
  // Allow any active org member as a mentee (admin, active_member, alumni).
  // The scoring library handles role-specific filtering downstream.
  const MENTEE_ELIGIBLE_ROLES = ["active_member", "admin", "alumni"] as const;

  if (opts.menteeUserId) {
    const { data } = await supabase
      .from("user_organization_roles")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("user_id", opts.menteeUserId)
      .eq("status", "active")
      .in("role", [...MENTEE_ELIGIBLE_ROLES])
      .maybeSingle();

    if (!data) return { state: "not_found" };

    const displayMap = await loadUserDisplayMap(supabase, [data.user_id]);
    const u = displayMap.get(data.user_id);
    return {
      state: "resolved",
      userId: data.user_id,
      display: {
        user_id: data.user_id,
        name: u?.name ?? u?.email ?? "Member",
        subtitle: null,
      },
    };
  }

  if (opts.menteeQuery) {
    const query = opts.menteeQuery.toLowerCase().trim();

    const { data: rows } = await supabase
      .from("user_organization_roles")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .in("role", [...MENTEE_ELIGIBLE_ROLES]);

    const displayMap = await loadUserDisplayMap(
      supabase,
      (rows ?? []).map((r) => r.user_id)
    );

    const candidates = (rows ?? [])
      .map((r) => {
        const u = displayMap.get(r.user_id);
        return {
          user_id: r.user_id,
          name: u?.name ?? null,
          email: u?.email ?? null,
        };
      })
      .filter((c) => {
        const nameLower = c.name?.toLowerCase() ?? "";
        const emailLower = c.email?.toLowerCase() ?? "";
        return nameLower.includes(query) || emailLower.includes(query);
      });

    if (candidates.length === 0) return { state: "not_found" };

    if (candidates.length === 1) {
      const c = candidates[0];
      return {
        state: "resolved",
        userId: c.user_id,
        display: {
          user_id: c.user_id,
          name: c.name ?? c.email ?? "Member",
          subtitle: null,
        },
      };
    }

    // Multiple matches — check for exact match
    const exact = candidates.find(
      (c) =>
        c.name?.toLowerCase() === query || c.email?.toLowerCase() === query
    );
    if (exact) {
      return {
        state: "resolved",
        userId: exact.user_id,
        display: {
          user_id: exact.user_id,
          name: exact.name ?? exact.email ?? "Member",
          subtitle: null,
        },
      };
    }

    return {
      state: "ambiguous",
      options: candidates.slice(0, 5).map((c) => ({
        user_id: c.user_id,
        name: c.name ?? c.email ?? "Member",
        subtitle: c.email ?? null,
      })),
    };
  }

  return { state: "not_found" };
}

function buildDisplaySuggestions(
  matches: MentorMatch[],
  mentorLookup: Map<string, { name: string | null; email: string | null }>,
  mentorInputLookup: Map<string, MentorInput>,
  limit: number
): DisplayReadyMentorSuggestion[] {
  return matches.slice(0, limit).map((m) => {
    const info = mentorLookup.get(m.mentorUserId);
    const input = mentorInputLookup.get(m.mentorUserId);
    const subtitle = [input?.jobTitle, input?.currentCompany]
      .filter(Boolean)
      .join(" at ") || null;

    return {
      mentor: {
        user_id: m.mentorUserId,
        name: info?.name ?? info?.email ?? "Mentor",
        subtitle,
      },
      score: m.score,
      reasons: m.signals.map((s) => ({
        code: s.code,
        label: formatMentorshipReasonLabel(s.code),
        weight: s.weight,
        value: s.value,
      })),
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Main function                                                     */
/* ------------------------------------------------------------------ */

/**
 * Suggest mentors for a mentee. Reuses Phase 1 scoring library.
 * Pure SQL-based — no graph dependency.
 */
export async function suggestMentors(
  supabase: SupabaseClient<Database>,
  orgId: string,
  opts: SuggestMentorsOptions
): Promise<SuggestMentorsResult> {
  const limit = opts.limit ?? 5;

  // 1. Resolve mentee
  const resolution = await resolveMentee(supabase, orgId, opts);

  if (resolution.state === "not_found") {
    return { state: "not_found", mentee: null, suggestions: [] };
  }

  if (resolution.state === "ambiguous") {
    return {
      state: "ambiguous",
      mentee: null,
      suggestions: [],
      disambiguation_options: resolution.options,
    };
  }

  const menteeUserId = resolution.userId;
  const menteeDisplay = resolution.display;

  // 2. Load mentee native preferences + mentor inputs in parallel
  const [menteeInput, mentorInputs] = await Promise.all([
    loadMenteePreferences(
      supabase as unknown as Parameters<typeof loadMenteePreferences>[0],
      orgId,
      menteeUserId
    ),
    loadMentorInputs(supabase, orgId),
  ]);

  // Merge focus_areas override
  const mergedMentee =
    opts.focusAreas && opts.focusAreas.length > 0
      ? { ...menteeInput, focusAreas: [...(menteeInput.focusAreas ?? []), ...opts.focusAreas] }
      : menteeInput;

  // 3. Exclude already-paired mentors
  const { data: existingPairs } = await supabase
    .from("mentorship_pairs")
    .select("mentor_user_id")
    .eq("organization_id", orgId)
    .eq("mentee_user_id", menteeUserId)
    .in("status", ["proposed", "accepted", "active", "paused"])
    .is("deleted_at", null);

  const excludeIds = new Set(
    (existingPairs ?? []).map((r) => r.mentor_user_id as string)
  );

  // 4. Load org settings for weight overrides
  const { data: orgRow } = await (supabase as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          maybeSingle: () => Promise<{ data: { settings?: unknown } | null }>;
        };
      };
    };
  })
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();

  // 5. Score via Phase 1 library
  const matches = rankMentorsForMentee(mergedMentee, mentorInputs, {
    orgSettings: orgRow?.settings ?? null,
    excludeMentorUserIds: excludeIds,
  });

  if (matches.length === 0) {
    return { state: "no_suggestions", mentee: menteeDisplay, suggestions: [] };
  }

  // 6. Build display-ready suggestions
  // Load names for matched mentors
  const matchedIds = matches.slice(0, limit).map((m) => m.mentorUserId);
  const { data: mentorRoleRows } = await supabase
    .from("user_organization_roles")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .in("role", ["alumni", "admin"])
    .in("user_id", matchedIds);

  const mentorLookup = await loadUserDisplayMap(
    supabase,
    (mentorRoleRows ?? []).map((row) => row.user_id)
  );

  const mentorInputLookup = new Map<string, MentorInput>();
  for (const mi of mentorInputs) {
    mentorInputLookup.set(mi.userId, mi);
  }

  return {
    state: "resolved",
    mentee: menteeDisplay,
    suggestions: buildDisplaySuggestions(matches, mentorLookup, mentorInputLookup, limit),
  };
}
