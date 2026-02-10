import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgeBracket, OrgType } from "./types";

/**
 * Check whether a user has opted in to analytics tracking.
 */
export async function getAnalyticsConsent(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("analytics_consent")
    .select("consented")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return false;
  return data.consented === true;
}

/**
 * Upsert a user's analytics consent record.
 */
export async function updateAnalyticsConsent(
  supabase: SupabaseClient,
  userId: string,
  consented: boolean,
  ageBracket?: AgeBracket | null,
): Promise<void> {
  const now = new Date().toISOString();

  if (consented) {
    // Consenting: upsert with consented_at, clear revoked_at
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("analytics_consent")
      .upsert(
        {
          user_id: userId,
          consented: true,
          age_bracket: ageBracket ?? null,
          consented_at: now,
          revoked_at: null,
          updated_at: now,
        },
        { onConflict: "user_id" },
      );

    if (error) {
      throw new Error(`Failed to update analytics consent: ${error.message}`);
    }
  } else {
    // Revoking: update only revoked_at and consented flag.
    // Leave consented_at untouched to preserve the audit trail of when
    // the user originally opted in (GDPR Article 7(1)).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("analytics_consent")
      .update({
        consented: false,
        age_bracket: ageBracket ?? null,
        revoked_at: now,
        updated_at: now,
      })
      .eq("user_id", userId);

    if (error) {
      throw new Error(`Failed to update analytics consent: ${error.message}`);
    }
  }
}

/**
 * Tracking restriction levels based on age bracket and org type.
 */
export type TrackingLevel = "none" | "page_view_only" | "full";

/**
 * Determine what level of tracking is allowed for a user+org combination.
 *
 * Rules:
 *  1. User must have consented.
 *  2. under_13 → always "none" (defence in depth).
 *  3. 13_17 → "page_view_only" (no duration, no hour_of_day).
 *  4. educational org → "page_view_only" (FERPA: no behavioral profiling).
 *  5. Otherwise → "full".
 */
export function resolveTrackingLevel(
  consented: boolean,
  ageBracket: AgeBracket | null | undefined,
  orgType: OrgType | null | undefined,
): TrackingLevel {
  if (!consented) return "none";
  if (ageBracket === "under_13") return "none";
  if (ageBracket === "13_17") return "page_view_only";
  if (orgType === "educational") return "page_view_only";
  return "full";
}

/**
 * High-level convenience: fetches consent + resolves tracking level.
 */
export async function isTrackingAllowed(
  supabase: SupabaseClient,
  userId: string,
  ageBracket: AgeBracket | null | undefined,
  orgType: OrgType | null | undefined,
): Promise<TrackingLevel> {
  const consented = await getAnalyticsConsent(supabase, userId);
  return resolveTrackingLevel(consented, ageBracket, orgType);
}
