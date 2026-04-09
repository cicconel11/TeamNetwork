"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  buildUnifiedCalendarDateRange,
  buildUnifiedCalendarPastDateRange,
  getUnifiedEventFloatingDateKey,
  type UnifiedEvent,
} from "@/lib/calendar/unified-events";
import type { CalendarEventTimeframe } from "@/lib/calendar/routes";
import { calendarNewEventPath, calendarSourcesPath } from "@/lib/calendar/routes";
import { formatCalendarEventTime } from "@/lib/calendar/event-segments";
import { getUnifiedEventHref } from "@/lib/calendar/navigation";

type UnifiedEventFeedProps = {
  orgId: string;
  orgSlug: string;
  initialEvents?: UnifiedEvent[];
  timeZone?: string;
  timeframe?: CalendarEventTimeframe;
};

type SourceFilterKey = "events" | "schedules" | "feeds" | "classes";
type ActiveFilter = SourceFilterKey | "all";

const ALL_SOURCE_KEYS: SourceFilterKey[] = ["events", "schedules", "feeds", "classes"];

const SOURCE_FILTERS: {
  key: ActiveFilter;
  label: string;
  colorClass: string;
}[] = [
  {
    key: "all",
    label: "All",
    colorClass: "bg-foreground text-background border-foreground/50",
  },
  {
    key: "events",
    label: "Team Events",
    colorClass: "bg-org-primary text-org-primary-foreground border-org-primary/50",
  },
  {
    key: "schedules",
    label: "Schedules",
    colorClass: "bg-org-secondary text-org-secondary-foreground border-org-secondary/50",
  },
  {
    key: "feeds",
    label: "Calendar Feeds",
    colorClass: "bg-blue-500 text-white border-blue-500/50",
  },
  {
    key: "classes",
    label: "My Schedule",
    colorClass: "bg-slate-500 text-white border-slate-500/50",
  },
];

function getSourceColors(sourceType: string) {
  switch (sourceType) {
    case "event":
      return {
        dot: "bg-org-primary",
        badge: "bg-org-primary text-org-primary-foreground",
      };
    case "schedule":
      return {
        dot: "bg-org-secondary",
        badge: "bg-org-secondary text-org-secondary-foreground",
      };
    case "feed":
      return { dot: "bg-blue-500", badge: "bg-blue-500 text-white" };
    case "class":
      return {
        dot: "bg-slate-500",
        badge: "bg-slate-500 text-white",
      };
    default:
      return {
        dot: "bg-muted-foreground",
        badge: "bg-muted text-muted-foreground",
      };
  }
}

function groupEventsByDate(events: UnifiedEvent[], timeZone?: string): Map<string, UnifiedEvent[]> {
  const grouped = new Map<string, UnifiedEvent[]>();

  events.forEach((event) => {
    const opts: Intl.DateTimeFormatOptions = {
      weekday: "long",
      month: "short",
      day: "numeric",
    };
    const floatingDateKey = getUnifiedEventFloatingDateKey(event);
    const floatingMatch = floatingDateKey ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(floatingDateKey) : null;
    let dateKey: string;

    if (floatingMatch) {
      const [, year, month, day] = floatingMatch;
      const floatingDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
      dateKey = floatingDate.toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
    } else {
      if (timeZone) opts.timeZone = timeZone;
      dateKey = new Date(event.startAt).toLocaleDateString("en-US", opts);
    }

    const existing = grouped.get(dateKey) || [];
    existing.push(event);
    grouped.set(dateKey, existing);
  });

  return grouped;
}

function getBadgeColor(badgeText: string): string {
  if (badgeText.toLowerCase() === "philanthropy") {
    return "bg-green-600 text-white";
  }
  return "bg-muted text-muted-foreground";
}

