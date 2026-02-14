"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type UnifiedEvent = {
  id: string;
  title: string;
  startAt: string; // ISO timestamp
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  sourceType: "event" | "schedule" | "feed" | "class";
  sourceName: string;
  badges: string[];
  eventId?: string; // Link to /events/[id] for manual events
  color?: string;
};

type UnifiedEventFeedProps = {
  orgId: string;
  orgSlug: string;
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
    colorClass: "bg-org-primary text-white border-org-primary/50",
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
        badge: "bg-org-primary text-white",
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

function formatEventTime(event: UnifiedEvent): string {
  if (event.allDay) {
    return "All day";
  }

  const start = new Date(event.startAt);
  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };

  const startTime = start.toLocaleTimeString("en-US", timeOpts);

  if (!event.endAt) {
    return startTime;
  }

  const end = new Date(event.endAt);

  // Same day: "11:30 AM – 1:00 PM"
  if (start.toDateString() === end.toDateString()) {
    const endTime = end.toLocaleTimeString("en-US", timeOpts);
    return `${startTime} – ${endTime}`;
  }

  // Multi-day: "Feb 12, 11:30 AM – Feb 13, 2:00 PM"
  const dateTimeOpts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  return `${start.toLocaleDateString("en-US", dateTimeOpts)} – ${end.toLocaleDateString("en-US", dateTimeOpts)}`;
}

function groupEventsByDate(events: UnifiedEvent[]): Map<string, UnifiedEvent[]> {
  const grouped = new Map<string, UnifiedEvent[]>();

  events.forEach((event) => {
    const dateKey = new Date(event.startAt).toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
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

export function UnifiedEventFeed({ orgId, orgSlug }: UnifiedEventFeedProps) {
  const [events, setEvents] = useState<UnifiedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");

  const dateRange = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setDate(end.getDate() + 365);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, []);

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

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

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

  const groupedEvents = useMemo(() => groupEventsByDate(events), [events]);

  const renderEmptyState = () => {
    const hasEventsSource = activeFilter === "all" || activeFilter === "events";
    const hasSchedulesSource = activeFilter === "all" || activeFilter === "schedules";

    return (
      <div className="text-center py-12 space-y-4">
        <p className="text-sm text-muted-foreground">No upcoming events</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {hasEventsSource && (
            <Link
              href={`/${orgSlug}/events/new`}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
            >
              Create your first event
            </Link>
          )}
          {hasSchedulesSource && (
            <Link
              href={`/${orgSlug}/calendar/sources`}
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
    const formattedTime = formatEventTime(event);

    const rowContent = (
      <>
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
        <span className="text-sm text-muted-foreground w-32 flex-shrink-0 whitespace-nowrap tabular-nums">
          {formattedTime}
        </span>
        <span className="text-sm font-medium text-foreground truncate min-w-0 flex-1">
          {event.title}
        </span>
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
          <span className="text-xs text-muted-foreground truncate hidden sm:inline max-w-[150px]">
            {event.location}
          </span>
        )}
      </>
    );

    const className = "flex items-center gap-3 py-2";

    if (event.sourceType === "event" && event.eventId) {
      return (
        <Link
          key={event.id}
          href={`/${orgSlug}/events/${event.eventId}`}
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
        <div className="space-y-4">
          {Array.from(groupedEvents.entries()).map(([dateLabel, dayEvents]) => (
            <div key={dateLabel}>
              <h3
                className="sticky top-0 bg-background/95 backdrop-blur-sm z-10 text-sm font-semibold text-foreground mb-1 pb-1 border-b border-border/40"
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
