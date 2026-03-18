import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type LinkedInProfileTable = "members" | "alumni" | "parents";

export interface LinkedInUrlResult {
  url: string;
  updatedAt: string;
}

export async function getLatestLinkedInUrl(
  supabase: SupabaseClient<Database>,
  table: LinkedInProfileTable,
  userId: string,
): Promise<LinkedInUrlResult | null> {
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

  const row = data?.[0];
  if (!row?.linkedin_url) return null;
  return { url: row.linkedin_url, updatedAt: row.updated_at ?? row.created_at };
}

export async function getOrgProfileLinkedInUrl(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string | null> {
  const [membersResult, alumniResult, parentsResult] = await Promise.allSettled([
    getLatestLinkedInUrl(supabase, "members", userId),
    getLatestLinkedInUrl(supabase, "alumni", userId),
    getLatestLinkedInUrl(supabase, "parents", userId),
  ]);

  // Fail closed: if any table query failed, throw
  if (membersResult.status === "rejected") throw membersResult.reason;
  if (alumniResult.status === "rejected") throw alumniResult.reason;
  if (parentsResult.status === "rejected") throw parentsResult.reason;

  // Pick the URL with the most recent updated_at across all tables
  const candidates: LinkedInUrlResult[] = [
    membersResult.value,
    alumniResult.value,
    parentsResult.value,
  ].filter((r): r is LinkedInUrlResult => r !== null);

  if (candidates.length === 0) return null;

  const newest = candidates.reduce((a, b) =>
    new Date(b.updatedAt) > new Date(a.updatedAt) ? b : a,
  );
  return newest.url;
}

export async function resolveLinkedInUrlForEnrichment(
  supabase: SupabaseClient<Database>,
  userId: string,
  connectionProfileUrl?: string | null,
): Promise<string | null> {
  const orgProfileUrl = await getOrgProfileLinkedInUrl(supabase, userId);
  if (orgProfileUrl) {
    return orgProfileUrl;
  }

  if (connectionProfileUrl !== undefined) {
    return connectionProfileUrl || null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("user_linkedin_connections")
    .select("linkedin_profile_url")
    .eq("user_id", userId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch LinkedIn connection: ${error.message}`);
  }

  return data?.linkedin_profile_url || null;
}
