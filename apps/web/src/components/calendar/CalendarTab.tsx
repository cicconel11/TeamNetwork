"use client";

import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  parseCalendarSubview,
  parseCalendarEventTimeframe,
} from "@/lib/calendar/view-state";
import { calendarListPath } from "@/lib/calendar/routes";
import type { UnifiedEvent } from "@/lib/calendar/unified-events";
import { CalendarMonthView } from "./CalendarMonthView";
import { UnifiedEventFeed } from "./UnifiedEventFeed";

type CalendarTabProps = {
  orgId: string;
  orgSlug: string;
  initialEvents?: UnifiedEvent[];
  timeZone?: string;
};

function GridIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 6a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2h-4a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2h-4a2 2 0 01-2-2v-4z"
      />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 6h16M4 12h16M4 18h16"
      />
    </svg>
  );
}

export function CalendarTab({
  orgId,
  orgSlug,
  initialEvents,
  timeZone,
}: CalendarTabProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const subview = parseCalendarSubview(searchParams.get("subview") ?? undefined);
  const timeframe = parseCalendarEventTimeframe(
    searchParams.get("timeframe") ?? undefined
  );

  const toggleSubview = (newSubview: "grid" | "list") => {
    const params = new URLSearchParams(searchParams);
    if (newSubview === "grid") {
      params.delete("subview");
      params.delete("timeframe");
    } else {
      params.set("subview", "list");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const isGridActive = subview === "grid";
  const isListActive = subview === "list";

  const viewToggleButtonClass =
    "p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const activeViewToggleButtonClass =
    "p-2 rounded-lg text-foreground bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  const rightSlot = (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => toggleSubview("grid")}
        aria-label="Month view"
        className={isGridActive ? activeViewToggleButtonClass : viewToggleButtonClass}
      >
        <GridIcon />
      </button>
      <button
        onClick={() => toggleSubview("list")}
        aria-label="List view"
        className={isListActive ? activeViewToggleButtonClass : viewToggleButtonClass}
      >
        <ListIcon />
      </button>
    </div>
  );

  if (isListActive) {
    return (
      <div className="space-y-4">
        {/* Upcoming / Past toggle */}
        <div className="flex gap-2">
          <Link
            href={calendarListPath(orgSlug)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              timeframe === "upcoming"
                ? "bg-foreground text-background border-foreground/50"
                : "bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/50"
            }`}
          >
            Upcoming
          </Link>
          <Link
            href={calendarListPath(orgSlug, { timeframe: "past" })}
            className={`px-3 py-1.5 text-sm font-medium rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              timeframe === "past"
                ? "bg-foreground text-background border-foreground/50"
                : "bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/50"
            }`}
          >
            Past
          </Link>
        </div>

        {/* Header with view toggle */}
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">
            {timeframe === "past" ? "Past Events" : "Upcoming Events"}
          </h3>
          <div className="flex items-center gap-1.5">
            {rightSlot}
          </div>
        </div>

        {/* List view */}
        <UnifiedEventFeed
          key={orgId}
          orgId={orgId}
          orgSlug={orgSlug}
          initialEvents={initialEvents}
          timeZone={timeZone}
          timeframe={timeframe}
        />
      </div>
    );
  }

  return (
    <CalendarMonthView
      key={orgId}
      orgId={orgId}
      orgSlug={orgSlug}
      initialEvents={initialEvents}
      timeZone={timeZone}
      rightSlot={rightSlot}
    />
  );
}
