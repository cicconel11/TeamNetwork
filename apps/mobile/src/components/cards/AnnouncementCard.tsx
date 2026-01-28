/**
 * AnnouncementCard Component
 * Slack-inspired announcement card with author info and reactions
 */

import React, { useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { Pin, MessageCircle } from "lucide-react-native";
import { NEUTRAL, SEMANTIC, RADIUS, SPACING, SHADOWS, ANIMATION } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatRelativeTime } from "@/lib/date-format";
import { Avatar } from "@/components/ui/Avatar";
import { PinnedBadge } from "@/components/ui/Badge";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface AnnouncementCardAnnouncement {
  id: string;
  title: string;
  body: string | null;
  created_at?: string | null;
  is_pinned?: boolean | null;
  author?: {
    name?: string | null;
    avatar_url?: string | null;
  } | null;
  reactions?: Array<{
    emoji: string;
    count: number;
  }>;
  reply_count?: number;
}

interface AnnouncementCardProps {
  announcement: AnnouncementCardAnnouncement;
  onPress?: () => void;
  onReactionPress?: (emoji: string) => void;
  style?: ViewStyle;
  maxBodyLines?: number;
}

export const AnnouncementCard = React.memo(function AnnouncementCard({
  announcement,
  onPress,
  onReactionPress,
  style,
  maxBodyLines = 3,
}: AnnouncementCardProps) {
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

  const hasReactions = announcement.reactions && announcement.reactions.length > 0;
  const hasReplies = announcement.reply_count && announcement.reply_count > 0;
  const hasFooter = hasReactions || hasReplies;

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[styles.container, animatedStyle, style]}
    >
      {/* Header with author and pin */}
      <View style={styles.header}>
        <Avatar
          uri={announcement.author?.avatar_url}
          name={announcement.author?.name}
          size="sm"
          squircle
        />

        <View style={styles.headerText}>
          <View style={styles.headerRow}>
            <Text style={styles.authorName} numberOfLines={1}>
              {announcement.author?.name || "Team Admin"}
            </Text>
            <Text style={styles.timestamp}>
              {formatRelativeTime(announcement.created_at)}
            </Text>
          </View>
        </View>

        {announcement.is_pinned && (
          <View style={styles.pinContainer}>
            <Pin size={14} color="#b45309" />
          </View>
        )}
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={2}>
          {announcement.title}
        </Text>
        {announcement.body && (
          <Text style={styles.body} numberOfLines={maxBodyLines}>
            {announcement.body}
          </Text>
        )}
      </View>

      {/* Footer with reactions and replies */}
      {hasFooter && (
        <View style={styles.footer}>
          {hasReactions && (
            <View style={styles.reactions}>
              {announcement.reactions!.map((reaction, index) => (
                <Pressable
                  key={index}
                  onPress={() => onReactionPress?.(reaction.emoji)}
                  style={({ pressed }) => [
                    styles.reactionPill,
                    pressed && styles.reactionPillPressed,
                  ]}
                >
                  <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
                  <Text style={styles.reactionCount}>{reaction.count}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {hasReplies && (
            <View style={styles.replies}>
              <MessageCircle size={14} color={NEUTRAL.muted} />
              <Text style={styles.replyCount}>
                {announcement.reply_count} {announcement.reply_count === 1 ? "reply" : "replies"}
              </Text>
            </View>
          )}
        </View>
      )}
    </AnimatedPressable>
  );
});

// Compact announcement card for home screen
interface AnnouncementCardCompactProps {
  announcement: AnnouncementCardAnnouncement;
  onPress?: () => void;
  style?: ViewStyle;
}

export const AnnouncementCardCompact = React.memo(function AnnouncementCardCompact({
  announcement,
  onPress,
  style,
}: AnnouncementCardCompactProps) {
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
      {announcement.is_pinned && (
        <PinnedBadge style={styles.compactPinned} />
      )}

      <Text style={styles.compactTitle} numberOfLines={1}>
        {announcement.title}
      </Text>

      {announcement.body && (
        <Text style={styles.compactBody} numberOfLines={2}>
          {announcement.body}
        </Text>
      )}

      <Text style={styles.compactMeta}>
        {announcement.author?.name || "Team Admin"} · {formatRelativeTime(announcement.created_at)}
      </Text>
    </AnimatedPressable>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    overflow: "hidden",
    ...SHADOWS.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: SPACING.md,
    paddingBottom: SPACING.sm,
    gap: SPACING.sm,
  },
  headerText: {
    flex: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
  },
  authorName: {
    ...TYPOGRAPHY.titleSmall,
    color: NEUTRAL.foreground,
    flex: 1,
  },
  timestamp: {
    ...TYPOGRAPHY.caption,
    color: NEUTRAL.muted,
  },
  pinContainer: {
    padding: 4,
  },
  content: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
  },
  title: {
    ...TYPOGRAPHY.titleMedium,
    color: NEUTRAL.foreground,
    marginBottom: SPACING.xs,
  },
  body: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.secondary,
    lineHeight: 20,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: NEUTRAL.divider,
    gap: SPACING.md,
  },
  reactions: {
    flexDirection: "row",
    gap: SPACING.xs,
    flex: 1,
    flexWrap: "wrap",
  },
  reactionPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: NEUTRAL.background,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    gap: 4,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
  },
  reactionPillPressed: {
    backgroundColor: NEUTRAL.divider,
  },
  reactionEmoji: {
    fontSize: 14,
  },
  reactionCount: {
    ...TYPOGRAPHY.labelSmall,
    color: NEUTRAL.secondary,
  },
  replies: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  replyCount: {
    ...TYPOGRAPHY.caption,
    color: NEUTRAL.muted,
  },

  // Compact styles
  compactContainer: {
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    padding: SPACING.md,
    ...SHADOWS.sm,
  },
  compactPinned: {
    marginBottom: SPACING.xs,
  },
  compactTitle: {
    ...TYPOGRAPHY.titleSmall,
    color: NEUTRAL.foreground,
    marginBottom: SPACING.xs,
  },
  compactBody: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.secondary,
    lineHeight: 18,
    marginBottom: SPACING.xs,
  },
  compactMeta: {
    ...TYPOGRAPHY.caption,
    color: NEUTRAL.muted,
  },
});
