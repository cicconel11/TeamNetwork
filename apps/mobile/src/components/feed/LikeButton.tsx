import React from "react";
import { View, Text, Pressable } from "react-native";
import { Heart } from "lucide-react-native";
import { SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface LikeButtonProps {
  liked: boolean;
  count: number;
  onPress: () => void;
}

export function LikeButton({ liked, count, onPress }: LikeButtonProps) {
  const { neutral, semantic } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    container: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
    },
    count: {
      ...TYPOGRAPHY.labelMedium,
      color: n.muted,
    },
    countLiked: {
      color: s.error,
    },
  }));

  return (
    <Pressable
      onPress={onPress}
      style={styles.container}
      accessibilityLabel={liked ? "Unlike post" : "Like post"}
      accessibilityState={{ selected: liked }}
      accessibilityRole="button"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Heart
        size={18}
        color={liked ? semantic.error : neutral.muted}
        fill={liked ? semantic.error : "none"}
      />
      <Text style={[styles.count, liked && styles.countLiked]}>
        {count}
      </Text>
    </Pressable>
  );
}
