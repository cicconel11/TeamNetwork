import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@teammeet/types";

type Announcement = Database["public"]["Tables"]["announcements"]["Row"];

export interface FetchAnnouncementsResult {
  data: Announcement[] | null;
  error: Error | null;
}

/**
 * Fetches all non-deleted announcements for an organization
 */
export async function fetchOrganizationAnnouncements(
  supabase: SupabaseClient<Database>,
  organizationId: string
): Promise<FetchAnnouncementsResult> {
  try {
    const { data, error } = await supabase
      .from("announcements")
      .select("*")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e as Error };
  }
}
