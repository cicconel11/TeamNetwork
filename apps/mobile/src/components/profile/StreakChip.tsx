import React from "react";
import { View, Text } from "react-native";
import { Flame } from "lucide-react-native";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { TYPOGRAPHY } from "@/lib/typography";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { useMemberStreak } from "@/hooks/useMemberStreak";

interface StreakChipProps {
  userId: string | null;
  organizationId: string | null;
}

/**
 * Compact pill showing the current attendance streak (consecutive weeks with
 * ≥1 checked-in event). Renders nothing when the user hasn't started a
 * streak yet — chip should celebrate, not nag.
 */
export function StreakChip({ userId, organizationId }: StreakChipProps) {
  const { streak } = useMemberStreak(userId, organizationId);
  const styles = useThemedStyles((n) => ({
    chip: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      backgroundColor: n.surface,
      borderColor: n.border,
      borderWidth: 1,
      borderCurve: "continuous" as const,
      borderRadius: RADIUS.full,
      paddingHorizontal: SPACING.sm,
      paddingVertical: 6,
      alignSelf: "flex-start" as const,
    },
    label: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
    },
    longest: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
    },
  }));

  if (!streak || streak.currentWeeks === 0) return null;

  return (
    <View style={styles.chip}>
      <Flame size={14} color="#f97316" />
      <Text style={styles.label}>
        {streak.currentWeeks}-week streak
      </Text>
      {streak.longestWeeks > streak.currentWeeks ? (
        <Text style={styles.longest}>(best: {streak.longestWeeks})</Text>
      ) : null}
    </View>
  );
}
