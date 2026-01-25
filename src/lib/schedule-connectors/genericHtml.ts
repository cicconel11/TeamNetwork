import { fetchUrlSafe, getAllowlistFromEnv } from "./fetch";
import { extractTableEvents, hashEventId, type ParsedEvent } from "./html-utils";
import type { NormalizedEvent, ScheduleConnector } from "./types";
import { syncScheduleEvents, type SyncWindow } from "./storage";
import { createServiceClient } from "@/lib/supabase/service";

export const genericHtmlConnector: ScheduleConnector = {
  id: "generic_html",
  async canHandle(input) {
    const allowlist = getAllowlistFromEnv();
    if (!isAllowlisted(input.url, allowlist)) {
      return { ok: false, confidence: 0, reason: "not allowlisted" };
    }

    if (!input.html) {
      return { ok: false, confidence: 0, reason: "no html" };
    }

    const events = extractTableEvents(input.html);
    if (events.length === 0) {
      return { ok: false, confidence: 0, reason: "no table events" };
    }

    return { ok: true, confidence: 0.4, reason: "table match" };
  },
  async preview({ url }) {
    const { text } = await fetchUrlSafe(url, { requireAllowlist: true });
    const events = normalizeEvents(extractTableEvents(text));
    return {
      vendor: "generic_html",
      title: events.length > 0 ? "Schedule" : undefined,
      events: events.slice(0, 20),
      inferredMeta: { source: "generic_html" },
    };
  },
  async sync({ sourceId, orgId, url, window }) {
    const { text } = await fetchUrlSafe(url, { requireAllowlist: true });
    const events = normalizeEvents(extractTableEvents(text)).filter((event) => isWithinWindow(event, window));
    const supabase = createServiceClient();
    const { imported, updated, cancelled } = await syncScheduleEvents(supabase, {
      orgId,
      sourceId,
      events,
      window,
    });
    return { imported, updated, cancelled, vendor: "generic_html" };
  },
};

function normalizeEvents(events: ParsedEvent[]): NormalizedEvent[] {
  return events.map((event) => {
    const endAt = event.end_at ?? new Date(new Date(event.start_at).getTime() + 2 * 60 * 60 * 1000).toISOString();
    const hashInput = `${event.title}|${event.start_at}|${event.location ?? ""}`;

    return {
      external_uid: hashEventId(hashInput),
      title: event.title,
      start_at: event.start_at,
      end_at: endAt,
      location: event.location,
      status: event.status ?? "confirmed",
      raw: event.raw,
    };
  });
}

function isAllowlisted(rawUrl: string, allowlist: string[]) {
  if (allowlist.length === 0) return false;
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return allowlist.some((entry) => host === entry || host.endsWith(`.${entry}`));
  } catch {
    return false;
  }
}

function isWithinWindow(event: NormalizedEvent, window: SyncWindow) {
  const start = new Date(event.start_at);
  return start >= window.from && start <= window.to;
}
