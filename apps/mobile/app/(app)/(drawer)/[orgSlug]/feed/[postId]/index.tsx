import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ArrowLeft, Send, Edit2, Trash2, ExternalLink } from "lucide-react-native";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";
import { usePost } from "@/hooks/usePost";
import { useComments } from "@/hooks/useComments";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { useOrgRole } from "@/hooks/useOrgRole";
import { PostMediaGrid } from "@/components/feed/PostMediaGrid";
import { LikeButton } from "@/components/feed/LikeButton";
import { CommentItem } from "@/components/feed/CommentItem";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { showToast } from "@/components/ui/Toast";
import * as sentry from "@/lib/analytics/sentry";
import { formatRelativeTime } from "@/lib/date-format";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { SkeletonList } from "@/components/ui/Skeleton";
import type { FeedComment } from "@/types/feed";

export default function PostDetailScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const { orgSlug, orgId } = useOrg();
  const { user } = useAuth();
  const { isAdmin } = useOrgRole();
  const userId = user?.id ?? null;

  const { post, loading: postLoading } = usePost(postId);
  const { comments, createComment, deleteComment } = useComments(postId, orgId);

  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const textRef = useRef("");
  const inputRef = useRef<TextInput>(null);
  const [sending, setSending] = useState(false);

  const styles = useMemo(() => createStyles(), []);

  // Sync like state from post
  useEffect(() => {
    if (post) {
      setLiked(post.liked_by_user);
      setLikeCount(post.like_count);
    }
  }, [post?.liked_by_user, post?.like_count]);

  // Navigate back if post was deleted
  useEffect(() => {
    if (!postLoading && post === null && postId) {
      showToast("This post has been removed", "info");
      router.back();
    }
  }, [postLoading, post, postId, router]);

  const canEdit = post && userId && (post.author_id === userId || isAdmin);

  // Toggle like
  const handleToggleLike = useCallback(async () => {
    if (!userId || !orgId || !postId) return;

    const wasLiked = liked;
    // Optimistic update
    setLiked(!wasLiked);
    setLikeCount((prev) => (wasLiked ? Math.max(0, prev - 1) : prev + 1));

    try {
      if (wasLiked) {
        const { error } = await supabase
          .from("feed_likes")
          .delete()
          .eq("post_id", postId)
          .eq("user_id", userId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("feed_likes").insert({
          post_id: postId,
          user_id: userId,
          organization_id: orgId,
        });
        if (error) throw error;
      }
    } catch (e) {
      // Revert on failure
      setLiked(wasLiked);
      setLikeCount((prev) => (wasLiked ? prev + 1 : Math.max(0, prev - 1)));
      showToast("Failed to update like", "error");
      sentry.captureException(e as Error, { context: "PostDetail.toggleLike", postId });
    }
  }, [liked, userId, orgId, postId]);

  // Send comment
  const handleSendComment = useCallback(async () => {
    const body = textRef.current.trim();
    if (!body || sending) return;

    setSending(true);
    try {
      await createComment(body);
      inputRef.current?.clear();
      textRef.current = "";
    } catch {
      // Error already handled in useComments
    } finally {
      setSending(false);
    }
  }, [createComment, sending]);

  // Delete comment with confirmation
  const handleDeleteComment = useCallback(
    (commentId: string) => {
      Alert.alert("Delete Comment", "Are you sure you want to delete this comment?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteComment(commentId);
          },
        },
      ]);
    },
    [deleteComment]
  );

  // Delete post with confirmation
  const handleDeletePost = useCallback(() => {
    if (!postId) return;
    Alert.alert("Delete Post", "Are you sure you want to delete this post?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const { error } = await supabase
              .from("feed_posts")
              .update({ deleted_at: new Date().toISOString() })
              .eq("id", postId);
            if (error) throw error;
            showToast("Post deleted");
            router.back();
          } catch (e) {
            showToast("Failed to delete post", "error");
            sentry.captureException(e as Error, { context: "PostDetail.deletePost", postId });
          }
        },
      },
    ]);
  }, [postId, router]);

  // Overflow menu items
  const menuItems: OverflowMenuItem[] = useMemo(() => {
    const items: OverflowMenuItem[] = [];

    if (canEdit && post?.author_id === userId) {
      items.push({
        id: "edit",
        label: "Edit Post",
        icon: <Edit2 size={20} color={NEUTRAL.foreground} />,
        onPress: () => {
          router.push(`/(app)/(drawer)/${orgSlug}/feed/${postId}/edit`);
        },
      });
    }

    if (canEdit) {
      items.push({
        id: "delete",
        label: "Delete Post",
        icon: <Trash2 size={20} color={SEMANTIC.error} />,
        onPress: handleDeletePost,
        destructive: true,
      });
    }

    items.push({
      id: "open-in-web",
      label: "Open in Web",
      icon: <ExternalLink size={20} color={NEUTRAL.foreground} />,
      onPress: () => {
        Linking.openURL(`https://www.myteamnetwork.com/${orgSlug}/feed`);
      },
    });

    return items;
  }, [canEdit, post?.author_id, userId, orgSlug, postId, handleDeletePost, router]);

  const renderComment = useCallback(
    ({ item }: { item: FeedComment }) => (
      <CommentItem
        comment={item}
        isOwn={item.author_id === userId}
        isAdmin={isAdmin}
        onDelete={handleDeleteComment}
      />
    ),
    [userId, isAdmin, handleDeleteComment]
  );

  // Loading state
  if (postLoading && !post) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={() => router.back()} style={styles.backButton}>
                <ArrowLeft size={24} color={APP_CHROME.headerTitle} />
              </Pressable>
              <Text style={styles.headerTitle}>Post</Text>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.loadingContainer}>
            <SkeletonList type="announcement" count={1} />
          </View>
        </View>
      </View>
    );
  }

  if (!post) return null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <ArrowLeft size={24} color={APP_CHROME.headerTitle} />
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Post</Text>
            </View>
            {menuItems.length > 0 && (
              <OverflowMenu items={menuItems} accessibilityLabel="Post options" />
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content + composer */}
      <KeyboardAvoidingView
        style={styles.contentSheet}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={90}
      >
        <FlatList
          data={comments}
          keyExtractor={(item) => item.id}
          renderItem={renderComment}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.postContainer}>
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
                  <Text style={styles.authorName}>{post.author?.full_name || "Unknown"}</Text>
                  <Text style={styles.timestamp}>{formatRelativeTime(post.created_at)}</Text>
                </View>
              </View>

              {/* Full body */}
              <Text style={styles.body}>{post.body}</Text>

              {/* Media */}
              {post.media.length > 0 && <PostMediaGrid media={post.media} />}

              {/* Actions */}
              <View style={styles.actionsRow}>
                <LikeButton liked={liked} count={likeCount} onPress={handleToggleLike} />
                <Text style={styles.commentCountText}>
                  {comments.length} {comments.length === 1 ? "comment" : "comments"}
                </Text>
              </View>

              {/* Comments divider */}
              <View style={styles.divider} />
            </View>
          }
        />

        {/* Comment composer */}
        <View style={styles.composerContainer}>
          <TextInput
            ref={inputRef}
            style={styles.composerInput}
            placeholder="Add a comment..."
            placeholderTextColor={NEUTRAL.placeholder}
            multiline
            maxLength={2000}
            onChangeText={(t) => {
              textRef.current = t;
            }}
          />
          <Pressable
            onPress={handleSendComment}
            style={[styles.sendButton, sending && styles.sendButtonDisabled]}
            disabled={sending}
            accessibilityLabel="Send comment"
            accessibilityRole="button"
          >
            <Send size={20} color={sending ? NEUTRAL.disabled : SEMANTIC.info} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: APP_CHROME.gradientEnd,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {},
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 40,
      gap: SPACING.sm,
    },
    backButton: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
    },
    loadingContainer: {
      padding: SPACING.md,
    },
    listContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.md,
    },
    postContainer: {
      marginBottom: SPACING.md,
    },
    authorRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: SPACING.sm,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
    },
    avatarFallback: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: NEUTRAL.border,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarFallbackText: {
      ...TYPOGRAPHY.labelLarge,
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
      marginBottom: SPACING.md,
      lineHeight: 22,
    },
    actionsRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingTop: SPACING.sm,
    },
    commentCountText: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.muted,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: NEUTRAL.border,
      marginTop: SPACING.md,
    },
    composerContainer: {
      flexDirection: "row",
      alignItems: "flex-end",
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: NEUTRAL.border,
      backgroundColor: NEUTRAL.surface,
      gap: SPACING.sm,
    },
    composerInput: {
      flex: 1,
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.foreground,
      maxHeight: 100,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      backgroundColor: NEUTRAL.background,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
    },
    sendButton: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    sendButtonDisabled: {
      opacity: 0.5,
    },
  });
