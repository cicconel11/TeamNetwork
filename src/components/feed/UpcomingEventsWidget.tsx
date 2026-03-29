"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";

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
      <Card interactive padding="md">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Upcoming Events</h3>
        <p className="text-sm text-muted-foreground/60 mt-3">No upcoming events</p>
      </Card>
    );
  }

  return (
    <Card interactive padding="md">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Upcoming Events</h3>
      <ul className="space-y-2.5 mt-3 stagger-children">
        {events.map((event) => {
          const { month, day } = getDateParts(event.start_date);
          return (
            <li key={event.id}>
              <Link
                href={`/${orgSlug}/events/${event.id}`}
                className="flex items-center gap-3 p-1.5 -m-1.5 rounded-xl hover:bg-muted transition-all duration-200"
              >
                <div className="flex-shrink-0 w-11 h-11 bg-muted rounded-lg flex flex-col items-center justify-center">
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
        href={`/${orgSlug}/events`}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-org-secondary mt-3 pt-3 border-t border-border transition-colors duration-200"
      >
        See all events <span aria-hidden="true">→</span>
      </Link>
    </Card>
  );
}
