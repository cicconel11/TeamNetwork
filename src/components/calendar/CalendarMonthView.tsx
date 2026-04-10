"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useHasMounted } from "@/hooks/useHasMounted";
import Link from "next/link";
import {
  buildUnifiedCalendarDateRange,
  getUnifiedEventFloatingDateKey,
  type UnifiedEvent,
} from "@/lib/calendar/unified-events";
import { getUnifiedEventHref } from "@/lib/calendar/navigation";
import { resolveOrgTimezone } from "@/lib/utils/timezone";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons/nav-icons";

type CalendarMonthViewProps = {
  orgId: string;
  orgSlug: string;
  initialEvents?: UnifiedEvent[];
  timeZone?: string;
  rightSlot?: React.ReactNode;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_VISIBLE_EVENTS = 3;

type CalendarMonthCursor = {
  year: number;
  month: number;
};

type CalendarMonthCell = {
  dateKey: string;
  dayOfMonth: number;
  month: number;
};

function toDateKeyInTimeZone(date: Date, timeZone?: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  };
  const parts = new Intl.DateTimeFormat("en-US", opts).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function toUtcDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function getCalendarMonthCursor(date: Date, timeZone?: string): CalendarMonthCursor {
  const resolvedTimeZone = resolveOrgTimezone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolvedTimeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: get("year"),
    month: get("month") - 1,
  };
}

