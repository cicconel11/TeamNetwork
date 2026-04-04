"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { buildAvailabilityWeek } from "@/components/schedules/availability-week";
import { computeEventBlocks, type EventBlock } from "@/components/schedules/availability-blocks";
import { computeSummaryStats, formatDateKey } from "@/components/schedules/availability-stats";
import type { AcademicSchedule, User } from "@/types/database";

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

function minutesToTimeLabel(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h < 12 ? "am" : "pm";
  const hour = h % 12 || 12;
  return min > 0 ? `${hour}:${String(min).padStart(2, "0")}${ampm}` : `${hour}${ampm}`;
}

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

function ChevronLeftIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function TeamAvailabilityRows({ schedules, orgId, timeZone }: TeamAvailabilityRowsProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);

  const week = useMemo(() => buildAvailabilityWeek(new Date(), weekOffset, timeZone), [weekOffset, timeZone]);

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

  // Build conflict grid for stats (team mode) and time-axis view
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

  // Parse selected cell to get date and hour
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

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      {totalMembers > 0 && (
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
      )}

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
        <div className="overflow-x-auto rounded-xl border border-border/50 bg-card animate-pulse">
          <div
            className="min-w-[480px]"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(60px, 80px) repeat(7, minmax(60px, 1fr))",
              gridTemplateRows: `48px repeat(3, 36px)`,
            }}
          >
            {/* Corner cell */}
            <div className="sticky left-0 z-20 bg-card border-b border-r border-border/30" />
            {/* Header cells */}
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div key={`header-${i}`} className="border-b border-l border-border/20 bg-muted/10" />
            ))}
            {/* Hour skeleton rows */}
            {[0, 1, 2].map((hi) => (
              <div key={`hour-${hi}`}>
                <div className="sticky left-0 z-10 bg-card border-r border-b border-border/20 px-2 flex items-center" />
                {[0, 1, 2, 3, 4, 5, 6].map((di) => (
                  <div key={`cell-${di}`} className="border-b border-l border-border/15" />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/50 bg-card">
          <div
            className="min-w-[480px]"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(60px, 80px) repeat(7, minmax(60px, 1fr))",
              gridTemplateRows: `48px repeat(16, 36px)`,
            }}
          >
            {/* Corner cell */}
            <div className="sticky left-0 z-20 bg-card border-b border-r border-border/30" />

            {/* Day header cells */}
            {week.weekDays.map((day) => {
              const dateKey = formatDateKey(day);
              const isToday = dateKey === week.todayKey;
              const hasBestWindow = bestWindowByDay.has(dateKey);
              const bw = bestWindowByDay.get(dateKey);
              return (
                <div
                  key={`header-${dateKey}`}
                  className={`border-b border-l border-border/20 py-2 px-1 text-center bg-card
                    ${isToday ? "bg-org-primary/[0.03]" : ""}
                    ${hasBestWindow ? "border-b-2 border-b-emerald-500/50" : ""}`}
                >
                  <div
                    className={`text-[10px] font-medium uppercase tracking-wider
                      ${isToday ? "text-org-primary" : "text-muted-foreground"}`}
                  >
                    {day.toLocaleDateString("en-US", { weekday: "short" })}
                  </div>
                  <div className="mt-0.5 flex justify-center">
                    <span
                      className={`inline-flex items-center justify-center text-sm font-semibold
                        ${isToday ? "w-7 h-7 rounded-full bg-org-primary text-white" : "text-foreground"}`}
                    >
                      {day.getDate()}
                    </span>
                  </div>
                  {hasBestWindow && bw && (
                    <div className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 truncate px-1">
                      {bw.label}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Hour rows */}
            {Array.from({ length: 16 }).map((_, hourIdx) => {
              const hour = 6 + hourIdx;
              return (
                <div key={`hour-${hour}`}>
                  {/* Hour label cell — sticky */}
                  <div className="sticky left-0 z-10 bg-card border-r border-b border-border/20 flex items-center justify-center px-1 text-xs font-medium text-muted-foreground">
                    {hourToLabel(hour)}
                  </div>

                  {/* Hour × Day cells */}
                  {week.weekDays.map((day) => {
                    const dateKey = formatDateKey(day);
                    const gridKey = `${dateKey}-${hour}`;
                    const cellData = freeCountGrid.get(gridKey);
                    const isToday = dateKey === week.todayKey;
                    const isNow = isToday && hour === new Date().getHours();

                    if (!cellData) return null;

                    const freePct = totalMembers > 0 ? cellData.freeCount / totalMembers : 0;
                    let bgColor = "bg-muted/20";
                    let textColor = "text-muted-foreground";
                    if (freePct >= 0.75) {
                      bgColor = "bg-emerald-500/15 hover:bg-emerald-500/25";
                      textColor = "text-emerald-700 dark:text-emerald-400";
                    } else if (freePct >= 0.4) {
                      bgColor = "bg-amber-400/15 hover:bg-amber-400/25";
                      textColor = "text-amber-700 dark:text-amber-400";
                    } else {
                      bgColor = "bg-red-500/15 hover:bg-red-500/25";
                      textColor = "text-red-700 dark:text-red-400";
                    }

                    const isSelected = selectedCell === gridKey;

                    return (
                      <div
                        key={`cell-${gridKey}`}
                        onClick={() => setSelectedCell((prev) => (prev === gridKey ? null : gridKey))}
                        className={`relative border-b border-l border-border/15 flex items-center justify-center cursor-pointer transition-colors
                          ${bgColor}
                          ${isToday ? "bg-org-primary/[0.05]" : ""}
                          ${isSelected ? "ring-2 ring-inset ring-org-primary/40" : ""}
                          ${isNow ? "ring-2 ring-inset ring-red-500/40" : ""}`}
                      >
                        <div className={`text-xs font-semibold ${textColor}`}>
                          {cellData.freeCount} <span className="text-[10px] font-normal">free</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selectedCellData && (
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {hourToLabel(selectedCellData.hour)} on {new Date(selectedCellData.dateKey).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {selectedCellData.freeCount} free · {selectedCellData.busyEntries.length} busy
              </p>
            </div>
            <button
              onClick={() => setSelectedCell(null)}
              className="text-muted-foreground hover:text-foreground text-xs px-2 py-1 rounded hover:bg-muted/50 transition-colors"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Free members */}
            <div>
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-2 flex items-center gap-1">
                <span className="text-green-500">✓</span> Free ({selectedCellData.freeMembers.length})
              </p>
              <div className="space-y-1">
                {selectedCellData.freeMembers.length > 0 ? (
                  selectedCellData.freeMembers.map((member) => (
                    <div key={member.userId} className="text-xs text-foreground flex items-center gap-1.5">
                      <div className="h-5 w-5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-[10px] font-semibold flex-shrink-0">
                        {getInitials(member.name)}
                      </div>
                      <span>{member.name}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground italic">None</p>
                )}
              </div>
            </div>

            {/* Busy members */}
            <div>
              <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-2 flex items-center gap-1">
                <span className="text-red-500">✗</span> Busy ({selectedCellData.busyEntries.length})
              </p>
              <div className="space-y-1">
                {selectedCellData.busyEntries.length > 0 ? (
                  selectedCellData.busyEntries.map(({ member, title }) => (
                    <div key={member.userId} className="text-xs text-foreground">
                      <div className="flex items-center gap-1.5">
                        <div className="h-5 w-5 rounded-full bg-red-500/20 text-red-600 dark:text-red-400 flex items-center justify-center text-[10px] font-semibold flex-shrink-0">
                          {getInitials(member.name)}
                        </div>
                        <span>{member.name}</span>
                      </div>
                      {title && <p className="text-[10px] text-muted-foreground ml-6">{title}</p>}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground italic">None</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 pt-1 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-emerald-500/40" />
          <span className="text-muted-foreground">Most free (75%+)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-amber-400/40" />
          <span className="text-muted-foreground">Partly free (40–74%)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-red-500/40" />
          <span className="text-muted-foreground">Least free (&lt;40%)</span>
        </div>
      </div>
    </div>
  );
}