export function UnifiedEventFeed({ orgId, orgSlug, initialEvents, timeZone, timeframe = "upcoming" }: UnifiedEventFeedProps) {
  const hasInitialData = initialEvents !== undefined;
  const [events, setEvents] = useState<UnifiedEvent[]>(initialEvents ?? []);
  const [loading, setLoading] = useState(!hasInitialData);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");

  const dateRange = useMemo(() => {
    return timeframe === "past" ? buildUnifiedCalendarPastDateRange() : buildUnifiedCalendarDateRange();
  }, [timeframe]);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const sourcesToFetch =
        activeFilter === "all" ? ALL_SOURCE_KEYS : [activeFilter];
      const params = new URLSearchParams({
        orgId,
        start: dateRange.start.toISOString(),
        end: dateRange.end.toISOString(),
        sources: sourcesToFetch.join(","),
      });
      const response = await fetch(
        `/api/calendar/unified-events?${params.toString()}`
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.message || "Failed to load events.");
      }

      const data = await response.json();
      setEvents(data.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events.");
    } finally {
      setLoading(false);
    }
  }, [activeFilter, dateRange, orgId]);

  const initialMountRef = useRef(hasInitialData);

  useEffect(() => {
    if (initialMountRef.current && activeFilter === "all") {
      initialMountRef.current = false;
      return;
    }
    initialMountRef.current = false;
    fetchEvents();
  }, [fetchEvents]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      fetchEvents();
    };
    window.addEventListener("calendar:refresh", handler);
    window.addEventListener("schedule:sources:refresh", handler);
    return () => {
      window.removeEventListener("calendar:refresh", handler);
      window.removeEventListener("schedule:sources:refresh", handler);
    };
  }, [fetchEvents]);

  const selectSource = (key: ActiveFilter) => {
    setActiveFilter(key);
  };

  const groupedEvents = useMemo(() => groupEventsByDate(events, timeZone), [events, timeZone]);

  const renderEmptyState = () => {
    const hasEventsSource = activeFilter === "all" || activeFilter === "events";
    const hasSchedulesSource = activeFilter === "all" || activeFilter === "schedules";
    const emptyMessage = timeframe === "past" ? "No past events" : "No upcoming events";

    return (
      <div className="text-center py-12 space-y-4">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {hasEventsSource && (
            <Link
              href={calendarNewEventPath(orgSlug)}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
            >
              Create your first event
            </Link>
          )}
          {hasSchedulesSource && (
            <Link
              href={calendarSourcesPath(orgSlug)}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
            >
              Connect a schedule source
            </Link>
          )}
        </div>
      </div>
    );
  };

  const renderEventRow = (event: UnifiedEvent) => {
    const { dot, badge } = getSourceColors(event.sourceType);
    const formattedTime = formatCalendarEventTime(event, "en-US", timeZone);

    const rowContent = (
      <>
        <div className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${dot}`} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="grid gap-1 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:gap-x-4">
            <div className="text-sm text-muted-foreground tabular-nums break-words">
              {formattedTime}
            </div>
            <div className="min-w-0 text-sm font-medium text-foreground break-words">
              {event.title}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${badge}`}>
              {event.sourceName}
            </span>
            {event.badges.length > 0 && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${getBadgeColor(event.badges[0])}`}
              >
                {event.badges[0].charAt(0).toUpperCase() + event.badges[0].slice(1)}
              </span>
            )}
            {event.location && (
              <span className="min-w-0 text-xs text-muted-foreground break-words">
                {event.location}
              </span>
            )}
          </div>
        </div>
      </>
    );

    const className = "flex items-start gap-3 py-3.5";
    const href = getUnifiedEventHref(orgSlug, event);

    if (href) {
      return (
        <Link
          key={event.id}
          href={href}
          className={`${className} hover:bg-accent/50 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
        >
          {rowContent}
        </Link>
      );
    }

    return (
      <div key={event.id} className={className}>
        {rowContent}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Source Filter Tabs */}
      <div className="overflow-x-auto">
        <div
          role="tablist"
          aria-label="Event source filter"
          className="flex flex-nowrap sm:flex-wrap gap-2 min-w-max sm:min-w-0"
        >
          {SOURCE_FILTERS.map((filter) => {
            const isActive = activeFilter === filter.key;
            return (
              <button
                key={filter.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => selectSource(filter.key)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md border transition-colors touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  isActive
                    ? filter.colorClass
                    : "bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/50"
                }`}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Event Feed */}
      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Loading events...
        </p>
      ) : error ? (
        <p className="text-sm text-error py-8 text-center">{error}</p>
      ) : events.length === 0 ? (
        renderEmptyState()
      ) : (
        <div className="space-y-6">
          {Array.from(groupedEvents.entries()).map(([dateLabel, dayEvents]) => (
            <div key={dateLabel}>
              <h3
                className="sticky top-0 bg-background/95 backdrop-blur-sm z-10 text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-3 pb-2 mb-1 border-b border-border/20"
                style={{ textWrap: "balance" } as React.CSSProperties}
              >
                {dateLabel}
              </h3>
              <div className="divide-y divide-border/60">
                {dayEvents.map((event) => renderEventRow(event))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
