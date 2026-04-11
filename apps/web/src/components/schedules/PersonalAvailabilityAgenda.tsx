"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useHasMounted } from "@/hooks/useHasMounted";
import Link from "next/link";
import { buildAvailabilityWeek } from "@/components/schedules/availability-week";
import { computeEventBlocks, type EventBlock } from "@/components/schedules/availability-blocks";
import { computeSummaryStats, formatDateKey } from "@/components/schedules/availability-stats";
import type { AcademicSchedule } from "@/types/database";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons/nav-icons";
import { minutesToTimeLabel } from "@/lib/utils/dates";

type PersonalAvailabilityAgendaProps = {
  schedules: AcademicSchedule[];
  orgId: string;
  orgSlug: string;
  timeZone?: string;
};

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  sourceType?: string;
  isOrg?: boolean;
};

function getBlockColor(origin: string): { dot: string; badge: string } {
  switch (origin) {
    case "org":
      return { dot: "bg-org-primary", badge: "bg-org-primary/15 text-foreground" };
    case "academic":
      return { dot: "bg-org-secondary", badge: "bg-org-secondary/15 text-foreground" };
    default:
      return { dot: "bg-blue-500", badge: "bg-blue-500/10 text-foreground" };
  }
}

function getBlockLabel(origin: string): string {
  switch (origin) {
    case "org":
      return "Org Event";
    case "academic":
      return "Academic";
    case "calendar":
      return "Calendar";
    case "schedule":
      return "Schedule";
    default:
      return "Event";
  }
}

function getScheduleEditHref(orgSlug: string, block: EventBlock): string | null {
  if (block.origin !== "academic") return null;
  const rawId = block.id;
  const scheduleId = rawId.startsWith("academic:") ? rawId.replace("academic:", "") : rawId;
  return `/${orgSlug}/calendar/${scheduleId}/edit`;
}

