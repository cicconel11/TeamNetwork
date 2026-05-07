/**
 * EventCard Component
 * Premium event card with date block and RSVP actions
 */

import React, { useCallback } from "react";
import { View, Text, Pressable, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { MapPin, Users, Clock } from "lucide-react-native";
import { RADIUS, SPACING, SHADOWS, ANIMATION, RSVP_COLORS, ENERGY } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatMonth, formatDay, formatTime, formatShortWeekdayDate } from "@/lib/date-format";
import { LiveBadge } from "@/components/ui/Badge";
import { AvatarGroup } from "@/components/ui/Avatar";
import { Button, type RSVPStatus } from "@/components/ui/Button";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface EventCardEvent {
  id: string;
  title: string;
  start_date: string;
  end_date?: string | null;
  location?: string | null;
  rsvp_count?: number;
  user_rsvp_status?: RSVPStatus | null;
  attendees?: Array<{ uri?: string | null; name?: string | null }>;
  is_live?: boolean;
}

interface EventCardProps {
  event: EventCardEvent;
  onPress?: () => void;
  onRSVP?: (status: RSVPStatus) => void;
  style?: ViewStyle;
  compact?: boolean;
  // For org-specific accent color
  accentColor?: string;
}

export const EventCard = React.memo(function EventCard({
  event,
  onPress,
  onRSVP,
  style,
  compact = false,
  accentColor,
}: EventCardProps) {
  const { neutral, semantic } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    container: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      overflow: "hidden" as const,
      ...SHADOWS.sm,
    },
    liveContainer: {
      position: "absolute" as const,
      top: SPACING.sm,
      right: SPACING.sm,
      zIndex: 1,
    },
    content: {
      flexDirection: "row" as const,
      padding: SPACING.md,
      gap: SPACING.md,
    },
    dateBlock: {
      width: 52,
      height: 52,
      backgroundColor: n.background,
      borderRadius: RADIUS.md,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    dateMonth: {
      ...TYPOGRAPHY.overline,
      fontSize: 10,
      color: s.error,
      marginBottom: -2,
    },
    dateDay: {
      ...TYPOGRAPHY.headlineMedium,
      fontSize: 22,
      color: n.foreground,
    },
    info: {
      flex: 1,
    },
    title: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      marginBottom: SPACING.xs,
    },
    details: {
      gap: 4,
    },
    detailRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
    },
    detailText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
      flex: 1,
    },
    locationText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      flex: 1,
    },
    footer: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderTopWidth: 1,
      borderTopColor: n.divider,
    },
    attendeeInfo: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
    },
    attendeeText: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      marginLeft: 4,
    },
    rsvpBadge: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs,
      borderRadius: RADIUS.lg,
    },
    rsvpBadgeText: {
      ...TYPOGRAPHY.labelSmall,
      fontWeight: "600" as const,
    },

    // Compact styles
    compactContainer: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      padding: SPACING.sm,
      gap: SPACING.sm,
      ...SHADOWS.sm,
    },
    compactLive: {
      position: "absolute" as const,
      top: 4,
      right: 4,
    },
    liveDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: ENERGY.live,
    },
    compactDateBlock: {
      width: 40,
      height: 40,
      backgroundColor: n.background,
      borderRadius: RADIUS.sm,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    compactMonth: {
      ...TYPOGRAPHY.overline,
      fontSize: 8,
      color: s.error,
      marginBottom: -1,
    },
    compactDay: {
      ...TYPOGRAPHY.titleLarge,
      fontSize: 16,
      color: n.foreground,
    },
    compactInfo: {
      flex: 1,
    },
    compactTitle: {
      ...TYPOGRAPHY.titleSmall,
      color: n.foreground,
    },
    compactTime: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      marginTop: 2,
    },
  }));

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

  const hasRSVP = !!event.user_rsvp_status;
  const rsvpColors = event.user_rsvp_status ? RSVP_COLORS[event.user_rsvp_status] : null;

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[styles.container, animatedStyle, style]}
    >
      {/* Live indicator */}
      {event.is_live && (
        <View style={styles.liveContainer}>
          <LiveBadge size="sm" />
        </View>
      )}

      <View style={styles.content}>
        {/* Date Block */}
        <View style={styles.dateBlock}>
          <Text style={[styles.dateMonth, accentColor && { color: accentColor }]}>
            {formatMonth(event.start_date)}
          </Text>
          <Text style={styles.dateDay}>{formatDay(event.start_date)}</Text>
        </View>

        {/* Event Info */}
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={compact ? 1 : 2}>
            {event.title}
          </Text>

          <View style={styles.details}>
            <View style={styles.detailRow}>
              <Clock size={13} color={neutral.secondary} />
              <Text style={styles.detailText}>
                {formatShortWeekdayDate(event.start_date)} · {formatTime(event.start_date)}
              </Text>
            </View>

            {event.location && (
              <View style={styles.detailRow}>
                <MapPin size={13} color={neutral.muted} />
                <Text style={styles.locationText} numberOfLines={1}>
                  {event.location}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Footer with RSVP */}
      <View style={styles.footer}>
        <View style={styles.attendeeInfo}>
          {event.attendees && event.attendees.length > 0 ? (
            <AvatarGroup avatars={event.attendees} size="xs" max={3} />
          ) : (
            <Users size={14} color={neutral.muted} />
          )}
          <Text style={styles.attendeeText}>
            {event.rsvp_count !== undefined
              ? `${event.rsvp_count} going`
              : "Be the first to RSVP"}
          </Text>
        </View>

        {hasRSVP && rsvpColors ? (
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              onRSVP?.(event.user_rsvp_status as RSVPStatus);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Update RSVP, currently ${
              event.user_rsvp_status === "attending"
                ? "Going"
                : event.user_rsvp_status === "maybe"
                  ? "Maybe"
                  : "Can't Go"
            }`}
            style={({ pressed }) => [
              styles.rsvpBadge,
              { backgroundColor: rsvpColors.background, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.rsvpBadgeText, { color: rsvpColors.text }]}>
              {event.user_rsvp_status === "attending"
                ? "Going"
                : event.user_rsvp_status === "maybe"
                  ? "Maybe"
                  : "Can't Go"}
            </Text>
          </Pressable>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onPress={() => onRSVP?.("attending")}
            primaryColor={accentColor || semantic.success}
          >
            RSVP
          </Button>
        )}
      </View>
    </AnimatedPressable>
  );
});

// Compact event card for home screen
export const EventCardCompact = React.memo(function EventCardCompact({
  event,
  onPress,
  style,
  accentColor,
}: Omit<EventCardProps, "compact">) {
  const styles = useThemedStyles((n, s) => ({
    compactContainer: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      padding: SPACING.sm,
      gap: SPACING.sm,
      ...SHADOWS.sm,
    },
    compactLive: {
      position: "absolute" as const,
      top: 4,
      right: 4,
    },
    liveDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: ENERGY.live,
    },
    compactDateBlock: {
      width: 40,
      height: 40,
      backgroundColor: n.background,
      borderRadius: RADIUS.sm,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    compactMonth: {
      ...TYPOGRAPHY.overline,
      fontSize: 8,
      color: s.error,
      marginBottom: -1,
    },
    compactDay: {
      ...TYPOGRAPHY.titleLarge,
      fontSize: 16,
      color: n.foreground,
    },
    compactInfo: {
      flex: 1,
    },
    compactTitle: {
      ...TYPOGRAPHY.titleSmall,
      color: n.foreground,
    },
    compactTime: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      marginTop: 2,
    },
  }));

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

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[styles.compactContainer, animatedStyle, style]}
    >
      {event.is_live && (
        <View style={styles.compactLive}>
          <View style={styles.liveDot} />
        </View>
      )}

      <View style={styles.compactDateBlock}>
        <Text style={[styles.compactMonth, accentColor && { color: accentColor }]}>
          {formatMonth(event.start_date)}
        </Text>
        <Text style={styles.compactDay}>{formatDay(event.start_date)}</Text>
      </View>

      <View style={styles.compactInfo}>
        <Text style={styles.compactTitle} numberOfLines={1}>
          {event.title}
        </Text>
        <Text style={styles.compactTime}>
          {formatTime(event.start_date)}
          {event.location && ` · ${event.location}`}
        </Text>
      </View>
    </AnimatedPressable>
  );
});
