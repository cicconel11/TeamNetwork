import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { optionalLinkedInProfileUrlSchema } from "@/lib/alumni/linkedin-url";

type LinkedInProfileTable = "members" | "alumni" | "parents";

export interface LinkedInStatusConnection {
  status: "connected" | "disconnected" | "error";
  linkedInName: string | null;
  linkedInEmail: string | null;
  linkedInPhotoUrl: string | null;
  lastSyncAt: string | null;
  syncError: string | null;
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

export async function getLinkedInStatusForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<LinkedInStatusResult> {
  // Run all queries in parallel, but preserve the original precedence/error
  // semantics: members -> alumni -> parents. A higher-priority table failure
  // must still fail closed if we would have needed to consult that table in the
  // original sequential flow.
  const [connectionResult, membersResult, alumniResult, parentsResult] =
    await Promise.allSettled([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("user_linkedin_connections")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
      getLatestLinkedInUrl(supabase, "members", userId),
      getLatestLinkedInUrl(supabase, "alumni", userId),
      getLatestLinkedInUrl(supabase, "parents", userId),
    ]);

  // Connection row is required — rethrow if it failed
  if (connectionResult.status === "rejected") throw connectionResult.reason;
  const { data: connectionRow, error: connectionError } = connectionResult.value;
  if (connectionError) {
    throw new Error(`Failed to fetch LinkedIn connection: ${connectionError.message}`);
  }

  const connection = connectionRow
    ? {
        status: connectionRow.status as "connected" | "disconnected" | "error",
        linkedInName: connectionRow.linkedin_name || null,
        linkedInEmail: connectionRow.linkedin_email || null,
        linkedInPhotoUrl: connectionRow.linkedin_picture_url || null,
        lastSyncAt: connectionRow.last_synced_at || null,
        syncError: connectionRow.sync_error || null,
      }
    : null;

  if (membersResult.status === "rejected") throw membersResult.reason;
  const membersUrl = membersResult.value;

  // Use truthiness (not ??) to match current falsy-check behavior: legacy
  // empty-string rows should continue falling through to lower-priority tables.
  if (membersUrl) {
    return {
      linkedin_url: membersUrl,
      connection,
    };
  }

  if (alumniResult.status === "rejected") throw alumniResult.reason;
  const alumniUrl = alumniResult.value;
  if (alumniUrl) {
    return {
      linkedin_url: alumniUrl,
      connection,
    };
  }

  if (parentsResult.status === "rejected") throw parentsResult.reason;
  const parentsUrl = parentsResult.value;

  return {
    linkedin_url: parentsUrl || null,
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
