/**
 * Skeleton Loading Component
 * Shimmer animation for loading states
 */

import React, { useEffect } from "react";
import { View, StyleSheet, ViewStyle, DimensionValue } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  interpolate,
  Easing,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { RADIUS, SPACING } from "@/lib/design-tokens";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

interface SkeletonTextProps {
  lines?: number;
  lineHeight?: number;
  lastLineWidth?: DimensionValue;
  gap?: number;
  style?: ViewStyle;
}

interface SkeletonAvatarProps {
  size?: number;
  style?: ViewStyle;
}

interface SkeletonCardProps {
  style?: ViewStyle;
}

export function Skeleton({
  width = "100%",
  height = 16,
  borderRadius = RADIUS.sm,
  style,
}: SkeletonProps) {
  const { neutral } = useAppColorScheme();
  const shimmerPosition = useSharedValue(-1);

  useEffect(() => {
    shimmerPosition.value = withRepeat(
      withTiming(1, {
        duration: 1200,
        easing: Easing.ease,
      }),
      -1, // infinite
      false
    );
  }, [shimmerPosition]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          shimmerPosition.value,
          [-1, 1],
          [-100, 100]
        ),
      },
    ],
  }));

  return (
    <View
      accessible={true}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading content"
      accessibilityState={{ busy: true }}
      style={[
        {
          backgroundColor: neutral.border,
          overflow: "hidden",
          width,
          height,
          borderRadius,
        },
        style,
      ]}
    >
      <Animated.View style={[styles.shimmerContainer, animatedStyle]}>
        <LinearGradient
          colors={[
            "transparent",
            "rgba(255, 255, 255, 0.4)",
            "transparent",
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.shimmer}
        />
      </Animated.View>
    </View>
  );
}

export function SkeletonText({
  lines = 3,
  lineHeight = 14,
  lastLineWidth = "60%",
  gap = 8,
  style,
}: SkeletonTextProps) {
  return (
    <View
      accessible={true}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading text content"
      accessibilityState={{ busy: true }}
      style={[styles.textContainer, style]}
    >
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          width={index === lines - 1 ? lastLineWidth : "100%"}
          height={lineHeight}
          style={{ marginBottom: index < lines - 1 ? gap : 0 }}
        />
      ))}
    </View>
  );
}

export function SkeletonAvatar({ size = 40, style }: SkeletonAvatarProps) {
  return (
    <View
      accessible={true}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading avatar"
      accessibilityState={{ busy: true }}
    >
      <Skeleton
        width={size}
        height={size}
        borderRadius={size / 2}
        style={style}
      />
    </View>
  );
}

// Event card skeleton
export function SkeletonEventCard({ style }: SkeletonCardProps) {
  const styles2 = useThemedStyles((n) => ({
    card: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
    },
    eventCardFooter: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "center" as const,
      marginTop: SPACING.md,
      paddingTop: SPACING.sm,
      borderTopWidth: 1,
      borderTopColor: n.divider,
    },
  }));

  return (
    <View
      accessible={true}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading event"
      accessibilityState={{ busy: true }}
      style={[styles2.card, style]}
    >
      <View style={styles.eventCardContent}>
        {/* Date block */}
        <Skeleton width={52} height={52} borderRadius={RADIUS.md} />

        {/* Content */}
        <View style={styles.eventCardText}>
          <Skeleton width="70%" height={18} />
          <View style={{ height: 8 }} />
          <Skeleton width="50%" height={14} />
          <View style={{ height: 4 }} />
          <Skeleton width="40%" height={14} />
        </View>
      </View>

      {/* RSVP row */}
      <View style={styles2.eventCardFooter}>
        <Skeleton width={80} height={14} />
        <Skeleton width={72} height={32} borderRadius={RADIUS.md} />
      </View>
    </View>
  );
}

// Announcement list row skeleton (matches feed-style announcement rows)
export function SkeletonAnnouncementCard({ style }: SkeletonCardProps) {
  const styles2 = useThemedStyles((n) => ({
    row: {
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      gap: SPACING.md,
      paddingVertical: SPACING.md,
      paddingHorizontal: SPACING.md,
    },
    main: {
      flex: 1,
      gap: SPACING.xs,
    },
    titleRow: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
    },
  }));

  return (
    <View
      accessible={true}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading announcement"
      accessibilityState={{ busy: true }}
      style={[styles2.row, style]}
    >
      <Skeleton width={44} height={44} borderRadius={22} />
      <View style={styles2.main}>
        <View style={styles2.titleRow}>
          <Skeleton width="65%" height={16} borderRadius={RADIUS.xs} />
          <Skeleton width={48} height={12} borderRadius={RADIUS.xs} />
        </View>
        <Skeleton width={100} height={12} borderRadius={RADIUS.xs} />
      </View>
    </View>
  );
}

