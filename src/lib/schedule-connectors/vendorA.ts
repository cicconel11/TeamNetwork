import { createServiceClient } from "@/lib/supabase/service";
import { fetchUrlSafe, getAllowlistFromEnv } from "./fetch";
import { extractJsonLdEvents, extractTableEvents, hashEventId, type ParsedEvent } from "./html-utils";
import type { NormalizedEvent, ScheduleConnector } from "./types";
import { syncScheduleEvents, type SyncWindow } from "./storage";

const HOST_ENV = "SCHEDULE_VENDOR_A_HOSTS";
const MARKERS = ["sectionxi", "vantage", "athletics"];

export const vendorAConnector: ScheduleConnector = {
  id: "vendorA",
  async canHandle(input) {
    const hostMatches = matchesHost(input.url, getHostAllowlist());
    if (hostMatches) {
      return { ok: true, confidence: 0.75, reason: "host match" };
    }

    const haystack = `${input.url} ${input.html ?? ""}`.toLowerCase();
    if (MARKERS.some((marker) => haystack.includes(marker))) {
      return { ok: true, confidence: 0.55, reason: "marker match" };
    }

    return { ok: false, confidence: 0 };
  },
  async preview({ url }) {
    const { text } = await fetchUrlSafe(url, { requireAllowlist: true, allowlist: resolveAllowlist() });
    const events = normalizeEvents(extractVendorAEvents(text));
    return {
      vendor: "vendorA",
      title: events.length > 0 ? "Schedule" : undefined,
      events: events.slice(0, 20),
      inferredMeta: { source: "vendorA" },
    };
  },
  async sync({ sourceId, orgId, url, window }) {
    const { text } = await fetchUrlSafe(url, { requireAllowlist: true, allowlist: resolveAllowlist() });
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
  const title = typeof event.title === "string" ? event.title : "Event";
  const start = typeof event.start === "string" ? new Date(event.start) : null;
  const end = typeof event.end === "string" ? new Date(event.end) : null;

  if (!start || Number.isNaN(start.getTime())) {
    return null;
  }

  return {
    title,
    start_at: start.toISOString(),
    end_at: end && !Number.isNaN(end.getTime()) ? end.toISOString() : null,
    location: typeof event.location === "string" ? event.location : undefined,
    raw: event,
  };
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

function matchesHost(rawUrl: string, allowed: string[]) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
  } catch {
    return false;
  }
}

function getHostAllowlist() {
  const raw = process.env[HOST_ENV] || "";
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function resolveAllowlist() {
  const vendorAllowlist = getHostAllowlist();
  return vendorAllowlist.length > 0 ? vendorAllowlist : getAllowlistFromEnv();
}

function isWithinWindow(event: NormalizedEvent, window: SyncWindow) {
  const start = new Date(event.start_at);
  return start >= window.from && start <= window.to;
}
