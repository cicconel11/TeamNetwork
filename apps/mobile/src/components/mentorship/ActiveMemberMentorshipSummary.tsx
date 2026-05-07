import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import { formatDefaultDateFromString } from "@/lib/date-format";

export function ActiveMemberMentorshipSummary({
  myMentorName,
  myLastLogDate,
}: {
  myMentorName: string | null;
  myLastLogDate: string | null;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {myMentorName ? `My mentor: ${myMentorName}` : "Looking for a mentor"}
        </Text>
        <Text style={styles.sectionSubtitle}>
          {myLastLogDate
            ? `Last session: ${formatDefaultDateFromString(myLastLogDate)}`
            : "Browse the mentor directory below to find alumni willing to help."}
        </Text>
      </View>
    </View>
  );
}

const createStyles = (n: NeutralColors, _s: SemanticColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      gap: SPACING.md,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
    },
    sectionHeader: {
      gap: SPACING.xs,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: n.foreground,
    },
    sectionSubtitle: {
      fontSize: 14,
      color: n.muted,
    },
  });
