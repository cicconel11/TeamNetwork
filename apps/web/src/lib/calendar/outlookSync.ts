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
const MICROSOFT_GRAPH_BASE = "https://graph.microsoft.com/";
const ISO_WITH_OFFSET_REGEX = /([zZ]|[+-]\d{2}:\d{2})$/;
const FLOATING_DATETIME_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?$/;
const OUTLOOK_TIMEZONE_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();
const MICROSOFT_TIMEZONE_TO_IANA: Record<string, string> = {
  UTC: "UTC",
  "Dateline Standard Time": "Etc/GMT+12",
  "UTC-11": "Etc/GMT+11",
  "Aleutian Standard Time": "America/Adak",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Alaskan Standard Time": "America/Anchorage",
  "Pacific Standard Time": "America/Los_Angeles",
  "Mountain Standard Time": "America/Denver",
  "US Mountain Standard Time": "America/Phoenix",
  "Central Standard Time": "America/Chicago",
  "Eastern Standard Time": "America/New_York",
  "Atlantic Standard Time": "America/Halifax",
  "Newfoundland Standard Time": "America/St_Johns",
  "GMT Standard Time": "Europe/London",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Romance Standard Time": "Europe/Paris",
  "Turkey Standard Time": "Europe/Istanbul",
  "Russian Standard Time": "Europe/Moscow",
  "Arabian Standard Time": "Asia/Dubai",
  "India Standard Time": "Asia/Kolkata",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "New Zealand Standard Time": "Pacific/Auckland",
};

/**
 * Validates that a nextLink URL is safe to follow.
 * Only allows URLs from Microsoft Graph to prevent SSRF attacks.
 */
function isValidGraphNextLink(nextLink: string | undefined): boolean {
    if (!nextLink) return false;
    return nextLink.startsWith(MICROSOFT_GRAPH_BASE);
}

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
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.timezone="UTC"',
      },
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

    // Paginate: use nextLink verbatim (never reconstruct), but validate hostname for SSRF protection
    const nextLink = data["@odata.nextLink"];
    if (isValidGraphNextLink(nextLink)) {
      url = nextLink;
    } else if (nextLink) {
      // nextLink points to an unexpected host — log and stop pagination
      console.error("[outlook-sync] Unexpected nextLink host, stopping pagination", {
        nextLink: nextLink.slice(0, 100),
      });
      break;
    } else {
      url = undefined;
    }
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
  const startAt = resolveOutlookDateTime(event.start);

  if (!startAt) {
    return null;
  }

  const instanceKey = event.seriesMasterId
    ? `${externalUid}|${startAt}`
    : event.id;

  const endAt = event.end ? resolveOutlookDateTime(event.end) : null;

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

export function resolveOutlookDateTime(dt: OutlookDateTime): string | null {
  if (!dt.dateTime) {
    return null;
  }

  if (ISO_WITH_OFFSET_REGEX.test(dt.dateTime)) {
    const parsed = new Date(dt.dateTime);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const timeZone = normalizeOutlookTimeZone(dt.timeZone);
  if (!timeZone) {
    return null;
  }

  return floatingDateTimeToUtcIso(dt.dateTime, timeZone);
}

function normalizeOutlookTimeZone(timeZone?: string): string | null {
  if (!timeZone) {
    return null;
  }

  const mappedTimeZone = MICROSOFT_TIMEZONE_TO_IANA[timeZone] ?? timeZone;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: mappedTimeZone });
    return mappedTimeZone;
  } catch {
    return null;
  }
}

function floatingDateTimeToUtcIso(dateTime: string, timeZone: string): string | null {
  const match = dateTime.match(FLOATING_DATETIME_REGEX);
  if (!match) {
    return null;
  }

  const [
    ,
    yearStr,
    monthStr,
    dayStr,
    hourStr,
    minuteStr,
    secondStr = "0",
    fractionStr = "",
  ] = match;

  const parts = {
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
    hour: Number(hourStr),
    minute: Number(minuteStr),
    second: Number(secondStr),
    millisecond: fractionStr ? Number(fractionStr.padEnd(3, "0").slice(0, 3)) : 0,
  };

  const desiredLocalMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );

  const roughUtc = new Date(desiredLocalMs);
  const offsetMs = getTimezoneOffsetMs(roughUtc, timeZone);
  const correctedUtc = new Date(desiredLocalMs - offsetMs);
  const verifiedOffsetMs = getTimezoneOffsetMs(correctedUtc, timeZone);
  const finalUtc = verifiedOffsetMs === offsetMs
    ? correctedUtc
    : new Date(desiredLocalMs - verifiedOffsetMs);

  return finalUtc.toISOString();
}

function getTimezoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = getOutlookTimeZoneFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  const hourValue = value("hour") === "24" ? "00" : value("hour");

  const localUtc = Date.UTC(
    Number(value("year")),
    Number(value("month")) - 1,
    Number(value("day")),
    Number(hourValue),
    Number(value("minute")),
    Number(value("second")),
    0,
  );

  return localUtc - date.getTime();
}

function getOutlookTimeZoneFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = OUTLOOK_TIMEZONE_FORMATTER_CACHE.get(timeZone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  OUTLOOK_TIMEZONE_FORMATTER_CACHE.set(timeZone, formatter);
  return formatter;
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
