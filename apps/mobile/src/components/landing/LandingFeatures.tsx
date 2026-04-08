/**
 * LandingFeatures
 *
 * Two-column features grid. Six fixed items rendered with .map() — no
 * virtualization wrapper (FlatList is a net loss for bounded lists this small).
 */

import { View, Text, StyleSheet } from "react-native";
import type { MarketingFeature } from "@teammeet/core";
import { RADIUS, SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { resolveLandingIcon } from "./landingIconMap";

interface LandingFeaturesProps {
  features: MarketingFeature[];
}

export function LandingFeatures({ features }: LandingFeaturesProps) {
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>Features</Text>
        <Text style={styles.title}>Everything your team needs</Text>
        <Text style={styles.subtitle}>
          From daily operations to alumni engagement, we&apos;ve got you covered.
        </Text>
      </View>

      <View style={styles.grid}>
        {features.map((feature) => {
          const Icon = resolveLandingIcon(feature.icon);
          return (
            <View key={feature.id} style={styles.cell}>
              <View style={styles.card}>
                <View style={styles.iconWrap}>
                  <Icon size={20} color="#ffffff" />
                </View>
                <Text style={styles.featureTitle}>{feature.title}</Text>
                <Text style={styles.featureDescription}>{feature.description}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const CARD_BG = "rgba(15, 23, 42, 0.55)";
const CARD_BORDER = "rgba(255, 255, 255, 0.08)";

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xxl,
    paddingBottom: SPACING.xl,
  },
  heading: {
    alignItems: "center",
    marginBottom: SPACING.xl,
  },
  eyebrow: {
    ...TYPOGRAPHY.overline,
    color: "rgba(255, 255, 255, 0.55)",
    marginBottom: SPACING.sm,
  },
  title: {
    ...TYPOGRAPHY.displayMedium,
    color: "#ffffff",
    textAlign: "center",
    marginBottom: SPACING.sm,
  },
  subtitle: {
    ...TYPOGRAPHY.bodyMedium,
    color: "rgba(255, 255, 255, 0.6)",
    textAlign: "center",
    maxWidth: 320,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -SPACING.xs,
  },
  cell: {
    width: "50%",
    paddingHorizontal: SPACING.xs,
    paddingBottom: SPACING.sm + 4,
  },
  card: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    minHeight: 150,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderWidth: 1,
    borderColor: CARD_BORDER,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.sm + 2,
  },
  featureTitle: {
    ...TYPOGRAPHY.titleMedium,
    color: "#ffffff",
    fontWeight: "600",
    marginBottom: 4,
  },
  featureDescription: {
    ...TYPOGRAPHY.bodySmall,
    color: "rgba(255, 255, 255, 0.55)",
    lineHeight: 18,
  },
});
