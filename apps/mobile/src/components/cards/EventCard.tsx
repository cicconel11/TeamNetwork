/**
 * EventCard Component
 * Premium event card with date block and RSVP actions
 */

import React, { useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { MapPin, Users, Clock } from "lucide-react-native";
import { NEUTRAL, SEMANTIC, RADIUS, SPACING, SHADOWS, ANIMATION, RSVP_COLORS, ENERGY } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { LiveBadge, Badge } from "@/components/ui/Badge";
import { AvatarGroup } from "@/components/ui/Avatar";
import { Button, RSVPButton, type RSVPStatus } from "@/components/ui/Button";

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

function formatMonth(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", { month: "short" }).toUpperCase();
}

function formatDay(dateString: string): number {
  return new Date(dateString).getDate();
}

function formatTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function EventCard({
  event,
  onPress,
  onRSVP,
  style,
  compact = false,
  accentColor,
}: EventCardProps) {
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
              <Clock size={13} color={NEUTRAL.secondary} />
              <Text style={styles.detailText}>
                {formatDate(event.start_date)} · {formatTime(event.start_date)}
              </Text>
            </View>

            {event.location && (
              <View style={styles.detailRow}>
                <MapPin size={13} color={NEUTRAL.muted} />
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
            <Users size={14} color={NEUTRAL.muted} />
          )}
          <Text style={styles.attendeeText}>
            {event.rsvp_count !== undefined
              ? `${event.rsvp_count} going`
              : "Be the first to RSVP"}
          </Text>
        </View>

        {hasRSVP && rsvpColors ? (
          <View style={[styles.rsvpBadge, { backgroundColor: rsvpColors.background }]}>
            <Text style={[styles.rsvpBadgeText, { color: rsvpColors.text }]}>
              {event.user_rsvp_status === "going"
                ? "Going"
                : event.user_rsvp_status === "maybe"
                ? "Maybe"
                : "Can't Go"}
            </Text>
          </View>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onPress={() => onRSVP?.("going")}
            primaryColor={accentColor || SEMANTIC.success}
          >
            RSVP
          </Button>
        )}
      </View>
    </AnimatedPressable>
  );
}

// Compact event card for home screen
export function EventCardCompact({
  event,
  onPress,
  style,
  accentColor,
}: Omit<EventCardProps, "compact">) {
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
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    overflow: "hidden",
    ...SHADOWS.sm,
  },
  liveContainer: {
    position: "absolute",
    top: SPACING.sm,
    right: SPACING.sm,
    zIndex: 1,
  },
  content: {
    flexDirection: "row",
    padding: SPACING.md,
    gap: SPACING.md,
  },
  dateBlock: {
    width: 52,
    height: 52,
    backgroundColor: NEUTRAL.background,
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
  },
  dateMonth: {
    ...TYPOGRAPHY.overline,
    fontSize: 10,
    color: SEMANTIC.error,
    marginBottom: -2,
  },
  dateDay: {
    ...TYPOGRAPHY.headlineMedium,
    fontSize: 22,
    color: NEUTRAL.foreground,
  },
  info: {
    flex: 1,
  },
  title: {
    ...TYPOGRAPHY.titleMedium,
    color: NEUTRAL.foreground,
    marginBottom: SPACING.xs,
  },
  details: {
    gap: 4,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  detailText: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.secondary,
    flex: 1,
  },
  locationText: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
    flex: 1,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: NEUTRAL.divider,
  },
  attendeeInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
  },
  attendeeText: {
    ...TYPOGRAPHY.caption,
    color: NEUTRAL.muted,
    marginLeft: 4,
  },
  rsvpBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.lg,
  },
  rsvpBadgeText: {
    ...TYPOGRAPHY.labelSmall,
    fontWeight: "600",
  },

  // Compact styles
  compactContainer: {
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    flexDirection: "row",
    alignItems: "center",
    padding: SPACING.sm,
    gap: SPACING.sm,
    ...SHADOWS.sm,
  },
  compactLive: {
    position: "absolute",
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
    backgroundColor: NEUTRAL.background,
    borderRadius: RADIUS.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  compactMonth: {
    ...TYPOGRAPHY.overline,
    fontSize: 8,
    color: SEMANTIC.error,
    marginBottom: -1,
  },
  compactDay: {
    ...TYPOGRAPHY.titleLarge,
    fontSize: 16,
    color: NEUTRAL.foreground,
  },
  compactInfo: {
    flex: 1,
  },
  compactTitle: {
    ...TYPOGRAPHY.titleSmall,
    color: NEUTRAL.foreground,
  },
  compactTime: {
    ...TYPOGRAPHY.caption,
    color: NEUTRAL.muted,
    marginTop: 2,
  },
});
