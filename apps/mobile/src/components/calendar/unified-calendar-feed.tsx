import React, { useCallback, useMemo } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import { Calendar as CalendarIcon } from "lucide-react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { RADIUS, SHADOWS, SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import type {
  CalendarDateGroup,
  UnifiedCalendarItem,
} from "@/hooks/useUnifiedCalendar";

import { CalendarItemCard } from "./calendar-item-card";
import { PoweredByTeamNetwork } from "@/components/PoweredByTeamNetwork";

type FeedRow =
  | { kind: "header"; key: string; label: string }
  | { kind: "item"; key: string; item: UnifiedCalendarItem };

interface UnifiedCalendarFeedProps {
  groups: CalendarDateGroup[];
  orgSlug: string;
  refreshing: boolean;
  onRefresh: () => void;
  error: string | null;
  onRetry: () => void;
}

function buildRows(groups: CalendarDateGroup[]): FeedRow[] {
  const rows: FeedRow[] = [];
  for (const group of groups) {
    rows.push({ kind: "header", key: `header:${group.dateKey}`, label: group.label });
    for (const item of group.items) {
      rows.push({ kind: "item", key: item.id, item });
    }
  }
  return rows;
}

export function UnifiedCalendarFeed({
  groups,
  orgSlug,
  refreshing,
  onRefresh,
  error,
  onRetry,
}: UnifiedCalendarFeedProps) {
  const { neutral, semantic } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    listContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xxl,
      gap: SPACING.sm,
      flexGrow: 1,
    },
    groupHeader: {
      ...TYPOGRAPHY.overline,
      color: n.muted,
      marginTop: SPACING.md,
      marginBottom: SPACING.xs,
      marginLeft: SPACING.xs,
    },
    groupHeaderFirst: {
      marginTop: 0,
    },
    emptyState: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingVertical: SPACING.xxl,
      paddingHorizontal: SPACING.md,
    },
    emptyCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.lg,
      alignItems: "center" as const,
      width: "100%" as const,
      ...SHADOWS.sm,
    },
    emptyTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      marginTop: SPACING.md,
    },
    emptySubtitle: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
      marginTop: SPACING.xs,
      textAlign: "center" as const,
    },
    errorBanner: {
      backgroundColor: s.errorLight,
      borderRadius: RADIUS.md,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: s.error,
      padding: SPACING.md,
      marginBottom: SPACING.md,
    },
    errorText: {
      ...TYPOGRAPHY.bodyMedium,
      color: s.error,
      marginBottom: SPACING.sm,
    },
    retryText: {
      ...TYPOGRAPHY.labelMedium,
      color: s.errorDark,
    },
  }));

  const rows = useMemo(() => buildRows(groups), [groups]);

  const renderRow = useCallback(
    ({ item, index }: { item: FeedRow; index: number }) => {
      if (item.kind === "header") {
        return (
          <Text
            style={[styles.groupHeader, index === 0 && styles.groupHeaderFirst]}
          >
            {item.label}
          </Text>
        );
      }
      return <CalendarItemCard item={item.item} orgSlug={orgSlug} />;
    },
    [orgSlug, styles]
  );

  const renderEmpty = useCallback(() => {
    if (error) {
      return (
        <Animated.View entering={FadeIn} style={styles.emptyState}>
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Couldn't load calendar</Text>
            <Text style={styles.emptySubtitle} selectable>
              {error}
            </Text>
            <Text
              style={styles.retryText}
              onPress={onRetry}
              accessibilityRole="button"
            >
              Tap to retry
            </Text>
          </View>
        </Animated.View>
      );
    }
    return (
      <Animated.View entering={FadeIn} style={styles.emptyState}>
        <View style={styles.emptyCard}>
          <CalendarIcon size={40} color={neutral.muted} />
          <Text style={styles.emptyTitle}>No upcoming items</Text>
          <Text style={styles.emptySubtitle}>
            Events and your class schedule will show here.
          </Text>
        </View>
        <PoweredByTeamNetwork variant="watermark" />
      </Animated.View>
    );
  }, [error, onRetry, neutral.muted, styles]);

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.key}
      renderItem={renderRow}
      contentContainerStyle={styles.listContent}
      contentInsetAdjustmentBehavior="automatic"
      ListEmptyComponent={renderEmpty}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={semantic.success}
        />
      }
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={5}
      removeClippedSubviews
    />
  );
}
