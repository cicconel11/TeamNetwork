/**
 * Badge/Chip Component
 * Status badges, role indicators, and category chips
 */

import React from "react";
import { View, Text, StyleSheet, ViewStyle, TextStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  useSharedValue,
} from "react-native-reanimated";
import { NEUTRAL, SEMANTIC, ROLE_COLORS, ENERGY, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

export type BadgeVariant =
  | "success"
  | "warning"
  | "error"
  | "info"
  | "neutral"
  | "admin"
  | "member"
  | "alumni"
  | "live";

export type BadgeSize = "sm" | "md";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: React.ReactNode;
  dot?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  accessibilityLabel?: string;
}

interface LiveBadgeProps {
  size?: BadgeSize;
  style?: ViewStyle;
}

function getVariantColors(variant: BadgeVariant) {
  switch (variant) {
    case "success":
      return {
        background: SEMANTIC.successLight,
        text: SEMANTIC.success,
      };
    case "warning":
      return {
        background: SEMANTIC.warningLight,
        text: SEMANTIC.warning,
      };
    case "error":
      return {
        background: SEMANTIC.errorLight,
        text: SEMANTIC.error,
      };
    case "info":
      return {
        background: SEMANTIC.infoLight,
        text: SEMANTIC.info,
      };
    case "neutral":
      return {
        background: NEUTRAL.divider,
        text: NEUTRAL.secondary,
      };
    case "admin":
      return ROLE_COLORS.admin;
    case "member":
      return ROLE_COLORS.member;
    case "alumni":
      return ROLE_COLORS.alumni;
    case "live":
      return {
        background: SEMANTIC.errorLight,
        text: SEMANTIC.error,
      };
  }
}

export function Badge({
  children,
  variant = "neutral",
  size = "md",
  icon,
  dot = false,
  style,
  textStyle,
  accessibilityLabel,
}: BadgeProps) {
  const colors = getVariantColors(variant);
  const sizeStyles = SIZE_STYLES[size];

  const containerStyle: ViewStyle = {
    ...styles.container,
    ...sizeStyles.container,
    backgroundColor: colors.background,
  };

  const labelStyle: TextStyle = {
    ...sizeStyles.text,
    color: colors.text,
  };

  // Derive accessibility label from children if not provided
  const derivedLabel =
    accessibilityLabel ??
    (typeof children === "string" ? children : undefined);

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={derivedLabel}
      style={[containerStyle, style]}
    >
      {dot && (
        <View
          style={[
            styles.dot,
            { backgroundColor: colors.text },
            sizeStyles.dot,
          ]}
        />
      )}
      {icon && <View style={styles.icon}>{icon}</View>}
      <Text style={[labelStyle, textStyle]}>{children}</Text>
    </View>
  );
}

// Live badge with animated pulsing dot
export function LiveBadge({ size = "md", style }: LiveBadgeProps) {
  const opacity = useSharedValue(1);

  React.useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.4, { duration: 500 }),
        withTiming(1, { duration: 500 })
      ),
      -1, // infinite
      false
    );
  }, [opacity]);

  const animatedDotStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const sizeStyles = SIZE_STYLES[size];

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel="Live"
      style={[
        styles.container,
        sizeStyles.container,
        { backgroundColor: SEMANTIC.errorLight },
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.liveDot,
          sizeStyles.dot,
          { backgroundColor: ENERGY.live },
          animatedDotStyle,
        ]}
      />
      <Text
        style={[
          sizeStyles.text,
          { color: SEMANTIC.error, fontWeight: "600" },
        ]}
      >
        LIVE
      </Text>
    </View>
  );
}

// Count badge (for notification counts)
interface CountBadgeProps {
  count: number;
  max?: number;
  color?: string;
  style?: ViewStyle;
}

export function CountBadge({
  count,
  max = 99,
  color = SEMANTIC.error,
  style,
}: CountBadgeProps) {
  if (count <= 0) return null;

  const displayCount = count > max ? `${max}+` : count.toString();
  const isLarge = count > 9;
  const accessibilityLabel =
    count > max ? `${count} notifications` : `${count} notification${count === 1 ? "" : "s"}`;

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.countBadge,
        { backgroundColor: color },
        isLarge && styles.countBadgeLarge,
        style,
      ]}
    >
      <Text style={styles.countText}>{displayCount}</Text>
    </View>
  );
}

// Pinned badge for announcements
export function PinnedBadge({ style }: { style?: ViewStyle }) {
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel="Pinned"
      style={[styles.pinnedBadge, style]}
    >
      <Text style={styles.pinnedText}>PINNED</Text>
    </View>
  );
}

// Role badge helper
interface RoleBadgeProps {
  role: "admin" | "member" | "alumni";
  size?: BadgeSize;
  style?: ViewStyle;
}

export function RoleBadge({ role, size = "sm", style }: RoleBadgeProps) {
  const labels = {
    admin: "Admin",
    member: "Member",
    alumni: "Alumni",
  };

  return (
    <Badge
      variant={role}
      size={size}
      style={style}
      accessibilityLabel={`Role: ${labels[role]}`}
    >
      {labels[role]}
    </Badge>
  );
}

const SIZE_STYLES = {
  sm: {
    container: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: RADIUS.xs,
    } as ViewStyle,
    text: {
      ...TYPOGRAPHY.labelSmall,
      fontSize: 10,
    } as TextStyle,
    dot: {
      width: 5,
      height: 5,
      borderRadius: 2.5,
    } as ViewStyle,
  },
  md: {
    container: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: RADIUS.sm,
    } as ViewStyle,
    text: {
      ...TYPOGRAPHY.labelSmall,
    } as TextStyle,
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    } as ViewStyle,
  },
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
  },
  dot: {
    marginRight: 4,
  },
  liveDot: {
    marginRight: 4,
  },
  icon: {
    marginRight: 4,
  },
  countBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  countBadgeLarge: {
    minWidth: 24,
    paddingHorizontal: 6,
  },
  countText: {
    ...TYPOGRAPHY.labelSmall,
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "700",
  },
  pinnedBadge: {
    backgroundColor: "#fef3c7", // amber-100
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.xs,
  },
  pinnedText: {
    ...TYPOGRAPHY.overline,
    fontSize: 9,
    color: "#b45309", // amber-700
    letterSpacing: 0.5,
  },
});
