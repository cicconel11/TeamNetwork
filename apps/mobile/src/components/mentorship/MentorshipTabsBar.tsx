import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";

export type MentorshipTabId = "pairs" | "directory" | "proposals" | "matches";

export type MentorshipTabConfig = {
  id: MentorshipTabId;
  label: string;
  badge?: number;
};

export function MentorshipTabsBar({
  tabs,
  active,
  onChange,
}: {
  tabs: MentorshipTabConfig[];
  active: MentorshipTabId;
  onChange: (id: MentorshipTabId) => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <Pressable
              key={tab.id}
              onPress={() => onChange(tab.id)}
              style={({ pressed }) => [
                styles.pill,
                isActive && styles.pillActive,
                pressed && styles.pillPressed,
              ]}
            >
              <Text
                style={[styles.pillLabel, isActive && styles.pillLabelActive]}
              >
                {tab.label}
              </Text>
              {tab.badge && tab.badge > 0 ? (
                <View
                  style={[styles.badge, isActive && styles.badgeActive]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      isActive && styles.badgeTextActive,
                    ]}
                  >
                    {tab.badge}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const createStyles = (n: NeutralColors, s: SemanticColors) =>
  StyleSheet.create({
    wrapper: {
      borderBottomWidth: 1,
      borderBottomColor: n.border,
      backgroundColor: n.surface,
    },
    scrollContent: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      gap: SPACING.xs,
      flexDirection: "row",
    },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs + 2,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
      gap: SPACING.xs,
    },
    pillActive: {
      backgroundColor: s.success,
      borderColor: s.success,
    },
    pillPressed: {
      opacity: 0.85,
    },
    pillLabel: {
      fontSize: 14,
      fontWeight: "600",
      color: n.foreground,
    },
    pillLabelActive: {
      color: "#ffffff",
    },
    badge: {
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 6,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: n.divider,
    },
    badgeActive: {
      backgroundColor: "rgba(255,255,255,0.25)",
    },
    badgeText: {
      fontSize: 11,
      fontWeight: "700",
      color: n.foreground,
    },
    badgeTextActive: {
      color: "#ffffff",
    },
  });
