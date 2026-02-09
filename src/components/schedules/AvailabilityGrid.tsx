"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, Badge, Skeleton } from "@/components/ui";
import type { AcademicSchedule, User } from "@/types/database";
import { computeSummaryStats, formatDateKey, type ConflictInfo } from "./availability-stats";

interface AvailabilityGridProps {
  schedules: (AcademicSchedule & { users?: Pick<User, "name" | "email"> | null })[];
  orgId: string;
  mode?: "personal" | "team";
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6am to 9pm (last slot is 9-10pm)
const GRID_START_HOUR = HOURS[0];
const GRID_END_HOUR = HOURS[HOURS.length - 1] + 1;

type CalendarEventSummary = {
  id: string;
  user_id: string;
  title: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean | null;
  users?: { name: string | null; email: string | null } | null;
  origin?: "calendar" | "schedule";
};

// Parse date string as local date (avoid timezone shifts)
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function parseDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Get start of week (Sunday) for a given date
function getWeekStart(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function formatHour(hour: number): { num: string; suffix: string } {
  return { num: String(hour % 12 || 12), suffix: hour < 12 ? "am" : "pm" };
}

export function AvailabilityGrid({ schedules, orgId, mode = "team" }: AvailabilityGridProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedCell, setSelectedCell] = useState<{ dateKey: string; hour: number } | null>(null);
  const [totalMembers, setTotalMembers] = useState<number>(mode === "team" ? 0 : 1);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventSummary[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Mark component as mounted to avoid hydration mismatch with dates
  useEffect(() => {
    setMounted(true);
  }, []);

  const { weekStart, weekEnd, weekLabel, weekDays, rangeStart, rangeEnd } = useMemo(() => {
    // Use a fixed date during SSR to avoid hydration mismatch
    // After mount, use the actual current date
    const today = mounted ? new Date() : new Date(2026, 0, 1); // fallback date for SSR
    const currentWeekStart = getWeekStart(today);

    // Apply week offset
    const targetWeekStart = new Date(currentWeekStart);
    targetWeekStart.setDate(currentWeekStart.getDate() + weekOffset * 7);

    const targetWeekEnd = new Date(targetWeekStart);
    targetWeekEnd.setDate(targetWeekStart.getDate() + 6);

    // Format label: "Jan 19 - 25, 2026" or "Jan 26 - Feb 1, 2026"
    const startMonth = targetWeekStart.toLocaleDateString("en-US", { month: "short" });
    const endMonth = targetWeekEnd.toLocaleDateString("en-US", { month: "short" });
    const sameMonth = targetWeekStart.getMonth() === targetWeekEnd.getMonth();
    const label = sameMonth
      ? `${startMonth} ${targetWeekStart.getDate()} - ${targetWeekEnd.getDate()}, ${targetWeekEnd.getFullYear()}`
      : `${startMonth} ${targetWeekStart.getDate()} - ${endMonth} ${targetWeekEnd.getDate()}, ${targetWeekEnd.getFullYear()}`;

    const rangeStartDate = new Date(targetWeekStart);
    rangeStartDate.setHours(0, 0, 0, 0);
    const rangeEndDate = new Date(targetWeekEnd);
    rangeEndDate.setHours(23, 59, 59, 999);

    // Build array of 7 days for the week
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(targetWeekStart);
      day.setDate(targetWeekStart.getDate() + i);
      days.push(day);
    }

    return {
      weekStart: targetWeekStart,
      weekEnd: targetWeekEnd,
      weekLabel: label,
      weekDays: days,
      rangeStart: rangeStartDate,
      rangeEnd: rangeEndDate,
    };
  }, [weekOffset, mounted]);

  useEffect(() => {
    if (mode !== "team") {
      setTotalMembers(1);
      return;
    }

    const supabase = createClient();
    supabase
      .from("user_organization_roles")
      .select("user_id", { count: "exact" })
      .eq("organization_id", orgId)
      .eq("status", "active")
      .then(({ count }) => {
        setTotalMembers(count || 0);
      });
  }, [orgId, mode]);

  const fetchEvents = useCallback(async () => {
    setLoadingEvents(true);
    setEventsError(null);

    try {
      const params = new URLSearchParams({
        organizationId: orgId,
        start: rangeStart.toISOString(),
        end: rangeEnd.toISOString(),
        // Pass mode so API filters to current user's events in personal mode
        // This prevents other users' events from counting as conflicts
        mode,
      });
      const response = await fetch(`/api/calendar/events?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to load availability events.");
      }

      setCalendarEvents(data.events || []);
    } catch (err) {
      setEventsError(err instanceof Error ? err.message : "Failed to load availability events.");
    } finally {
      setLoadingEvents(false);
    }
  }, [orgId, rangeStart, rangeEnd, mode]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    const handler = () => {
      fetchEvents();
    };

    if (typeof window !== "undefined") {
      window.addEventListener("calendar:refresh", handler);
      return () => {
        window.removeEventListener("calendar:refresh", handler);
      };
    }

    return undefined;
  }, [fetchEvents]);

  const conflictGrid = useMemo(() => {
    const grid: Map<string, ConflictInfo[]> = new Map();

    const addConflict = (date: Date, hour: number, conflict: ConflictInfo) => {
      if (hour < GRID_START_HOUR || hour >= GRID_END_HOUR) {
        return;
      }

      const key = `${formatDateKey(date)}-${hour}`;
      const existing = grid.get(key) || [];
      if (!existing.some((item) => item.userId === conflict.userId)) {
        existing.push(conflict);
        grid.set(key, existing);
      }
    };

    const addHoursForDay = (date: Date, startHour: number, endHour: number, conflict: ConflictInfo) => {
      const start = Math.max(startHour, GRID_START_HOUR);
      const end = Math.min(endHour, GRID_END_HOUR);
      for (let hour = start; hour < end; hour += 1) {
        addConflict(date, hour, conflict);
      }
    };

    schedules.forEach((schedule) => {
      const userId = schedule.user_id;
      const fallbackName = mode === "personal" ? "You" : "Unknown";
      const memberName = schedule.users?.name || schedule.users?.email || fallbackName;
      const scheduleStart = parseLocalDate(schedule.start_date);
      const scheduleEnd = schedule.end_date ? parseLocalDate(schedule.end_date) : null;

      const [startHour] = schedule.start_time.split(":").map(Number);
      const [endHour] = schedule.end_time.split(":").map(Number);

      weekDays.forEach((dayDate) => {
        const dayOnly = startOfDay(dayDate);
        const startOnly = startOfDay(scheduleStart);
        const endOnly = scheduleEnd ? startOfDay(scheduleEnd) : null;

        if (dayOnly < startOnly) return;
        if (endOnly && dayOnly > endOnly) return;

        let applies = false;
        switch (schedule.occurrence_type) {
          case "single":
            applies = dayOnly.getTime() === startOnly.getTime();
            break;
          case "daily":
            applies = true;
            break;
          case "weekly":
            applies = Array.isArray(schedule.day_of_week)
              ? schedule.day_of_week.includes(dayDate.getDay())
              : schedule.day_of_week === dayDate.getDay();
            break;
          case "monthly":
            applies = schedule.day_of_month === dayDate.getDate();
            break;
          default:
            applies = false;
        }

        if (!applies) return;

        addHoursForDay(dayDate, startHour, endHour, {
          userId,
          memberName,
          title: schedule.title,
        });
      });
    });

    calendarEvents.forEach((event) => {
      const start = new Date(event.start_at);
      if (Number.isNaN(start.getTime())) {
        return;
      }

      const end = event.end_at ? new Date(event.end_at) : new Date(start.getTime() + 60 * 60 * 1000);
      const isOrgEvent = event.origin === "schedule";
      const userId = isOrgEvent ? `org:${event.id}` : event.user_id;
      const fallbackName = mode === "personal" ? "You" : "Unknown";
      const memberName = isOrgEvent
        ? "Org schedule"
        : event.users?.name || event.users?.email || fallbackName;
      const title = event.title || (isOrgEvent ? "Org schedule" : "Calendar event");
      const conflict = { userId, memberName, title, isOrg: isOrgEvent };

      if (event.all_day) {
        const startDay = startOfDay(start);
        const endDay = startOfDay(end);
        const endIsMidnight = end.getHours() === 0 && end.getMinutes() === 0;
        const inclusiveEnd = endIsMidnight && endDay > startDay
          ? new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() - 1)
          : endDay;

        for (let day = new Date(startDay); day <= inclusiveEnd; day.setDate(day.getDate() + 1)) {
          if (day < weekStart || day > weekEnd) continue;
          addHoursForDay(day, GRID_START_HOUR, GRID_END_HOUR, conflict);
        }
        return;
      }

      const startDay = startOfDay(start);
      const endDay = startOfDay(end);

      for (let day = new Date(startDay); day <= endDay; day.setDate(day.getDate() + 1)) {
        if (day < weekStart || day > weekEnd) continue;

        const isFirstDay = day.getTime() === startDay.getTime();
        const isLastDay = day.getTime() === endDay.getTime();
        const dayStart = isFirstDay ? start : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0);
        const dayEnd = isLastDay ? end : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59);

        const sHour = dayStart.getHours();
        const eHour = dayEnd.getHours() + (dayEnd.getMinutes() > 0 ? 1 : 0);
        addHoursForDay(day, sHour, eHour, conflict);
      }
    });

    return grid;
  }, [calendarEvents, weekDays, weekEnd, weekStart, mode, schedules]);

  const getConflicts = (dateKey: string, hour: number): ConflictInfo[] => {
    return conflictGrid.get(`${dateKey}-${hour}`) || [];
  };

  // Get gradient color based on availability ratio (0-1)
  const getGradientColor = (available: number, total: number): string => {
    if (total === 0) return "bg-muted";
    const ratio = available / total;

    // Personal mode: binary colors (available or not)
    if (mode === "personal") {
      return ratio >= 1
        ? "bg-emerald-400 dark:bg-emerald-500"
        : "bg-red-400 dark:bg-red-500";
    }

    // Team mode: gradient spectrum based on availability percentage
    if (ratio >= 1) return "bg-emerald-400 dark:bg-emerald-500";
    if (ratio >= 0.75) return "bg-emerald-300 dark:bg-emerald-600";
    if (ratio >= 0.5) return "bg-amber-300 dark:bg-amber-500";
    if (ratio >= 0.25) return "bg-orange-400 dark:bg-orange-500";
    return "bg-red-400 dark:bg-red-500";
  };

  // Compute summary stats from the conflict grid
  const summaryStats = useMemo(
    () => computeSummaryStats(conflictGrid, weekDays, mode, totalMembers),
    [conflictGrid, weekDays, mode, totalMembers],
  );

  // Show loading state until mounted to avoid hydration issues
  if (!mounted) {
    return (
      <div className="space-y-4 animate-fade-in">
        {/* Week navigation skeleton */}
        <div className="bg-muted/50 rounded-2xl p-1.5 border border-border/50 inline-flex items-center gap-3">
          <Skeleton className="w-10 h-10 rounded-xl" />
          <Skeleton className="w-40 h-8 rounded-lg" />
          <Skeleton className="w-10 h-10 rounded-xl" />
        </div>

        {/* Grid skeleton */}
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
          <div className="flex gap-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex-1 p-2">
                <Skeleton className="h-8 rounded-lg" />
              </div>
            ))}
          </div>
          {Array.from({ length: 8 }).map((_, row) => (
            <div key={row} className="flex gap-0">
              {Array.from({ length: 8 }).map((_, col) => (
                <div key={col} className="flex-1 p-0.5">
                  <Skeleton className="h-10 rounded-lg" />
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Legend skeleton */}
        <Skeleton className="h-14 rounded-xl" />
      </div>
    );
  }

  const todayKey = formatDateKey(new Date());
  const weekNum = getWeekNumber(weekStart);

  return (
    <div className="space-y-4">
      {/* Summary Stats Bar */}
      {mode === "personal" ? (
        <div className="mb-1 p-4 rounded-xl border border-border/50 bg-gradient-to-r from-emerald-50/80 to-transparent dark:from-emerald-950/20">
          <div className="flex items-center gap-4">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">This Week</span>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-2xl font-bold text-foreground">
                {"freeHours" in summaryStats ? summaryStats.freeHours : 0}
              </span>
              <span className="text-sm text-muted-foreground">free hours</span>
            </div>
            <div className="w-px h-6 bg-border/50" />
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-lg font-semibold text-muted-foreground">
                {"busyHours" in summaryStats ? summaryStats.busyHours : 0}
              </span>
              <span className="text-sm text-muted-foreground">busy</span>
            </div>
          </div>
        </div>
      ) : totalMembers > 0 ? (
        <div className="mb-1 p-4 rounded-xl border border-border/50 bg-muted/20">
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Avg Availability</p>
              <p className="font-mono text-2xl font-bold text-foreground">
                {"avgAvailability" in summaryStats ? summaryStats.avgAvailability : 0}%
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Best Time</p>
              <p className="font-display text-lg font-semibold text-foreground">
                {"bestTime" in summaryStats ? summaryStats.bestTime : "—"}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Team Size</p>
              <p className="font-mono text-2xl font-bold text-foreground">
                {"teamSize" in summaryStats ? summaryStats.teamSize : 0}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Week Navigation */}
      <div className="flex items-center justify-between">
        <div className="bg-muted/50 rounded-2xl p-1.5 border border-border/50 inline-flex items-center gap-1">
          <button
            onClick={() => setWeekOffset((w) => w - 1)}
            className="p-2.5 rounded-xl hover:bg-card hover:shadow-sm transition-all duration-200"
            aria-label="Previous week"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <div className="px-4 py-1 text-center min-w-[180px]">
            <div className="font-display font-bold text-foreground">{weekLabel}</div>
            <div className="text-xs text-muted-foreground">Week {weekNum}</div>
          </div>
          <button
            onClick={() => setWeekOffset((w) => w + 1)}
            className="p-2.5 rounded-xl hover:bg-card hover:shadow-sm transition-all duration-200"
            aria-label="Next week"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </div>
        {weekOffset !== 0 && (
          <button
            onClick={() => setWeekOffset(0)}
            className="px-4 py-2 rounded-full bg-org-primary/10 text-org-primary text-sm font-medium hover:bg-org-primary/20 transition-colors inline-flex items-center gap-1.5"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
            </svg>
            This Week
          </button>
        )}
      </div>

      {loadingEvents && (
        <p className="text-xs text-muted-foreground">Loading calendar availability...</p>
      )}
      {eventsError && (
        <p className="text-xs text-error">{eventsError}</p>
      )}

      {/* Grid Table */}
      <div className="overflow-x-auto rounded-xl border border-border/50 bg-card">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/30">
              <th className="p-2 text-left text-muted-foreground font-medium w-16 border-r border-border/20"></th>
              {weekDays.map((day) => {
                const isToday = formatDateKey(day) === todayKey;
                return (
                  <th
                    key={formatDateKey(day)}
                    className={`p-2 text-center font-medium border-r border-border/20 last:border-r-0 ${isToday ? "bg-org-primary/5" : ""}`}
                  >
                    <div className={`flex items-center justify-center gap-1.5 ${isToday ? "text-org-primary" : "text-muted-foreground"}`}>
                      {DAYS[day.getDay()]}
                      {isToday && <span className="w-1.5 h-1.5 rounded-full bg-org-primary" />}
                    </div>
                    <div className={`text-xs ${isToday ? "text-org-primary font-semibold" : "text-muted-foreground"}`}>
                      {day.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {HOURS.map((hour) => {
              const { num, suffix } = formatHour(hour);
              return (
                <tr key={hour} className="hover:bg-muted/20 transition-colors">
                  <td className="p-1 text-right text-muted-foreground text-xs pr-2 font-mono border-r border-border/20">
                    <span className="font-semibold">{num}</span>
                    <span className="text-[10px] opacity-70">{suffix}</span>
                  </td>
                  {weekDays.map((dayDate) => {
                    const dateKey = formatDateKey(dayDate);
                    const conflicts = getConflicts(dateKey, hour);
                    const orgBusy = conflicts.some((conflict) => conflict.isOrg);
                    const busyCount = orgBusy ? totalMembers : conflicts.length;
                    const available = Math.max(totalMembers - busyCount, 0);
                    const isSelected = selectedCell?.dateKey === dateKey && selectedCell?.hour === hour;
                    const availabilityPercent = totalMembers > 0 ? (available / totalMembers) * 100 : 0;
                    const isToday = dateKey === todayKey;

                    const tooltipId = `tooltip-${dateKey}-${hour}`;

                    return (
                      <td key={`${dateKey}-${hour}`} className={`p-0.5 relative group border-r border-border/20 last:border-r-0 ${isToday ? "bg-org-primary/[0.02]" : ""}`}>
                        <button
                          onClick={() => setSelectedCell(isSelected ? null : { dateKey, hour })}
                          className={`w-full h-10 rounded-lg transition-all duration-200 ${getGradientColor(available, totalMembers)} ${
                            isSelected
                              ? "ring-2 ring-org-primary ring-offset-2 ring-offset-card scale-[1.08] shadow-lg z-10 relative"
                              : ""
                          } hover:scale-[1.08] hover:ring-2 hover:ring-org-primary/40 hover:z-10 hover:relative focus:ring-2 focus:ring-org-primary focus:ring-offset-2 focus:ring-offset-card focus:outline-none`}
                          aria-label={`${available} of ${totalMembers} available`}
                          aria-describedby={tooltipId}
                        />
                        {/* Frosted glass tooltip */}
                        <div
                          id={tooltipId}
                          role="tooltip"
                          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2
                            opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100
                            group-focus-within:opacity-100 group-focus-within:scale-100
                            transition-all duration-200 pointer-events-none z-20
                            bg-card/90 backdrop-blur-md border border-border/50 rounded-xl shadow-xl px-3 py-2 text-xs whitespace-nowrap"
                        >
                          <span className="font-mono font-bold text-foreground">{available}/{totalMembers}</span>
                          <span className="text-muted-foreground ml-1">available</span>
                          <div className="w-20 h-2 bg-muted rounded-full mt-1.5 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${getGradientColor(available, totalMembers)}`}
                              style={{ width: `${availabilityPercent}%` }}
                            />
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Conflict Detail Panel */}
      {selectedCell && (
        <div className="animate-slide-in">
          <Card padding="none" className="overflow-hidden border-l-4 border-l-org-primary">
            <div className="p-4 bg-org-primary/5 border-b border-border/50 flex items-center justify-between">
              <div>
                <h4 className="font-display font-semibold text-foreground">
                  {parseDateKey(selectedCell.dateKey).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {selectedCell.hour % 12 || 12}:00 {selectedCell.hour < 12 ? "AM" : "PM"} — {(selectedCell.hour + 1) % 12 || 12}:00 {selectedCell.hour + 1 < 12 ? "AM" : "PM"}
                </p>
              </div>
              <button
                onClick={() => setSelectedCell(null)}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Close detail panel"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              {getConflicts(selectedCell.dateKey, selectedCell.hour).length > 0 ? (
                <div className="space-y-2">
                  {getConflicts(selectedCell.dateKey, selectedCell.hour).map((conflict, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-lg bg-muted/30 border border-border/50 hover:bg-muted/50 transition-colors flex items-center gap-3"
                    >
                      <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                        <svg className="h-4 w-4 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground text-sm">{conflict.memberName}</span>
                          {conflict.isOrg && <Badge variant="primary">Org Event</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{conflict.title}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center flex-shrink-0">
                    <svg className="h-5 w-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-display font-semibold text-emerald-900 dark:text-emerald-100">All Clear!</p>
                    <p className="text-sm text-emerald-700 dark:text-emerald-300">All members available during this time.</p>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Legend */}
      {mode === "personal" ? (
        <div className="mt-6 p-4 rounded-xl bg-muted/20 border border-border/50">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
              </svg>
              <span className="font-medium uppercase tracking-wide">Legend</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-4 rounded-md shadow-sm bg-emerald-400 dark:bg-emerald-500" />
              <span className="text-xs font-medium text-foreground">Free</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-4 rounded-md shadow-sm bg-red-400 dark:bg-red-500" />
              <span className="text-xs font-medium text-foreground">Busy</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 p-4 rounded-xl bg-muted/20 border border-border/50">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
              </svg>
              <span className="font-medium uppercase tracking-wide">Legend</span>
            </div>
            <span className="text-xs font-medium text-foreground">More Available</span>
            <div className="flex h-4 rounded-full overflow-hidden w-40 shadow-sm border border-border/50">
              <div className="flex-1 bg-emerald-400 dark:bg-emerald-500" title="100% available" />
              <div className="flex-1 bg-emerald-300 dark:bg-emerald-600" title="75%+ available" />
              <div className="flex-1 bg-amber-300 dark:bg-amber-500" title="50%+ available" />
              <div className="flex-1 bg-orange-400 dark:bg-orange-500" title="25%+ available" />
              <div className="flex-1 bg-red-400 dark:bg-red-500" title="<25% available" />
            </div>
            <span className="text-xs font-medium text-foreground">Less Available</span>
          </div>
        </div>
      )}
    </div>
  );
}