// Member card skeleton
export function SkeletonMemberCard({ style }: SkeletonCardProps) {
  const styles2 = useThemedStyles((n) => ({
    memberCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.md,
      padding: SPACING.sm,
      paddingLeft: SPACING.md,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.md,
    },
  }));

  return (
    <View
      accessible={true}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading member"
      accessibilityState={{ busy: true }}
      style={[styles2.memberCard, style]}
    >
      <SkeletonAvatar size={40} />
      <View style={styles.memberCardContent}>
        <Skeleton width={120} height={16} />
        <View style={{ height: 4 }} />
        <Skeleton width={160} height={14} />
      </View>
      <View style={styles.memberCardRight}>
        <Skeleton width={48} height={20} borderRadius={RADIUS.lg} />
      </View>
    </View>
  );
}

// Notification card skeleton
export function SkeletonNotificationCard({ style }: SkeletonCardProps) {
  const styles2 = useThemedStyles((n) => ({
    notificationCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
    },
  }));

  return (
    <View
      accessible={true}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading notification"
      accessibilityState={{ busy: true }}
      style={[styles2.notificationCard, style]}
    >
      <View style={styles.notificationContent}>
        {/* Unread indicator placeholder */}
        <Skeleton width={8} height={8} borderRadius={4} style={{ marginRight: 4 }} />

        {/* Main content */}
        <View style={styles.notificationMain}>
          <Skeleton width="80%" height={16} />
          <View style={{ height: 6 }} />
          <Skeleton width="100%" height={14} />
          <View style={{ height: 4 }} />
          <Skeleton width="60%" height={14} />
          <View style={{ height: 8 }} />
          <Skeleton width={80} height={12} />
        </View>

        {/* Toggle placeholder */}
        <Skeleton width={24} height={24} borderRadius={12} />
      </View>
    </View>
  );
}

// Chat card skeleton
export function SkeletonChatCard({ style }: SkeletonCardProps) {
  const styles2 = useThemedStyles((n) => ({
    memberCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.md,
      padding: SPACING.sm,
      paddingLeft: SPACING.md,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.md,
    },
  }));

  return (
    <Animated.View
      style={[styles2.memberCard, style]}
      accessible={true}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading chat group"
      accessibilityState={{ busy: true }}
    >
      <SkeletonAvatar size={40} />
      <View style={styles.memberCardContent}>
        <Skeleton width="60%" height={14} />
        <Skeleton width="40%" height={12} style={{ marginTop: SPACING.xs }} />
      </View>
    </Animated.View>
  );
}

// List skeleton (multiple cards)
type SkeletonType = "event" | "announcement" | "member" | "notification" | "chat";

interface SkeletonListProps {
  count?: number;
  type?: SkeletonType;
  style?: ViewStyle;
}

export function SkeletonList({
  count = 3,
  type = "event",
  style,
}: SkeletonListProps) {
  const cardComponentMap = {
    event: SkeletonEventCard,
    announcement: SkeletonAnnouncementCard,
    member: SkeletonMemberCard,
    notification: SkeletonNotificationCard,
    chat: SkeletonChatCard,
  };

  const typeLabelMap = {
    event: "events",
    announcement: "announcements",
    member: "members",
    notification: "notifications",
    chat: "chat group",
  };

  const CardComponent = cardComponentMap[type];
  const typeLabel = typeLabelMap[type];

  return (
    <View
      accessible={true}
      accessibilityRole="progressbar"
      accessibilityLabel={`Loading ${typeLabel}`}
      accessibilityState={{ busy: true }}
      style={style}
    >
      {Array.from({ length: count }).map((_, index) => (
        <CardComponent key={index} style={{ marginBottom: 12 }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  shimmerContainer: {
    width: "100%",
    height: "100%",
  },
  shimmer: {
    width: 100,
    height: "100%",
  },
  textContainer: {
    width: "100%",
  },
  eventCardContent: {
    flexDirection: "row",
    gap: SPACING.md,
  },
  eventCardText: {
    flex: 1,
  },
  announcementHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  announcementHeaderText: {
    flex: 1,
  },
  memberCardContent: {
    flex: 1,
  },
  memberCardRight: {
    marginLeft: SPACING.sm,
  },
  notificationContent: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: SPACING.sm,
  },
  notificationMain: {
    flex: 1,
  },
});
