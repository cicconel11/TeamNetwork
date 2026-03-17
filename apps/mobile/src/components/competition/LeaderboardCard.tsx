import React from "react";
import { Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { LiveDot } from "./LiveDot";
import { RADIUS, SPACING, ENERGY } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import type { LeaderboardEntry } from "@/hooks/competitionHelpers";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

const COMP = {
  gold: "#eab308",
  silver: "#94a3b8",
  bronze: "#b45309",
} as const;

interface LeaderboardCardProps {
  leaderboard: LeaderboardEntry[];
  maxPoints: number;
  season?: string | null;
}

function rankBadgeColors(index: number, borderColor: string, mutedColor: string) {
  if (index === 0) return { bg: COMP.gold, text: "#ffffff" };
  if (index === 1) return { bg: COMP.silver, text: "#ffffff" };
  if (index === 2) return { bg: COMP.bronze, text: "#ffffff" };
  return { bg: borderColor, text: mutedColor };
}

function barFillColor(index: number): string {
  if (index === 0) return ENERGY.gold;
  if (index === 1) return COMP.silver;
  if (index === 2) return COMP.bronze;
  return "#94a3b8";
}

function barFillOpacity(index: number): number {
  return index > 2 ? 0.65 : 1;
}

export function LeaderboardCard({ leaderboard, maxPoints, season }: LeaderboardCardProps) {
  const { neutral } = useAppColorScheme();
  const styles = useThemedStyles((n) => ({
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
    subtitle: {
      ...TYPOGRAPHY.caption,
      color: n.secondary,
      marginTop: 2,
    },
    liveIndicator: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
    },
    liveText: {
      ...TYPOGRAPHY.labelSmall,
      color: ENERGY.online,
    },
    list: {
      gap: SPACING.sm,
    },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.md,
      padding: SPACING.sm,
      borderRadius: RADIUS.md,
      backgroundColor: n.background,
    },
    rankBadge: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    rankText: {
      ...TYPOGRAPHY.labelMedium,
      fontWeight: "700" as const,
    },
    nameColumn: {
      flex: 1,
      gap: SPACING.xs,
    },
    teamName: {
      ...TYPOGRAPHY.titleSmall,
      color: n.foreground,
    },
    progressTrack: {
      height: 4,
      backgroundColor: n.border,
      borderRadius: 2,
      overflow: "hidden" as const,
    },
    progressFill: {
      height: 4,
      borderRadius: 2,
    },
    pointsValue: {
      ...TYPOGRAPHY.titleLarge,
      fontVariant: ["tabular-nums"] as const,
      color: n.foreground,
    },
    emptyText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
    },
  }));

  if (leaderboard.length === 0) {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>Leaderboard</Text>
        </View>
        <Text style={styles.emptyText}>No points recorded yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Leaderboard</Text>
          {season ? <Text style={styles.subtitle}>Season {season}</Text> : null}
        </View>
        <View style={styles.liveIndicator}>
          <LiveDot color={ENERGY.online} />
          <Text style={styles.liveText}>Live</Text>
        </View>
      </View>

      <View style={styles.list}>
        {leaderboard.map((team, index) => {
          const badge = rankBadgeColors(index, neutral.border, neutral.muted);
          const fillPct = maxPoints > 0 ? (team.total_points / maxPoints) * 100 : 0;
          const fillColor = barFillColor(index);
          const opacity = barFillOpacity(index);

          return (
            <Animated.View
              key={`${team.name}-${index}`}
              entering={FadeInDown.delay(index * 60).duration(300)}
              style={styles.row}
              accessibilityLabel={`${team.name}, rank ${index + 1}, ${team.total_points} points`}
            >
              <View style={[styles.rankBadge, { backgroundColor: badge.bg }]}>
                <Text style={[styles.rankText, { color: badge.text }]}>{index + 1}</Text>
              </View>

              <View style={styles.nameColumn}>
                <Text style={styles.teamName}>{team.name}</Text>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${fillPct}%`, backgroundColor: fillColor, opacity },
                    ]}
                  />
                </View>
              </View>

              <Text style={styles.pointsValue}>{team.total_points}</Text>
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}
