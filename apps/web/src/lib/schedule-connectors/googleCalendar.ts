import { fetchGoogleCalendarEvents } from "@/lib/calendar/googleSync";
import type { CalendarEventInstance, SyncWindow as CalSyncWindow } from "@/lib/calendar/syncHelpers";
import { syncScheduleEvents, type SyncWindow } from "./storage";
import { createServiceClient } from "@/lib/supabase/service";
import type { NormalizedEvent, ScheduleConnector, PreviewInput, SyncInput } from "./types";

const PREVIEW_DAYS_FORWARD = 180;
const PREVIEW_DAYS_BACK = 30;

/**
 * Maps a CalendarEventInstance (from Google sync) to a NormalizedEvent (for schedule storage).
 * Uses instanceKey as external_uid so each recurring instance gets a unique, stable identifier.
 */
export function mapCalendarInstanceToScheduleEvent(instance: CalendarEventInstance): NormalizedEvent {
  return {
    external_uid: instance.instanceKey,
    title: instance.title ?? "",
    start_at: instance.startAt,
    end_at: instance.endAt ?? "",
    location: instance.location ?? undefined,
    status: "confirmed",
    raw: instance.raw ?? undefined,
  };
}

function parseCalendarId(url: string): string {
  // URL format: google://calendarId
  const prefix = "google://";
  if (!url.startsWith(prefix)) {
    throw new Error(`Invalid Google Calendar URL: ${url}`);
  }
  return url.slice(prefix.length);
}

function buildPreviewWindow(): SyncWindow {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - PREVIEW_DAYS_BACK);
  from.setHours(0, 0, 0, 0);

  const to = new Date(now);
  to.setDate(to.getDate() + PREVIEW_DAYS_FORWARD);
  to.setHours(23, 59, 59, 999);

  return { from, to };
}

/** Convert schedule SyncWindow {from,to} to calendar SyncWindow {start,end}. */
function toCalWindow(w: SyncWindow): CalSyncWindow {
  return { start: w.from, end: w.to };
}

async function resolveAccessToken(
  input: Pick<SyncInput, "userId" | "supabase" | "getAccessToken">
): Promise<string> {
  if (!input.userId) {
    throw new Error("Google Calendar connector requires userId (connected_user_id)");
  }

  const supabase = input.supabase ?? createServiceClient();
  const { getValidAccessToken } = await import("@/lib/google/oauth");
  const getToken = input.getAccessToken ?? getValidAccessToken;
  const token = await getToken(supabase, input.userId);

  if (!token) {
    throw new Error("Unable to obtain valid access token for connected user");
  }

  return token;
}

export const googleCalendarConnector: ScheduleConnector = {
  id: "google_calendar",

  async canHandle({ url }) {
    if (url.startsWith("google://")) {
      return { ok: true, confidence: 1.0 };
    }
    return { ok: false, confidence: 0 };
  },

  async preview(input: PreviewInput) {
    const calendarId = parseCalendarId(input.url);
    const accessToken = await resolveAccessToken(input);
    const fetcher = input.fetcher ?? globalThis.fetch;

    const calWindow = toCalWindow(buildPreviewWindow());
    const instances = await fetchGoogleCalendarEvents(accessToken, calendarId, calWindow, fetcher);
    const events = instances.map(mapCalendarInstanceToScheduleEvent);

    const sorted = events
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
      .slice(0, 20);

    return {
      vendor: "google_calendar" as const,
      title: "Google Calendar",
      events: sorted,
    };
  },

  async sync(input: SyncInput) {
    const calendarId = parseCalendarId(input.url);
    const accessToken = await resolveAccessToken(input);
    const fetcher = input.fetcher ?? globalThis.fetch;
    const supabase = input.supabase ?? createServiceClient();

    const calWindow = toCalWindow(input.window);
    const instances = await fetchGoogleCalendarEvents(accessToken, calendarId, calWindow, fetcher);
    const events = instances.map(mapCalendarInstanceToScheduleEvent);

    const { imported, updated, cancelled } = await syncScheduleEvents(supabase, {
      orgId: input.orgId,
      sourceId: input.sourceId,
      events,
      window: input.window,
    });

    return { imported, updated, cancelled, vendor: "google_calendar" as const };
  },
};
