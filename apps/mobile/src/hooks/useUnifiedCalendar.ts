import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useRequestTracker } from "@/hooks/useRequestTracker";
import { showToast } from "@/components/ui/Toast";
import * as sentry from "@/lib/analytics/sentry";
import { formatShortWeekdayDate } from "@/lib/date-format";
import type { AcademicSchedule } from "@teammeet/types";

const STALE_TIME_MS = 30_000; // 30 seconds
const DEFAULT_WINDOW_DAYS = 60;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CalendarSourceType = "event" | "schedule";

export type CalendarFilterSource = "all" | "event" | "schedule";

export interface UnifiedCalendarItem {
  /** Stable key, prefixed by source ("event:uuid" or "schedule:uuid:YYYY-MM-DD") */
  id: string;
  title: string;
  /** ISO timestamp */
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  sourceType: CalendarSourceType;
  /** Display label, e.g. "Team Event" or "My Schedule" */
  sourceName: string;
  /** Event type for color mapping (null for schedules) */
  eventType: string | null;
  /** Present when sourceType === "event" */
  eventId?: string;
  /** Present when sourceType === "schedule" */
  scheduleId?: string;
}

export interface CalendarDateGroup {
  /** ISO date key like "2026-04-08" */
  dateKey: string;
  /** Display label like "Today", "Tomorrow", "Mon, Apr 12" */
  label: string;
  items: UnifiedCalendarItem[];
}

export type CalendarViewMode = "month" | "week" | "3day" | "day" | "list";

export interface UseUnifiedCalendarReturn {
  /** All items, chronologically sorted, no filter applied */
  items: UnifiedCalendarItem[];
  /** Items grouped by date, filter applied */
  groups: CalendarDateGroup[];
  /** Flat items, filter applied */
  filteredItems: UnifiedCalendarItem[];
  loading: boolean;
  error: string | null;
  activeSource: CalendarFilterSource;
  setActiveSource: (source: CalendarFilterSource) => void;
  viewMode: CalendarViewMode;
  setViewMode: (mode: CalendarViewMode) => void;
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
  refetch: () => Promise<void>;
  refetchIfStale: () => void;
}

