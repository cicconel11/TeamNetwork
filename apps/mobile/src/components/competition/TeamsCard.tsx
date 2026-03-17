import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { NEUTRAL, RADIUS, SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatLocalDateString } from "@/lib/date-format";
import type { CompetitionTeam } from "@teammeet/types";

interface TeamsCardProps {
  teams: CompetitionTeam[];
  teamPoints: Map<string, number>;
  isAdmin: boolean;
  onAddTeam: () => void;
}

export function TeamsCard({ teams, teamPoints, isAdmin, onAddTeam }: TeamsCardProps) {
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
  subtitle: {
    ...TYPOGRAPHY.caption,
    color: NEUTRAL.secondary,
    marginTop: 2,
  },
  addButton: {
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    backgroundColor: NEUTRAL.surface,
  },
  addButtonPressed: {
    opacity: 0.85,
  },
  addButtonText: {
    ...TYPOGRAPHY.labelMedium,
    color: NEUTRAL.foreground,
  },
  list: {
    gap: SPACING.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: NEUTRAL.background,
  },
  teamInfo: {
    flex: 1,
  },
  teamName: {
    ...TYPOGRAPHY.titleSmall,
    color: NEUTRAL.foreground,
  },
  teamMeta: {
    ...TYPOGRAPHY.caption,
    color: NEUTRAL.secondary,
    marginTop: 2,
  },
  pointsBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: 999,
    backgroundColor: NEUTRAL.surface,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
  },
  pointsText: {
    ...TYPOGRAPHY.labelSmall,
    fontVariant: ["tabular-nums"],
    color: NEUTRAL.foreground,
  },
  emptyText: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.secondary,
  },
});
