import React from "react";
import { View } from "react-native";
import { Skeleton } from "@/components/ui/Skeleton";
import { RADIUS, SPACING } from "@/lib/design-tokens";
import { useThemedStyles } from "@/hooks/useThemedStyles";

export function CompetitionSkeleton() {
  const styles = useThemedStyles((n) => ({
    container: {
      gap: SPACING.lg,
    },
    heroSkeleton: {
      backgroundColor: n.dark800,
    },
    card: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      gap: SPACING.md,
    },
    rows: {
      gap: SPACING.sm,
    },
  }));

  return (
    <View
      accessible={true}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading competition"
      accessibilityState={{ busy: true }}
      style={styles.container}
    >
      {/* Hero skeleton */}
      <Skeleton height={200} borderRadius={RADIUS.xl} style={styles.heroSkeleton} />

      {/* Leaderboard skeleton */}
      <View style={styles.card}>
        <Skeleton width="40%" height={20} />
        <View style={styles.rows}>
          <Skeleton height={56} borderRadius={RADIUS.md} />
          <Skeleton height={56} borderRadius={RADIUS.md} />
          <Skeleton height={56} borderRadius={RADIUS.md} />
        </View>
      </View>

      {/* Activity feed skeleton */}
      <View style={styles.card}>
        <Skeleton width="30%" height={20} />
        <View style={styles.rows}>
          <Skeleton height={72} borderRadius={RADIUS.md} />
          <Skeleton height={72} borderRadius={RADIUS.md} />
          <Skeleton height={72} borderRadius={RADIUS.md} />
        </View>
      </View>
    </View>
  );
}