export function PersonalAvailabilityAgenda({ schedules, orgId, orgSlug, timeZone }: PersonalAvailabilityAgendaProps) {
  const mounted = useHasMounted();
  const [weekOffset, setWeekOffset] = useState(0);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const week = useMemo(() => buildAvailabilityWeek(new Date(), weekOffset, timeZone), [weekOffset, timeZone]); // eslint-disable-line react-hooks/exhaustive-deps
  // Suppress todayKey during SSR to avoid hydration mismatch
  const todayKey = mounted ? week.todayKey : "";

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        organizationId: orgId,
        start: week.rangeStart.toISOString(),
        end: week.rangeEnd.toISOString(),
        mode: "personal",
      });
      const res = await fetch(`/api/calendar/events?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setCalendarEvents(data.events ?? []);
      }
    } catch {
      // silent — schedules still render
    } finally {
      setLoading(false);
    }
  }, [orgId, week.rangeStart, week.rangeEnd]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const eventBlocksByDay = useMemo(
    () => computeEventBlocks(schedules, calendarEvents as never, week.weekDays, timeZone),
    [schedules, calendarEvents, week.weekDays, timeZone]
  );

  // Build conflict grid for stats
  const conflictGrid = useMemo(() => {
    const grid = new Map<string, { userId: string; memberName: string; title: string; isOrg?: boolean }[]>();
    eventBlocksByDay.forEach((blocks, dateKey) => {
      blocks.forEach((block) => {
        const startHour = Math.floor(block.startMinute / 60);
        const endHour = Math.ceil(block.endMinute / 60);
        for (let h = startHour; h < endHour; h++) {
          const key = `${dateKey}-${h}`;
          const existing = grid.get(key) ?? [];
          existing.push({ userId: block.userId ?? "me", memberName: block.memberName ?? "Me", title: block.title, isOrg: block.isOrg });
          grid.set(key, existing);
        }
      });
    });
    return grid;
  }, [eventBlocksByDay]);

  const stats = useMemo(
    () => computeSummaryStats(conflictGrid, week.weekDays, "personal", 1),
    [conflictGrid, week.weekDays]
  );
  const personalStats = stats as { freeHours: number; busyHours: number };

  const totalEvents = Array.from(eventBlocksByDay.values()).reduce((sum, blocks) => sum + blocks.length, 0);

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-muted/30 border border-border/50">
        <div className="h-2 w-2 rounded-full bg-emerald-500 flex-shrink-0" />
        <p className="text-sm text-foreground">
          <span className="font-semibold">{personalStats.freeHours} free hours</span>
          <span className="text-muted-foreground"> · {personalStats.busyHours} busy this week</span>
        </p>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setWeekOffset((o) => o - 1)}
          aria-label="Previous week"
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeftIcon />
        </button>

        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-foreground tabular-nums">{week.weekLabel}</span>
          {weekOffset !== 0 && (
            <button
              onClick={() => setWeekOffset(0)}
              className="text-xs font-medium px-2.5 py-1 rounded-md bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              This Week
            </button>
          )}
        </div>

        <button
          onClick={() => setWeekOffset((o) => o + 1)}
          aria-label="Next week"
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRightIcon />
        </button>
      </div>

      {/* Agenda list */}
      {totalEvents === 0 && !loading ? (
        <div className="py-10 text-center space-y-3">
          <p className="text-sm text-muted-foreground">No events this week</p>
          <Link
            href={`/${orgSlug}/calendar/new`}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 transition-colors"
          >
            Add your schedule
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          {week.weekDays.map((day) => {
            const dateKey = formatDateKey(day);
            const blocks: EventBlock[] = (eventBlocksByDay.get(dateKey) ?? []).sort(
              (a, b) => a.startMinute - b.startMinute
            );
            const isToday = dateKey === todayKey;

            const dayLabel = day.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

            return (
              <div key={dateKey}>
                {/* Day header */}
                <div className={`flex items-center gap-2 mb-2 pb-2 border-b ${isToday ? "border-foreground/20" : "border-border/30"}`}>
                  <span
                    className={`text-xs font-semibold uppercase tracking-wider ${
                      isToday ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {dayLabel}
                  </span>
                  {isToday && (
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-foreground/15 text-foreground leading-none">
                      Today
                    </span>
                  )}
                </div>

                {/* Events */}
                {blocks.length === 0 ? (
                  <p className="text-xs text-muted-foreground/50 pl-1 py-1">Free all day</p>
                ) : (
                  <div className="space-y-1">
                    {blocks.map((block) => {
                      const { dot, badge } = getBlockColor(block.origin);
                      const timeLabel = `${minutesToTimeLabel(block.startMinute)} – ${minutesToTimeLabel(block.endMinute)}`;
                      const href = getScheduleEditHref(orgSlug, block);
                      const label = getBlockLabel(block.origin);

                      const content = (
                        <div className="flex items-start gap-3 px-2 py-2 rounded-lg group">
                          <div className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${dot}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{timeLabel}</span>
                              <span className="text-sm font-medium text-foreground truncate">{block.title}</span>
                            </div>
                            <span className={`mt-0.5 inline-block text-[10px] font-medium px-1.5 py-0.5 rounded ${badge}`}>
                              {label}
                            </span>
                          </div>
                          {href && (
                            <span className="text-xs text-muted-foreground/40 group-hover:text-muted-foreground transition-colors flex-shrink-0 mt-1">
                              Edit →
                            </span>
                          )}
                        </div>
                      );

                      if (href) {
                        return (
                          <Link
                            key={block.id}
                            href={href}
                            className="block hover:bg-muted/40 rounded-lg transition-colors"
                          >
                            {content}
                          </Link>
                        );
                      }

                      return <div key={block.id}>{content}</div>;
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-4">
          <div className="h-4 w-4 border-2 border-org-primary/30 border-t-org-primary rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
