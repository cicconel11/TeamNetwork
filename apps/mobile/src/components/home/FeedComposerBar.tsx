import React from "react";
import { Text, Pressable, View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { Edit3 } from "lucide-react-native";
import { SPACING, RADIUS, SHADOWS, ANIMATION } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { Avatar } from "@/components/ui/Avatar";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface FeedComposerBarProps {
  onPress: () => void;
  userAvatarUrl?: string | null;
  userName?: string | null;
}

export function FeedComposerBar({ onPress, userAvatarUrl, userName }: FeedComposerBarProps) {
  const { neutral } = useAppColorScheme();
  const styles = useThemedStyles((n) => ({
    container: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.sm,
      paddingHorizontal: SPACING.md,
      gap: SPACING.sm,
      ...SHADOWS.sm,
    },
    avatarPlaceholder: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: n.background,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    placeholder: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.muted,
      flex: 1,
    },
  }));

  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const hasUserInfo = userAvatarUrl || userName;

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => {
        scale.value = withSpring(0.97, ANIMATION.spring);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, ANIMATION.spring);
      }}
      style={[styles.container, animatedStyle]}
      accessibilityRole="button"
      accessibilityLabel="Create a new post"
    >
      {hasUserInfo ? (
        <Avatar
          size="sm"
          uri={userAvatarUrl}
          name={userName || ""}
        />
      ) : (
        <View style={styles.avatarPlaceholder}>
          <Edit3 size={18} color={neutral.muted} />
        </View>
      )}
      <Text style={styles.placeholder}>What's on your mind?</Text>
    </AnimatedPressable>
  );
}
