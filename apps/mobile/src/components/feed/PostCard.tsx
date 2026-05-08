import React, { useCallback } from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { MessageCircle } from "lucide-react-native";
import { SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatRelativeTime } from "@/lib/date-format";
import { LikeButton } from "./LikeButton";
import { PostMediaGrid } from "./PostMediaGrid";
import { FeedPoll } from "./FeedPoll";
import type { FeedPost } from "@/types/feed";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface PostCardProps {
  post: FeedPost;
  onPress: (postId: string) => void;
  onLikeToggle: (postId: string) => void;
  onPollVote?: (postId: string, optionIndex: number) => void;
  likeDisabled?: boolean;
  pollDisabled?: boolean;
}

function PostCardInner({
  post,
  onPress,
  onLikeToggle,
  onPollVote,
  likeDisabled = false,
  pollDisabled = false,
}: PostCardProps) {
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
      opacity: 0.7,
    },
    headerPress: {
      // Tap target for opening the detail screen — author row + body only.
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

  const handleLike = useCallback(() => {
    onLikeToggle(post.id);
  }, [onLikeToggle, post.id]);

  const handleCommentPress = useCallback(() => {
    onPress(post.id);
  }, [onPress, post.id]);

  // Only the header + body navigate to the detail screen. Poll, media,
  // and the actions row are siblings — interactive children inside a
  // navigating Pressable can race with the parent and swallow taps.
  return (
    <View style={styles.card}>
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [styles.headerPress, pressed && styles.cardPressed]}
        accessibilityRole="button"
        accessibilityLabel={`Open post by ${post.author?.full_name || "Unknown"}`}
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
        {post.body ? (
          <Text style={styles.body} numberOfLines={3}>
            {post.body}
          </Text>
        ) : null}
      </Pressable>

      {/* Poll — outside the navigating Pressable so taps reach the buttons */}
      {post.post_type === "poll" && post.poll_meta && onPollVote ? (
        <FeedPoll
          postId={post.id}
          meta={post.poll_meta}
          userVote={post.user_vote ?? null}
          voteCounts={post.vote_counts ?? []}
          totalVotes={post.total_votes ?? 0}
          onVote={onPollVote}
          disabled={pollDisabled}
        />
      ) : null}

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
        <Pressable onPress={handleCommentPress} style={styles.commentAction} accessibilityRole="button" accessibilityLabel="View comments">
          <MessageCircle size={18} color={neutral.muted} />
          <Text style={styles.commentCount}>{post.comment_count}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export const PostCard = React.memo(PostCardInner, (prev, next) => {
  return (
    prev.post.id === next.post.id &&
    prev.post.body === next.post.body &&
    prev.post.like_count === next.post.like_count &&
    prev.post.liked_by_user === next.post.liked_by_user &&
    prev.post.comment_count === next.post.comment_count &&
    prev.post.user_vote === next.post.user_vote &&
    prev.post.total_votes === next.post.total_votes &&
    prev.post.vote_counts === next.post.vote_counts &&
    prev.likeDisabled === next.likeDisabled &&
    prev.pollDisabled === next.pollDisabled
  );
});
