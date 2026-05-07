import React, { useCallback } from "react";
import { View, Text, Pressable, Platform, GestureResponderEvent } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { MessageCircle } from "lucide-react-native";
import { SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatRelativeTime } from "@/lib/date-format";
import { LikeButton } from "./LikeButton";
import { PostMediaGrid } from "./PostMediaGrid";
import type { FeedPost } from "@/types/feed";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface PostCardProps {
  post: FeedPost;
  onPress: (postId: string) => void;
  onLikeToggle: (postId: string) => void;
  likeDisabled?: boolean;
}

function PostCardInner({ post, onPress, onLikeToggle, likeDisabled = false }: PostCardProps) {
  const { neutral } = useAppColorScheme();
  const styles = useThemedStyles((n) => ({
    card: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      marginBottom: SPACING.md,
      ...SHADOWS.sm,
    },
    cardPressed: {
      transform: [{ scale: 0.98 }],
    },
    authorRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
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
      backgroundColor: n.border,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    avatarFallbackText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.secondary,
      fontWeight: "600" as const,
    },
    authorMeta: {
      flex: 1,
      marginLeft: SPACING.sm,
    },
    authorName: {
      ...TYPOGRAPHY.labelLarge,
      color: n.foreground,
      fontWeight: "600" as const,
    },
    timestamp: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      marginTop: 2,
    },
    body: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      marginBottom: SPACING.sm,
    },
    actionsRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.lg,
      marginTop: SPACING.sm,
      paddingTop: SPACING.sm,
      borderTopWidth: 0.5,
      borderTopColor: n.border,
    },
    commentAction: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
    },
    commentCount: {
      ...TYPOGRAPHY.labelMedium,
      color: n.muted,
    },
  }));

  const handlePress = useCallback(() => {
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress(post.id);
  }, [onPress, post.id]);
  const handleLike = useCallback((e?: GestureResponderEvent) => {
    e?.stopPropagation();
    onLikeToggle(post.id);
  }, [onLikeToggle, post.id]);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityRole="none"
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
          disabled={likeDisabled}
        />
        <View style={styles.commentAction}>
          <MessageCircle size={18} color={neutral.muted} />
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
    prev.post.comment_count === next.post.comment_count &&
    prev.likeDisabled === next.likeDisabled
  );
});
