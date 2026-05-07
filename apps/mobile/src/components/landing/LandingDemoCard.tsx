/**
 * LandingDemoCard
 *
 * Mirrors the South Rock Ridge HS preview card from the web landing page.
 * Header → 3-up stats scoreboard → 3 feature rows.
 */

import { View, Text, StyleSheet } from "react-native";
import type { DemoOrg } from "@teammeet/core";
import { ENERGY, RADIUS, SHADOWS, SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { resolveLandingIcon } from "./landingIconMap";

interface LandingDemoCardProps {
  org: DemoOrg;
}

export function LandingDemoCard({ org }: LandingDemoCardProps) {
  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{org.initials}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.orgName} numberOfLines={1}>
            {org.name}
          </Text>
          <Text style={styles.orgLocation} numberOfLines={1}>
            {org.location}
          </Text>
        </View>
      </View>

      {/* Scoreboard stats */}
      <View style={styles.statsRow}>
        <Stat value={String(org.stats.members)} label="Members" />
        <View style={styles.statDivider} />
        <Stat value={String(org.stats.events)} label="Events" />
        <View style={styles.statDivider} />
        <Stat value={org.stats.donations} label="Donations" />
      </View>

      {/* Feature rows */}
      <View style={styles.rows}>
        {org.rows.map((row) => {
          const Icon = resolveLandingIcon(row.icon);
          return (
            <View key={row.label} style={styles.row}>
              <View style={styles.rowIcon}>
                <Icon size={16} color="rgba(255,255,255,0.85)" />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                <Text style={styles.rowValue} numberOfLines={1}>
                  {row.value}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

interface StatProps {
  value: string;
  label: string;
}

function Stat({ value, label }: StatProps) {
  return (
    <View
      style={styles.stat}
      accessible
      accessibilityLabel={`${value} ${label}`}
    >
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const CARD_BG = "rgba(15, 23, 42, 0.7)";
const CARD_BORDER = "rgba(255, 255, 255, 0.1)";
const SUBTLE_BG = "rgba(255, 255, 255, 0.05)";
const SCOREBOARD_BG = "#0a0a0a";
const ROW_BG = "rgba(15, 23, 42, 0.6)";

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD_BG,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    overflow: "hidden",
    ...SHADOWS.lg,
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    padding: SPACING.lg,
    backgroundColor: SUBTLE_BG,
    borderBottomWidth: 1,
    borderBottomColor: CARD_BORDER,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: RADIUS.lg,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    ...TYPOGRAPHY.titleLarge,
    color: "#ffffff",
    fontWeight: "700",
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  orgName: {
    ...TYPOGRAPHY.titleLarge,
    color: "#ffffff",
    fontWeight: "700",
  },
  orgLocation: {
    ...TYPOGRAPHY.bodySmall,
    color: "rgba(255, 255, 255, 0.5)",
    marginTop: 2,
  },

  // Stats
  statsRow: {
    flexDirection: "row",
    backgroundColor: SCOREBOARD_BG,
    borderBottomWidth: 1,
    borderBottomColor: CARD_BORDER,
  },
  stat: {
    flex: 1,
    alignItems: "center",
    paddingVertical: SPACING.md,
  },
  statValue: {
    fontSize: 22,
    fontWeight: "700",
    color: ENERGY.online,
    fontVariant: ["tabular-nums"],
    textShadowColor: "rgba(34, 197, 94, 0.5)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  statLabel: {
    ...TYPOGRAPHY.overline,
    color: "rgba(255, 255, 255, 0.5)",
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: CARD_BORDER,
  },

  // Rows
  rows: {
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm + 4,
    padding: SPACING.sm + 4,
    borderRadius: RADIUS.md,
    backgroundColor: ROW_BG,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.md,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontSize: 11,
    color: "rgba(255, 255, 255, 0.5)",
    letterSpacing: 0.3,
  },
  rowValue: {
    ...TYPOGRAPHY.bodySmall,
    color: "#ffffff",
    marginTop: 2,
  },
});
