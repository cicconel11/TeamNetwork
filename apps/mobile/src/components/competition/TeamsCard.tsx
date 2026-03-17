import React from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { RADIUS, SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatLocalDateString } from "@/lib/date-format";
import type { CompetitionTeam } from "@teammeet/types";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface TeamsCardProps {
  teams: CompetitionTeam[];
  teamPoints: Map<string, number>;
  isAdmin: boolean;
  onAddTeam: () => void;
}

export function TeamsCard({ teams, teamPoints, isAdmin, onAddTeam }: TeamsCardProps) {
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
    addButton: {
      paddingVertical: SPACING.xs + 2,
      paddingHorizontal: SPACING.md,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    addButtonPressed: {
      opacity: 0.85,
    },
    addButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
    },
    list: {
      gap: SPACING.sm,
    },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: SPACING.sm,
      padding: SPACING.sm,
      borderRadius: RADIUS.md,
      backgroundColor: n.background,
    },
    teamInfo: {
      flex: 1,
    },
    teamName: {
      ...TYPOGRAPHY.titleSmall,
      color: n.foreground,
    },
    teamMeta: {
      ...TYPOGRAPHY.caption,
      color: n.secondary,
      marginTop: 2,
    },
    pointsBadge: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs,
      borderRadius: 999,
      backgroundColor: n.surface,
      borderWidth: 1,
      borderColor: n.border,
    },
    pointsText: {
      ...TYPOGRAPHY.labelSmall,
      fontVariant: ["tabular-nums"] as const,
      color: n.foreground,
    },
    emptyText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
    },
  }));

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Teams</Text>
          <Text style={styles.subtitle}>{teams.length} active {teams.length === 1 ? "team" : "teams"}</Text>
        </View>
        {isAdmin ? (
          <Pressable
            onPress={onAddTeam}
            style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Add team"
          >
            <Text style={styles.addButtonText}>Add Team</Text>
          </Pressable>
        ) : null}
      </View>

      {teams.length > 0 ? (
        <View style={styles.list}>
          {teams.map((team, index) => (
            <Animated.View
              key={team.id}
              entering={FadeInDown.delay(index * 50).duration(250)}
              style={styles.row}
            >
              <View style={styles.teamInfo}>
                <Text style={styles.teamName}>{team.name}</Text>
                <Text style={styles.teamMeta}>
                  Created {formatLocalDateString(team.created_at)}
                </Text>
              </View>
              <View style={styles.pointsBadge}>
                <Text style={styles.pointsText}>
                  {teamPoints.get(team.name) ?? 0} pts
                </Text>
              </View>
            </Animated.View>
          ))}
        </View>
      ) : (
        <Text style={styles.emptyText}>No teams yet.</Text>
      )}
    </View>
  );
}
