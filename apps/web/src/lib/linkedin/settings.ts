import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { optionalLinkedInProfileUrlSchema } from "@/lib/alumni/linkedin-url";
import {
  getLinkedInConnectionSource,
  type LinkedInConnectionSource,
} from "@/lib/linkedin/connection-source";
import {
  mapBrightDataToFields,
  type BrightDataProfileResult,
} from "@/lib/linkedin/bright-data";

type LinkedInProfileTable = "members" | "alumni" | "parents";

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

async function getLatestLinkedInUrl(
  supabase: SupabaseClient<Database>,
  table: LinkedInProfileTable,
  userId: string,
) {
  // parents is not in generated types; use the same service-client cast pattern as other routes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from(table)
    .select("linkedin_url, updated_at, created_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .not("linkedin_url", "is", null)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to fetch LinkedIn URL from ${table}: ${error.message}`);
  }

  return data?.[0]?.linkedin_url ?? null;
}

export async function getLinkedInProfileUrlForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string | null> {
  const [membersResult, alumniResult, parentsResult] =
    await Promise.allSettled([
      getLatestLinkedInUrl(supabase, "members", userId),
      getLatestLinkedInUrl(supabase, "alumni", userId),
      getLatestLinkedInUrl(supabase, "parents", userId),
    ]);

  if (membersResult.status === "rejected") throw membersResult.reason;
  const membersUrl = membersResult.value;
  if (membersUrl) return membersUrl;

  if (alumniResult.status === "rejected") throw alumniResult.reason;
  const alumniUrl = alumniResult.value;
  if (alumniUrl) return alumniUrl;

  if (parentsResult.status === "rejected") throw parentsResult.reason;
  return parentsResult.value || null;
}

export async function getLinkedInStatusForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<LinkedInStatusResult> {
  // Run all queries in parallel, but preserve the original precedence/error
  // semantics: members -> alumni -> parents. A higher-priority table failure
  // must still fail closed if we would have needed to consult that table in the
  // original sequential flow.
  const [connectionResult, linkedinUrlResult] =
    await Promise.allSettled([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("user_linkedin_connections")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
      getLinkedInProfileUrlForUser(supabase, userId),
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
    const raw = connectionRow.linkedin_data.enrichment;

    // Detect legacy ProxyCurl format (uses `experiences` plural) vs Bright Data (`experience` singular)
    const isLegacyFormat = Array.isArray(raw.experiences);

    if (isLegacyFormat) {
      const currentJob = (raw.experiences as Array<{ ends_at: unknown; title: string | null; company: string | null }>)
        ?.find((e) => !e.ends_at) ?? raw.experiences?.[0];
      const latestEdu = (raw.education as Array<{ school: string | null }>)?.[0];
      enrichment = {
        jobTitle: currentJob?.title || raw.occupation || null,
        currentCompany: currentJob?.company || null,
        school: latestEdu?.school || null,
      };
    } else {
      const fields = mapBrightDataToFields(raw as BrightDataProfileResult);
      enrichment = {
        jobTitle: fields.job_title,
        currentCompany: fields.current_company,
        school: fields.school,
      };
    }
  }

  const connection = connectionRow
    ? {
        source: getLinkedInConnectionSource(connectionRow),
        status: connectionRow.status as "connected" | "disconnected" | "error",
        linkedInName: connectionRow.linkedin_name || null,
        linkedInEmail: connectionRow.linkedin_email || null,
        linkedInPhotoUrl: connectionRow.linkedin_picture_url || null,
        lastSyncAt: connectionRow.last_synced_at || null,
        syncError: connectionRow.sync_error || null,
        enrichment,
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
