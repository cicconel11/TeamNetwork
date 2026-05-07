import { fetchOutlookCalendarEvents } from "@/lib/calendar/outlookSync";
import type { CalendarEventInstance, SyncWindow as CalSyncWindow } from "@/lib/calendar/syncHelpers";
import { createServiceClient } from "@/lib/supabase/service";
import { syncScheduleEvents, type SyncWindow } from "./storage";
import type { NormalizedEvent, PreviewInput, ScheduleConnector, SyncInput } from "./types";

const PREVIEW_DAYS_FORWARD = 180;
const PREVIEW_DAYS_BACK = 30;

export function mapOutlookInstanceToScheduleEvent(instance: CalendarEventInstance): NormalizedEvent {
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
  const prefix = "outlook://";
  if (!url.startsWith(prefix)) {
    throw new Error(`Invalid Outlook Calendar URL: ${url}`);
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

function toCalWindow(window: SyncWindow): CalSyncWindow {
  return { start: window.from, end: window.to };
}

async function resolveAccessToken(
  input: Pick<SyncInput, "userId" | "supabase" | "getAccessToken">
): Promise<string> {
  if (!input.userId) {
    throw new Error("Outlook Calendar connector requires userId (connected_user_id)");
  }

  const supabase = input.supabase ?? createServiceClient();
  const { getMicrosoftValidAccessToken } = await import("@/lib/microsoft/oauth");
  const getToken = input.getAccessToken ?? getMicrosoftValidAccessToken;
  const token = await getToken(supabase, input.userId);

  if (!token) {
    throw new Error("Unable to obtain valid access token for connected user");
  }

  return token;
}

export const outlookCalendarConnector: ScheduleConnector = {
  id: "outlook_calendar",

  async canHandle({ url }) {
    if (url.startsWith("outlook://")) {
      return { ok: true, confidence: 1.0 };
    }
    return { ok: false, confidence: 0 };
  },

  async preview(input: PreviewInput) {
    const calendarId = parseCalendarId(input.url);
    const accessToken = await resolveAccessToken(input);
    const fetcher = input.fetcher ?? globalThis.fetch;

    const calWindow = toCalWindow(buildPreviewWindow());
    const instances = await fetchOutlookCalendarEvents(accessToken, calendarId, calWindow, fetcher);
    const events = instances.map(mapOutlookInstanceToScheduleEvent);

    const sorted = events
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
      .slice(0, 20);

    return {
      vendor: "outlook_calendar" as const,
      title: "Outlook Calendar",
      events: sorted,
    };
  },

  async sync(input: SyncInput) {
    const calendarId = parseCalendarId(input.url);
    const accessToken = await resolveAccessToken(input);
    const fetcher = input.fetcher ?? globalThis.fetch;
    const supabase = input.supabase ?? createServiceClient();

    const calWindow = toCalWindow(input.window);
    const instances = await fetchOutlookCalendarEvents(accessToken, calendarId, calWindow, fetcher);
    const events = instances.map(mapOutlookInstanceToScheduleEvent);

    const { imported, updated, cancelled } = await syncScheduleEvents(supabase, {
      orgId: input.orgId,
      sourceId: input.sourceId,
      events,
      window: input.window,
    });

    return { imported, updated, cancelled, vendor: "outlook_calendar" as const };
  },
};
