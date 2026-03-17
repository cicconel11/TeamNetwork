import React from "react";
import { Text, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { Edit3 } from "lucide-react-native";
import { NEUTRAL, SPACING, RADIUS, SHADOWS, ANIMATION } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { Avatar } from "@/components/ui/Avatar";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface FeedComposerBarProps {
  onPress: () => void;
  userAvatarUrl?: string | null;
  userName?: string | null;
}

export function FeedComposerBar({ onPress, userAvatarUrl, userName }: FeedComposerBarProps) {
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
          <Edit3 size={18} color={NEUTRAL.muted} />
        </View>
      )}
      <Text style={styles.placeholder}>What's on your mind?</Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    padding: SPACING.sm,
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
    ...SHADOWS.sm,
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: NEUTRAL.background,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholder: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.muted,
    flex: 1,
  },
});
