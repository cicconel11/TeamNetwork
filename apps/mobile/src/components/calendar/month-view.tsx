import React, { useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { getEventColor } from "./event-type-colors";
import type { UnifiedCalendarItem } from "@/hooks/useUnifiedCalendar";

interface MonthViewProps {
  items: UnifiedCalendarItem[];
  selectedDate: Date;
  onDayPress: (date: Date) => void;
  orgSlug: string;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function getFirstDayOfMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function MonthView({
  items,
  selectedDate,
  onDayPress,
  orgSlug,
}: MonthViewProps) {
  const { width } = useWindowDimensions();
  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.surface,
    },
    content: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.md,
    },
    weekdayRow: {
      flexDirection: "row" as const,
      marginBottom: SPACING.md,
    },
    weekdayLabel: {
      flex: 1,
      ...TYPOGRAPHY.labelSmall,
      color: n.muted,
      textAlign: "center" as const,
    },
    weeksContainer: {
      gap: SPACING.sm,
    },
    weekRow: {
      flexDirection: "row" as const,
      gap: SPACING.sm,
    },
    dayCell: {
      flex: 1,
      aspectRatio: 1,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
      padding: SPACING.xs,
      justifyContent: "flex-start" as const,
    },
    dayCellToday: {
      borderColor: s.success,
      borderWidth: 2,
    },
    dayCellSelected: {
      backgroundColor: "rgba(14, 165, 233, 0.1)",
      borderColor: "#0ea5e9",
      borderWidth: 2,
    },
    dayNumber: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
      fontWeight: "600" as const,
      marginBottom: SPACING.xs,
    },
    dayNumberToday: {
      color: s.success,
    },
    dayNumberSelected: {
      color: "#0ea5e9",
    },
    eventsContainer: {
      gap: 1,
      flex: 1,
    },
    eventPill: {
      borderRadius: RADIUS.sm,
      paddingHorizontal: SPACING.xs,
      paddingVertical: 1,
      justifyContent: "center" as const,
    },
    eventText: {
      fontSize: 9,
      lineHeight: 11,
      fontWeight: "500" as const,
    },
    moreText: {
      fontSize: 8,
      lineHeight: 10,
      fontWeight: "500" as const,
      color: n.muted,
    },
    emptyDay: {
      backgroundColor: "transparent",
      borderWidth: 0,
    },
  }));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = toDateKey(today);
  const selectedDateKey = toDateKey(selectedDate);

  // Build calendar grid
  const daysInMonth = getDaysInMonth(selectedDate);
  const firstDay = getFirstDayOfMonth(selectedDate);
  const totalCells = Math.ceil((daysInMonth + firstDay) / 7) * 7;

  const days: Array<{ date: Date; dayNum: number; isCurrentMonth: boolean }> =
    [];
  for (let i = 0; i < totalCells; i++) {
    if (i < firstDay) {
      // Previous month filler
      days.push({ date: new Date(), dayNum: 0, isCurrentMonth: false });
    } else {
      const dayNum = i - firstDay + 1;
      if (dayNum <= daysInMonth) {
        const date = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), dayNum);
        days.push({ date, dayNum, isCurrentMonth: true });
      }
    }
  }

  // Group items by date
  const itemsByDate = useMemo(() => {
    const map = new Map<string, UnifiedCalendarItem[]>();
    for (const item of items) {
      const itemDate = new Date(item.startAt);
      const key = toDateKey(itemDate);
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(item);
    }
    return map;
  }, [items]);

  const weeks = useMemo(() => {
    const result: Array<typeof days> = [];
    for (let i = 0; i < days.length; i += 7) {
      result.push(days.slice(i, i + 7));
    }
    return result;
  }, [days]);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        {/* Weekday Labels */}
        <View style={styles.weekdayRow}>
          {WEEKDAY_LABELS.map((label) => (
            <Text key={label} style={styles.weekdayLabel}>
              {label}
            </Text>
          ))}
        </View>

        {/* Calendar Grid */}
        <View style={styles.weeksContainer}>
          {weeks.map((week, weekIdx) => (
            <View key={`week-${weekIdx}`} style={styles.weekRow}>
              {week.map((day, dayIdx) => {
                const dateKey = day.isCurrentMonth ? toDateKey(day.date) : null;
                const isToday = dateKey === todayKey;
                const isSelected = dateKey === selectedDateKey;
                const dayItems = dateKey ? itemsByDate.get(dateKey) ?? [] : [];

                if (!day.isCurrentMonth) {
                  return (
                    <View
                      key={`day-${weekIdx}-${dayIdx}`}
                      style={[styles.dayCell, styles.emptyDay]}
                    />
                  );
                }

                return (
                  <Pressable
                    key={`day-${weekIdx}-${dayIdx}`}
                    style={[
                      styles.dayCell,
                      isToday && styles.dayCellToday,
                      isSelected && styles.dayCellSelected,
                    ]}
                    onPress={() => onDayPress(day.date)}
                  >
                    <Text
                      style={[
                        styles.dayNumber,
                        isToday && styles.dayNumberToday,
                        isSelected && styles.dayNumberSelected,
                      ]}
                    >
                      {day.dayNum}
                    </Text>

                    <View style={styles.eventsContainer}>
                      {dayItems.slice(0, 2).map((item) => {
                        const color = getEventColor(item.eventType, item.sourceType);
                        return (
                          <View
                            key={item.id}
                            style={[
                              styles.eventPill,
                              { backgroundColor: color.bg, borderLeftColor: color.text, borderLeftWidth: 2 },
                            ]}
                          >
                            <Text
                              style={[styles.eventText, { color: color.text }]}
                              numberOfLines={1}
                            >
                              {item.title.substring(0, 12)}
                            </Text>
                          </View>
                        );
                      })}

                      {dayItems.length > 2 && (
                        <Text style={styles.moreText}>
                          +{dayItems.length - 2} more
                        </Text>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
