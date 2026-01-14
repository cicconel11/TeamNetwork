import type { SupabaseClient } from "@supabase/supabase-js";
import ical from "node-ical";
import type { Database, Json } from "@/types/database";
import {
  upsertInstances,
  deleteStaleInstances,
  getDefaultSyncWindow,
} from "./syncHelpers";

// Re-export shared types for backwards compatibility
export type {
  CalendarFeedRow,
  CalendarEventInsert,
  SyncWindow,
  CalendarEventInstance,
  SyncResult,
} from "./syncHelpers";
export { getDefaultSyncWindow } from "./syncHelpers";

const FETCH_TIMEOUT_MS = 12000;
const FETCH_RETRIES = 2;
const RETRY_DELAY_MS = 800;

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

type CalendarFeedRow = Database["public"]["Tables"]["calendar_feeds"]["Row"];
type SyncWindow = { start: Date; end: Date };
type CalendarEventInstance = {
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

export function expandIcsEvents(icsText: string, window: SyncWindow): CalendarEventInstance[] {
  const parsed = ical.parseICS(icsText);
  const instances = new Map<string, CalendarEventInstance>();

  for (const value of Object.values(parsed)) {
    const event = value as IcsEvent | undefined;

    if (!event || event.type !== "VEVENT" || !event.uid) {
      continue;
    }

    if (event.recurrenceid) {
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

  try {
    const icsText = await fetchIcsText(feed.feed_url, fetcher);
    const instances = expandIcsEvents(icsText, window);
    const instanceKeys = new Set(instances.map((instance) => instance.instanceKey));

    await upsertInstances(supabase, feed, instances);
    const deletedCount = await deleteStaleInstances(supabase, feed, window, instanceKeys);

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

function resolveEventEnd(instanceEvent: IcsEvent, baseEvent: IcsEvent, start: Date) {
  if (instanceEvent !== baseEvent && instanceEvent.end) {
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
