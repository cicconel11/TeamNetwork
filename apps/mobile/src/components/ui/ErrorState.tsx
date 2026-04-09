import React from "react";
import { View, Text, Pressable } from "react-native";
import { RefreshCw } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";

interface ErrorStateProps {
  onRetry: () => void;
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  isOffline?: boolean;
}

const createErrorStyles = (n: NeutralColors, s: SemanticColors) => ({
  container: {
    flex: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    padding: SPACING.xl,
  },
  card: {
    backgroundColor: n.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: n.border,
    padding: SPACING.xl,
    alignItems: "center" as const,
    ...SHADOWS.sm,
    width: "100%" as const,
    maxWidth: 340,
  },
  iconContainer: {
    marginBottom: SPACING.sm,
  },
  title: {
    ...TYPOGRAPHY.titleMedium,
    color: n.foreground,
    textAlign: "center" as const,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    ...TYPOGRAPHY.bodySmall,
    color: n.muted,
    textAlign: "center" as const,
    marginBottom: SPACING.md,
  },
  retryButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: SPACING.sm,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
    backgroundColor: s.success,
  },
  retryButtonPressed: {
    opacity: 0.8,
  },
  retryButtonDisabled: {
    opacity: 0.5,
  },
  retryButtonText: {
    ...TYPOGRAPHY.labelMedium,
    color: "#ffffff",
  },
  offlineHint: {
    ...TYPOGRAPHY.caption,
    color: n.muted,
    textAlign: "center" as const,
    marginTop: SPACING.sm,
  },
});

export const ErrorState = React.memo(function ErrorState({
  onRetry,
  title = "Something went wrong",
  subtitle = "Please try again.",
  icon,
  isOffline = false,
}: ErrorStateProps) {
  const styles = useThemedStyles(createErrorStyles);

  const handleRetry = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    onRetry();
  };

  const defaultIcon = (
    <RefreshCw size={40} color={styles.title.color} style={{ opacity: 0.3 }} />
  );

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconContainer}>
          {icon ?? defaultIcon}
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>
          {isOffline ? "You're offline." : subtitle}
        </Text>
        <Pressable
          onPress={handleRetry}
          disabled={isOffline}
          style={({ pressed }) => [
            styles.retryButton,
            isOffline && styles.retryButtonDisabled,
            pressed && !isOffline && styles.retryButtonPressed,
          ]}
          accessibilityLabel="Retry loading"
          accessibilityRole="button"
          accessibilityState={{ disabled: isOffline }}
        >
          <RefreshCw size={16} color="#ffffff" />
          <Text style={styles.retryButtonText}>Try again</Text>
        </Pressable>
        {isOffline && (
          <Text style={styles.offlineHint}>
            Connect to the internet to retry
          </Text>
        )}
      </View>
    </View>
  );
});
