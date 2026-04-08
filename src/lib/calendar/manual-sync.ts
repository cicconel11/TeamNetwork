import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { normalizeOutlookTargetCalendarId } from "@/lib/microsoft/calendar-sync";

export type CalendarEntryToSync = {
  event_id: string;
  organization_id: string;
};

export async function getOutlookEntriesToSync(
  supabase: SupabaseClient<Database>,
  userId: string,
  targetCalendarId: string | null,
  organizationId?: string | null
): Promise<CalendarEntryToSync[]> {
  let pendingQuery = supabase
    .from("event_calendar_entries")
    .select("event_id, organization_id")
    .eq("user_id", userId)
    .eq("provider", "outlook")
    .in("sync_status", ["pending", "failed"]);

  if (organizationId) {
    pendingQuery = pendingQuery.eq("organization_id", organizationId);
  }

  let syncedQuery = supabase
    .from("event_calendar_entries")
    .select("event_id, organization_id, external_calendar_id")
    .eq("user_id", userId)
    .eq("provider", "outlook")
    .eq("sync_status", "synced");

  if (organizationId) {
    syncedQuery = syncedQuery.eq("organization_id", organizationId);
  }

  const [{ data: pendingEntries }, { data: syncedEntries }] = await Promise.all([
    pendingQuery,
    syncedQuery,
  ]);

  const normalizedTargetCalendarId = normalizeOutlookTargetCalendarId(targetCalendarId);
  const mismatchedEntries = (syncedEntries || [])
    .filter((entry) =>
      normalizeOutlookTargetCalendarId(
        typeof entry.external_calendar_id === "string" ? entry.external_calendar_id : null
      ) !== normalizedTargetCalendarId
    )
    .map((entry) => ({
      event_id: entry.event_id,
      organization_id: entry.organization_id,
    }));

  return [
    ...(pendingEntries || []),
    ...mismatchedEntries,
  ];
}
