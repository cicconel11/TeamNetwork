export type CalendarSurfaceView = "events" | "all" | "availability";
export type CalendarEventTimeframe = "upcoming" | "past";

function buildQuery(params: Record<string, string | null | undefined>) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (!value) return;
    query.set(key, value);
  });

  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

export function calendarRootPath(orgSlug: string) {
  return `/${orgSlug}/calendar`;
}

export function calendarViewPath(
  orgSlug: string,
  view: CalendarSurfaceView,
  params: {
    timeframe?: CalendarEventTimeframe;
    type?: string | null;
  } = {}
) {
  return `${calendarRootPath(orgSlug)}${buildQuery({
    view: view === "events" ? null : view,
    timeframe: params.timeframe && params.timeframe !== "upcoming" ? params.timeframe : null,
    type: params.type || null,
  })}`;
}

export function calendarEventsPath(
  orgSlug: string,
  params: {
    timeframe?: CalendarEventTimeframe;
    type?: string | null;
  } = {}
) {
  return calendarViewPath(orgSlug, "events", params);
}

export function calendarAllPath(orgSlug: string) {
  return calendarViewPath(orgSlug, "all");
}

export function calendarAvailabilityPath(orgSlug: string) {
  return calendarViewPath(orgSlug, "availability");
}

export function calendarSourcesPath(orgSlug: string) {
  return `${calendarRootPath(orgSlug)}/sources`;
}

export function calendarMySettingsPath(orgSlug: string) {
  return `${calendarRootPath(orgSlug)}/my-settings`;
}

export function calendarNewSchedulePath(orgSlug: string) {
  return `${calendarRootPath(orgSlug)}/new`;
}

export function calendarNewEventPath(orgSlug: string) {
  return `${calendarRootPath(orgSlug)}/events/new`;
}

export function calendarEventDetailPath(orgSlug: string, eventId: string) {
  return `${calendarRootPath(orgSlug)}/events/${eventId}`;
}

export function calendarEventEditPath(orgSlug: string, eventId: string) {
  return `${calendarEventDetailPath(orgSlug, eventId)}/edit`;
}

