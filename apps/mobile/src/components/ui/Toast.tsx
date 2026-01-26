/**
 * Toast Component
 * Feedback notifications for success/error/info states
 */

import React, { useEffect, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  FadeInDown,
  FadeOutDown,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, X, AlertCircle, Info } from "lucide-react-native";
import { NEUTRAL, SEMANTIC, RADIUS, SPACING, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

export type ToastVariant = "success" | "error" | "warning" | "info";

interface ToastProps {
  visible: boolean;
  message: string;
  variant?: ToastVariant;
  duration?: number; // auto-dismiss duration in ms
  onDismiss?: () => void;
  action?: {
    label: string;
    onPress: () => void;
  };
}

interface ToastState {
  visible: boolean;
  message: string;
  variant: ToastVariant;
  action?: { label: string; onPress: () => void };
}

// Toast context for global toast management
const ToastContext = React.createContext<{
  show: (message: string, variant?: ToastVariant, action?: ToastState["action"]) => void;
  hide: () => void;
} | null>(null);

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<ToastState>({
    visible: false,
    message: "",
    variant: "success",
  });

  const show = useCallback(
    (
      message: string,
      variant: ToastVariant = "success",
      action?: ToastState["action"]
    ) => {
      setState({ visible: true, message, variant, action });
    },
    []
  );

  const hide = useCallback(() => {
    setState((prev) => ({ ...prev, visible: false }));
  }, []);

  return (
    <ToastContext.Provider value={{ show, hide }}>
      {children}
      <Toast
        visible={state.visible}
        message={state.message}
        variant={state.variant}
        action={state.action}
        onDismiss={hide}
      />
    </ToastContext.Provider>
  );
}

function getVariantStyles(variant: ToastVariant) {
  switch (variant) {
    case "success":
      return {
        backgroundColor: SEMANTIC.successLight,
        textColor: "#047857", // emerald-700
        iconColor: SEMANTIC.success,
        Icon: Check,
      };
    case "error":
      return {
        backgroundColor: SEMANTIC.errorLight,
        textColor: "#b91c1c", // red-700
        iconColor: SEMANTIC.error,
        Icon: X,
      };
    case "warning":
      return {
        backgroundColor: SEMANTIC.warningLight,
        textColor: "#b45309", // amber-700
        iconColor: SEMANTIC.warning,
        Icon: AlertCircle,
      };
    case "info":
      return {
        backgroundColor: SEMANTIC.infoLight,
        textColor: "#0369a1", // sky-700
        iconColor: SEMANTIC.info,
        Icon: Info,
      };
  }
}

export function Toast({
  visible,
  message,
  variant = "success",
  duration = 3000,
  onDismiss,
  action,
}: ToastProps) {
  const insets = useSafeAreaInsets();
  const variantStyles = getVariantStyles(variant);

  useEffect(() => {
    if (visible && duration > 0) {
      const timer = setTimeout(() => {
        onDismiss?.();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [visible, duration, onDismiss]);

  if (!visible) return null;

  const { Icon, backgroundColor, textColor, iconColor } = variantStyles;

  return (
    <Animated.View
      entering={FadeInDown.springify().damping(15).stiffness(300)}
      exiting={FadeOutDown.duration(200)}
      style={[
        styles.container,
        {
          backgroundColor,
          bottom: insets.bottom + SPACING.md,
        },
      ]}
    >
      <View style={styles.iconContainer}>
        <Icon size={18} color={iconColor} />
      </View>

      <Text
        accessible={true}
        accessibilityRole={variant === "error" ? "alert" : "text"}
        accessibilityLiveRegion="polite"
        style={[styles.message, { color: textColor }]}
        numberOfLines={2}
      >
        {message}
      </Text>

      {action && (
        <Pressable
          onPress={() => {
            action.onPress();
            onDismiss?.();
          }}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={({ pressed }) => [
            styles.actionButton,
            pressed && styles.actionButtonPressed,
          ]}
        >
          <Text style={[styles.actionText, { color: textColor }]}>
            {action.label}
          </Text>
        </Pressable>
      )}

      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss notification"
        style={({ pressed }) => [
          styles.dismissButton,
          pressed && styles.dismissButtonPressed,
        ]}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <X size={16} color={textColor} />
      </Pressable>
    </Animated.View>
  );
}

// Standalone toast functions for quick use (can be connected via context)
let globalShowToast: ((message: string, variant?: ToastVariant) => void) | null = null;

export function setGlobalShowToast(fn: typeof globalShowToast) {
  globalShowToast = fn;
}

export function showToast(
  message: string,
  variant: ToastVariant = "success"
) {
  globalShowToast?.(message, variant);
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: SPACING.md,
    right: SPACING.md,
    flexDirection: "row",
    alignItems: "center",
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    ...SHADOWS.lg,
  },
  iconContainer: {
    marginRight: SPACING.sm,
  },
  message: {
    ...TYPOGRAPHY.bodyMedium,
    flex: 1,
    fontWeight: "500",
  },
  actionButton: {
    marginLeft: SPACING.sm,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  actionButtonPressed: {
    opacity: 0.7,
  },
  actionText: {
    ...TYPOGRAPHY.labelMedium,
    fontWeight: "600",
  },
  dismissButton: {
    marginLeft: SPACING.sm,
    padding: 4,
  },
  dismissButtonPressed: {
    opacity: 0.7,
  },
});
