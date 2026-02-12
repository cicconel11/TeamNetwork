"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, EmptyState } from "@/components/ui";

const UPCOMING_DAYS = 365;

type CalendarEventSummary = {
  id: string;
  title: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean | null;
  location: string | null;
  feed_id?: string | null;
  origin?: "calendar" | "schedule";
};

type UpcomingEventsTabProps = {
  orgId: string;
};

function formatEventTime(event: CalendarEventSummary) {
  const start = new Date(event.start_at);

  if (event.all_day) {
    return `${start.toLocaleDateString()} (All day)`;
  }

  const startLabel = start.toLocaleString();

  if (!event.end_at) {
    return startLabel;
  }

  const end = new Date(event.end_at);
  const endLabel = end.toLocaleString();
  return `${startLabel} - ${endLabel}`;
}

function groupEventsByDate(events: CalendarEventSummary[]): Map<string, CalendarEventSummary[]> {
  const grouped = new Map<string, CalendarEventSummary[]>();

  events.forEach((event) => {
    const dateKey = new Date(event.start_at).toLocaleDateString("en-US", {
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

export function UpcomingEventsTab({ orgId }: UpcomingEventsTabProps) {
  const [events, setEvents] = useState<CalendarEventSummary[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dateRange = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setDate(end.getDate() + UPCOMING_DAYS);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, []);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        organizationId: orgId,
        start: dateRange.start.toISOString(),
        end: dateRange.end.toISOString(),
      });
      const response = await fetch(`/api/calendar/org-events?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to load events.");
      }

      setEvents(data.events || []);
      setTruncated(data.meta?.truncated === true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events.");
    } finally {
      setLoading(false);
    }
  }, [dateRange, orgId]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      fetchEvents();
    };
    window.addEventListener("schedule:sources:refresh", handler);
    window.addEventListener("calendar:refresh", handler);
    return () => {
      window.removeEventListener("schedule:sources:refresh", handler);
      window.removeEventListener("calendar:refresh", handler);
    };
  }, [fetchEvents]);

  const groupedEvents = useMemo(() => groupEventsByDate(events), [events]);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Upcoming Events (Next {UPCOMING_DAYS} Days)
        </h2>
        <Card className="p-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading events...</p>
          ) : error ? (
            <p className="text-sm text-error">{error}</p>
          ) : events.length === 0 ? (
            <EmptyState
              title="No upcoming events"
              description="Org events will appear here once an admin connects a calendar or schedule source."
            />
          ) : (
            <div className="space-y-6">
              {truncated && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    Showing first {events.length} events. Some events may not be displayed.
                  </p>
                </div>
              )}
              {Array.from(groupedEvents.entries()).map(([dateLabel, dayEvents]) => (
                <div key={dateLabel}>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">{dateLabel}</h3>
                  <div className="divide-y divide-border/60">
                    {dayEvents.map((event) => (
                      <div key={event.id} className="py-3">
                        <p className="font-medium text-foreground">{event.title || "Untitled event"}</p>
                        <p className="text-sm text-muted-foreground">{formatEventTime(event)}</p>
                        {event.location && (
                          <p className="text-sm text-muted-foreground">{event.location}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
