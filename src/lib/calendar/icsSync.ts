import type { SupabaseClient } from "@supabase/supabase-js";
import ical from "node-ical";
import type { Database, Json } from "@/types/database";

const FETCH_TIMEOUT_MS = 12000;
const FETCH_RETRIES = 2;
const RETRY_DELAY_MS = 800;
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

type IcsEvent = {
  type?: string;
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: Date;
  end?: Date;
  datetype?: string;
  rrule?: { between: (start: Date, end: Date, inc: boolean) => Date[] };
  recurrences?: Record<string, IcsEvent>;
  exdate?: Record<string, Date>;
  recurrenceid?: Date;
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

export function expandIcsEvents(icsText: string, window: SyncWindow): CalendarEventInstance[] {
  const parsed = ical.parseICS(icsText);
  const instances = new Map<string, CalendarEventInstance>();

  for (const value of Object.values(parsed)) {
    const event = value as IcsEvent | undefined;

    if (!event || event.type !== "VEVENT" || !event.uid) {
      continue;
    }

    if (event.recurrenceid) {
      // Recurrence overrides are handled via the parent event's recurrences map.
      continue;
    }

    if (event.rrule) {
      const occurrences = event.rrule.between(window.start, window.end, true);

      for (const occurrence of occurrences) {
        const occurrenceKey = occurrence.toISOString();

        if (event.exdate && event.exdate[occurrenceKey]) {
          continue;
        }

        const override = event.recurrences?.[occurrenceKey];
        const instanceEvent = override ?? event;
        const start = override?.start ?? occurrence;
        const end = resolveEventEnd(instanceEvent, event, start);

        addInstance(instances, buildInstance(instanceEvent, event.uid, start, end));
      }

      continue;
    }

    if (!event.start) {
      continue;
    }

    if (!isWithinWindow(event.start, window)) {
      continue;
    }

    addInstance(instances, buildInstance(event, event.uid, event.start, event.end ?? null));
  }

  return Array.from(instances.values());
}

export async function syncCalendarFeed(
  supabase: SupabaseClient<Database>,
  feed: CalendarFeedRow,
  options?: {
    window?: SyncWindow;
    fetcher?: typeof fetch;
    now?: () => Date;
  }
) {
  const window = options?.window ?? getDefaultSyncWindow(options?.now?.() ?? new Date());
  const fetcher = options?.fetcher ?? fetch;
  const now = options?.now?.() ?? new Date();

  // #region agent log
  console.log("[DEBUG-A] Starting calendar sync:", { feedId: feed.id, userId: feed.user_id, windowStart: window.start.toISOString(), windowEnd: window.end.toISOString() });
  // #endregion

  try {
    const icsText = await fetchIcsText(feed.feed_url, fetcher);
    const instances = expandIcsEvents(icsText, window);
    const instanceKeys = new Set(instances.map((instance) => instance.instanceKey));

    // #region agent log
    console.log("[DEBUG-A] Parsed ICS events:", { instanceCount: instances.length, firstInstance: instances[0] || null, allDayCount: instances.filter(i => i.allDay).length });
    // #endregion

    await upsertInstances(supabase, feed, instances);
    const deletedCount = await deleteStaleInstances(supabase, feed, window, instanceKeys);

    // #region agent log
    console.log("[DEBUG-A] Sync completed successfully:", { upserted: instances.length, deleted: deletedCount });
    // #endregion

    const lastSyncedAt = now.toISOString();
    await supabase
      .from("calendar_feeds")
      .update({
        status: "active",
        last_synced_at: lastSyncedAt,
        last_error: null,
      })
      .eq("id", feed.id);

    return {
      status: "active" as const,
      lastSyncedAt,
      lastError: null,
      upserted: instances.length,
      deleted: deletedCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync calendar feed.";

    // #region agent log
    console.log("[DEBUG-A] Sync FAILED:", { error: message });
    // #endregion

    await supabase
      .from("calendar_feeds")
      .update({
        status: "error",
        last_error: message,
      })
      .eq("id", feed.id);

    return {
      status: "error" as const,
      lastSyncedAt: null,
      lastError: message,
      upserted: 0,
      deleted: 0,
    };
  }
}

async function fetchIcsText(feedUrl: string, fetcher: typeof fetch): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetcher(feedUrl, {
        method: "GET",
        headers: {
          "User-Agent": "TeamMeet-CalendarSync/1.0",
          Accept: "text/calendar,text/plain",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`ICS fetch failed (${response.status})`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;

      if (attempt < FETCH_RETRIES) {
        await delay(RETRY_DELAY_MS);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Failed to fetch ICS feed.");
}

async function upsertInstances(
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
      // Already know we need fallback, use base rows directly
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
      // If error mentions organization_id or scope column, retry without those fields
      const errorStr = error.message || "";
      if (errorStr.includes("organization_id") || errorStr.includes("scope") || error.code === "42703") {
        console.warn("[icsSync] Falling back to upsert without organization_id/scope columns");
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

async function deleteStaleInstances(
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

function resolveEventEnd(instanceEvent: IcsEvent, baseEvent: IcsEvent, start: Date) {
  if (instanceEvent.end) {
    return instanceEvent.end;
  }

  if (baseEvent.start && baseEvent.end) {
    const durationMs = baseEvent.end.getTime() - baseEvent.start.getTime();
    return new Date(start.getTime() + durationMs);
  }

  return null;
}

function buildInstance(event: IcsEvent, uid: string, start: Date, end: Date | null): CalendarEventInstance {
  const allDay = isAllDayEvent(event, start, end);

  return {
    externalUid: uid,
    instanceKey: `${uid}|${start.toISOString()}`,
    title: event.summary ?? null,
    description: event.description ?? null,
    location: event.location ?? null,
    startAt: start.toISOString(),
    endAt: end ? end.toISOString() : null,
    allDay,
    raw: serializeRawEvent(event, start, end),
  };
}

function isAllDayEvent(event: IcsEvent, start: Date, end: Date | null) {
  if (event.datetype === "date") {
    return true;
  }

  if (!end) {
    return false;
  }

  const startsAtMidnight = start.getUTCHours() === 0 && start.getUTCMinutes() === 0;
  const endsAtMidnight = end.getUTCHours() === 0 && end.getUTCMinutes() === 0;

  return startsAtMidnight && endsAtMidnight;
}

function serializeRawEvent(event: IcsEvent, start: Date, end: Date | null): Json {
  return {
    uid: event.uid ?? null,
    summary: event.summary ?? null,
    description: event.description ?? null,
    location: event.location ?? null,
    start: start.toISOString(),
    end: end ? end.toISOString() : null,
    rrule: event.rrule && "toString" in event.rrule ? String(event.rrule) : null,
    exdate: event.exdate ? Object.keys(event.exdate) : null,
  };
}

function addInstance(map: Map<string, CalendarEventInstance>, instance: CalendarEventInstance) {
  if (!map.has(instance.instanceKey)) {
    map.set(instance.instanceKey, instance);
  }
}

function isWithinWindow(start: Date, window: SyncWindow) {
  return start >= window.start && start <= window.end;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
