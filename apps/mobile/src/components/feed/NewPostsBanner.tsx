import React from "react";
import { Text, Pressable } from "react-native";
import { SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface NewPostsBannerProps {
  count: number;
  onPress: () => void;
}

export function NewPostsBanner({ count, onPress }: NewPostsBannerProps) {
  const styles = useThemedStyles((n, s) => ({
    banner: {
      position: "absolute" as const,
      top: SPACING.sm,
      left: SPACING.md,
      right: SPACING.md,
      backgroundColor: s.info,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      borderRadius: RADIUS.lg,
      alignItems: "center" as const,
      zIndex: 10,
      ...SHADOWS.md,
    },
    text: {
      ...TYPOGRAPHY.labelMedium,
      color: n.surface,
      fontWeight: "600" as const,
    },
  }));

  if (count === 0) return null;

  const label = count === 1 ? "1 new post" : `${count} new posts`;

  return (
    <Pressable
      onPress={onPress}
      style={styles.banner}
      accessibilityRole="button"
      accessibilityLabel={`${label} — tap to refresh`}
    >
      <Text style={styles.text}>{label} — tap to refresh</Text>
    </Pressable>
  );
}
