"use client";

import { Fragment, useState, useEffect, useMemo, useCallback } from "react";
import { useHasMounted } from "@/hooks/useHasMounted";
import { buildAvailabilityWeek, getCurrentTimeMarker } from "@/components/schedules/availability-week";
import { computeEventBlocks, type EventBlock } from "@/components/schedules/availability-blocks";
import { computeSummaryStats, formatDateKey } from "@/components/schedules/availability-stats";
import type { AcademicSchedule, User } from "@/types/database";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons/nav-icons";
import { minutesToTimeLabel } from "@/lib/utils/dates";

type TeamMember = {
  userId: string;
  name: string;
  schedules: AcademicSchedule[];
};

type TeamAvailabilityRowsProps = {
  schedules: (AcademicSchedule & { users: Pick<User, "name" | "email"> | null })[];
  orgId: string;
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

const GRID_START_MINUTE = 6 * 60; // 6am
const GRID_END_MINUTE = 22 * 60; // 10pm

function hourToLabel(h: number): string {
  const ampm = h < 12 ? "am" : "pm";
  const hour = h % 12 || 12;
  return `${hour}${ampm}`;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

export function getCurrentAvailabilityHour(now: Date, timeZone?: string): number {
  return Math.floor(getCurrentTimeMarker(now, timeZone).minute / 60);
}

function computeBestWindow(
  members: TeamMember[],
  blocksByMemberAndDay: Map<string, EventBlock[]>,
  dateKey: string,
  totalMembers: number
): { label: string; freeCount: number; startMinute: number; endMinute: number } | null {
  if (totalMembers === 0) return null;

  const threshold = Math.ceil(totalMembers * 0.8);
  const SLOT_MINUTES = 30;
  const slots: { start: number; freeCount: number }[] = [];

  for (let m = GRID_START_MINUTE; m < GRID_END_MINUTE; m += SLOT_MINUTES) {
    let busyCount = 0;
    members.forEach((member) => {
      const blocks = blocksByMemberAndDay.get(`${member.userId}-${dateKey}`) ?? [];
      const busy = blocks.some((b) => b.startMinute < m + SLOT_MINUTES && b.endMinute > m);
      if (busy) busyCount++;
    });
    slots.push({ start: m, freeCount: totalMembers - busyCount });
  }

  let bestStart = -1;
  let bestEnd = -1;
  let bestFree = 0;
  let runStart = -1;
  let runFree = 0;

  for (let i = 0; i < slots.length; i++) {
    if (slots[i].freeCount >= threshold) {
      if (runStart === -1) {
        runStart = slots[i].start;
        runFree = slots[i].freeCount;
      } else {
        runFree = Math.min(runFree, slots[i].freeCount);
      }
      const runEnd = slots[i].start + SLOT_MINUTES;
      const duration = runEnd - runStart;
      if (duration > bestEnd - bestStart || (duration === bestEnd - bestStart && runFree > bestFree)) {
        bestStart = runStart;
        bestEnd = runEnd;
        bestFree = runFree;
      }
    } else {
      runStart = -1;
    }
  }

  if (bestStart === -1 || bestEnd - bestStart < 30) return null;

  return {
    label: `${minutesToTimeLabel(bestStart)} – ${minutesToTimeLabel(bestEnd)}`,
    freeCount: bestFree,
    startMinute: bestStart,
    endMinute: bestEnd,
  };
}

export function TeamAvailabilityRows({ schedules, orgId, timeZone }: TeamAvailabilityRowsProps) {
  const mounted = useHasMounted();
  const [weekOffset, setWeekOffset] = useState(0);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);

  const week = useMemo(() => buildAvailabilityWeek(new Date(), weekOffset, timeZone), [weekOffset, timeZone]); // eslint-disable-line react-hooks/exhaustive-deps
  // todayKey is only used for "isToday" highlights — suppress during SSR to
  // avoid hydration mismatch between server/client timezones.
  const todayKey = mounted ? week.todayKey : "";
  const currentHour = mounted ? getCurrentAvailabilityHour(new Date(), timeZone) : null;

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        organizationId: orgId,
        start: week.rangeStart.toISOString(),
        end: week.rangeEnd.toISOString(),
        mode: "team",
      });
      const res = await fetch(`/api/calendar/events?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setCalendarEvents(data.events ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [orgId, week.rangeStart, week.rangeEnd]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Group schedules by user
  const members: TeamMember[] = useMemo(() => {
    const map = new Map<string, TeamMember>();
    schedules.forEach((s) => {
      if (!map.has(s.user_id)) {
        map.set(s.user_id, {
          userId: s.user_id,
          name: s.users?.name ?? s.users?.email ?? "Member",
          schedules: [],
        });
      }
      map.get(s.user_id)!.schedules.push(s);
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [schedules]);

  const totalMembers = members.length;

  // Compute event blocks per member per day key
  const blocksByMemberAndDay = useMemo(() => {
    const result = new Map<string, EventBlock[]>();
    members.forEach((member) => {
      const blocksMap = computeEventBlocks(
        member.schedules,
        calendarEvents as never,
        week.weekDays,
        timeZone
      );
      blocksMap.forEach((blocks, dateKey) => {
        result.set(`${member.userId}-${dateKey}`, blocks);
      });
    });
    return result;
  }, [members, calendarEvents, week.weekDays, timeZone]);

  // Build conflict grid
  const conflictGrid = useMemo(() => {
    const grid = new Map<string, { userId: string; memberName: string; title: string; isOrg?: boolean }[]>();
    blocksByMemberAndDay.forEach((blocks, key) => {
      const [userId, dateKey] = key.split(/-(\d{4}-\d{2}-\d{2})$/).filter(Boolean);
      if (!dateKey) return;
      blocks.forEach((block) => {
        const startHour = Math.floor(block.startMinute / 60);
        const endHour = Math.ceil(block.endMinute / 60);
        for (let h = startHour; h < endHour; h++) {
          const gridKey = `${dateKey}-${h}`;
          const existing = grid.get(gridKey) ?? [];
          existing.push({ userId, memberName: block.memberName ?? "Member", title: block.title, isOrg: block.isOrg });
          grid.set(gridKey, existing);
        }
      });
    });
    return grid;
  }, [blocksByMemberAndDay]);

  // Compute free count grid for time-axis view
  const freeCountGrid = useMemo(() => {
    const map = new Map<string, { freeCount: number; freeMembers: TeamMember[]; busyEntries: Array<{ member: TeamMember; title: string }> }>();
    week.weekDays.forEach((day) => {
      const dateKey = formatDateKey(day);
      for (let h = 6; h < 22; h++) {
        const gridKey = `${dateKey}-${h}`;
        const busyList = conflictGrid.get(gridKey) ?? [];
        const busyUserIds = new Set(busyList.map((b) => b.userId));
        const freeMembers = members.filter((m) => !busyUserIds.has(m.userId));
        const busyEntries = members
          .filter((m) => busyUserIds.has(m.userId))
          .map((m) => ({
            member: m,
            title: busyList.find((b) => b.userId === m.userId)?.title ?? "",
          }));
        map.set(gridKey, { freeCount: freeMembers.length, freeMembers, busyEntries });
      }
    });
    return map;
  }, [conflictGrid, members, week.weekDays]);

  const stats = useMemo(
    () => computeSummaryStats(conflictGrid, week.weekDays, "team", totalMembers),
    [conflictGrid, week.weekDays, totalMembers]
  );
  const teamStats = stats as { avgAvailability: number; bestTime: string; teamSize: number };

  const bestWindowByDay = useMemo(() => {
    const map = new Map<string, { label: string; freeCount: number; startMinute: number; endMinute: number }>();
    week.weekDays.forEach((day) => {
      const dateKey = formatDateKey(day);
      const result = computeBestWindow(members, blocksByMemberAndDay, dateKey, totalMembers);
      if (result) map.set(dateKey, result);
    });
    return map;
  }, [members, blocksByMemberAndDay, week.weekDays, totalMembers]);

  // Parse selected cell
  const selectedCellData = useMemo(() => {
    if (!selectedCell) return null;
    const match = selectedCell.match(/^(.+)-(\d+)$/);
    if (!match) return null;
    const [, dateKey, hourStr] = match;
    const hour = parseInt(hourStr, 10);
    const cellData = freeCountGrid.get(selectedCell);
    if (!cellData) return null;
    return { dateKey, hour, ...cellData };
  }, [selectedCell, freeCountGrid]);

  if (totalMembers === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-muted-foreground">No team schedules yet</p>
      </div>
    );
  }

  // Grid column/row definitions
  const gridCols = "minmax(48px, 56px) repeat(7, minmax(60px, 1fr))";
  const gridRows = `68px repeat(16, 64px)`;

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Avg availability</p>
          <p className="font-mono text-2xl font-bold text-foreground tabular-nums">{teamStats.avgAvailability}%</p>
        </div>
        <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Best time</p>
          <p className="font-mono text-2xl font-bold text-foreground tabular-nums">{teamStats.bestTime}</p>
        </div>
        <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Members</p>
          <p className="font-mono text-2xl font-bold text-foreground tabular-nums">{totalMembers}</p>
        </div>
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

      {/* Time-axis grid */}
      {loading ? (
        <div className="overflow-x-auto rounded-xl border border-border/60 bg-card animate-pulse">
          <div
            className="min-w-[476px]"
            style={{ display: "grid", gridTemplateColumns: gridCols, gridTemplateRows: `68px repeat(4, 64px)` }}
          >
            <div className="sticky left-0 z-20 bg-card border-b border-r border-border/60" />
            {[0,1,2,3,4,5,6].map((i) => (
              <div key={i} className="border-b border-l border-border/30 bg-muted/20" />
            ))}
            {[0,1,2,3].map((hi) => (
              <Fragment key={hi}>
                <div className="sticky left-0 z-10 bg-card border-r border-b border-border/30" />
                {[0,1,2,3,4,5,6].map((di) => (
                  <div key={di} className="border-b border-l border-border/20 bg-muted/10" />
                ))}
              </Fragment>
            ))}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60 bg-card relative after:pointer-events-none after:absolute after:top-0 after:right-0 after:h-full after:w-8 after:bg-gradient-to-l after:from-card after:to-transparent sm:after:hidden">
          <div
            className="min-w-[476px]"
            style={{ display: "grid", gridTemplateColumns: gridCols, gridTemplateRows: gridRows }}
          >
            {/* ── Corner ── */}
            <div className="sticky left-0 z-20 bg-card border-b border-r border-border/60" />

            {/* ── Day headers ── */}
            {week.weekDays.map((day) => {
              const dateKey = formatDateKey(day);
              const isToday = dateKey === todayKey;
              const bw = bestWindowByDay.get(dateKey);
              return (
                <div
                  key={`hdr-${dateKey}`}
                  className={[
                    "border-b border-l border-border/60 flex flex-col items-center justify-center gap-1 px-2 py-2",
                    isToday ? "bg-org-primary/[0.04]" : "bg-card",
                    bw ? "border-b-2 border-b-emerald-500/60" : "",
                  ].join(" ")}
                >
                  <span className={`text-[10px] font-semibold uppercase tracking-widest ${isToday ? "text-foreground" : "text-muted-foreground"}`}>
                    {day.toLocaleDateString("en-US", { weekday: "short" })}
                  </span>
                  <span className={[
                    "flex items-center justify-center w-9 h-9 rounded-full text-[15px] font-bold",
                    isToday ? "bg-org-primary text-org-primary-foreground" : "text-foreground",
                  ].join(" ")}>
                    {day.getDate()}
                  </span>
                  {bw && (
                    <span className="text-[8px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 rounded-full px-2 py-0.5 truncate w-full text-center">
                      {bw.label}
                    </span>
                  )}
                </div>
              );
            })}

            {/* ── Hour rows ── each row = Fragment with 1 label + 7 cells as direct grid children */}
            {Array.from({ length: 16 }).map((_, hi) => {
              const hour = 6 + hi;
              return (
                <Fragment key={`row-${hour}`}>
                  {/* Hour label */}
                  <div className="sticky left-0 z-10 bg-card border-r border-b border-border/30 flex items-start justify-end pt-2 pr-2">
                    <span className="text-[11px] font-medium text-muted-foreground/70 tabular-nums">
                      {hourToLabel(hour)}
                    </span>
                  </div>

                  {/* Day cells */}
                  {week.weekDays.map((day) => {
                    const dateKey = formatDateKey(day);
                    const gridKey = `${dateKey}-${hour}`;
                    const cellData = freeCountGrid.get(gridKey);
                    const isToday = dateKey === todayKey;
                    const isNow = isToday && hour === currentHour;
                    const isSelected = selectedCell === gridKey;

                    if (!cellData) return <div key={gridKey} className="border-b border-l border-border/20" />;

                    const freePct = totalMembers > 0 ? cellData.freeCount / totalMembers : 0;

                    // Color system: stronger fills that clearly read
                    let cellBg: string;
                    let countColor: string;
                    let dotFreeColor: string;
                    if (freePct >= 0.75) {
                      cellBg = "bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-950/60";
                      countColor = "text-emerald-700 dark:text-emerald-300";
                      dotFreeColor = "bg-emerald-500";
                    } else if (freePct >= 0.4) {
                      cellBg = "bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-950/60";
                      countColor = "text-amber-700 dark:text-amber-300";
                      dotFreeColor = "bg-amber-400";
                    } else {
                      cellBg = "bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-950/60";
                      countColor = "text-red-700 dark:text-red-300";
                      dotFreeColor = "bg-red-400";
                    }

                    // Today column overlay
                    const todayOverlay = isToday ? "ring-1 ring-inset ring-org-primary/10" : "";
                    const selectedRing = isSelected ? "ring-2 ring-inset ring-org-primary/60" : "";
                    const nowRing = isNow ? "ring-2 ring-inset ring-red-500/60" : "";

                    // Capped dots
                    const maxDots = 10;
                    const freeSlice = cellData.freeMembers.slice(0, maxDots);
                    const busySlice = cellData.busyEntries.slice(0, Math.max(0, maxDots - freeSlice.length));
                    const overflow = totalMembers - freeSlice.length - busySlice.length;

                    return (
                      <div
                        key={gridKey}
                        onClick={() => setSelectedCell((prev) => (prev === gridKey ? null : gridKey))}
                        className={[
                          "border-b border-l border-border/30 cursor-pointer transition-colors",
                          cellBg,
                          todayOverlay,
                          selectedRing,
                          nowRing,
                        ].join(" ")}
                      >
                        {/* Inner layout: padded, vertically stacked */}
                        <div className="h-full flex flex-col items-center justify-center gap-1.5 px-2 py-2">
                          {/* Count line - only show when there is a conflict */}
                          {cellData.freeCount < totalMembers && (
                            <div className="flex items-baseline gap-1">
                              <span className={`text-base font-bold leading-none tabular-nums ${countColor}`}>
                                {cellData.freeCount}
                              </span>
                              <span className="text-[10px] text-muted-foreground leading-none">
                                / {totalMembers}
                              </span>
                            </div>
                          )}

                          {/* Member dots */}
                          <div className="flex flex-wrap justify-center gap-[3px]">
                            {freeSlice.map((m) => (
                              <span
                                key={m.userId}
                                className={`inline-block h-[6px] w-[6px] rounded-full ${dotFreeColor}`}
                                title={m.name}
                              />
                            ))}
                            {busySlice.map(({ member }) => (
                              <span
                                key={member.userId}
                                className="inline-block h-[6px] w-[6px] rounded-full bg-foreground/15"
                                title={member.name}
                              />
                            ))}
                            {overflow > 0 && (
                              <span className="text-[8px] text-muted-foreground leading-none">+{overflow}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selectedCellData && (
        <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/20">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {hourToLabel(selectedCellData.hour)}–{hourToLabel(selectedCellData.hour + 1)}{" "}
                &middot;{" "}
                {new Date(selectedCellData.dateKey + "T12:00:00").toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {selectedCellData.freeCount} available · {selectedCellData.busyEntries.length} busy
              </p>
            </div>
            <button
              onClick={() => setSelectedCell(null)}
              className="text-muted-foreground hover:text-foreground h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted/50 transition-colors text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="grid grid-cols-2 divide-x divide-border/40">
            {/* Free */}
            <div className="px-4 py-3 space-y-2">
              <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                Available ({selectedCellData.freeMembers.length})
              </p>
              <div className="space-y-1.5">
                {selectedCellData.freeMembers.length > 0 ? (
                  selectedCellData.freeMembers.map((member) => (
                    <div key={member.userId} className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                        {getInitials(member.name)}
                      </div>
                      <span className="text-xs text-foreground">{member.name}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground italic">No one available</p>
                )}
              </div>
            </div>

            {/* Busy */}
            <div className="px-4 py-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-foreground/20" />
                Busy ({selectedCellData.busyEntries.length})
              </p>
              <div className="space-y-1.5">
                {selectedCellData.busyEntries.length > 0 ? (
                  selectedCellData.busyEntries.map(({ member, title }) => (
                    <div key={member.userId} className="flex items-start gap-2">
                      <div className="h-6 w-6 rounded-full bg-muted/60 text-muted-foreground flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-px">
                        {getInitials(member.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-foreground leading-tight">{member.name}</p>
                        {title && <p className="text-[10px] text-muted-foreground truncate">{title}</p>}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground italic">Everyone is free</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-5 pt-1">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-5 rounded-sm bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800" />
          <span className="text-xs text-muted-foreground">75%+ free</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-5 rounded-sm bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800" />
          <span className="text-xs text-muted-foreground">40–74% free</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-5 rounded-sm bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800" />
          <span className="text-xs text-muted-foreground">&lt;40% free</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="inline-block h-[6px] w-[6px] rounded-full bg-emerald-500" />
          <span className="text-xs text-muted-foreground">free</span>
          <span className="inline-block h-[6px] w-[6px] rounded-full bg-foreground/15 ml-2" />
          <span className="text-xs text-muted-foreground">busy</span>
        </div>
      </div>
    </div>
  );
}
