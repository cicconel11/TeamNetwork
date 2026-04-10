import React, { useCallback } from "react";
import {
  View,
  Pressable,
  Text,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { SourceFilterChips } from "./source-filter-chips";
import type {
  CalendarViewMode,
  CalendarFilterSource,
} from "@/hooks/useUnifiedCalendar";

interface CalendarToolbarProps {
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  activeSource: CalendarFilterSource;
  onSourceChange: (source: CalendarFilterSource) => void;
}

const VIEW_MODES: Array<{ mode: CalendarViewMode; label: string }> = [
  { mode: "month", label: "Month" },
  { mode: "week", label: "Week" },
  { mode: "3day", label: "3 Day" },
  { mode: "day", label: "Day" },
  { mode: "list", label: "List" },
];

export function CalendarToolbar({
  viewMode,
  onViewModeChange,
  selectedDate,
  onDateChange,
  activeSource,
  onSourceChange,
}: CalendarToolbarProps) {
  const { width } = useWindowDimensions();
  const styles = useThemedStyles((n, s) => ({
    container: {
      backgroundColor: "#0f172a",
      borderBottomWidth: 1,
      borderBottomColor: n.border,
    },
    dateNavRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      gap: SPACING.sm,
    },
    navButton: {
      padding: SPACING.xs,
      borderRadius: RADIUS.md,
    },
    navButtonPressed: {
      backgroundColor: "rgba(255,255,255,0.1)",
    },
    dateLabel: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      flex: 1,
      textAlign: "center" as const,
    },
    todayButton: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs,
      backgroundColor: n.foreground,
      borderRadius: RADIUS.full,
    },
    todayButtonText: {
      ...TYPOGRAPHY.labelSmall,
      color: "#0f172a",
      fontWeight: "600" as const,
    },
    viewModeContainer: {
      borderBottomWidth: 1,
      borderBottomColor: n.border,
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs,
    },
    viewModeScroll: {
      flexGrow: 0,
    },
    viewModePill: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs,
      marginHorizontal: SPACING.xs,
      borderRadius: RADIUS.full,
      borderWidth: 0,
      minHeight: 36,
      justifyContent: "center" as const,
    },
    viewModePillActive: {
      backgroundColor: n.foreground,
    },
    viewModePillInactive: {
      backgroundColor: "transparent",
    },
    viewModePillText: {
      ...TYPOGRAPHY.labelMedium,
      textAlign: "center" as const,
    },
    viewModePillTextActive: {
      color: "#0f172a",
      fontWeight: "600" as const,
    },
    viewModePillTextInactive: {
      color: n.muted,
    },
    filterContainer: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
    },
  }));

  const handleDateNav = useCallback(
    (direction: 1 | -1) => {
      const next = new Date(selectedDate);
      switch (viewMode) {
        case "month":
          next.setMonth(next.getMonth() + direction);
          break;
        case "week":
          next.setDate(next.getDate() + direction * 7);
          break;
        case "3day":
          next.setDate(next.getDate() + direction * 3);
          break;
        case "day":
          next.setDate(next.getDate() + direction);
          break;
        case "list":
          // No date nav in list mode
          return;
      }
      onDateChange(next);
    },
    [selectedDate, viewMode, onDateChange]
  );

  const handleToday = useCallback(() => {
    onDateChange(new Date());
  }, [onDateChange]);

  const monthYearLabel = selectedDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const showDateNav = viewMode !== "list";

  return (
    <View style={styles.container}>
      {/* Date Navigation Row */}
      {showDateNav && (
        <View style={styles.dateNavRow}>
          <Pressable
            style={({ pressed }) => [
              styles.navButton,
              pressed && styles.navButtonPressed,
            ]}
            onPress={() => handleDateNav(-1)}
          >
            <ChevronLeft size={20} color="#9ca3af" />
          </Pressable>

          <Text style={styles.dateLabel}>{monthYearLabel}</Text>

          <Pressable
            style={({ pressed }) => [
              styles.navButton,
              pressed && styles.navButtonPressed,
            ]}
            onPress={() => handleDateNav(1)}
          >
            <ChevronRight size={20} color="#9ca3af" />
          </Pressable>

          <Pressable
            style={styles.todayButton}
            onPress={handleToday}
            hitSlop={SPACING.sm}
          >
            <Text style={styles.todayButtonText}>Today</Text>
          </Pressable>
        </View>
      )}

      {/* View Mode Tabs */}
      <View style={styles.viewModeContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.viewModeScroll}
        >
          {VIEW_MODES.map(({ mode, label }) => (
            <Pressable
              key={mode}
              style={[
                styles.viewModePill,
                viewMode === mode
                  ? styles.viewModePillActive
                  : styles.viewModePillInactive,
              ]}
              onPress={() => onViewModeChange(mode)}
              accessible
              accessibilityRole="tab"
              accessibilityState={{ selected: viewMode === mode }}
            >
              <Text
                style={[
                  styles.viewModePillText,
                  viewMode === mode
                    ? styles.viewModePillTextActive
                    : styles.viewModePillTextInactive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Source Filter Chips */}
      <View style={styles.filterContainer}>
        <SourceFilterChips activeSource={activeSource} onChange={onSourceChange} />
      </View>
    </View>
  );
}
