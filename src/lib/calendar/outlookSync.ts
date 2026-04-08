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

const MAX_RESULTS_PER_PAGE = 250;

// ---------- Microsoft Graph response types ----------

type OutlookDateTime = {
  dateTime?: string;
  timeZone?: string;
};

type OutlookEvent = {
  id?: string;
  seriesMasterId?: string;
  subject?: string;
  bodyPreview?: string;
  location?: { displayName?: string };
  start?: OutlookDateTime;
  end?: OutlookDateTime;
  isAllDay?: boolean;
};

type OutlookEventsResponse = {
  value?: OutlookEvent[];
  "@odata.nextLink"?: string;
};

// ---------- Public API ----------

export async function fetchOutlookCalendarEvents(
  accessToken: string,
  calendarId: string,
  window: SyncWindow,
  fetcher: typeof fetch = globalThis.fetch
): Promise<CalendarEventInstance[]> {
  const instances: CalendarEventInstance[] = [];

  const params = new URLSearchParams({
    startDateTime: window.start.toISOString(),
    endDateTime: window.end.toISOString(),
    $top: String(MAX_RESULTS_PER_PAGE),
    $select: "id,seriesMasterId,subject,bodyPreview,location,start,end,isAllDay",
  });

  let url: string | undefined =
    `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${params.toString()}`;

  do {
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Microsoft Graph API error (${response.status})`);
    }

    const data: OutlookEventsResponse = await response.json();

    for (const event of data.value ?? []) {
      const instance = mapOutlookEvent(event);
      if (instance) {
        instances.push(instance);
      }
    }

    // Paginate: use nextLink verbatim (never reconstruct)
    url = data["@odata.nextLink"];
  } while (url);

  return instances;
}

export type SyncOutlookOptions = {
  window?: SyncWindow;
  fetcher?: typeof fetch;
  now?: () => Date;
  /** Dependency-injected: return a valid access token for the connected user, or null */
  getAccessToken?: (supabase: SupabaseClient<Database>, userId: string) => Promise<string | null>;
  /** Dependency-injected: check if connected user still has admin role */
  checkAdminRole?: (supabase: SupabaseClient<Database>, userId: string, orgId: string) => Promise<boolean>;
};

export async function syncOutlookCalendarFeed(
  supabase: SupabaseClient<Database>,
  feed: CalendarFeedRow,
  options?: SyncOutlookOptions
): Promise<SyncResult> {
  const window = options?.window ?? getDefaultSyncWindow(options?.now?.() ?? new Date());
  const fetcher = options?.fetcher ?? globalThis.fetch;
  const now = options?.now?.() ?? new Date();
  const getAccessToken = options?.getAccessToken ?? defaultGetAccessToken;
  const checkAdminRole = options?.checkAdminRole ?? defaultCheckAdminRole;

  const connectedUserId = feed.connected_user_id;
  const externalCalendarId = feed.external_calendar_id;

  if (!connectedUserId || !externalCalendarId) {
    return setFeedError(supabase, feed, "Missing connected_user_id or external_calendar_id");
  }

  // Check admin role at sync time (only for org-scoped feeds)
  if (feed.organization_id && feed.scope === "org") {
    const isAdmin = await checkAdminRole(supabase, connectedUserId, feed.organization_id);
    if (!isAdmin) {
      return setFeedError(supabase, feed, "Connected user no longer has admin access");
    }
  }

  const accessToken = await getAccessToken(supabase, connectedUserId);
  if (!accessToken) {
    return setFeedError(supabase, feed, "Unable to obtain valid access token for connected user");
  }

  try {
    const instances = await fetchOutlookCalendarEvents(accessToken, externalCalendarId, window, fetcher);
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
    const message = error instanceof Error ? error.message : "Failed to sync Outlook Calendar feed.";
    return setFeedError(supabase, feed, message);
  }
}

// ---------- Internal helpers ----------

export function mapOutlookEvent(event: OutlookEvent): CalendarEventInstance | null {
  if (!event.id || !event.start) {
    return null;
  }

  const allDay = event.isAllDay === true;

  // For recurring events, instanceKey includes seriesMasterId + start time
  // For single events, instanceKey is just the event id
  const externalUid = event.seriesMasterId ?? event.id;
  const startAt = resolveDateTime(event.start);

  if (!startAt) {
    return null;
  }

  const instanceKey = event.seriesMasterId
    ? `${externalUid}|${startAt}`
    : event.id;

  const endAt = event.end ? resolveDateTime(event.end) : null;

  return {
    externalUid,
    instanceKey,
    title: event.subject ?? "(No title)",
    description: event.bodyPreview ?? null,
    location: event.location?.displayName ?? null,
    startAt,
    endAt,
    allDay,
    raw: serializeOutlookEvent(event),
  };
}

function resolveDateTime(dt: OutlookDateTime): string | null {
  if (dt.dateTime) {
    // Graph returns ISO 8601 datetimes without Z — normalize to UTC representation
    const d = new Date(dt.dateTime);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function serializeOutlookEvent(event: OutlookEvent): Json {
  return {
    outlookEventId: event.id ?? null,
    seriesMasterId: event.seriesMasterId ?? null,
    subject: event.subject ?? null,
    bodyPreview: event.bodyPreview ?? null,
    location: event.location?.displayName ?? null,
    start: event.start ?? null,
    end: event.end ?? null,
    isAllDay: event.isAllDay ?? null,
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
  const { getMicrosoftValidAccessToken } = await import("@/lib/microsoft/oauth");
  return getMicrosoftValidAccessToken(supabase, userId);
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
