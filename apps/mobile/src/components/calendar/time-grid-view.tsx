import React, { useMemo, useRef, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  useWindowDimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { getEventColor } from "./event-type-colors";
import { useRouter } from "expo-router";
import type { UnifiedCalendarItem } from "@/hooks/useUnifiedCalendar";

interface TimeGridViewProps {
  items: UnifiedCalendarItem[];
  visibleDates: Date[];
  orgSlug: string;
  onEventPress?: (item: UnifiedCalendarItem) => void;
}

const HOUR_HEIGHT = 60;
const TIME_COLUMN_WIDTH = 60;

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTimeLabel(hour: number): string {
  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour} ${ampm}`;
}

function parseTime(isoString: string): { hour: number; minute: number } {
  const date = new Date(isoString);
  return { hour: date.getHours(), minute: date.getMinutes() };
}

export function TimeGridView({
  items,
  visibleDates,
  orgSlug,
  onEventPress,
}: TimeGridViewProps) {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const scrollViewRef = useRef<ScrollView>(null);

  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.surface,
    },
    content: {
      flexDirection: "row" as const,
    },
    timeColumn: {
      width: TIME_COLUMN_WIDTH,
      backgroundColor: n.background,
      borderRightWidth: 1,
      borderRightColor: n.border,
    },
    timeLabel: {
      height: HOUR_HEIGHT,
      justifyContent: "flex-start" as const,
      alignItems: "center" as const,
      paddingTop: 4,
      ...TYPOGRAPHY.caption,
      color: n.muted,
      fontSize: 11,
    },
    dayColumnsContainer: {
      flex: 1,
      flexDirection: "row" as const,
    },
    dayColumn: {
      flex: 1,
      borderRightWidth: 1,
      borderRightColor: n.border,
      backgroundColor: n.surface,
    },
    dayColumnLast: {
      borderRightWidth: 0,
    },
    dayHeader: {
      height: 50,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      borderBottomWidth: 1,
      borderBottomColor: n.border,
      backgroundColor: n.background,
    },
    dayHeaderText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
      fontWeight: "600" as const,
    },
    dayHeaderToday: {
      backgroundColor: "rgba(14, 165, 233, 0.1)",
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs,
    },
    dayHeaderTextToday: {
      color: "#0ea5e9",
    },
    gridLine: {
      height: HOUR_HEIGHT,
      borderBottomWidth: 1,
      borderBottomColor: n.border,
    },
    eventBlock: {
      position: "absolute" as const,
      left: 1,
      right: 1,
      borderLeftWidth: 3,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.xs,
      paddingVertical: SPACING.xs,
      overflow: "hidden" as const,
    },
    eventTitle: {
      ...TYPOGRAPHY.labelSmall,
      fontWeight: "600" as const,
      marginBottom: 2,
    },
    eventTime: {
      ...TYPOGRAPHY.caption,
      opacity: 0.7,
      fontSize: 10,
    },
    allDayRow: {
      minHeight: 40,
      borderBottomWidth: 1,
      borderBottomColor: "#9ca3af",
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs,
      backgroundColor: n.background,
      justifyContent: "center" as const,
    },
    allDayText: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      fontStyle: "italic" as const,
    },
  }));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = toDateKey(today);

  // Filter and group events by date and all-day status
  const { allDayEvents, timedEvents } = useMemo(() => {
    const visibleDateKeys = new Set(visibleDates.map(toDateKey));
    const allDay: UnifiedCalendarItem[] = [];
    const timed: UnifiedCalendarItem[] = [];

    for (const item of items) {
      const dateKey = toDateKey(new Date(item.startAt));
      if (visibleDateKeys.has(dateKey)) {
        if (item.allDay) {
          allDay.push(item);
        } else {
          timed.push(item);
        }
      }
    }

    return { allDayEvents: allDay, timedEvents: timed };
  }, [items, visibleDates]);

  // Group timed events by date and hour range
  const eventsByDateAndHour = useMemo(() => {
    const map = new Map<string, Map<number, UnifiedCalendarItem[]>>();

    for (const item of timedEvents) {
      const dateKey = toDateKey(new Date(item.startAt));
      if (!map.has(dateKey)) {
        map.set(dateKey, new Map());
      }

      const time = parseTime(item.startAt);
      const hourBucket = time.hour;

      const hourMap = map.get(dateKey)!;
      if (!hourMap.has(hourBucket)) {
        hourMap.set(hourBucket, []);
      }
      hourMap.get(hourBucket)!.push(item);
    }

    return map;
  }, [timedEvents]);

  const columnWidth = (width - TIME_COLUMN_WIDTH) / visibleDates.length;

  const handleEventPress = (item: UnifiedCalendarItem) => {
    if (onEventPress) {
      onEventPress(item);
    } else if (item.sourceType === "event" && item.eventId) {
      router.push(`/(app)/${orgSlug}/events/${item.eventId}`);
    } else if (item.sourceType === "schedule" && item.scheduleId) {
      router.push(`/(app)/${orgSlug}/schedules/${item.scheduleId}/edit`);
    }
  };

  // Scroll to 7 AM on mount
  useEffect(() => {
    if (scrollViewRef.current) {
      setTimeout(() => {
        scrollViewRef.current?.scrollTo({
          y: 7 * HOUR_HEIGHT,
          animated: false,
        });
      }, 100);
    }
  }, [visibleDates]);

  return (
    <View style={styles.container}>
      {/* All-day events row */}
      {allDayEvents.length > 0 && (
        <View style={styles.allDayRow}>
          <Text style={styles.allDayText}>
            {allDayEvents.length} all-day event{allDayEvents.length !== 1 ? "s" : ""}
          </Text>
        </View>
      )}

      {/* Time grid */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.container}
        scrollEnabled={true}
        showsVerticalScrollIndicator={true}
      >
        <View style={styles.content}>
          {/* Time labels column */}
          <View style={styles.timeColumn}>
            {Array.from({ length: 24 }, (_, i) => (
              <View key={`time-${i}`} style={styles.timeLabel}>
                <Text>{formatTimeLabel(i)}</Text>
              </View>
            ))}
          </View>

          {/* Day columns */}
          <View style={styles.dayColumnsContainer}>
            {visibleDates.map((date, colIdx) => {
              const dateKey = toDateKey(date);
              const isToday = dateKey === todayKey;
              const columnHourMap = eventsByDateAndHour.get(dateKey) ?? new Map();

              return (
                <View
                  key={`col-${colIdx}`}
                  style={[
                    { width: columnWidth, position: "relative" as const },
                  ]}
                >
                  {/* Day header */}
                  <View
                    style={[
                      styles.dayHeader,
                      isToday && styles.dayHeaderToday,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayHeaderText,
                        isToday && styles.dayHeaderTextToday,
                      ]}
                    >
                      {date.toLocaleDateString("en-US", {
                        weekday: "short",
                        day: "numeric",
                      })}
                    </Text>
                  </View>

                  {/* Grid hours */}
                  <View>
                    {Array.from({ length: 24 }, (_, hour) => {
                      const hourEvents = columnHourMap.get(hour) ?? [];

                      return (
                        <View
                          key={`grid-${colIdx}-${hour}`}
                          style={[
                            styles.gridLine,
                            { minHeight: HOUR_HEIGHT, position: "relative" as const },
                          ]}
                        >
                          {/* Render events in this hour */}
                          {hourEvents.map((item: UnifiedCalendarItem) => {
                            const time = parseTime(item.startAt);
                            const endTime = item.endAt
                              ? parseTime(item.endAt)
                              : { hour: time.hour + 1, minute: 0 };

                            const topOffset =
                              (time.minute / 60) * HOUR_HEIGHT;
                            const durationMinutes =
                              (endTime.hour -
                                time.hour +
                                (endTime.minute - time.minute) / 60) *
                              60;
                            const blockHeight = Math.max(
                              (durationMinutes / 60) * HOUR_HEIGHT,
                              30
                            );

                            const color = getEventColor(
                              item.eventType,
                              item.sourceType
                            );

                            return (
                              <Pressable
                                key={item.id}
                                style={[
                                  styles.eventBlock,
                                  {
                                    top: topOffset,
                                    height: blockHeight,
                                    backgroundColor: color.bg,
                                    borderLeftColor: color.text,
                                  },
                                ]}
                                onPress={() => handleEventPress(item)}
                              >
                                <Text
                                  style={[
                                    styles.eventTitle,
                                    { color: color.text },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {item.title}
                                </Text>
                                <Text
                                  style={[
                                    styles.eventTime,
                                    { color: color.text },
                                  ]}
                                >
                                  {time.hour % 12 || 12}:
                                  {String(time.minute).padStart(2, "0")} AM
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