/** Minimal event row shape — local to avoid coupling with useEvents.ts */
export interface EventRow {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  location: string | null;
  event_type: string | null;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Format a Date as a local YYYY-MM-DD key. */
export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Parse a date-only string ("YYYY-MM-DD") as a local Date at midnight. */
function parseDateOnly(dateString: string): Date {
  const datePart = dateString.split("T")[0];
  const [year, month, day] = datePart.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

/** Combine a local Date (date part) with an "HH:MM" or "HH:MM:SS" time. */
function combineDateAndTime(date: Date, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const combined = new Date(date);
  combined.setHours(hours || 0, minutes || 0, 0, 0);
  return combined;
}

/** Add days to a date, returning a new Date. */
function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Normalize an event row into a UnifiedCalendarItem.
 */
export function normalizeEvent(event: EventRow): UnifiedCalendarItem {
  return {
    id: `event:${event.id}`,
    title: event.title,
    startAt: event.start_date,
    endAt: event.end_date,
    allDay: false,
    location: event.location,
    sourceType: "event",
    sourceName: "Team Event",
    eventType: event.event_type ?? null,
    eventId: event.id,
  };
}

/**
 * Build a UnifiedCalendarItem for a single occurrence of an academic schedule.
 */
function buildScheduleItem(
  schedule: AcademicSchedule,
  occurrenceDate: Date
): UnifiedCalendarItem {
  const startAt = combineDateAndTime(occurrenceDate, schedule.start_time);
  const endAt = combineDateAndTime(occurrenceDate, schedule.end_time);
  const dateKey = toDateKey(occurrenceDate);
  return {
    id: `schedule:${schedule.id}:${dateKey}`,
    title: schedule.title,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    allDay: false,
    location: null,
    sourceType: "schedule",
    sourceName: "My Schedule",
    eventType: "schedule",
    scheduleId: schedule.id,
  };
}

/**
 * Expand an academic_schedules row into one UnifiedCalendarItem per occurrence
 * within [windowStart, windowEnd]. Stable IDs use the form
 * "schedule:<uuid>:<YYYY-MM-DD>".
 */
export function expandScheduleOccurrences(
  schedule: AcademicSchedule,
  windowStart: Date,
  windowEnd: Date
): UnifiedCalendarItem[] {
  // Clamp the expansion range to the schedule's start/end bounds.
  const scheduleStart = parseDateOnly(schedule.start_date);
  const scheduleEnd = schedule.end_date ? parseDateOnly(schedule.end_date) : null;

  const rangeStart = scheduleStart > windowStart ? scheduleStart : windowStart;
  const rangeEnd = scheduleEnd && scheduleEnd < windowEnd ? scheduleEnd : windowEnd;

  if (rangeStart > rangeEnd) {
    return [];
  }

  switch (schedule.occurrence_type) {
    case "single": {
      if (scheduleStart >= rangeStart && scheduleStart <= rangeEnd) {
        return [buildScheduleItem(schedule, scheduleStart)];
      }
      return [];
    }

    case "daily": {
      const items: UnifiedCalendarItem[] = [];
      let cursor = new Date(rangeStart);
      while (cursor <= rangeEnd) {
        items.push(buildScheduleItem(schedule, cursor));
        cursor = addDays(cursor, 1);
      }
      return items;
    }

    case "weekly": {
      const days = schedule.day_of_week;
      if (!days || days.length === 0) {
        return [];
      }
      const items: UnifiedCalendarItem[] = [];
      let cursor = new Date(rangeStart);
      while (cursor <= rangeEnd) {
        if (days.includes(cursor.getDay())) {
          items.push(buildScheduleItem(schedule, cursor));
        }
        cursor = addDays(cursor, 1);
      }
      return items;
    }

    case "monthly": {
      const dayOfMonth = schedule.day_of_month;
      if (!dayOfMonth) {
        return [];
      }
      const items: UnifiedCalendarItem[] = [];
      // Iterate by month from rangeStart's month to rangeEnd's month
      let year = rangeStart.getFullYear();
      let month = rangeStart.getMonth();
      const endYear = rangeEnd.getFullYear();
      const endMonth = rangeEnd.getMonth();
      while (year < endYear || (year === endYear && month <= endMonth)) {
        // Check the day_of_month exists in this month
        const candidate = new Date(year, month, dayOfMonth);
        if (
          candidate.getMonth() === month &&
          candidate >= rangeStart &&
          candidate <= rangeEnd
        ) {
          items.push(buildScheduleItem(schedule, candidate));
        }
        month += 1;
        if (month > 11) {
          month = 0;
          year += 1;
        }
      }
      return items;
    }

    default:
      return [];
  }
}

/**
 * Sort items chronologically (ascending). Returns a new array.
 */
export function sortByStartAt(items: UnifiedCalendarItem[]): UnifiedCalendarItem[] {
  return [...items].sort((a, b) => {
    if (a.startAt < b.startAt) return -1;
    if (a.startAt > b.startAt) return 1;
    return 0;
  });
}

/**
 * Filter merged items by source. "all" returns the input unchanged.
 */
export function filterBySource(
  items: UnifiedCalendarItem[],
  source: CalendarFilterSource
): UnifiedCalendarItem[] {
  if (source === "all") {
    return items;
  }
  return items.filter((item) => item.sourceType === source);
}

/**
 * Group items by ISO local date key with display labels (Today / Tomorrow /
 * "Mon, Apr 12"). Items inside each group keep their input order.
 */
export function groupByDate(
  items: UnifiedCalendarItem[],
  now: Date = new Date()
): CalendarDateGroup[] {
  if (items.length === 0) {
    return [];
  }

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = addDays(today, 1);
  const todayKey = toDateKey(today);
  const tomorrowKey = toDateKey(tomorrow);

  const groupsByKey = new Map<string, CalendarDateGroup>();
  const order: string[] = [];

  for (const item of items) {
    const itemDate = new Date(item.startAt);
    const dateKey = toDateKey(itemDate);

    let group = groupsByKey.get(dateKey);
    if (!group) {
      let label: string;
      if (dateKey === todayKey) {
        label = "Today";
      } else if (dateKey === tomorrowKey) {
        label = "Tomorrow";
      } else {
        label = formatShortWeekdayDate(item.startAt);
      }
      group = { dateKey, label, items: [] };
      groupsByKey.set(dateKey, group);
      order.push(dateKey);
    }
    group.items.push(item);
  }

  return order.map((key) => groupsByKey.get(key) as CalendarDateGroup);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook that fetches events + the current user's academic schedules for an org,
 * normalizes them into a chronological merged feed, and exposes filter state.
 *
 * Mirrors the `useEvents.ts` data-fetching pattern: stale-while-revalidate,
 * request tracking, realtime channel subscriptions, mount-safe state updates.
 */
export function useUnifiedCalendar(orgId: string | null): UseUnifiedCalendarReturn {
  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const { beginRequest, invalidateRequests, isCurrentRequest } = useRequestTracker();

  const [items, setItems] = useState<UnifiedCalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<CalendarFilterSource>("all");
  const [viewMode, setViewMode] = useState<CalendarViewMode>("month");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  // Reset state when org or user changes
  useEffect(() => {
    lastFetchTimeRef.current = 0;
    invalidateRequests();
  }, [orgId, currentUserId, invalidateRequests]);

  const fetchAll = useCallback(async () => {
    const requestId = beginRequest();

    if (!orgId || !currentUserId) {
      if (isMountedRef.current) {
        setItems([]);
        setError(null);
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);

      const windowStart = new Date();
      windowStart.setHours(0, 0, 0, 0);
      const windowEnd = addDays(windowStart, DEFAULT_WINDOW_DAYS);
      windowEnd.setHours(23, 59, 59, 999);

      const windowStartIso = windowStart.toISOString();

      const [eventsResult, schedulesResult] = await Promise.all([
        supabase
          .from("events")
          .select("id, title, start_date, end_date, location, event_type")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          // Include events that are still in progress (end_date >= windowStart)
          // OR upcoming (start_date >= windowStart). This prevents dropping
          // overnight/multi-day events that began before midnight today.
          .or(
            `end_date.gte.${windowStartIso},and(end_date.is.null,start_date.gte.${windowStartIso})`
          )
          .order("start_date", { ascending: true }),
        supabase
          .from("academic_schedules")
          .select("*")
          .eq("organization_id", orgId)
          .eq("user_id", currentUserId)
          .is("deleted_at", null),
      ]);

      // Treat missing tables as empty rather than fatal
      const eventsError = eventsResult.error;
      if (eventsError && eventsError.code !== "42P01") {
        throw eventsError;
      }
      const schedulesError = schedulesResult.error;
      if (schedulesError && schedulesError.code !== "42P01") {
        throw schedulesError;
      }

      if (!isCurrentRequest(requestId)) return;

      const eventRows = (eventsResult.data ?? []) as EventRow[];
      const scheduleRows = (schedulesResult.data ?? []) as AcademicSchedule[];

      const normalizedEvents = eventRows.map(normalizeEvent);
      const expandedSchedules = scheduleRows.flatMap((schedule) =>
        expandScheduleOccurrences(schedule, windowStart, windowEnd)
      );
      const merged = sortByStartAt([...normalizedEvents, ...expandedSchedules]);

      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setItems(merged);
        setError(null);
        lastFetchTimeRef.current = Date.now();
      }
    } catch (e) {
      if (isMountedRef.current && isCurrentRequest(requestId)) {
        const err = e as { code?: string; message: string };
        if (err.code === "42P01" || err.message?.includes("does not exist")) {
          setItems([]);
          setError(null);
        } else {
          const message = err.message || "An error occurred";
          setError(message);
          showToast(message, "error");
          sentry.captureException(e as Error, {
            context: "useUnifiedCalendar",
            orgId,
          });
        }
      }
    } finally {
      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setLoading(false);
      }
    }
  }, [orgId, currentUserId, beginRequest, isCurrentRequest]);

  // Initial fetch + cleanup
  useEffect(() => {
    isMountedRef.current = true;
    fetchAll();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchAll]);

  // Realtime subscriptions on both tables
  useEffect(() => {
    if (!orgId) return;

    const eventsChannel = createPostgresChangesChannel(`unified-calendar-events:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "events",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchAll();
        }
      )
      .subscribe();

    const schedulesChannel = createPostgresChangesChannel(`unified-calendar-schedules:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "academic_schedules",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchAll();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(eventsChannel);
      supabase.removeChannel(schedulesChannel);
    };
  }, [orgId, fetchAll]);

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      fetchAll();
    }
  }, [fetchAll]);

  const filteredItems = useMemo(
    () => filterBySource(items, activeSource),
    [items, activeSource]
  );

  const groups = useMemo(() => groupByDate(filteredItems), [filteredItems]);

  return {
    items,
    groups,
    filteredItems,
    loading,
    error,
    activeSource,
    setActiveSource,
    viewMode,
    setViewMode,
    selectedDate,
    setSelectedDate,
    refetch: fetchAll,
    refetchIfStale,
  };
}
