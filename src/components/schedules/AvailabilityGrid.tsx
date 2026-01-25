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
};

type CalendarEventSummary = {
  id: string;
  user_id: string;
  title: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean | null;
  users?: { name: string | null; email: string | null } | null;
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

    // #region agent log
    console.log("[DEBUG-C] Client fetchEvents called:", { orgId, rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString(), mode, mounted });
    // #endregion

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

      // #region agent log
      console.log("[DEBUG-C] Client received response:", { ok: response.ok, status: response.status, eventCount: data?.events?.length || 0, firstEvent: data?.events?.[0] || null });
      // #endregion

      if (!response.ok) {
        throw new Error(data?.message || "Failed to load availability events.");
      }

      setCalendarEvents(data.events || []);
    } catch (err) {
      // #region agent log
      console.log("[DEBUG-C] Client fetch FAILED:", { error: err instanceof Error ? err.message : String(err) });
      // #endregion
      setEventsError(err instanceof Error ? err.message : "Failed to load availability events.");
    } finally {
      setLoadingEvents(false);
    }
  }, [orgId, rangeStart, rangeEnd, mode, mounted]);

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

    // #region agent log
    console.log("[DEBUG-D] Processing calendar events into grid:", { calendarEventsCount: calendarEvents.length, weekStart: weekStart.toISOString(), weekEnd: weekEnd.toISOString() });
    // #endregion

    calendarEvents.forEach((event, idx) => {
      const start = new Date(event.start_at);
      if (Number.isNaN(start.getTime())) {
        // #region agent log
        console.log("[DEBUG-E] Event has invalid start_at:", { eventIdx: idx, start_at: event.start_at });
        // #endregion
        return;
      }

      const end = event.end_at ? new Date(event.end_at) : new Date(start.getTime() + 60 * 60 * 1000);
      const userId = event.user_id;
      const fallbackName = mode === "personal" ? "You" : "Unknown";
      const memberName = event.users?.name || event.users?.email || fallbackName;
      const title = event.title || "Calendar event";
      const conflict = { userId, memberName, title };

      if (event.all_day) {
        const startDay = startOfDay(start);
        const endDay = startOfDay(end);
        const endIsMidnight = end.getHours() === 0 && end.getMinutes() === 0;
        const inclusiveEnd = endIsMidnight && endDay > startDay
          ? new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() - 1)
          : endDay;

        // #region agent log
        if (idx === 0) console.log("[DEBUG-E] Processing all-day event:", { title: event.title, startDay: startDay.toISOString(), inclusiveEnd: inclusiveEnd.toISOString(), weekStart: weekStart.toISOString(), weekEnd: weekEnd.toISOString() });
        // #endregion

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

  const getCellColor = (conflicts: number): string => {
    if (conflicts === 0) return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300";
    if (conflicts <= 2) return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300";
    return "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300";
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
                  const available = totalMembers - conflicts.length;
                  const isSelected = selectedCell?.dateKey === dateKey && selectedCell?.hour === hour;

                  return (
                    <td key={`${dateKey}-${hour}`} className="p-0.5">
                      <button
                        onClick={() => setSelectedCell(isSelected ? null : { dateKey, hour })}
                        className={`w-full h-8 rounded text-xs font-medium transition-all ${getCellColor(conflicts.length)} ${
                          isSelected ? "ring-2 ring-org-primary" : ""
                        } hover:opacity-80`}
                      >
                        {available}/{totalMembers}
                      </button>
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

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-100 dark:bg-green-900/30"></div>
          <span>All available</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-yellow-100 dark:bg-yellow-900/30"></div>
          <span>1-2 busy</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-red-100 dark:bg-red-900/30"></div>
          <span>3+ busy</span>
        </div>
      </div>
    </div>
  );
}
