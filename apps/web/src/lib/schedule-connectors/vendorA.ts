import { createServiceClient } from "@/lib/supabase/service";
import { fetchUrlSafe } from "./fetch";
import { extractJsonLdEvents, extractTableEvents, findDigitalsportsScheduleUrl, hashEventId, type ParsedEvent } from "./html-utils";
import type { NormalizedEvent, ScheduleConnector } from "./types";
import { syncScheduleEvents, type SyncWindow } from "./storage";
import { isHostAllowed } from "@/lib/schedule-security/allowlist";
import { sanitizeEventTitle, getTitleForHash } from "./sanitize";

const MARKERS = ["sectionxi", "vantage", "athletics"];

export const vendorAConnector: ScheduleConnector = {
  id: "vendorA",
  async canHandle(input) {
    const host = safeHost(input.url);
    if (host && (await isHostAllowed(host, "vendorA"))) {
      return { ok: true, confidence: 0.75, reason: "allowlist match" };
    }

    const haystack = `${input.url} ${input.html ?? ""}`.toLowerCase();
    if (MARKERS.some((marker) => haystack.includes(marker))) {
      return { ok: true, confidence: 0.55, reason: "marker match" };
    }

    return { ok: false, confidence: 0 };
  },
  async preview({ url, orgId }) {
    const { text } = await fetchScheduleHtml(url, orgId);
    const events = normalizeEvents(extractVendorAEvents(text));
    return {
      vendor: "vendorA",
      title: events.length > 0 ? "Schedule" : undefined,
      events: events.slice(0, 20),
      inferredMeta: { source: "vendorA" },
    };
  },
  async sync({ sourceId, orgId, url, window }) {
    const { text } = await fetchScheduleHtml(url, orgId);
    const events = normalizeEvents(extractVendorAEvents(text)).filter((event) => isWithinWindow(event, window));
    const supabase = createServiceClient();
    const { imported, updated, cancelled } = await syncScheduleEvents(supabase, {
      orgId,
      sourceId,
      events,
      window,
  });
  return { imported, updated, cancelled, vendor: "vendorA" };
  },
};

async function fetchScheduleHtml(url: string, orgId: string) {
  const primary = await fetchUrlSafe(url, { orgId, vendorId: "vendorA" });
  const embeddedUrl = findDigitalsportsScheduleUrl(primary.text, url);
  if (!embeddedUrl) {
    return { text: primary.text };
  }

  const embedded = await fetchUrlSafe(embeddedUrl, { orgId, vendorId: "digitalsports" });
  return { text: embedded.text };
}

function extractVendorAEvents(html: string): ParsedEvent[] {
  const jsonLd = extractJsonLdEvents(html);
  if (jsonLd.length > 0) return jsonLd;

  const embedded = extractEmbeddedEvents(html);
  if (embedded.length > 0) return embedded;

  return extractTableEvents(html);
}

function extractEmbeddedEvents(html: string): ParsedEvent[] {
  const patterns = [
    /window\.__SCHEDULE_DATA__\s*=\s*(\{[\s\S]*?\});/,
    /window\.__DATA__\s*=\s*(\{[\s\S]*?\});/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    const jsonText = match[1];
    try {
      const parsed = JSON.parse(jsonText) as { events?: Array<Record<string, unknown>> };
      if (Array.isArray(parsed.events)) {
        return parsed.events.flatMap(normalizeEmbeddedEvent).filter(Boolean) as ParsedEvent[];
      }
    } catch {
      continue;
    }
  }

  return [];
}

function normalizeEmbeddedEvent(event: Record<string, unknown>): ParsedEvent | null {
  const rawTitle = typeof event.title === "string" ? event.title : "";
  const title = sanitizeEventTitle(rawTitle);
  const start = typeof event.start === "string" ? new Date(event.start) : null;
  const end = typeof event.end === "string" ? new Date(event.end) : null;

  if (!start || Number.isNaN(start.getTime())) {
    return null;
  }

  return {
    title,
    rawTitle,
    start_at: start.toISOString(),
    end_at: end && !Number.isNaN(end.getTime()) ? end.toISOString() : null,
    location: typeof event.location === "string" ? event.location : undefined,
    raw: event,
  };
}

function normalizeEvents(events: ParsedEvent[]): NormalizedEvent[] {
  return events.map((event) => {
    const endAt = event.end_at ?? new Date(new Date(event.start_at).getTime() + 2 * 60 * 60 * 1000).toISOString();
    const hashInput = `${getTitleForHash(event.rawTitle, event.title)}|${event.start_at}|${event.location ?? ""}`;

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
