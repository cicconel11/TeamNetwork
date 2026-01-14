import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";

const DEFAULT_WINDOW_PAST_DAYS = 30;
const DEFAULT_WINDOW_FUTURE_DAYS = 366;
const UPSERT_CHUNK_SIZE = 500;
const DELETE_CHUNK_SIZE = 500;

export type CalendarFeedRow = Database["public"]["Tables"]["calendar_feeds"]["Row"];
export type CalendarEventInsert = Database["public"]["Tables"]["calendar_events"]["Insert"];

export type SyncWindow = {
  start: Date;
  end: Date;
};

export type CalendarEventInstance = {
  externalUid: string;
  instanceKey: string;
  title: string | null;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  raw: Json | null;
};

export type SyncResult = {
  status: "active" | "error";
  lastSyncedAt: string | null;
  lastError: string | null;
  upserted: number;
  deleted: number;
};

export function getDefaultSyncWindow(now = new Date()): SyncWindow {
  const start = new Date(now);
  start.setDate(start.getDate() - DEFAULT_WINDOW_PAST_DAYS);
  start.setHours(0, 0, 0, 0);

  const end = new Date(now);
  end.setDate(end.getDate() + DEFAULT_WINDOW_FUTURE_DAYS);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

export async function upsertInstances(
  supabase: SupabaseClient<Database>,
  feed: CalendarFeedRow,
  instances: CalendarEventInstance[]
) {
  // Build base row data without optional columns that may not exist
  const baseRows = instances.map((instance) => ({
    user_id: feed.user_id,
    feed_id: feed.id,
    external_uid: instance.externalUid,
    instance_key: instance.instanceKey,
    title: instance.title,
    description: instance.description,
    location: instance.location,
    start_at: instance.startAt,
    end_at: instance.endAt,
    all_day: instance.allDay,
    raw: instance.raw,
  }));

  // Try with organization_id and scope first (for migrated DBs)
  const fullRows: CalendarEventInsert[] = baseRows.map((row) => ({
    ...row,
    organization_id: feed.organization_id ?? null,
    scope: feed.scope ?? "personal",
  }));

  let useFallback = false;

  for (let i = 0; i < fullRows.length; i += UPSERT_CHUNK_SIZE) {
    const fullChunk = fullRows.slice(i, i + UPSERT_CHUNK_SIZE);
    const baseChunk = baseRows.slice(i, i + UPSERT_CHUNK_SIZE);

    if (useFallback) {
      const { error } = await supabase
        .from("calendar_events")
        .upsert(baseChunk as CalendarEventInsert[], { onConflict: "feed_id,instance_key" });

      if (error) {
        throw new Error(error.message);
      }
      continue;
    }

    const { error } = await supabase
      .from("calendar_events")
      .upsert(fullChunk, { onConflict: "feed_id,instance_key" });

    if (error) {
      const errorStr = error.message || "";
      if (errorStr.includes("organization_id") || errorStr.includes("scope") || error.code === "42703") {
        console.warn("[syncHelpers] Falling back to upsert without organization_id/scope columns");
        useFallback = true;

        const { error: retryError } = await supabase
          .from("calendar_events")
          .upsert(baseChunk as CalendarEventInsert[], { onConflict: "feed_id,instance_key" });

        if (retryError) {
          throw new Error(retryError.message);
        }
        continue;
      }
      throw new Error(error.message);
    }
  }
}

export async function deleteStaleInstances(
  supabase: SupabaseClient<Database>,
  feed: CalendarFeedRow,
  window: SyncWindow,
  keepKeys: Set<string>
) {
  const { data: existing, error } = await supabase
    .from("calendar_events")
    .select("id, instance_key")
    .eq("feed_id", feed.id)
    .gte("start_at", window.start.toISOString())
    .lte("start_at", window.end.toISOString());

  if (error) {
    throw new Error(error.message);
  }

  const toDelete = (existing || [])
    .filter((row) => !keepKeys.has(row.instance_key))
    .map((row) => row.id);

  let deletedCount = 0;

  for (const chunk of chunkArray(toDelete, DELETE_CHUNK_SIZE)) {
    const { error: deleteError } = await supabase
      .from("calendar_events")
      .delete()
      .in("id", chunk);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    deletedCount += chunk.length;
  }

  return deletedCount;
}

export function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}
