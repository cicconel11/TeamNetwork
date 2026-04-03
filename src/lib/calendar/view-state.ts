import type { CalendarEventTimeframe, CalendarSurfaceView } from "./routes";

export function parseCalendarView(view: string | undefined): CalendarSurfaceView {
  if (view === "all" || view === "availability") {
    return view;
  }

  return "events";
}

export function parseCalendarEventTimeframe(timeframe: string | undefined): CalendarEventTimeframe {
  return timeframe === "past" ? "past" : "upcoming";
}

