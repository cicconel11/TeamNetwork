// ---------------------------------------------------------------------------
// LinkedIn enrichment orchestrator
// Wraps the Bright Data adapter and writes enrichment results to DB via RPCs.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  fetchLinkedInEnrichment,
  mapBrightDataToFields,
  isBrightDataConfigured,
  type BrightDataProfileResult,
} from "@/lib/linkedin/bright-data";

// Re-export for convenience at call sites
export { isBrightDataConfigured, mapBrightDataToFields, type BrightDataProfileResult };
export { type EnrichmentFields } from "@/lib/linkedin/bright-data";

// ---------------------------------------------------------------------------
// Individual enrichment (user-initiated: OAuth connect, manual sync, URL save)
// ---------------------------------------------------------------------------

/**
 * Runs Bright Data enrichment for a user and writes the results to
 * members/alumni records via the sync_user_linkedin_enrichment RPC.
 *
 * This is best-effort: it never throws. If Bright Data is not configured or
 * the enrichment fails, it logs and returns gracefully.
 *
 * @param linkedinUrl The user's LinkedIn profile URL
 * @param overwrite If true, overwrite existing non-NULL fields (for manual sync)
 */
export async function runEnrichment(
  supabase: SupabaseClient<Database>,
  userId: string,
  linkedinUrl: string | null | undefined,
  overwrite = false,
): Promise<{ enriched: boolean; error?: string }> {
  if (!linkedinUrl) {
    return { enriched: false };
  }

  if (!isBrightDataConfigured()) {
    return { enriched: false };
  }

  try {
    const profile = await fetchLinkedInEnrichment(linkedinUrl);
    if (!profile) {
      return { enriched: false, error: "Bright Data returned no data" };
    }

    const fields = mapBrightDataToFields(profile);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc("sync_user_linkedin_enrichment", {
      p_user_id: userId,
      p_job_title: fields.job_title,
      p_current_company: fields.current_company,
      p_current_city: fields.current_city,
      p_school: fields.school,
      p_major: fields.major,
      p_position_title: fields.position_title,
      p_headline: fields.headline,
      p_summary: fields.summary,
      p_work_history: fields.work_history,
      p_education_history: fields.education_history,
      p_enrichment_json: profile as unknown,
      p_overwrite: overwrite,
    });

    if (error) {
      console.error("[linkedin-enrichment] RPC error:", error);
      return { enriched: false, error: error.message };
    }

    return { enriched: true };
  } catch (err) {
    console.error("[linkedin-enrichment] Unexpected error:", err);
    return { enriched: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Looks up the user's LinkedIn URL from their connection record.
 */
export async function getLinkedInUrlForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("user_linkedin_connections")
    .select("linkedin_profile_url")
    .eq("user_id", userId)
    .maybeSingle();

  return data?.linkedin_profile_url || null;
}
