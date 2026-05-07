import { createServiceClient } from "@/lib/supabase/service";
import { fetchUrlSafe } from "./fetch";
import { extractBalancedJson, extractJsonLdEvents, extractTableEvents, findIcsLink, hashEventId, type ParsedEvent } from "./html-utils";
import type { NormalizedEvent, ScheduleConnector } from "./types";
import { syncScheduleEvents } from "./storage";
import { icsConnector, syncIcsToSource } from "./ics";
import { isHostAllowed } from "@/lib/schedule-security/allowlist";
import { sanitizeEventTitle, getTitleForHash } from "./sanitize";
import { debugLog } from "@/lib/debug";

const MARKERS = ["chsaa", "sidearm", "sidearm sports", "athletics"];

export const vendorBConnector: ScheduleConnector = {
  id: "vendorB",
  async canHandle(input) {
    const host = safeHost(input.url);
    if (host && (await isHostAllowed(host, "vendorB"))) {
      return { ok: true, confidence: 0.75, reason: "allowlist match" };
    }

    const haystack = `${input.url} ${input.html ?? ""}`.toLowerCase();
    if (MARKERS.some((marker) => haystack.includes(marker))) {
      return { ok: true, confidence: 0.5, reason: "marker match" };
    }

    return { ok: false, confidence: 0 };
  },
  async preview({ url, orgId }) {
    const { text } = await fetchUrlSafe(url, { orgId, vendorId: "vendorB" });
    const icsUrl = findIcsLink(text, url);
    if (icsUrl) {
      const icsPreview = await icsConnector.preview({ url: icsUrl, orgId });
      return { ...icsPreview, vendor: "vendorB", inferredMeta: { source: "vendorB", icsUrl } };
    }

    const events = normalizeEvents(extractVendorBEvents(text));
    return {
      vendor: "vendorB",
      title: events.length > 0 ? "Schedule" : undefined,
      events: events.slice(0, 20),
      inferredMeta: { source: "vendorB" },
    };
  },
  async sync({ sourceId, orgId, url, window }) {
    const { text } = await fetchUrlSafe(url, { orgId, vendorId: "vendorB" });
    const icsUrl = findIcsLink(text, url);
    if (icsUrl) {
      const supabase = createServiceClient();
      const result = await syncIcsToSource(supabase, { sourceId, orgId, url: icsUrl, window });
      return { ...result, vendor: "vendorB" };
    }

    const events = normalizeEvents(extractVendorBEvents(text));
    const supabase = createServiceClient();
    const { imported, updated, cancelled } = await syncScheduleEvents(supabase, {
      orgId,
      sourceId,
      events,
      window,
    });
    return { imported, updated, cancelled, vendor: "vendorB" };
  },
};

function extractVendorBEvents(html: string): ParsedEvent[] {
  const jsonLd = extractJsonLdEvents(html);
  if (jsonLd.length > 0) {
    debugLog("vendorB", "extraction method: JSON-LD", { eventCount: jsonLd.length });
    return jsonLd;
  }

  const embedded = extractEmbeddedEvents(html);
  if (embedded.length > 0) {
    debugLog("vendorB", "extraction method: embedded JS", { eventCount: embedded.length });
    return embedded;
  }

  const table = extractTableEvents(html);
  debugLog("vendorB", "extraction method: HTML table", { eventCount: table.length });
  return table;
}

function extractEmbeddedEvents(html: string): ParsedEvent[] {
  const prefixes = [
    /window\.__INITIAL_STATE__\s*=\s*/,
    /window\.__SIDARM_DATA__\s*=\s*/,
  ];

  for (const prefix of prefixes) {
    const parsed = extractBalancedJson(html, prefix) as { events?: Array<Record<string, unknown>> } | null;
    if (!parsed) continue;
    if (Array.isArray(parsed.events)) {
      return parsed.events.flatMap(normalizeEmbeddedEvent).filter(Boolean) as ParsedEvent[];
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
    const rowSuffix = event.rowIndex != null ? `|${event.rowIndex}` : "";
    const hashInput = `${getTitleForHash(event.rawTitle, event.title)}|${event.start_at}|${event.location ?? ""}${rowSuffix}`;

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

