import type { CalendarEventTimeframe, CalendarSurfaceView, CalendarSubview } from "./routes";

export function parseCalendarView(view: string | undefined): CalendarSurfaceView {
  if (view === "availability") {
    return view;
  }

  // Backward compatibility: "events" and "all" are treated as calendar
  return "calendar";
}

export function parseCalendarSubview(subview: string | undefined): CalendarSubview {
  return subview === "list" ? "list" : "grid";
}

export function parseCalendarEventTimeframe(timeframe: string | undefined): CalendarEventTimeframe {
  return timeframe === "past" ? "past" : "upcoming";
}

