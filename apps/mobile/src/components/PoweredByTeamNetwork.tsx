import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { TYPOGRAPHY } from "@/lib/typography";
import { SPACING } from "@/lib/design-tokens";

interface Props {
  variant?: "powered-by" | "watermark";
}

export function PoweredByTeamNetwork({ variant = "powered-by" }: Props) {
  const styles = useThemedStyles((n) => ({
    wrap: {
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingVertical: SPACING.md,
    },
    text: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      letterSpacing: 0.3,
    },
    brand: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      fontWeight: "600" as const,
      letterSpacing: 0.3,
    },
  }));

  if (variant === "watermark") {
    return (
      <View style={styles.wrap}>
        <Text style={styles.brand}>TeamNetwork</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>
        Powered by <Text style={styles.brand}>TeamNetwork</Text>
      </Text>
    </View>
  );
}
