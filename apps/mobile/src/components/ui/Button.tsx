/**
 * Button Component
 * Premium button system with variants and press animations
 */

import React, { useCallback } from "react";
import {
  Pressable,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  ActivityIndicator,
  View,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { Check, X, HelpCircle } from "lucide-react-native";
import { NEUTRAL, SEMANTIC, RSVP_COLORS, RADIUS, ANIMATION } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "outline"
  | "danger";

export type ButtonSize = "sm" | "md" | "lg";

export type RSVPStatus = "going" | "maybe" | "declined";

interface ButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  pill?: boolean;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  onPress?: () => void;
  style?: ViewStyle;
  textStyle?: TextStyle;
  // For org-specific primary color
  primaryColor?: string;
  primaryForeground?: string;
  // Accessibility
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

interface RSVPButtonProps {
  status: RSVPStatus;
  selected?: boolean;
  onPress?: () => void;
  size?: ButtonSize;
  style?: ViewStyle;
  // Accessibility
  accessibilityHint?: string;
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  fullWidth = false,
  pill = false,
  icon,
  iconPosition = "left",
  onPress,
  style,
  textStyle,
  primaryColor,
  primaryForeground,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.98, ANIMATION.spring);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, ANIMATION.spring);
  }, [scale]);

  const sizeStyles = SIZE_STYLES[size];
  const variantStyles = getVariantStyles(variant, primaryColor, primaryForeground);

  const containerStyle: ViewStyle = {
    ...styles.base,
    ...sizeStyles.container,
    ...variantStyles.container,
    ...(pill && { borderRadius: RADIUS.full }),
    ...(fullWidth && { width: "100%" }),
    ...(disabled && styles.disabled),
  };

  const labelStyle: TextStyle = {
    ...TYPOGRAPHY.labelLarge,
    ...sizeStyles.text,
    ...variantStyles.text,
    ...(disabled && styles.disabledText),
  };

  const iconColor = disabled
    ? NEUTRAL.disabled
    : variantStyles.iconColor;

  // Derive accessibility label from children if it's a string
  const derivedAccessibilityLabel =
    accessibilityLabel ||
    (typeof children === "string" ? children : undefined);

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      style={[containerStyle, animatedStyle, style]}
      accessibilityRole="button"
      accessibilityLabel={derivedAccessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={iconColor}
        />
      ) : (
        <View style={styles.content}>
          {icon && iconPosition === "left" && (
            <View style={styles.iconLeft}>{icon}</View>
          )}
          <Text style={[labelStyle, textStyle]}>{children}</Text>
          {icon && iconPosition === "right" && (
            <View style={styles.iconRight}>{icon}</View>
          )}
        </View>
      )}
    </AnimatedPressable>
  );
}

export function RSVPButton({
  status,
  selected = false,
  onPress,
  size = "md",
  style,
  accessibilityHint,
}: RSVPButtonProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.98, ANIMATION.spring);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, ANIMATION.spring);
  }, [scale]);

  const colors = RSVP_COLORS[status];
  const sizeStyles = SIZE_STYLES[size];

  const getIcon = () => {
    const iconSize = size === "sm" ? 14 : size === "lg" ? 18 : 16;
    switch (status) {
      case "going":
        return <Check size={iconSize} color={colors.text} />;
      case "maybe":
        return <HelpCircle size={iconSize} color={colors.text} />;
      case "declined":
        return <X size={iconSize} color={colors.text} />;
    }
  };

  const getLabel = () => {
    switch (status) {
      case "going":
        return "Going";
      case "maybe":
        return "Maybe";
      case "declined":
        return "Can't Go";
    }
  };

  const containerStyle: ViewStyle = {
    ...styles.base,
    ...sizeStyles.container,
    backgroundColor: selected ? colors.background : NEUTRAL.surface,
    borderWidth: 1,
    borderColor: selected ? colors.border : NEUTRAL.border,
    borderRadius: RADIUS.lg,
  };

  const labelStyle: TextStyle = {
    ...TYPOGRAPHY.labelMedium,
    color: selected ? colors.text : NEUTRAL.secondary,
  };

  const rsvpLabel = getLabel();
  const accessibilityLabel = `RSVP ${rsvpLabel}: ${selected ? "selected" : "not selected"}`;

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[containerStyle, animatedStyle, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected }}
    >
      <View style={styles.content}>
        {getIcon()}
        <Text style={[labelStyle, styles.rsvpLabel]}>{rsvpLabel}</Text>
      </View>
    </AnimatedPressable>
  );
}

// Size configurations
const SIZE_STYLES = {
  sm: {
    container: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      minHeight: 36,
    } as ViewStyle,
    text: {
      fontSize: 13,
    } as TextStyle,
  },
  md: {
    container: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      minHeight: 44,
    } as ViewStyle,
    text: {
      fontSize: 14,
    } as TextStyle,
  },
  lg: {
    container: {
      paddingVertical: 14,
      paddingHorizontal: 20,
      minHeight: 52,
    } as ViewStyle,
    text: {
      fontSize: 16,
    } as TextStyle,
  },
};

// Variant configurations
function getVariantStyles(
  variant: ButtonVariant,
  primaryColor?: string,
  primaryForeground?: string
) {
  const primary = primaryColor || SEMANTIC.success;
  const foreground = primaryForeground || "#ffffff";

  switch (variant) {
    case "primary":
      return {
        container: {
          backgroundColor: primary,
        } as ViewStyle,
        text: {
          color: foreground,
        } as TextStyle,
        iconColor: foreground,
      };
    case "secondary":
      return {
        container: {
          backgroundColor: NEUTRAL.divider,
        } as ViewStyle,
        text: {
          color: NEUTRAL.foreground,
        } as TextStyle,
        iconColor: NEUTRAL.foreground,
      };
    case "ghost":
      return {
        container: {
          backgroundColor: "transparent",
        } as ViewStyle,
        text: {
          color: NEUTRAL.foreground,
        } as TextStyle,
        iconColor: NEUTRAL.foreground,
      };
    case "outline":
      return {
        container: {
          backgroundColor: "transparent",
          borderWidth: 1,
          borderColor: primary,
        } as ViewStyle,
        text: {
          color: primary,
        } as TextStyle,
        iconColor: primary,
      };
    case "danger":
      return {
        container: {
          backgroundColor: SEMANTIC.error,
        } as ViewStyle,
        text: {
          color: "#ffffff",
        } as TextStyle,
        iconColor: "#ffffff",
      };
  }
}

const styles = StyleSheet.create({
  base: {
    borderRadius: RADIUS.lg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  iconLeft: {
    marginRight: 6,
  },
  iconRight: {
    marginLeft: 6,
  },
  disabled: {
    backgroundColor: NEUTRAL.divider,
    borderColor: NEUTRAL.divider,
  },
  disabledText: {
    color: NEUTRAL.disabled,
  },
  rsvpLabel: {
    marginLeft: 6,
  },
});
