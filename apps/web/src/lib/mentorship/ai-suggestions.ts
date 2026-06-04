import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  rankMentorsForMentee,
  rankMentorsForMenteeWithFallback,
  rankMenteesForMentor,
  loadBalanceMatches,
  type MentorMatch,
} from "@/lib/mentorship/matching";
import type { MentorInput } from "@/lib/mentorship/matching-signals";
import {
  loadMentorInputs,
  loadMenteePreferences,
  loadSeekingMenteeInputs,
} from "@/lib/mentorship/queries";
import {
  formatMatchExplanation,
  formatMentorshipReasonLabel,
} from "@/lib/mentorship/presentation";
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

interface MemberRow {
  user_id: string;
  name: string | null;
  email: string | null;
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
      .select("user_id, users(name, email)")
      .eq("organization_id", orgId)
      .eq("user_id", opts.menteeUserId)
      .eq("status", "active")
      .in("role", [...MENTEE_ELIGIBLE_ROLES])
      .maybeSingle();

    if (!data) return { state: "not_found" };

    const u = Array.isArray(data.users) ? data.users[0] : data.users;
    return {
      state: "resolved",
      userId: data.user_id,
      display: {
        user_id: data.user_id,
        name: (u as MemberRow | null)?.name ?? "Member",
        subtitle: null,
      },
    };
  }

  if (opts.menteeQuery) {
    const query = opts.menteeQuery.toLowerCase().trim();

    const { data: rows } = await supabase
      .from("user_organization_roles")
      .select("user_id, users(name, email)")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .in("role", [...MENTEE_ELIGIBLE_ROLES]);

    const candidates = (rows ?? [])
      .map((r) => {
        const u = Array.isArray(r.users) ? r.users[0] : r.users;
        return {
          user_id: r.user_id,
          name: (u as MemberRow | null)?.name ?? null,
          email: (u as MemberRow | null)?.email ?? null,
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
  const scored = rankMentorsForMentee(mergedMentee, mentorInputs, {
    orgSettings: orgRow?.settings ?? null,
    excludeMentorUserIds: excludeIds,
  });

  if (scored.length === 0) {
    return { state: "no_suggestions", mentee: menteeDisplay, suggestions: [] };
  }

  // Spread recommendations so the same top mentor isn't returned to everyone.
  const matches = loadBalanceMatches(scored, mentorInputs);

  // 6. Build display-ready suggestions
  // Load names for matched mentors
  const matchedIds = matches.slice(0, limit).map((m) => m.mentorUserId);
  const { data: mentorUsers } = await supabase
    .from("user_organization_roles")
    .select("user_id, users(name, email)")
    .eq("organization_id", orgId)
    .in("user_id", matchedIds);

  const mentorLookup = new Map<string, { name: string | null; email: string | null }>();
  for (const row of mentorUsers ?? []) {
    const u = Array.isArray(row.users) ? row.users[0] : row.users;
    mentorLookup.set(row.user_id, {
      name: (u as MemberRow | null)?.name ?? null,
      email: (u as MemberRow | null)?.email ?? null,
    });
  }

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

/* ------------------------------------------------------------------ */
/*  Admin pairing surface                                             */
/* ------------------------------------------------------------------ */

export interface AdminPairingReason {
  code: MentorshipReasonCode;
  label: string;
  /** Human-readable explanation sentence (value-aware). */
  explanation: string;
  weight: number;
  value?: string | number;
}

export interface AdminPairingCandidate {
  mentor: DisplayReadyMentorPerson;
  score: number;
  /** Remaining mentee slots for this mentor (maxMentees - currentMenteeCount). */
  capacityRemaining: number;
  reasons: AdminPairingReason[];
  /** True when this candidate came from the data-thin fallback, not real overlap. */
  isFallback: boolean;
}

export interface AdminPairingResult {
  state: SuggestMentorsState;
  mentee: DisplayReadyMentorPerson | null;
  usedFallback: boolean;
  candidates: AdminPairingCandidate[];
  disambiguation_options?: DisplayReadyMentorPerson[];
}

/**
 * Rank mentors for the admin pairing board. Unlike {@link suggestMentors}, this
 * never returns an empty list for a data-thin mentee — it uses the fallback
 * ranker so the admin always sees candidates — and surfaces capacity + a
 * human-readable explanation per reason. The "why" prose is added by the route
 * (LLM, optional); this function stays deterministic and LLM-free.
 */
export async function suggestMentorsForPairing(
  supabase: SupabaseClient<Database>,
  orgId: string,
  opts: SuggestMentorsOptions
): Promise<AdminPairingResult> {
  const limit = opts.limit ?? 5;

  const resolution = await resolveMentee(supabase, orgId, opts);
  if (resolution.state === "not_found") {
    return { state: "not_found", mentee: null, usedFallback: false, candidates: [] };
  }
  if (resolution.state === "ambiguous") {
    return {
      state: "ambiguous",
      mentee: null,
      usedFallback: false,
      candidates: [],
      disambiguation_options: resolution.options,
    };
  }

  const menteeUserId = resolution.userId;
  const menteeDisplay = resolution.display;

  const [menteeInput, mentorInputs] = await Promise.all([
    loadMenteePreferences(
      supabase as unknown as Parameters<typeof loadMenteePreferences>[0],
      orgId,
      menteeUserId
    ),
    loadMentorInputs(supabase, orgId),
  ]);

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

  const { matches, usedFallback } = rankMentorsForMenteeWithFallback(
    menteeInput,
    mentorInputs,
    {
      orgSettings: orgRow?.settings ?? null,
      excludeMentorUserIds: excludeIds,
      minResults: limit,
    }
  );

  // Spread recommendations across mentors so a single high-scoring mentor
  // isn't surfaced #1 for every student.
  const top = loadBalanceMatches(matches, mentorInputs).slice(0, limit);
  const matchedIds = top.map((m) => m.mentorUserId);
  const { data: mentorUsers } = await supabase
    .from("user_organization_roles")
    .select("user_id, users(name, email)")
    .eq("organization_id", orgId)
    .in("user_id", matchedIds);

  const mentorLookup = new Map<string, { name: string | null; email: string | null }>();
  for (const row of mentorUsers ?? []) {
    const u = Array.isArray(row.users) ? row.users[0] : row.users;
    mentorLookup.set(row.user_id, {
      name: (u as MemberRow | null)?.name ?? null,
      email: (u as MemberRow | null)?.email ?? null,
    });
  }

  const mentorInputLookup = new Map<string, MentorInput>();
  for (const mi of mentorInputs) mentorInputLookup.set(mi.userId, mi);

  const candidates: AdminPairingCandidate[] = top.map((m) => {
    const info = mentorLookup.get(m.mentorUserId);
    const input = mentorInputLookup.get(m.mentorUserId);
    const subtitle =
      [input?.jobTitle, input?.currentCompany].filter(Boolean).join(" at ") || null;
    const capacityRemaining = Math.max(
      0,
      (input?.maxMentees ?? 3) - (input?.currentMenteeCount ?? 0)
    );
    return {
      mentor: {
        user_id: m.mentorUserId,
        name: info?.name ?? info?.email ?? "Mentor",
        subtitle,
      },
      score: m.score,
      capacityRemaining,
      isFallback: m.signals.some((s) => s.code === "fallback_general"),
      reasons: m.signals.map((s) => ({
        code: s.code,
        label: formatMentorshipReasonLabel(s.code),
        explanation: formatMatchExplanation(s),
        weight: s.weight,
        value: s.value,
      })),
    };
  });

  return { state: "resolved", mentee: menteeDisplay, usedFallback, candidates };
}

/* ------------------------------------------------------------------ */
/*  Bi-directional: recommend mentees for a mentor                    */
/* ------------------------------------------------------------------ */

export interface SuggestMenteesOptions {
  mentorUserId?: string;
  mentorQuery?: string;
  limit?: number;
}

export interface DisplayReadyMenteeSuggestion {
  mentee: DisplayReadyMentorPerson;
  score: number;
  reasons: DisplayReadyMentorReason[];
}

export interface SuggestMenteesResult {
  state: SuggestMentorsState;
  mentor: DisplayReadyMentorPerson | null;
  suggestions: DisplayReadyMenteeSuggestion[];
  disambiguation_options?: DisplayReadyMentorPerson[];
}

/**
 * Resolve a mentor by id or fuzzy name/email query. Accepts any active member —
 * a mentor can be an alumni, admin, OR an active_member who set up a mentor
 * profile. The `mentor_profiles` lookup in {@link suggestMentees} is what
 * actually gates whether the resolved person can mentor.
 */
async function resolveMentor(
  supabase: SupabaseClient<Database>,
  orgId: string,
  opts: SuggestMenteesOptions
): Promise<
  | { state: "resolved"; userId: string; display: DisplayReadyMentorPerson }
  | { state: "not_found" }
  | { state: "ambiguous"; options: DisplayReadyMentorPerson[] }
> {
  const MENTOR_ELIGIBLE_ROLES = ["alumni", "admin", "active_member"] as const;

  const toPerson = (r: { user_id: string; name: string | null; email: string | null }) => ({
    user_id: r.user_id,
    name: r.name ?? r.email ?? "Mentor",
    subtitle: r.email ?? null,
  });

  if (opts.mentorUserId) {
    const { data } = await supabase
      .from("user_organization_roles")
      .select("user_id, users(name, email)")
      .eq("organization_id", orgId)
      .eq("user_id", opts.mentorUserId)
      .eq("status", "active")
      .in("role", [...MENTOR_ELIGIBLE_ROLES])
      .maybeSingle();
    if (!data) return { state: "not_found" };
    const u = Array.isArray(data.users) ? data.users[0] : data.users;
    return {
      state: "resolved",
      userId: data.user_id,
      display: toPerson({
        user_id: data.user_id,
        name: (u as MemberRow | null)?.name ?? null,
        email: (u as MemberRow | null)?.email ?? null,
      }),
    };
  }

  if (opts.mentorQuery) {
    const query = opts.mentorQuery.toLowerCase().trim();
    const { data: rows } = await supabase
      .from("user_organization_roles")
      .select("user_id, users(name, email)")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .in("role", [...MENTOR_ELIGIBLE_ROLES]);

    const candidates = (rows ?? [])
      .map((r) => {
        const u = Array.isArray(r.users) ? r.users[0] : r.users;
        return {
          user_id: r.user_id,
          name: (u as MemberRow | null)?.name ?? null,
          email: (u as MemberRow | null)?.email ?? null,
        };
      })
      .filter((c) => {
        const n = c.name?.toLowerCase() ?? "";
        const e = c.email?.toLowerCase() ?? "";
        return n.includes(query) || e.includes(query);
      });

    if (candidates.length === 0) return { state: "not_found" };
    const exact = candidates.find(
      (c) => c.name?.toLowerCase() === query || c.email?.toLowerCase() === query
    );
    const chosen = candidates.length === 1 ? candidates[0] : exact;
    if (chosen) {
      return { state: "resolved", userId: chosen.user_id, display: toPerson(chosen) };
    }
    return { state: "ambiguous", options: candidates.slice(0, 5).map(toPerson) };
  }

  return { state: "not_found" };
}

/**
 * Recommend mentees for a mentor — the bi-directional counterpart of
 * {@link suggestMentors}, backing the in-app agent's "who should I mentor?"
 * tool. Reuses the symmetric scorer via {@link rankMenteesForMentor}.
 */
export async function suggestMentees(
  supabase: SupabaseClient<Database>,
  orgId: string,
  opts: SuggestMenteesOptions
): Promise<SuggestMenteesResult> {
  const limit = opts.limit ?? 5;

  const resolution = await resolveMentor(supabase, orgId, opts);
  if (resolution.state === "not_found") {
    return { state: "not_found", mentor: null, suggestions: [] };
  }
  if (resolution.state === "ambiguous") {
    return {
      state: "ambiguous",
      mentor: null,
      suggestions: [],
      disambiguation_options: resolution.options,
    };
  }

  const mentorUserId = resolution.userId;
  const mentorDisplay = resolution.display;

  const [mentorInputs, menteeInputs] = await Promise.all([
    loadMentorInputs(supabase, orgId),
    loadSeekingMenteeInputs(supabase, orgId),
  ]);

  const mentorInput = mentorInputs.find((m) => m.userId === mentorUserId);
  if (!mentorInput) {
    // No mentor profile → cannot rank. Surface as "no suggestions".
    return { state: "no_suggestions", mentor: mentorDisplay, suggestions: [] };
  }

  // Exclude mentees already paired with this mentor.
  const { data: existingPairs } = await supabase
    .from("mentorship_pairs")
    .select("mentee_user_id")
    .eq("organization_id", orgId)
    .eq("mentor_user_id", mentorUserId)
    .in("status", ["proposed", "accepted", "active", "paused"])
    .is("deleted_at", null);
  const excludeIds = new Set(
    (existingPairs ?? []).map((r) => r.mentee_user_id as string)
  );

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

  const matches = rankMenteesForMentor(mentorInput, menteeInputs, {
    orgSettings: orgRow?.settings ?? null,
    excludeMenteeUserIds: excludeIds,
  });

  if (matches.length === 0) {
    return { state: "no_suggestions", mentor: mentorDisplay, suggestions: [] };
  }

  const top = matches.slice(0, limit);
  const menteeIds = top.map((m) => m.menteeUserId);
  const { data: menteeUsers } = await supabase
    .from("user_organization_roles")
    .select("user_id, users(name, email)")
    .eq("organization_id", orgId)
    .in("user_id", menteeIds);

  const lookup = new Map<string, { name: string | null; email: string | null }>();
  for (const row of menteeUsers ?? []) {
    const u = Array.isArray(row.users) ? row.users[0] : row.users;
    lookup.set(row.user_id, {
      name: (u as MemberRow | null)?.name ?? null,
      email: (u as MemberRow | null)?.email ?? null,
    });
  }

  return {
    state: "resolved",
    mentor: mentorDisplay,
    suggestions: top.map((m) => {
      const info = lookup.get(m.menteeUserId);
      return {
        mentee: {
          user_id: m.menteeUserId,
          name: info?.name ?? info?.email ?? "Member",
          subtitle: null,
        },
        score: m.score,
        reasons: m.signals.map((s) => ({
          code: s.code,
          label: formatMentorshipReasonLabel(s.code),
          weight: s.weight,
          value: s.value,
        })),
      };
    }),
  };
}
