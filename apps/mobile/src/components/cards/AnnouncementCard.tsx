/**
 * AnnouncementCard Component
 * Slack-inspired announcement card with author info and reactions
 */

import React, { useCallback } from "react";
import { View, Text, Pressable, ViewStyle, TextStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { Pin, MessageCircle, Megaphone } from "lucide-react-native";
import { RADIUS, SPACING, SHADOWS, ANIMATION } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatRelativeTime } from "@/lib/date-format";
import { Avatar } from "@/components/ui/Avatar";
import { PinnedBadge } from "@/components/ui/Badge";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function feedAccentIndex(id: string, bucketCount: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = id.charCodeAt(i) + ((h << 5) - h);
  }
  return Math.abs(h) % bucketCount;
}

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
  /** `feed` = list row with icon + separators (notifications-style); `card` = bordered card */
  variant?: "card" | "feed";
}

export const AnnouncementCard = React.memo(function AnnouncementCard({
  announcement,
  onPress,
  onReactionPress,
  style,
  maxBodyLines = 3,
  variant = "card",
}: AnnouncementCardProps) {
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
    header: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      padding: SPACING.md,
      paddingBottom: SPACING.sm,
      gap: SPACING.sm,
    },
    headerText: {
      flex: 1,
    },
    headerRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
    },
    authorName: {
      ...TYPOGRAPHY.titleSmall,
      color: n.foreground,
      flex: 1,
    },
    timestamp: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
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
      color: n.foreground,
      marginBottom: SPACING.xs,
    },
    body: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
      lineHeight: 20,
    },
    footer: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderTopWidth: 1,
      borderTopColor: n.divider,
      gap: SPACING.md,
    },
    reactions: {
      flexDirection: "row" as const,
      gap: SPACING.xs,
      flex: 1,
      flexWrap: "wrap" as const,
    },
    reactionPill: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      backgroundColor: n.background,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: RADIUS.full,
      gap: 4,
      borderWidth: 1,
      borderColor: n.border,
    },
    reactionPillPressed: {
      backgroundColor: n.divider,
    },
    reactionEmoji: {
      fontSize: 14,
    },
    reactionCount: {
      ...TYPOGRAPHY.labelSmall,
      color: n.secondary,
    },
    replies: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
    },
    replyCount: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
    },

    // Compact styles
    compactContainer: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      ...SHADOWS.sm,
    },
    compactPinned: {
      marginBottom: SPACING.xs,
    },
    compactTitle: {
      ...TYPOGRAPHY.titleSmall,
      color: n.foreground,
      marginBottom: SPACING.xs,
    },
    compactBody: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
      lineHeight: 18,
      marginBottom: SPACING.xs,
    },
    compactMeta: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
    },

    // Feed list row (notifications-style — no card chrome)
    feedRow: {
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      gap: SPACING.md,
    },
    feedIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    feedMain: {
      flex: 1,
      minWidth: 0,
    },
    feedTitleRow: {
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      gap: SPACING.sm,
      marginBottom: SPACING.xs / 2,
    },
    feedTitle: {
      ...TYPOGRAPHY.titleSmall,
      color: n.foreground,
      flex: 1,
    },
    feedTime: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      marginTop: 2,
      fontVariant: ["tabular-nums"] as TextStyle["fontVariant"],
    },
    feedMetaRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
    },
    feedMeta: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      flex: 1,
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

  const hasReactions = announcement.reactions && announcement.reactions.length > 0;
  const hasReplies = announcement.reply_count && announcement.reply_count > 0;
  const hasFooter = hasReactions || hasReplies;

  const displayAuthor =
    announcement.author?.name?.trim() || "Team Admin";

  const feedAccentIdx = feedAccentIndex(announcement.id, 4);
  const feedIconBg = [
    semantic.infoLight,
    semantic.warningLight,
    semantic.successLight,
    semantic.errorLight,
  ][feedAccentIdx];
  const feedIconFg = [
    semantic.info,
    semantic.warning,
    semantic.success,
    semantic.error,
  ][feedAccentIdx];

  if (variant === "feed") {
    const timeLabel = formatRelativeTime(announcement.created_at);
    const a11yLabel = announcement.body?.trim()
      ? `${announcement.title}. ${displayAuthor}. ${timeLabel}. ${announcement.body}`
      : `${announcement.title}. ${displayAuthor}. ${timeLabel}`;

    return (
      <AnimatedPressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[styles.feedRow, animatedStyle, style]}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityHint="Opens the full announcement"
      >
        <View style={[styles.feedIconWrap, { backgroundColor: feedIconBg }]}>
          <Megaphone size={22} color={feedIconFg} strokeWidth={2.25} />
        </View>
        <View style={styles.feedMain}>
          <View style={styles.feedTitleRow}>
            <Text style={styles.feedTitle} numberOfLines={2}>
              {announcement.title}
            </Text>
            <Text style={styles.feedTime}>{timeLabel}</Text>
          </View>
          <View style={styles.feedMetaRow}>
            <Text style={styles.feedMeta} numberOfLines={1}>
              {displayAuthor}
            </Text>
            {announcement.is_pinned ? (
              <Pin size={13} color={semantic.warning} accessibilityLabel="Pinned" />
            ) : null}
          </View>
        </View>
      </AnimatedPressable>
    );
  }

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
          name={displayAuthor}
          size="sm"
          squircle
        />

        <View style={styles.headerText}>
          <View style={styles.headerRow}>
            <Text style={styles.authorName} numberOfLines={1}>
              {displayAuthor}
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
              <MessageCircle size={14} color={neutral.muted} />
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
  const styles = useThemedStyles((n) => ({
    compactContainer: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      ...SHADOWS.sm,
    },
    compactPinned: {
      marginBottom: SPACING.xs,
    },
    compactTitle: {
      ...TYPOGRAPHY.titleSmall,
      color: n.foreground,
      marginBottom: SPACING.xs,
    },
    compactBody: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
      lineHeight: 18,
      marginBottom: SPACING.xs,
    },
    compactMeta: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
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
