import React from "react";
import { Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";
import { WifiOff } from "lucide-react-native";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";

interface OfflineBannerProps {
  isOffline: boolean;
}

const createBannerStyles = (_n: NeutralColors, s: SemanticColors) => ({
  wrapper: {
    backgroundColor: s.infoLight,
    borderLeftWidth: 4,
    borderLeftColor: s.info,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: SPACING.sm,
  },
  text: {
    ...TYPOGRAPHY.bodySmall,
    color: s.infoDark,
    flex: 1,
  },
});

export const OfflineBanner = React.memo(function OfflineBanner({
  isOffline,
}: OfflineBannerProps) {
  const styles = useThemedStyles(createBannerStyles);

  if (!isOffline) return null;

  return (
    <Animated.View
      entering={FadeInDown.springify().damping(15).stiffness(300)}
      exiting={FadeOutUp.duration(200)}
      style={styles.wrapper}
      accessibilityRole="alert"
    >
      <WifiOff size={16} color={styles.text.color} />
      <Text style={styles.text}>
        You're offline. Some features may not work.
      </Text>
    </Animated.View>
  );
});
