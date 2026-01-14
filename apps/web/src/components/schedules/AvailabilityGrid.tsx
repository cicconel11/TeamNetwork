"use client";

import { useState, useMemo, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AcademicSchedule, User } from "@/types/database";

interface AvailabilityGridProps {
  schedules: (AcademicSchedule & { users: Pick<User, "name" | "email"> | null })[];
  orgId: string;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6am to 9pm (last slot is 9-10pm)

type ConflictInfo = {
  userId: string;
  memberName: string;
  title: string;
};

// Parse date string as local date (avoid timezone shifts)
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function AvailabilityGrid({ schedules, orgId }: AvailabilityGridProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedCell, setSelectedCell] = useState<{ day: number; hour: number } | null>(null);
  const [totalMembers, setTotalMembers] = useState<number>(0);

  const { startOfWeek, weekLabel } = useMemo(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    start.setDate(start.getDate() - start.getDay() + weekOffset * 7);
    
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    
    const label = `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    
    return { startOfWeek: start, weekLabel: label };
  }, [weekOffset]);

  // Fetch total members count (useEffect for side-effect)
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("user_organization_roles")
      .select("user_id", { count: "exact" })
      .eq("organization_id", orgId)
      .eq("status", "active")
      .then(({ count }) => {
        setTotalMembers(count || 0);
      });
  }, [orgId]);

  const conflictGrid = useMemo(() => {
    const grid: Map<string, ConflictInfo[]> = new Map();
    
    schedules.forEach((schedule) => {
      const userId = schedule.user_id;
      const memberName = schedule.users?.name || schedule.users?.email || "Unknown";
      const scheduleStart = parseLocalDate(schedule.start_date);
      const scheduleEnd = schedule.end_date ? parseLocalDate(schedule.end_date) : null;
      
      const [startHour] = schedule.start_time.split(":").map(Number);
      const [endHour] = schedule.end_time.split(":").map(Number);
      
      for (let d = 0; d < 7; d++) {
        const dayDate = new Date(startOfWeek);
        dayDate.setDate(startOfWeek.getDate() + d);
        
        // Check if this schedule applies to this day (compare dates only, no time)
        const dayOnly = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate());
        const startOnly = new Date(scheduleStart.getFullYear(), scheduleStart.getMonth(), scheduleStart.getDate());
        const endOnly = scheduleEnd ? new Date(scheduleEnd.getFullYear(), scheduleEnd.getMonth(), scheduleEnd.getDate()) : null;
        
        if (dayOnly < startOnly) continue;
        if (endOnly && dayOnly > endOnly) continue;
        
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
              ? schedule.day_of_week.includes(d)
              : schedule.day_of_week === d;
            break;
          case "monthly":
            applies = schedule.day_of_month === dayDate.getDate();
            break;
        }
        
        if (!applies) continue;
        
        // Mark all hours this schedule covers (inclusive of last hour slot)
        for (let h = startHour; h < endHour && h <= 21; h++) {
          if (h < 6) continue;
          const key = `${d}-${h}`;
          const existing = grid.get(key) || [];
          // Only add if this user isn't already marked for this slot (avoid double-counting)
          if (!existing.some(c => c.userId === userId)) {
            existing.push({ userId, memberName, title: schedule.title });
            grid.set(key, existing);
          }
        }
      }
    });
    
    return grid;
  }, [schedules, startOfWeek]);

  const getConflicts = (day: number, hour: number): ConflictInfo[] => {
    return conflictGrid.get(`${day}-${hour}`) || [];
  };

  const getCellColor = (conflicts: number): string => {
    if (conflicts === 0) return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300";
    if (conflicts <= 2) return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300";
    return "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset((w) => w - 1)}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <span className="font-medium text-foreground min-w-[200px] text-center">{weekLabel}</span>
          <button
            onClick={() => setWeekOffset((w) => w + 1)}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
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

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="p-2 text-left text-muted-foreground font-medium w-16"></th>
              {DAYS.map((day) => (
                <th key={day} className="p-2 text-center text-muted-foreground font-medium">
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HOURS.map((hour) => (
              <tr key={hour}>
                <td className="p-1 text-right text-muted-foreground text-xs pr-2">
                  {hour % 12 || 12}{hour < 12 ? "a" : "p"}
                </td>
                {DAYS.map((_, dayIndex) => {
                  const conflicts = getConflicts(dayIndex, hour);
                  const available = totalMembers - conflicts.length;
                  const isSelected = selectedCell?.day === dayIndex && selectedCell?.hour === hour;
                  
                  return (
                    <td key={dayIndex} className="p-0.5">
                      <button
                        onClick={() => setSelectedCell(isSelected ? null : { day: dayIndex, hour })}
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
            {DAYS[selectedCell.day]} at {selectedCell.hour % 12 || 12}:00 {selectedCell.hour < 12 ? "AM" : "PM"}
          </h4>
          {getConflicts(selectedCell.day, selectedCell.hour).length > 0 ? (
            <ul className="space-y-1 text-sm">
              {getConflicts(selectedCell.day, selectedCell.hour).map((conflict, i) => (
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