export function buildCalendarMonthGrid(year: number, month: number): CalendarMonthCell[][] {
  const firstDay = new Date(Date.UTC(year, month, 1));
  const startSunday = new Date(Date.UTC(year, month, 1 - firstDay.getUTCDay()));

  const weeks: CalendarMonthCell[][] = [];
  const cursor = new Date(startSunday);
  for (let w = 0; w < 6; w++) {
    const week: CalendarMonthCell[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({
        dateKey: toUtcDateKey(cursor),
        dayOfMonth: cursor.getUTCDate(),
        month: cursor.getUTCMonth(),
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export function formatCalendarMonthName(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month, 1, 12)));
}

function getSourceColors(sourceType: string): { dot: string; text: string } {
  switch (sourceType) {
    case "event":
      return { dot: "bg-org-primary", text: "text-org-primary-foreground" };
    case "schedule":
      return { dot: "bg-org-secondary", text: "text-org-secondary-foreground" };
    case "feed":
      return { dot: "bg-blue-500", text: "text-white" };
    case "class":
      return { dot: "bg-slate-500", text: "text-white" };
    default:
      return { dot: "bg-muted-foreground", text: "text-foreground" };
  }
}

export function CalendarMonthView({ orgId, orgSlug, initialEvents, timeZone, rightSlot }: CalendarMonthViewProps) {
  const resolvedTimeZone = resolveOrgTimezone(timeZone);
  const mounted = useHasMounted();
  const [displayMonth, setDisplayMonth] = useState<CalendarMonthCursor>(() => getCalendarMonthCursor(new Date(), resolvedTimeZone));
  const [events, setEvents] = useState<UnifiedEvent[]>(initialEvents ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDayKey, setExpandedDayKey] = useState<string | null>(null);

  const initialDataRangeRef = useRef(buildUnifiedCalendarDateRange());
  const initialEventsRef = useRef(initialEvents);

  const { year, month } = displayMonth;

  // todayKey drives the "isToday" highlight — only compute on client to avoid
  // hydration mismatch between server and browser timezones.
  const todayKey = useMemo(
    () => (mounted ? toDateKeyInTimeZone(new Date(), resolvedTimeZone) : ""),
    [mounted, resolvedTimeZone]
  );

  const monthGrid = useMemo(() => buildCalendarMonthGrid(year, month), [year, month]);

  const monthName = useMemo(() => formatCalendarMonthName(year, month), [year, month]);

  const fetchMonthEvents = useCallback(
    async (start: Date, end: Date) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          orgId,
          start: start.toISOString(),
          end: end.toISOString(),
        });
        const res = await fetch(`/api/calendar/unified-events?${params.toString()}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.message || "Failed to load events.");
        }
        const data = await res.json();
        setEvents(data.events ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load events.");
      } finally {
        setLoading(false);
      }
    },
    [orgId]
  );

  useEffect(() => {
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);
    const { start: rangeStart, end: rangeEnd } = initialDataRangeRef.current;

    const monthInRange = monthStart <= rangeEnd && monthEnd >= rangeStart;

    if (monthInRange && initialEventsRef.current !== undefined) {
      setEvents(initialEventsRef.current);
      return;
    }

    const fetchStart = new Date(year, month, 1);
    const fetchEnd = new Date(year, month + 2, 0);
    fetchMonthEvents(fetchStart, fetchEnd);
  }, [year, month, fetchMonthEvents]);

  useEffect(() => {
    if (!expandedDayKey) return;
    const handler = () => setExpandedDayKey(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [expandedDayKey]);

  const eventsByDateKey = useMemo<Map<string, UnifiedEvent[]>>(() => {
    const map = new Map<string, UnifiedEvent[]>();

    events.forEach((event) => {
      const floatingKey = getUnifiedEventFloatingDateKey(event);
      let dateKey: string;

      if (floatingKey) {
        dateKey = floatingKey;
      } else if (event.allDay && /^\d{4}-\d{2}-\d{2}$/.test(event.startAt)) {
        dateKey = event.startAt;
      } else {
        dateKey = toDateKeyInTimeZone(new Date(event.startAt), resolvedTimeZone);
      }

      const existing = map.get(dateKey) ?? [];
      existing.push(event);
      map.set(dateKey, existing);
    });

    return map;
  }, [events, resolvedTimeZone]);

  const goToPrevMonth = useCallback(() => {
    setDisplayMonth((current) => (
      current.month === 0
        ? { year: current.year - 1, month: 11 }
        : { year: current.year, month: current.month - 1 }
    ));
  }, []);

  const goToNextMonth = useCallback(() => {
    setDisplayMonth((current) => (
      current.month === 11
        ? { year: current.year + 1, month: 0 }
        : { year: current.year, month: current.month + 1 }
    ));
  }, []);

  const goToToday = useCallback(() => {
    setDisplayMonth(getCalendarMonthCursor(new Date(), resolvedTimeZone));
  }, [resolvedTimeZone]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <button
          onClick={goToPrevMonth}
          aria-label="Previous month"
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeftIcon />
        </button>

        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-foreground tabular-nums">{monthName}</h2>
          <button
            onClick={goToToday}
            className="text-xs font-medium px-2.5 py-1 rounded-md bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Today
          </button>
        </div>

        <div className="flex items-center gap-2">
          {rightSlot}
          <button
            onClick={goToNextMonth}
            aria-label="Next month"
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRightIcon />
          </button>
        </div>
      </div>

      {/* Loading bar */}
      {loading && (
        <div className="h-0.5 bg-org-primary/40 animate-pulse rounded mb-3" />
      )}
      {error && (
        <p className="text-xs text-destructive text-center mb-3">{error}</p>
      )}

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAY_LABELS.map((day) => (
          <div key={day} className="text-center py-2">
            <span className="hidden sm:inline text-xs font-medium text-muted-foreground/60">
              {day}
            </span>
            <span className="sm:hidden text-xs font-medium text-muted-foreground/60">
              {day[0]}
            </span>
          </div>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-7 border-l border-t border-border/60 rounded-sm">
        {monthGrid.flat().map((cell, idx) => {
          const cellKey = cell.dateKey;
          const isCurrentMonth = cell.month === month;
          const isToday = cellKey === todayKey;
          const cellEvents = eventsByDateKey.get(cellKey) ?? [];
          const visibleEvents = cellEvents.slice(0, MAX_VISIBLE_EVENTS);
          const overflowCount = cellEvents.length - MAX_VISIBLE_EVENTS;

          return (
            <div
              key={idx}
              className="relative border-r border-b border-border/60 min-h-[90px] sm:min-h-[110px] p-1.5 flex flex-col gap-0.5 bg-card"
            >
              {/* Date number */}
              <div className="flex justify-start mb-0.5">
                <span
                  className={`
                    text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full leading-none tabular-nums select-none
                    ${
                      isToday
                        ? "bg-org-primary text-org-primary-foreground"
                        : isCurrentMonth
                          ? "text-foreground"
                          : "text-muted-foreground/35"
                    }
                  `}
                >
                  {cell.dayOfMonth}
                </span>
              </div>

              {/* Event chips (sm+) and dots (xs) */}
              <div className="flex-1 overflow-hidden space-y-0.5">
                {visibleEvents.map((event) => {
                  const { dot, text } = getSourceColors(event.sourceType);
                  const href = getUnifiedEventHref(orgSlug, event);

                  if (href) {
                    return (
                      <Link
                        key={event.id}
                        href={href}
                        title={event.title}
                        className={`hidden sm:block text-xs font-medium ${text} px-1.5 py-0.5 rounded truncate leading-tight hover:opacity-80 transition-opacity border border-foreground/10 ${dot}`}
                      >
                        {event.title}
                      </Link>
                    );
                  }

                  return (
                    <div
                      key={event.id}
                      title={event.title}
                      className={`hidden sm:block text-xs font-medium ${text} px-1.5 py-0.5 rounded truncate leading-tight border border-foreground/10 ${dot}`}
                    >
                      {event.title}
                    </div>
                  );
                })}

                {/* Mobile: colored dots */}
                {cellEvents.length > 0 && (
                  <div className="flex gap-0.5 flex-wrap sm:hidden pt-0.5">
                    {cellEvents.slice(0, 3).map((event) => (
                      <span
                        key={event.id}
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ring-1 ring-foreground/10 ${getSourceColors(event.sourceType).dot}`}
                      />
                    ))}
                  </div>
                )}

                {/* Overflow count - clickable button */}
                {overflowCount > 0 && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setExpandedDayKey((k) => (k === cellKey ? null : cellKey));
                    }}
                    className="hidden sm:block text-xs text-muted-foreground hover:text-foreground pl-1.5 leading-tight transition-colors cursor-pointer"
                  >
                    +{overflowCount} more
                  </button>
                )}

                {/* Overflow popover */}
                {expandedDayKey === cellKey && overflowCount > 0 && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute z-50 left-0 w-56 bg-card border border-border/60 rounded-lg shadow-lg p-2 space-y-1 max-h-60 overflow-y-auto ${
                      idx >= 28 ? "bottom-full mb-1" : "top-full mt-1"
                    }`}
                  >
                    {cellEvents.map((event) => {
                      const { dot, text } = getSourceColors(event.sourceType);
                      const href = getUnifiedEventHref(orgSlug, event);

                      if (href) {
                        return (
                          <Link
                            key={event.id}
                            href={href}
                            onClick={(e) => e.stopPropagation()}
                            title={event.title}
                            className={`block text-xs font-medium ${text} px-2 py-1.5 rounded truncate leading-snug hover:opacity-80 transition-opacity border border-foreground/10 ${dot}`}
                          >
                            {event.title}
                          </Link>
                        );
                      }

                      return (
                        <div
                          key={event.id}
                          title={event.title}
                          className={`block text-xs font-medium ${text} px-2 py-1.5 rounded truncate leading-snug border border-foreground/10 ${dot}`}
                        >
                          {event.title}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
