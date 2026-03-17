import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Trophy } from "lucide-react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { LiveDot } from "./LiveDot";
import { NEUTRAL, RADIUS, SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

const COMP = {
  amber: "#f59e0b",
  amberDim: "rgba(245,158,11,0.6)",
} as const;

interface HeroScoreboardProps {
  teamName: string;
  points: number;
}

export function HeroScoreboard({ teamName, points }: HeroScoreboardProps) {
  return (
    <Animated.View
      entering={FadeInDown.duration(400)}
      style={styles.card}
      accessibilityRole="summary"
      accessibilityLabel={`Current leader: ${teamName} with ${points} points`}
    >
      <View style={styles.liveRow}>
        <LiveDot color={COMP.amber} />
        <Text style={styles.liveLabel}>CURRENT LEADER</Text>
      </View>

      <View style={styles.center}>
        <LinearGradient
          colors={["#f59e0b", "#d97706"]}
          style={styles.trophyCircle}
        >
          <Trophy size={32} color="#ffffff" />
        </LinearGradient>

        <Text style={styles.teamName}>{teamName}</Text>

        <Text style={styles.pointsValue}>{points}</Text>
        <Text style={styles.pointsLabel}>points</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: NEUTRAL.dark900,
    borderWidth: 1,
    borderColor: NEUTRAL.dark800,
    borderRadius: RADIUS.xl,
    borderCurve: "continuous",
    padding: SPACING.lg,
    boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
  },
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  liveLabel: {
    ...TYPOGRAPHY.overline,
    color: COMP.amber,
  },
  center: {
    alignItems: "center",
    marginTop: SPACING.md,
    gap: SPACING.xs,
  },
  trophyCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.sm,
  },
  teamName: {
    ...TYPOGRAPHY.displayMedium,
    color: "#ffffff",
    textAlign: "center",
  },
  pointsValue: {
    fontSize: 48,
    lineHeight: 56,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    color: COMP.amber,
  },
  pointsLabel: {
    ...TYPOGRAPHY.caption,
    color: "rgba(255,255,255,0.6)",
  },
});
