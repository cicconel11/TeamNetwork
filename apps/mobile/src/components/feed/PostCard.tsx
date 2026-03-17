import React, { useCallback } from "react";
import { View, Text, Pressable, Platform, StyleSheet } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { MessageCircle } from "lucide-react-native";
import { NEUTRAL, SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatRelativeTime } from "@/lib/date-format";
import { LikeButton } from "./LikeButton";
import { PostMediaGrid } from "./PostMediaGrid";
import type { FeedPost } from "@/types/feed";

interface PostCardProps {
  post: FeedPost;
  onPress: (postId: string) => void;
  onLikeToggle: (postId: string) => void;
}

function PostCardInner({ post, onPress, onLikeToggle }: PostCardProps) {
  const handlePress = useCallback(() => {
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress(post.id);
  }, [onPress, post.id]);
  const handleLike = useCallback(() => onLikeToggle(post.id), [onLikeToggle, post.id]);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Post by ${post.author?.full_name || "Unknown"}`}
    >
      {/* Author row */}
      <View style={styles.authorRow}>
        {post.author?.avatar_url ? (
          <Image
            source={post.author.avatar_url}
            style={styles.avatar}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarFallbackText}>
              {(post.author?.full_name || "?")[0].toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.authorMeta}>
          <Text style={styles.authorName} numberOfLines={1}>
            {post.author?.full_name || "Unknown"}
          </Text>
          <Text style={styles.timestamp}>
            {formatRelativeTime(post.created_at)}
          </Text>
        </View>
      </View>

      {/* Body */}
      <Text style={styles.body} numberOfLines={3}>
        {post.body}
      </Text>

      {/* Media */}
      {post.media.length > 0 && (
        <PostMediaGrid media={post.media} />
      )}

      {/* Actions row */}
      <View style={styles.actionsRow}>
        <LikeButton
          liked={post.liked_by_user}
          count={post.like_count}
          onPress={handleLike}
        />
        <View style={styles.commentAction}>
          <MessageCircle size={18} color={NEUTRAL.muted} />
          <Text style={styles.commentCount}>{post.comment_count}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export const PostCard = React.memo(PostCardInner, (prev, next) => {
  return (
    prev.post.id === next.post.id &&
    prev.post.body === next.post.body &&
    prev.post.like_count === next.post.like_count &&
    prev.post.liked_by_user === next.post.liked_by_user &&
    prev.post.comment_count === next.post.comment_count
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  cardPressed: {
    transform: [{ scale: 0.98 }],
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: SPACING.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: NEUTRAL.border,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    ...TYPOGRAPHY.labelMedium,
    color: NEUTRAL.secondary,
    fontWeight: "600",
  },
  authorMeta: {
    flex: 1,
    marginLeft: SPACING.sm,
  },
  authorName: {
    ...TYPOGRAPHY.labelLarge,
    color: NEUTRAL.foreground,
    fontWeight: "600",
  },
  timestamp: {
    ...TYPOGRAPHY.caption,
    color: NEUTRAL.muted,
    marginTop: 2,
  },
  body: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.foreground,
    marginBottom: SPACING.sm,
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.lg,
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: NEUTRAL.border,
  },
  commentAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
  },
  commentCount: {
    ...TYPOGRAPHY.labelMedium,
    color: NEUTRAL.muted,
  },
});
