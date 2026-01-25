import { fetchUrlSafe } from "./fetch";
import { extractTableEvents, hashEventId, type ParsedEvent } from "./html-utils";
import type { NormalizedEvent, ScheduleConnector } from "./types";
import { syncScheduleEvents, type SyncWindow } from "./storage";
import { createServiceClient } from "@/lib/supabase/service";
import { isHostAllowed } from "@/lib/schedule-security/allowlist";

export const genericHtmlConnector: ScheduleConnector = {
  id: "generic_html",
  async canHandle(input) {
    const host = safeHost(input.url);
    if (!host || !(await isHostAllowed(host))) {
      return { ok: false, confidence: 0, reason: "not allowlisted" };
    }

    if (!input.html) {
      return { ok: false, confidence: 0, reason: "no html" };
    }

    const embeddedUrl = findDigitalsportsScheduleUrl(input.html, input.url);
    if (embeddedUrl) {
      return { ok: true, confidence: 0.6, reason: "digitalsports embed" };
    }

    const events = extractTableEvents(input.html);
    if (events.length === 0) {
      return { ok: false, confidence: 0, reason: "no table events" };
    }

    return { ok: true, confidence: 0.4, reason: "table match" };
  },
  async preview({ url, orgId }) {
    const { text } = await fetchScheduleHtml(url, orgId);
    const events = normalizeEvents(extractTableEvents(text));
    return {
      vendor: "generic_html",
      title: events.length > 0 ? "Schedule" : undefined,
      events: events.slice(0, 20),
      inferredMeta: { source: "generic_html" },
    };
  },
  async sync({ sourceId, orgId, url, window }) {
    const { text } = await fetchScheduleHtml(url, orgId);
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

async function fetchScheduleHtml(url: string, orgId: string) {
  const primary = await fetchUrlSafe(url, { orgId, vendorId: "generic_html" });
  const embeddedUrl = findDigitalsportsScheduleUrl(primary.text, url);
  if (!embeddedUrl) {
    return { text: primary.text };
  }

  const embedded = await fetchUrlSafe(embeddedUrl, { orgId, vendorId: "generic_html" });
  return { text: embedded.text };
}

function findDigitalsportsScheduleUrl(html: string, baseUrl: string) {
  const match = html.match(/https?:\/\/digitalsports\.com\/pages\/api\/schedule-list\.php\??/i);
  if (!match) return null;

  const base = new URL(baseUrl);
  const query = base.searchParams.toString();
  const baseLink = match[0].endsWith("?") ? match[0] : `${match[0]}?`;
  return query ? `${baseLink}${query}` : baseLink.replace(/\?$/, "");
}

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

function safeHost(rawUrl: string) {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isWithinWindow(event: NormalizedEvent, window: SyncWindow) {
  const start = new Date(event.start_at);
  return start >= window.from && start <= window.to;
}
