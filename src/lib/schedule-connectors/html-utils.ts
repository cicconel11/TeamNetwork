import { createHash } from "node:crypto";
import { load } from "cheerio";

export type ParsedEvent = {
  title: string;
  start_at: string;
  end_at: string | null;
  location?: string;
  status?: "confirmed" | "cancelled" | "tentative";
  raw?: unknown;
};

export function extractJsonLdEvents(html: string): ParsedEvent[] {
  const $ = load(html);
  const events: ParsedEvent[] = [];

  $("script[type='application/ld+json']").each((_, element) => {
    const text = $(element).text();
    if (!text) return;

    try {
      const parsed = JSON.parse(text);
      const candidates = collectJsonLdObjects(parsed);
      for (const obj of candidates) {
        if (!isEventType(obj)) continue;
        const event = jsonLdToEvent(obj);
        if (event) events.push(event);
      }
    } catch {
      return;
    }
  });

  return events;
}

export function extractTableEvents(html: string): ParsedEvent[] {
  const $ = load(html);
  const events: ParsedEvent[] = [];
  const tables = $("table");

  tables.each((_, table) => {
    const headerCells = $(table).find("thead th");
    const headers = headerCells
      .map((_, cell) => $(cell).text().trim().toLowerCase())
      .get();

    const dateIndex = headers.findIndex((h) => h.includes("date"));
    const timeIndex = headers.findIndex((h) => h.includes("time"));
    const titleIndex = headers.findIndex((h) => h.includes("opponent") || h.includes("event") || h.includes("match"));
    const locationIndex = headers.findIndex((h) => h.includes("location") || h.includes("site") || h.includes("facility") || h.includes("venue"));
    const homeIndex = headers.findIndex((h) => h.includes("home"));
    const awayIndex = headers.findIndex((h) => h.includes("away"));
    const sportIndex = headers.findIndex((h) => h.includes("sport"));
    const genderIndex = headers.findIndex((h) => h.includes("gender"));
    const eventTypeIndex = headers.findIndex((h) => h.includes("event type"));

    $(table)
      .find("tbody tr")
      .each((_, row) => {
        const cells = $(row)
          .find("td")
          .map((_, cell) => $(cell).text().trim())
          .get();

        if (cells.length === 0) return;

        const dateText = dateIndex >= 0 ? cells[dateIndex] : cells[0];
        const timeText = timeIndex >= 0 ? cells[timeIndex] : undefined;
        const titleText = titleIndex >= 0 ? cells[titleIndex] : cells[1] || "";
        const locationText = locationIndex >= 0 ? cells[locationIndex] : undefined;
        const homeTeam = homeIndex >= 0 ? cells[homeIndex] : "";
        const awayTeam = awayIndex >= 0 ? cells[awayIndex] : "";
        const sportText = sportIndex >= 0 ? cells[sportIndex] : "";
        const genderText = genderIndex >= 0 ? cells[genderIndex] : "";
        const eventTypeText = eventTypeIndex >= 0 ? cells[eventTypeIndex] : "";

        const start = parseDateTime(dateText, timeText);
        if (!start) return;

        const sportLabel = [genderText, sportText].filter(Boolean).join(" ");
        const matchup = [awayTeam, homeTeam].filter(Boolean).join(" vs ");
        const fallbackTitle = [sportLabel, matchup || eventTypeText].filter(Boolean).join(" - ");
        const finalTitle = titleText || fallbackTitle || "Event";

        const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
        events.push({
          title: finalTitle,
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          location: locationText,
          raw: { dateText, timeText, titleText, locationText },
        });
      });
  });

  return events;
}

export function parseDateTime(dateText: string, timeText?: string) {
  let normalizedDate = dateText.replace(/\s+/g, " ").trim();
  normalizedDate = normalizedDate.replace(/(\d{4})(\d{1,2}:\d{2}\s*(?:am|pm)?)/i, "$1 $2");
  normalizedDate = normalizedDate.replace(/(\d{1,2}:\d{2})(am|pm)\b/i, "$1 $2");
  const normalizedTime = timeText?.replace(/\s+/g, " ").trim();
  const dateHasTime = /\d{1,2}:\d{2}\s*(am|pm)?/i.test(normalizedDate);
  const sameText = normalizedTime && normalizedTime === normalizedDate;
  const combined = normalizedTime && !dateHasTime && !sameText
    ? `${normalizedDate} ${normalizedTime}`
    : normalizedDate;
  const parsed = new Date(combined);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

export function findIcsLink(html: string, baseUrl: string) {
  const $ = load(html);
  const link = $("a[href$='.ics'], a[href*='.ics'], link[href$='.ics']").first();
  const href = link.attr("href");
  if (!href) return null;

  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

export function hashEventId(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

function collectJsonLdObjects(parsed: unknown): unknown[] {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed.flatMap((item) => collectJsonLdObjects(item));
  if (typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj["@graph"])) {
      return collectJsonLdObjects(obj["@graph"]);
    }
    return [obj];
  }
  return [];
}

function isEventType(obj: unknown): obj is Record<string, unknown> {
  if (!obj || typeof obj !== "object") return false;
  const record = obj as Record<string, unknown>;
  const type = record["@type"];
  if (Array.isArray(type)) {
    return type.includes("Event");
  }
  return type === "Event";
}

function jsonLdToEvent(obj: Record<string, unknown>): ParsedEvent | null {
  const title = typeof obj.name === "string" ? obj.name : "Event";
  const startDate = typeof obj.startDate === "string" ? obj.startDate : null;
  if (!startDate) return null;

  const endDate = typeof obj.endDate === "string" ? obj.endDate : null;
  const location = resolveJsonLdLocation(obj.location);
  const status = resolveJsonLdStatus(obj.eventStatus);

  return {
    title,
    start_at: new Date(startDate).toISOString(),
    end_at: endDate ? new Date(endDate).toISOString() : null,
    location,
    status,
    raw: obj,
  };
}

function resolveJsonLdLocation(location: unknown) {
  if (!location) return undefined;
  if (typeof location === "string") return location;
  if (typeof location === "object") {
    const loc = location as Record<string, unknown>;
    if (typeof loc.name === "string") return loc.name;
    if (typeof loc.address === "string") return loc.address;
    if (typeof loc.address === "object") {
      const address = loc.address as Record<string, unknown>;
      if (typeof address.streetAddress === "string") return address.streetAddress;
    }
  }
  return undefined;
}

function resolveJsonLdStatus(status: unknown): ParsedEvent["status"] {
  if (typeof status !== "string") return undefined;
  const lower = status.toLowerCase();
  if (lower.includes("cancel")) return "cancelled";
  if (lower.includes("tentative")) return "tentative";
  return "confirmed";
}
