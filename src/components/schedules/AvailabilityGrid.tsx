"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AcademicSchedule, User } from "@/types/database";

interface AvailabilityGridProps {
  schedules: (AcademicSchedule & { users?: Pick<User, "name" | "email"> | null })[];
  orgId: string;
  mode?: "personal" | "team";
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6am to 9pm (last slot is 9-10pm)
const GRID_START_HOUR = HOURS[0];
const GRID_END_HOUR = HOURS[HOURS.length - 1] + 1;

type ConflictInfo = {
  userId: string;
  memberName: string;
  title: string;
  isOrg?: boolean;
};

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

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

        const startHour = dayStart.getHours();
        const endHour = dayEnd.getHours() + (dayEnd.getMinutes() > 0 ? 1 : 0);
        addHoursForDay(day, startHour, endHour, conflict);
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

  // Show loading state until mounted to avoid hydration issues
  if (!mounted) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center py-8">
          <p className="text-sm text-muted-foreground">Loading availability...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset((w) => w - 1)}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
            aria-label="Previous week"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <span className="font-medium text-foreground min-w-[200px] text-center">{weekLabel}</span>
          <button
            onClick={() => setWeekOffset((w) => w + 1)}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
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
            className="text-sm text-org-primary hover:underline"
          >
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

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="p-2 text-left text-muted-foreground font-medium w-16"></th>
              {weekDays.map((day) => {
                // Only check for "today" after mount to avoid hydration mismatch
                const todayKey = mounted ? formatDateKey(new Date()) : "";
                const isToday = mounted && formatDateKey(day) === todayKey;
                return (
                  <th
                    key={formatDateKey(day)}
                    className={`p-2 text-center font-medium ${isToday ? "text-org-primary" : "text-muted-foreground"}`}
                  >
                    <div>{DAYS[day.getDay()]}</div>
                    <div className={`text-xs ${isToday ? "text-org-primary font-semibold" : "text-muted-foreground"}`}>
                      {day.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {HOURS.map((hour) => (
              <tr key={hour}>
                <td className="p-1 text-right text-muted-foreground text-xs pr-2">
                  {hour % 12 || 12}{hour < 12 ? "a" : "p"}
                </td>
                {weekDays.map((dayDate) => {
                  const dateKey = formatDateKey(dayDate);
                  const conflicts = getConflicts(dateKey, hour);
                  const orgBusy = conflicts.some((conflict) => conflict.isOrg);
                  const busyCount = orgBusy ? totalMembers : conflicts.length;
                  const available = Math.max(totalMembers - busyCount, 0);
                  const isSelected = selectedCell?.dateKey === dateKey && selectedCell?.hour === hour;
                  const availabilityPercent = totalMembers > 0 ? (available / totalMembers) * 100 : 0;

                  const tooltipId = `tooltip-${dateKey}-${hour}`;

                  return (
                    <td key={`${dateKey}-${hour}`} className="p-0.5 relative group">
                      <button
                        onClick={() => setSelectedCell(isSelected ? null : { dateKey, hour })}
                        className={`w-full h-8 rounded-md transition-all duration-150 ${getGradientColor(available, totalMembers)} ${
                          isSelected ? "ring-2 ring-org-primary ring-offset-1" : ""
                        } hover:ring-2 hover:ring-org-primary/50 hover:ring-offset-1 focus:ring-2 focus:ring-org-primary focus:ring-offset-1 focus:outline-none`}
                        aria-label={`${available} of ${totalMembers} available`}
                        aria-describedby={tooltipId}
                      />
                      {/* Hover/focus tooltip - accessible to keyboard users */}
                      <div
                        id={tooltipId}
                        role="tooltip"
                        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5
                          opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 pointer-events-none z-20
                          bg-card border border-border rounded-lg shadow-lg px-2.5 py-1.5 text-xs whitespace-nowrap"
                      >
                        <span className="font-medium text-foreground">{available}/{totalMembers}</span>
                        <span className="text-muted-foreground ml-1">available</span>
                        {/* Mini progress bar */}
                        <div className="w-16 h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                          <div
                            className={`h-full transition-all ${getGradientColor(available, totalMembers)}`}
                            style={{ width: `${availabilityPercent}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedCell && (
        <div className="p-4 rounded-xl bg-muted/50 border border-border">
          <h4 className="font-medium text-foreground mb-2">
            {parseDateKey(selectedCell.dateKey).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}{" "}
            at {selectedCell.hour % 12 || 12}:00 {selectedCell.hour < 12 ? "AM" : "PM"}
          </h4>
          {getConflicts(selectedCell.dateKey, selectedCell.hour).length > 0 ? (
            <ul className="space-y-1 text-sm">
              {getConflicts(selectedCell.dateKey, selectedCell.hour).map((conflict, i) => (
                <li key={i} className="text-muted-foreground">
                  <span className="font-medium text-foreground">{conflict.memberName}</span>
                  <span className="mx-1">-</span>
                  <span>{conflict.title}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-green-600 dark:text-green-400">All members available!</p>
          )}
        </div>
      )}

      {/* Legend: adapts to mode (binary for personal, gradient for team) */}
      {mode === "personal" ? (
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-3 rounded bg-emerald-400 dark:bg-emerald-500" />
            <span className="font-medium text-foreground">Free</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-3 rounded bg-red-400 dark:bg-red-500" />
            <span className="font-medium text-foreground">Busy</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Available</span>
          <div className="flex h-3 rounded-full overflow-hidden w-32 shadow-sm border border-border/50">
            <div className="flex-1 bg-emerald-400 dark:bg-emerald-500" />
            <div className="flex-1 bg-emerald-300 dark:bg-emerald-600" />
            <div className="flex-1 bg-amber-300 dark:bg-amber-500" />
            <div className="flex-1 bg-orange-400 dark:bg-orange-500" />
            <div className="flex-1 bg-red-400 dark:bg-red-500" />
          </div>
          <span className="font-medium text-foreground">Busy</span>
        </div>
      )}
    </div>
  );
}
