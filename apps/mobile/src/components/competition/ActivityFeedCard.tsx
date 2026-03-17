import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Trash2 } from "lucide-react-native";
import { LiveDot } from "./LiveDot";
import { NEUTRAL, SEMANTIC, RADIUS, SPACING, ENERGY } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatRelativeTime } from "@/lib/date-format";
import type { PointHistoryEntry } from "@/hooks/competitionHelpers";

interface ActivityFeedCardProps {
  pointHistory: PointHistoryEntry[];
  isAdmin: boolean;
  onDelete: (id: string) => void;
}

export function ActivityFeedCard({ pointHistory, isAdmin, onDelete }: ActivityFeedCardProps) {
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
                    <Trash2 size={14} color={SEMANTIC.error} />
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

const styles = StyleSheet.create({
  card: {
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    padding: SPACING.md,
    gap: SPACING.md,
    boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    ...TYPOGRAPHY.headlineSmall,
    color: NEUTRAL.foreground,
  },
  liveIndicator: {
    flexDirection: "row",
    alignItems: "center",
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
    backgroundColor: NEUTRAL.background,
    gap: SPACING.xs,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING.sm,
  },
  teamInfo: {
    flex: 1,
    gap: 2,
  },
  teamName: {
    ...TYPOGRAPHY.titleSmall,
    color: NEUTRAL.foreground,
  },
  timestamp: {
    ...TYPOGRAPHY.caption,
    color: NEUTRAL.muted,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
  },
  pointsBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: 999,
  },
  pointsBadgePositive: {
    backgroundColor: `${SEMANTIC.success}22`,
  },
  pointsBadgeNegative: {
    backgroundColor: `${SEMANTIC.error}22`,
  },
  pointsBadgeText: {
    ...TYPOGRAPHY.labelSmall,
    fontVariant: ["tabular-nums"],
    color: NEUTRAL.foreground,
  },
  deleteButton: {
    padding: SPACING.xs,
    borderRadius: RADIUS.sm,
    backgroundColor: `${SEMANTIC.error}14`,
  },
  deletePressed: {
    opacity: 0.8,
  },
  notes: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.secondary,
  },
  emptyText: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.secondary,
  },
});
