import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
} from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import type { ScheduleWithUser } from "@/hooks/useSchedules";
import { formatWeekRange } from "@/lib/date-format";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";

interface AvailabilityGridProps {
  schedules: ScheduleWithUser[];
  totalMembers: number;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6am to 9pm

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

const GRID_COLORS = {
  available: "#dcfce7", // green-100
  availableText: "#166534", // green-800
  someBusy: "#fef3c7", // amber-100
  someBusyText: "#92400e", // amber-800
  manyBusy: "#fee2e2", // red-100
  manyBusyText: "#991b1b", // red-800
  border: "#e2e8f0",
  headerBg: "#f8fafc",
  primaryText: "#0f172a",
  secondaryText: "#64748b",
  mutedText: "#94a3b8",
  card: "#ffffff",
  accent: "#059669",
};

export function AvailabilityGrid({ schedules, totalMembers }: AvailabilityGridProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedCell, setSelectedCell] = useState<{ day: number; hour: number } | null>(null);

  const { startOfWeek, weekLabel } = useMemo(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    start.setDate(start.getDate() - start.getDay() + weekOffset * 7);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    const label = formatWeekRange(start, end);

    return { startOfWeek: start, weekLabel: label };
  }, [weekOffset]);

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

        // Check if this schedule applies to this day
        const dayOnly = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate());
        const startOnly = new Date(scheduleStart.getFullYear(), scheduleStart.getMonth(), scheduleStart.getDate());
        const endOnly = scheduleEnd
          ? new Date(scheduleEnd.getFullYear(), scheduleEnd.getMonth(), scheduleEnd.getDate())
          : null;

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

        // Mark all hours this schedule covers
        for (let h = startHour; h < endHour && h <= 21; h++) {
          if (h < 6) continue;
          const key = `${d}-${h}`;
          const existing = grid.get(key) || [];
          // Only add if this user isn't already marked for this slot
          if (!existing.some((c) => c.userId === userId)) {
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

  const getCellStyle = (conflicts: number) => {
    if (conflicts === 0) {
      return { bg: GRID_COLORS.available, text: GRID_COLORS.availableText };
    }
    if (conflicts <= 2) {
      return { bg: GRID_COLORS.someBusy, text: GRID_COLORS.someBusyText };
    }
    return { bg: GRID_COLORS.manyBusy, text: GRID_COLORS.manyBusyText };
  };

  const formatHour = (hour: number) => {
    const h12 = hour % 12 || 12;
    const ampm = hour < 12 ? "a" : "p";
    return `${h12}${ampm}`;
  };

  return (
    <View style={styles.container}>
      {/* Week Navigation */}
      <View style={styles.navRow}>
        <View style={styles.navButtons}>
          <Pressable
            style={({ pressed }) => [styles.navButton, pressed && { opacity: 0.7 }]}
            onPress={() => setWeekOffset((w) => w - 1)}
          >
            <ChevronLeft size={20} color={GRID_COLORS.primaryText} />
          </Pressable>
          <Text style={styles.weekLabel}>{weekLabel}</Text>
          <Pressable
            style={({ pressed }) => [styles.navButton, pressed && { opacity: 0.7 }]}
            onPress={() => setWeekOffset((w) => w + 1)}
          >
            <ChevronRight size={20} color={GRID_COLORS.primaryText} />
          </Pressable>
        </View>
        {weekOffset !== 0 && (
          <Pressable onPress={() => setWeekOffset(0)} style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
            <Text style={styles.thisWeekLink}>This Week</Text>
          </Pressable>
        )}
      </View>

      {/* Grid */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {/* Header Row */}
          <View style={styles.headerRow}>
            <View style={styles.timeColumn} />
            {DAYS.map((day) => (
              <View key={day} style={styles.dayHeader}>
                <Text style={styles.dayHeaderText}>{day}</Text>
              </View>
            ))}
          </View>

          {/* Hour Rows */}
          {HOURS.map((hour) => (
            <View key={hour} style={styles.hourRow}>
              <View style={styles.timeColumn}>
                <Text style={styles.timeText}>{formatHour(hour)}</Text>
              </View>
              {DAYS.map((_, dayIndex) => {
                const conflicts = getConflicts(dayIndex, hour);
                const available = totalMembers - conflicts.length;
                const cellStyle = getCellStyle(conflicts.length);
                const isSelected = selectedCell?.day === dayIndex && selectedCell?.hour === hour;

                return (
                  <Pressable
                    key={dayIndex}
                    style={({ pressed }) => [
                      styles.cell,
                      { backgroundColor: cellStyle.bg },
                      isSelected && styles.cellSelected,
                      pressed && { opacity: 0.7 },
                    ]}
                    onPress={() =>
                      setSelectedCell(isSelected ? null : { day: dayIndex, hour })
                    }
                  >
                    <Text style={[styles.cellText, { color: cellStyle.text }]}>
                      {available}/{totalMembers}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Selected Cell Details */}
      {selectedCell && (
        <View style={styles.detailsCard}>
          <Text style={styles.detailsTitle}>
            {DAYS[selectedCell.day]} at {selectedCell.hour % 12 || 12}:00{" "}
            {selectedCell.hour < 12 ? "AM" : "PM"}
          </Text>
          {getConflicts(selectedCell.day, selectedCell.hour).length > 0 ? (
            <View style={styles.conflictsList}>
              {getConflicts(selectedCell.day, selectedCell.hour).map((conflict, i) => (
                <Text key={i} style={styles.conflictItem}>
                  <Text style={styles.conflictName}>{conflict.memberName}</Text>
                  {" - "}
                  {conflict.title}
                </Text>
              ))}
            </View>
          ) : (
            <Text style={styles.allAvailable}>All members available!</Text>
          )}
        </View>
      )}

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: GRID_COLORS.available }]} />
          <Text style={styles.legendText}>All available</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: GRID_COLORS.someBusy }]} />
          <Text style={styles.legendText}>1-2 busy</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: GRID_COLORS.manyBusy }]} />
          <Text style={styles.legendText}>3+ busy</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  navButton: {
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: GRID_COLORS.headerBg,
  },
  weekLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: GRID_COLORS.primaryText,
    minWidth: 180,
    textAlign: "center",
  },
  thisWeekLink: {
    fontSize: fontSize.sm,
    color: GRID_COLORS.accent,
    fontWeight: fontWeight.medium,
  },
  headerRow: {
    flexDirection: "row",
  },
  timeColumn: {
    width: 36,
    justifyContent: "center",
    alignItems: "flex-end",
    paddingRight: spacing.xs,
  },
  dayHeader: {
    width: 48,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: GRID_COLORS.headerBg,
  },
  dayHeaderText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: GRID_COLORS.secondaryText,
  },
  hourRow: {
    flexDirection: "row",
  },
  timeText: {
    fontSize: 10,
    color: GRID_COLORS.mutedText,
  },
  cell: {
    width: 48,
    height: 28,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 4,
    margin: 1,
  },
  cellSelected: {
    borderWidth: 2,
    borderColor: GRID_COLORS.accent,
  },
  cellText: {
    fontSize: 10,
    fontWeight: fontWeight.medium,
  },
  detailsCard: {
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    backgroundColor: GRID_COLORS.headerBg,
    borderWidth: 1,
    borderColor: GRID_COLORS.border,
  },
  detailsTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: GRID_COLORS.primaryText,
    marginBottom: spacing.sm,
  },
  conflictsList: {
    gap: spacing.xs,
  },
  conflictItem: {
    fontSize: fontSize.sm,
    color: GRID_COLORS.secondaryText,
  },
  conflictName: {
    fontWeight: fontWeight.medium,
    color: GRID_COLORS.primaryText,
  },
  allAvailable: {
    fontSize: fontSize.sm,
    color: GRID_COLORS.availableText,
  },
  legend: {
    flexDirection: "row",
    gap: spacing.md,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 2,
  },
  legendText: {
    fontSize: fontSize.xs,
    color: GRID_COLORS.mutedText,
  },
});
