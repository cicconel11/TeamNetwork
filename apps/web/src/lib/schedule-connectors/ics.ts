import type { SupabaseClient } from "@supabase/supabase-js";
import ical from "node-ical";
import { createServiceClient } from "@/lib/supabase/service";
import type { Database } from "@teammeet/types";
import { fetchUrlSafe } from "./fetch";
import type { NormalizedEvent, ScheduleConnector, SyncResult } from "./types";
import { syncScheduleEvents, type SyncWindow } from "./storage";
import { sanitizeEventTitle } from "./sanitize";

const PREVIEW_DAYS_FORWARD = 180;
const PREVIEW_DAYS_BACK = 30;

type IcsEvent = {
  type?: string;
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: Date;
  end?: Date;
  datetype?: string;
  status?: string;
  rrule?: { between: (start: Date, end: Date, inc: boolean) => Date[] };
  recurrences?: Record<string, IcsEvent>;
  exdate?: Record<string, Date>;
  recurrenceid?: Date;
};

export const icsConnector: ScheduleConnector = {
  id: "ics",
  async canHandle(input) {
    const lower = input.url.toLowerCase();
    if (lower.endsWith(".ics") || lower.includes("ical") || lower.includes("webcal")) {
      return { ok: true, confidence: 0.9 };
    }

    const contentType = input.headers?.["content-type"] || input.headers?.["Content-Type"];
    if (contentType && contentType.includes("text/calendar")) {
      return { ok: true, confidence: 0.6 };
    }

    return { ok: false, confidence: 0 };
  },
  async preview({ url, orgId }) {
    const window = buildPreviewWindow();
    const icsText = await fetchUrlSafe(url, { orgId, vendorId: "ics" }).then((result) => result.text);
    const events = expandIcsEvents(icsText, window);
    const sorted = sortEvents(events).slice(0, 20);

    return {
      vendor: "ics",
      title: sorted.length > 0 ? "ICS Schedule" : undefined,
      events: sorted,
    };
  },
  async sync({ sourceId, orgId, url, window }) {
    const supabase = createServiceClient();
    return syncIcsToSource(supabase, { sourceId, orgId, url, window });
  },
};

export async function syncIcsToSource(
  supabase: SupabaseClient<Database>,
  input: { sourceId: string; orgId: string; url: string; window: SyncWindow }
): Promise<SyncResult> {
  const icsText = await fetchUrlSafe(input.url, { orgId: input.orgId, vendorId: "ics" }).then((result) => result.text);
  const events = expandIcsEvents(icsText, input.window);
  const { imported, updated, cancelled } = await syncScheduleEvents(supabase, {
    orgId: input.orgId,
    sourceId: input.sourceId,
    events,
    window: input.window,
  });

  return { imported, updated, cancelled, vendor: "ics" };
}

export function expandIcsEvents(icsText: string, window: SyncWindow): NormalizedEvent[] {
  const parsed = ical.parseICS(icsText);
  const instances = new Map<string, NormalizedEvent>();

  for (const value of Object.values(parsed)) {
    const event = value as IcsEvent | undefined;

    if (!event || event.type !== "VEVENT" || !event.uid) {
      continue;
    }

    if (event.recurrenceid) {
      continue;
    }

    if (event.rrule) {
      const occurrences = event.rrule.between(window.from, window.to, true);
      for (const occurrence of occurrences) {
        const occurrenceKey = occurrence.toISOString();
        if (event.exdate && event.exdate[occurrenceKey]) {
          continue;
        }

        const override = event.recurrences?.[occurrenceKey];
        const instanceEvent = override ?? event;
        const start = override?.start ?? occurrence;
        const end = resolveEventEnd(instanceEvent, event, start);
        const instanceKey = `${event.uid}|${start.toISOString()}`;
        addInstance(instances, buildInstance(instanceEvent, instanceKey, start, end));
      }
      continue;
    }

    if (!event.start) {
      continue;
    }

    if (!isWithinWindow(event.start, window)) {
      continue;
    }

    const externalUid = event.uid;
    addInstance(instances, buildInstance(event, externalUid, event.start, event.end ?? null));
  }

  return Array.from(instances.values());
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

function buildInstance(event: IcsEvent, externalUid: string, start: Date, end: Date | null): NormalizedEvent {
  const allDay = isAllDayEvent(event, start, end);
  const safeEnd = end ?? (allDay ? new Date(start.getTime() + 24 * 60 * 60 * 1000) : new Date(start.getTime() + 60 * 60 * 1000));

  return {
    external_uid: externalUid,
    title: sanitizeEventTitle(event.summary),
    start_at: start.toISOString(),
    end_at: safeEnd.toISOString(),
    location: event.location ?? undefined,
    status: normalizeStatus(event.status),
    raw: {
      uid: event.uid ?? null,
      summary: event.summary ?? null,
      description: event.description ?? null,
      location: event.location ?? null,
      start: start.toISOString(),
      end: safeEnd.toISOString(),
    },
  };
}

function normalizeStatus(status?: string): NormalizedEvent["status"] {
  if (!status) return "confirmed";
  const lower = status.toLowerCase();
  if (lower.includes("cancel")) return "cancelled";
  if (lower.includes("tentative")) return "tentative";
  return "confirmed";
}

function isAllDayEvent(event: IcsEvent, start: Date, end: Date | null) {
  if (event.datetype === "date") return true;
  if (!end) return false;
  return start.getUTCHours() === 0 && start.getUTCMinutes() === 0 && end.getUTCHours() === 0 && end.getUTCMinutes() === 0;
}

function addInstance(map: Map<string, NormalizedEvent>, instance: NormalizedEvent) {
  if (!map.has(instance.external_uid)) {
    map.set(instance.external_uid, instance);
  }
}

function isWithinWindow(start: Date, window: SyncWindow) {
  return start >= window.from && start <= window.to;
}

function sortEvents(events: NormalizedEvent[]) {
  return [...events].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
}
