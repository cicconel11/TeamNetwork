import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import {
  upsertInstances,
  deleteStaleInstances,
  getDefaultSyncWindow,
} from "./syncHelpers";
import type {
  CalendarFeedRow,
  CalendarEventInstance,
  SyncWindow,
  SyncResult,
} from "./syncHelpers";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const MAX_RESULTS_PER_PAGE = 250;

// ---------- Google API response types ----------

type GoogleDateTime = {
  dateTime?: string;
  date?: string;
  timeZone?: string;
};

type GoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleDateTime;
  end?: GoogleDateTime;
  recurringEventId?: string;
};

type GoogleEventsResponse = {
  items?: GoogleEvent[];
  nextPageToken?: string;
};

// ---------- Public API ----------

export async function fetchGoogleCalendarEvents(
  accessToken: string,
  calendarId: string,
  window: SyncWindow,
  fetcher: typeof fetch = globalThis.fetch
): Promise<CalendarEventInstance[]> {
  const instances: CalendarEventInstance[] = [];
  let pageToken: string | undefined;

  do {
    const url = buildListUrl(calendarId, window, pageToken);

    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Google Calendar API error (${response.status})`);
    }

    const data: GoogleEventsResponse = await response.json();

    for (const event of data.items ?? []) {
      if (!event.id || event.status === "cancelled") {
        continue;
      }

      const instance = mapGoogleEvent(event);
      if (instance) {
        instances.push(instance);
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return instances;
}

export type SyncGoogleOptions = {
  window?: SyncWindow;
  fetcher?: typeof fetch;
  now?: () => Date;
  /** Dependency-injected: return a valid access token for the connected user, or null */
  getAccessToken?: (supabase: SupabaseClient<Database>, userId: string) => Promise<string | null>;
  /** Dependency-injected: check if connected user still has admin role */
  checkAdminRole?: (supabase: SupabaseClient<Database>, userId: string, orgId: string) => Promise<boolean>;
};

export async function syncGoogleCalendarFeed(
  supabase: SupabaseClient<Database>,
  feed: CalendarFeedRow,
  options?: SyncGoogleOptions
): Promise<SyncResult> {
  const window = options?.window ?? getDefaultSyncWindow(options?.now?.() ?? new Date());
  const fetcher = options?.fetcher ?? globalThis.fetch;
  const now = options?.now?.() ?? new Date();
  const getAccessToken = options?.getAccessToken ?? defaultGetAccessToken;
  const checkAdminRole = options?.checkAdminRole ?? defaultCheckAdminRole;

  const connectedUserId = feed.connected_user_id;
  const googleCalendarId = feed.google_calendar_id;

  if (!connectedUserId || !googleCalendarId) {
    return setFeedError(supabase, feed, "Missing connected_user_id or google_calendar_id");
  }

  // Check admin role at sync time (only for org-scoped feeds)
  if (feed.organization_id && feed.scope === "org") {
    const isAdmin = await checkAdminRole(supabase, connectedUserId, feed.organization_id);
    if (!isAdmin) {
      return setFeedError(supabase, feed, "Connected user no longer has admin access");
    }
  }

  // Get a valid access token
  const accessToken = await getAccessToken(supabase, connectedUserId);
  if (!accessToken) {
    return setFeedError(supabase, feed, "Unable to obtain valid access token for connected user");
  }

  try {
    const instances = await fetchGoogleCalendarEvents(accessToken, googleCalendarId, window, fetcher);
    const instanceKeys = new Set(instances.map((i) => i.instanceKey));

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
      status: "active",
      lastSyncedAt,
      lastError: null,
      upserted: instances.length,
      deleted: deletedCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync Google Calendar feed.";
    return setFeedError(supabase, feed, message);
  }
}

// ---------- Internal helpers ----------

function buildListUrl(calendarId: string, window: SyncWindow, pageToken?: string): string {
  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(MAX_RESULTS_PER_PAGE),
    timeMin: window.start.toISOString(),
    timeMax: window.end.toISOString(),
  });

  if (pageToken) {
    params.set("pageToken", pageToken);
  }

  return `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
}

export function mapGoogleEvent(event: GoogleEvent): CalendarEventInstance | null {
  if (!event.id || !event.start) {
    return null;
  }

  const allDay = !!event.start.date && !event.start.dateTime;
  const startAt = resolveDateTime(event.start);
  const endAt = event.end ? resolveDateTime(event.end) : null;

  if (!startAt) {
    return null;
  }

  // For recurring instances, use recurringEventId as externalUid and
  // build instanceKey from recurringEventId|startDateTime for stable dedup.
  // For single events, use event.id for both.
  const externalUid = event.recurringEventId ?? event.id;
  const instanceKey = `${externalUid}|${startAt}`;

  return {
    externalUid,
    instanceKey,
    title: event.summary ?? null,
    description: event.description ?? null,
    location: event.location ?? null,
    startAt,
    endAt,
    allDay,
    raw: serializeGoogleEvent(event),
  };
}

function resolveDateTime(dt: GoogleDateTime): string | null {
  if (dt.dateTime) {
    return dt.dateTime;
  }

  if (dt.date) {
    // All-day: date is YYYY-MM-DD, convert to ISO
    return `${dt.date}T00:00:00Z`;
  }

  return null;
}

function serializeGoogleEvent(event: GoogleEvent): Json {
  return {
    googleEventId: event.id ?? null,
    recurringEventId: event.recurringEventId ?? null,
    summary: event.summary ?? null,
    description: event.description ?? null,
    location: event.location ?? null,
    start: event.start ?? null,
    end: event.end ?? null,
    status: event.status ?? null,
  } as unknown as Json;
}

async function setFeedError(
  supabase: SupabaseClient<Database>,
  feed: CalendarFeedRow,
  message: string
): Promise<SyncResult> {
  await supabase
    .from("calendar_feeds")
    .update({
      status: "error",
      last_error: message,
    })
    .eq("id", feed.id);

  return {
    status: "error",
    lastSyncedAt: null,
    lastError: message,
    upserted: 0,
    deleted: 0,
  };
}

// ---------- Default dependency implementations ----------

async function defaultGetAccessToken(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<string | null> {
  // Dynamic import to avoid circular dependency at module level
  const { getValidAccessToken } = await import("@/lib/google/oauth");
  return getValidAccessToken(supabase, userId);
}

async function defaultCheckAdminRole(
  supabase: SupabaseClient<Database>,
  userId: string,
  orgId: string
): Promise<boolean> {
  const { data: membership } = await supabase
    .from("user_organization_roles")
    .select("role,status")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .maybeSingle();

  return !!membership && membership.status === "active" && membership.role === "admin";
}
