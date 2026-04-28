"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { calendarEventDetailPath, calendarEventsPath } from "@/lib/calendar/routes";

interface Event {
  id: string;
  title: string;
  start_date: string;
}

interface UpcomingEventsWidgetProps {
  events: Event[];
  orgSlug: string;
}

function getDateParts(dateString: string) {
  const date = new Date(dateString);
  return {
    month: date.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
    day: date.getDate().toString(),
  };
}

export function UpcomingEventsWidget({ events, orgSlug }: UpcomingEventsWidgetProps) {
  if (events.length === 0) {
    return (
      <Card className="rounded-xl border-border/70 bg-card/75 p-4 shadow-none backdrop-blur-sm">
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Upcoming Events</h3>
        <p className="text-sm text-muted-foreground/60 mt-3">No upcoming events</p>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border-border/70 bg-card/75 p-4 shadow-none backdrop-blur-sm">
      <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Upcoming Events</h3>
      <ul className="mt-3 space-y-2.5 stagger-children">
        {events.map((event) => {
          const { month, day } = getDateParts(event.start_date);
          return (
            <li key={event.id}>
              <Link
                href={calendarEventDetailPath(orgSlug, event.id)}
                className="-m-1.5 flex items-center gap-3 rounded-lg p-1.5 transition-all duration-200 hover:bg-muted/35"
              >
                <div className="flex h-11 w-11 flex-shrink-0 flex-col items-center justify-center rounded-lg border border-border/50 bg-background/35">
                  <span className="text-[10px] font-semibold text-muted-foreground leading-none">{month}</span>
                  <span className="text-sm font-mono font-bold text-foreground leading-tight">{day}</span>
                </div>
                <span className="text-sm text-foreground font-medium line-clamp-1">{event.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <Link
        href={calendarEventsPath(orgSlug)}
        className="mt-3 flex items-center gap-1 border-t border-border/40 pt-3 text-xs text-muted-foreground transition-colors duration-200 hover:text-foreground"
      >
        See all events <span aria-hidden="true">→</span>
      </Link>
    </Card>
  );
}
