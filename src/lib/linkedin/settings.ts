import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { optionalLinkedInProfileUrlSchema } from "@/lib/alumni/linkedin-url";
import {
  getLinkedInConnectionSource,
  type LinkedInConnectionSource,
} from "@/lib/linkedin/connection-source";
import { getOrgProfileLinkedInUrl } from "@/lib/linkedin/url-resolver";

export interface LinkedInEnrichmentInfo {
  jobTitle: string | null;
  currentCompany: string | null;
  school: string | null;
}

export interface LinkedInStatusConnection {
  source: LinkedInConnectionSource;
  status: "connected" | "disconnected" | "error";
  linkedInName: string | null;
  linkedInEmail: string | null;
  linkedInPhotoUrl: string | null;
  lastSyncAt: string | null;
  syncError: string | null;
  enrichment: LinkedInEnrichmentInfo | null;
  lastEnrichedAt: string | null;
}

export interface LinkedInStatusResult {
  linkedin_url: string | null;
  connection: LinkedInStatusConnection | null;
}

type LinkedInUrlPatchBodyResult =
  | { success: true; linkedinUrl: string }
  | { success: false; error: string };

type SaveLinkedInUrlResult =
  | { success: true }
  | { success: false; reason: "db_error" | "not_found"; error: string };

export async function getLinkedInStatusForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<LinkedInStatusResult> {
  const [connectionResult, linkedinUrlResult] = await Promise.allSettled([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("user_linkedin_connections")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
    getOrgProfileLinkedInUrl(supabase, userId),
  ]);

  // Connection row is required — rethrow if it failed
  if (connectionResult.status === "rejected") throw connectionResult.reason;
  const { data: connectionRow, error: connectionError } = connectionResult.value;
  if (connectionError) {
    throw new Error(`Failed to fetch LinkedIn connection: ${connectionError.message}`);
  }

  // Extract enrichment data from linkedin_data JSONB if present
  let enrichment: LinkedInEnrichmentInfo | null = null;
  if (connectionRow?.linkedin_data?.enrichment) {
    const e = connectionRow.linkedin_data.enrichment;
    const currentJob = Array.isArray(e.experiences)
      ? e.experiences.find((exp: { ends_at?: unknown }) => !exp.ends_at) ?? e.experiences[0]
      : null;
    const latestEdu = Array.isArray(e.education) ? e.education[0] : null;
    enrichment = {
      jobTitle: currentJob?.title || e.occupation || null,
      currentCompany: currentJob?.company || null,
      school: latestEdu?.school || null,
    };
  }

  // Filter out 'enriched_only' sentinel rows — they exist only to persist
  // last_enriched_at for manual-URL users and should not appear as a connection.
  const connection =
    connectionRow && connectionRow.status !== "enriched_only"
      ? {
          source: getLinkedInConnectionSource(connectionRow),
          status: connectionRow.status as "connected" | "disconnected" | "error",
          linkedInName: connectionRow.linkedin_name || null,
          linkedInEmail: connectionRow.linkedin_email || null,
          linkedInPhotoUrl: connectionRow.linkedin_picture_url || null,
          lastSyncAt: connectionRow.last_synced_at || null,
          syncError: connectionRow.sync_error || null,
          enrichment,
          lastEnrichedAt: connectionRow.last_enriched_at || null,
        }
      : null;
  if (linkedinUrlResult.status === "rejected") throw linkedinUrlResult.reason;

  return {
    linkedin_url: linkedinUrlResult.value || null,
    connection,
  };
}

export function parseLinkedInUrlPatchBody(body: unknown): LinkedInUrlPatchBodyResult {
  if (!body || typeof body !== "object" || !("linkedin_url" in body)) {
    return { success: false, error: "linkedin_url is required" };
  }

  const result = optionalLinkedInProfileUrlSchema.safeParse(
    (body as { linkedin_url: unknown }).linkedin_url,
  );

  if (!result.success) {
    return {
      success: false,
      error: result.error.issues[0]?.message ?? "Invalid LinkedIn URL",
    };
  }

  return {
    success: true,
    linkedinUrl: result.data ?? "",
  };
}

export async function saveLinkedInUrlForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
  linkedinUrl: string,
): Promise<SaveLinkedInUrlResult> {
  const normalizedUrl = linkedinUrl || null;
  // Wrap the cross-table write in a single RPC so the caller sees all-or-nothing behavior.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("save_user_linkedin_url", {
    p_user_id: userId,
    p_linkedin_url: normalizedUrl,
  });

  if (error) {
    console.error("[linkedin-url] Failed to save LinkedIn URL:", error);
    return { success: false, reason: "db_error", error: "Failed to save LinkedIn URL" };
  }

  const totalUpdated = typeof data?.updated_count === "number" ? data.updated_count : null;
  if (totalUpdated === null) {
    console.error("[linkedin-url] save_user_linkedin_url returned an invalid payload:", data);
    return { success: false, reason: "db_error", error: "Failed to save LinkedIn URL" };
  }

  if (totalUpdated === 0) {
    return { success: false, reason: "not_found", error: "No profile found to update" };
  }

  return { success: true };
}
