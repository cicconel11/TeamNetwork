import React from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Trash2 } from "lucide-react-native";
import { LiveDot } from "./LiveDot";
import { RADIUS, SPACING, ENERGY } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatRelativeTime } from "@/lib/date-format";
import type { PointHistoryEntry } from "@/hooks/competitionHelpers";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface ActivityFeedCardProps {
  pointHistory: PointHistoryEntry[];
  isAdmin: boolean;
  onDelete: (id: string) => void;
}

export function ActivityFeedCard({ pointHistory, isAdmin, onDelete }: ActivityFeedCardProps) {
  const { semantic } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    card: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      // @ts-ignore — iOS continuous corner curves
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      gap: SPACING.md,
      boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
    },
    header: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
    },
    title: {
      ...TYPOGRAPHY.headlineSmall,
      color: n.foreground,
    },
    liveIndicator: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
    },
    liveText: {
      ...TYPOGRAPHY.labelSmall,
      color: ENERGY.live,
    },
    list: {
      gap: SPACING.sm,
    },
    row: {
      padding: SPACING.sm,
      borderRadius: RADIUS.md,
      backgroundColor: n.background,
      gap: SPACING.xs,
    },
    rowTop: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: SPACING.sm,
    },
    teamInfo: {
      flex: 1,
      gap: 2,
    },
    teamName: {
      ...TYPOGRAPHY.titleSmall,
      color: n.foreground,
    },
    timestamp: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
    },
    actions: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
    },
    pointsBadge: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs,
      borderRadius: 999,
    },
    pointsBadgePositive: {
      backgroundColor: `${s.success}22`,
    },
    pointsBadgeNegative: {
      backgroundColor: `${s.error}22`,
    },
    pointsBadgeText: {
      ...TYPOGRAPHY.labelSmall,
      fontVariant: ["tabular-nums"] as const,
      color: n.foreground,
    },
    deleteButton: {
      padding: SPACING.xs,
      borderRadius: RADIUS.sm,
      backgroundColor: `${s.error}14`,
    },
    deletePressed: {
      opacity: 0.8,
    },
    notes: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
    },
    emptyText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
    },
  }));

  if (pointHistory.length === 0) {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>Live Feed</Text>
        </View>
        <Text style={styles.emptyText}>No activity yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Live Feed</Text>
        <View style={styles.liveIndicator}>
          <LiveDot color={ENERGY.live} />
          <Text style={styles.liveText}>Live</Text>
        </View>
      </View>

      <View style={styles.list}>
        {pointHistory.map((entry, index) => (
          <Animated.View
            key={entry.id}
            entering={FadeInDown.delay(index * 40).duration(250)}
            style={styles.row}
          >
            <View style={styles.rowTop}>
              <View style={styles.teamInfo}>
                <Text style={styles.teamName}>{entry.team_name}</Text>
                <Text style={styles.timestamp}>
                  {formatRelativeTime(entry.created_at)}
                </Text>
              </View>

              <View style={styles.actions}>
                <View
                  style={[
                    styles.pointsBadge,
                    entry.points >= 0 ? styles.pointsBadgePositive : styles.pointsBadgeNegative,
                  ]}
                >
                  <Text style={styles.pointsBadgeText}>
                    {entry.points > 0 ? "+" : ""}{entry.points}
                  </Text>
                </View>

                {isAdmin ? (
                  <Pressable
                    onPress={() => onDelete(entry.id)}
                    style={({ pressed }) => [styles.deleteButton, pressed && styles.deletePressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Delete point entry"
                  >
                    <Trash2 size={14} color={semantic.error} />
                  </Pressable>
                ) : null}
              </View>
            </View>

            {entry.notes ? (
              <Text style={styles.notes}>{entry.notes}</Text>
            ) : null}
          </Animated.View>
        ))}
      </View>
    </View>
  );
}
