import React, { useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { PenSquare, ChevronRight, Plus } from "lucide-react-native";
import Animated, {
  FadeInUp,
  FadeOutUp,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import { SPACING, RADIUS, SHADOWS, ANIMATION } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { PostCard } from "@/components/feed/PostCard";
import { NewPostsBanner } from "@/components/feed/NewPostsBanner";
import { FeedComposerBar } from "./FeedComposerBar";
import { EventCard } from "@/components/cards/EventCard";
import { AnnouncementCardCompact } from "@/components/cards/AnnouncementCard";
import type { FeedPost } from "@/types/feed";
import type { EventCardEvent } from "@/components/cards/EventCard";
import type { AnnouncementCardAnnouncement } from "@/components/cards/AnnouncementCard";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface FeedTabProps {
  posts: FeedPost[];
  pendingPosts: FeedPost[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onLoadMore: () => void;
  onAcceptPending: () => void;
  onPostPress: (postId: string) => void;
  onLikeToggle: (postId: string) => void;
  onPollVote?: (postId: string, optionIndex: number) => void;
  onCreatePost: () => void;
  upNextEvent?: EventCardEvent | null;
  pinnedAnnouncement?: AnnouncementCardAnnouncement | null;
  onEventPress?: (eventId: string) => void;
  onAnnouncementPress?: (announcementId: string) => void;
  onSeeAllEvents?: () => void;
  onSeeAllAnnouncements?: () => void;
  userAvatarUrl?: string | null;
  userName?: string | null;
  isOffline?: boolean;
}

export function FeedTab({
  posts,
  pendingPosts,
  loading,
  loadingMore,
  hasMore,
  refreshing,
  onRefresh,
  onLoadMore,
  onAcceptPending,
  onPostPress,
  onLikeToggle,
  onPollVote,
  onCreatePost,
  upNextEvent,
  pinnedAnnouncement,
  onEventPress,
  onAnnouncementPress,
  onSeeAllEvents,
  onSeeAllAnnouncements,
  userAvatarUrl,
  userName,
  isOffline = false,
}: FeedTabProps) {
  const { neutral, semantic } = useAppColorScheme();
  const composerBottomY = useRef(0);
  const fabProgress = useSharedValue(0);
  const fabPressScale = useSharedValue(1);

  const handleComposerLayout = useCallback((e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    composerBottomY.current = y + height;
  }, []);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const scrollY = e.nativeEvent.contentOffset.y;
      const threshold = Math.max(composerBottomY.current - 24, 80);
      const target = scrollY > threshold ? 1 : 0;
      if (fabProgress.value !== target) {
        fabProgress.value = withTiming(target, { duration: 220 });
      }
    },
    [fabProgress]
  );

  const fabStyle = useAnimatedStyle(() => ({
    opacity: fabProgress.value,
    transform: [
      {
        translateY: interpolate(
          fabProgress.value,
          [0, 1],
          [16, 0],
          Extrapolation.CLAMP
        ),
      },
      {
        scale: interpolate(
          fabProgress.value,
          [0, 1],
          [0.85, 1],
          Extrapolation.CLAMP
        ) * fabPressScale.value,
      },
    ],
  }));

  const handleFabPress = useCallback(() => {
    onCreatePost();
  }, [onCreatePost]);

  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
    },
    listContent: {
      paddingBottom: SPACING.xl,
    },
    sectionBlock: {
      paddingTop: SPACING.sm,
      marginBottom: SPACING.xs,
    },
    sectionHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: SPACING.md,
      marginBottom: SPACING.xs,
    },
    sectionLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: n.muted,
    },
    seeAllButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xxs,
    },
    seeAllText: {
      ...TYPOGRAPHY.labelMedium,
      color: s.info,
    },
    upNextWrapper: {
      marginHorizontal: SPACING.md,
      marginBottom: SPACING.sm,
    },
    pinnedWrapper: {
      marginHorizontal: SPACING.md,
      marginBottom: SPACING.sm,
    },
    pinnedCard: {
      borderLeftWidth: 3,
      borderLeftColor: s.warning,
    },
    composerWrapper: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
    },
    loadingMore: {
      paddingVertical: SPACING.lg,
    },
    emptyState: {
      alignItems: "center" as const,
      paddingVertical: SPACING.xxxl,
      paddingHorizontal: SPACING.xl,
      gap: SPACING.sm,
    },
    emptyTitle: {
      ...TYPOGRAPHY.headlineSmall,
      color: n.foreground,
      marginTop: SPACING.sm,
    },
    emptyBody: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.muted,
      textAlign: "center" as const,
    },
    skeletonContainer: {
      flex: 1,
      gap: SPACING.sm,
      padding: SPACING.md,
    },
    skeletonCard: {
      height: 120,
      backgroundColor: n.divider,
      borderRadius: RADIUS.lg,
    },
    fabWrapper: {
      position: "absolute" as const,
      right: SPACING.lg,
      bottom: SPACING.lg,
    },
    fabPill: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
      paddingLeft: SPACING.sm,
      paddingRight: SPACING.md,
      height: 52,
      borderRadius: 26,
      backgroundColor: n.foreground,
      ...SHADOWS.lg,
      shadowOpacity: 0.18,
    },
    fabIconWrap: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: "rgba(255,255,255,0.14)",
    },
    fabLabel: {
      ...TYPOGRAPHY.labelLarge,
      color: n.surface,
      letterSpacing: 0.2,
    },
  }));

  const renderItem = useCallback(
    ({ item }: { item: FeedPost }) => (
      <PostCard
        post={item}
        onPress={onPostPress}
        onLikeToggle={onLikeToggle}
        onPollVote={onPollVote}
        likeDisabled={isOffline}
        pollDisabled={isOffline}
      />
    ),
    [isOffline, onPostPress, onLikeToggle, onPollVote]
  );

  const keyExtractor = useCallback((item: FeedPost) => item.id, []);

  const ListHeaderComponent = useMemo(
    () => (
      <View>
        {upNextEvent != null && (
          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>Up next</Text>
              {onSeeAllEvents != null && (
                <Pressable
                  onPress={onSeeAllEvents}
                  style={styles.seeAllButton}
                  accessibilityRole="link"
                  accessibilityLabel="See all events"
                >
                  <Text style={styles.seeAllText}>See all</Text>
                  <ChevronRight size={14} color={semantic.info} />
                </Pressable>
              )}
            </View>
            <View style={styles.upNextWrapper}>
              <EventCard
                event={upNextEvent}
                onPress={() => onEventPress?.(upNextEvent.id)}
              />
            </View>
          </View>
        )}

        {pinnedAnnouncement != null && (
          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>Pinned</Text>
              {onSeeAllAnnouncements != null && (
                <Pressable
                  onPress={onSeeAllAnnouncements}
                  style={styles.seeAllButton}
                  accessibilityRole="link"
                  accessibilityLabel="See all announcements"
                >
                  <Text style={styles.seeAllText}>See all</Text>
                  <ChevronRight size={14} color={semantic.info} />
                </Pressable>
              )}
            </View>
            <View style={styles.pinnedWrapper}>
              <AnnouncementCardCompact
                announcement={pinnedAnnouncement}
                onPress={() => onAnnouncementPress?.(pinnedAnnouncement.id)}
                style={styles.pinnedCard}
              />
            </View>
          </View>
        )}

        <View style={styles.composerWrapper} onLayout={handleComposerLayout}>
          <FeedComposerBar
            onPress={onCreatePost}
            userAvatarUrl={userAvatarUrl}
            userName={userName}
            disabled={isOffline}
          />
        </View>
      </View>
    ),
    [
      upNextEvent,
      pinnedAnnouncement,
      onEventPress,
      onAnnouncementPress,
      onSeeAllEvents,
      onSeeAllAnnouncements,
      onCreatePost,
      isOffline,
      userAvatarUrl,
      userName,
      styles,
      semantic.info,
      handleComposerLayout,
    ]
  );

  const ListFooterComponent = useMemo(
    () =>
      loadingMore ? (
        <ActivityIndicator size="small" color={semantic.info} style={styles.loadingMore} />
      ) : null,
    [loadingMore, semantic.info, styles.loadingMore]
  );

  const ListEmptyComponent = useMemo(
    () =>
      !loading ? (
        <View style={styles.emptyState}>
          <PenSquare size={40} color={neutral.disabled} />
          <Text style={styles.emptyTitle}>No Posts Yet</Text>
          <Text style={styles.emptyBody}>
            Be the first to share something with the team.
          </Text>
        </View>
      ) : null,
    [loading, styles, neutral.disabled]
  );

  if (loading && posts.length === 0) {
    return (
      <View style={styles.skeletonContainer}>
        {ListHeaderComponent}
        {[1, 2, 3].map((i) => (
          <View key={i} style={styles.skeletonCard} />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={posts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeaderComponent}
        ListFooterComponent={ListFooterComponent}
        ListEmptyComponent={ListEmptyComponent}
        onEndReached={hasMore ? onLoadMore : undefined}
        onEndReachedThreshold={0.4}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={semantic.success}
          />
        }
        contentContainerStyle={styles.listContent}
        initialNumToRender={8}
        maxToRenderPerBatch={5}
        windowSize={7}
        removeClippedSubviews={true}
      />
      {pendingPosts.length > 0 && (
        <Animated.View entering={FadeInUp.springify()} exiting={FadeOutUp.springify()}>
          <NewPostsBanner count={pendingPosts.length} onPress={onAcceptPending} />
        </Animated.View>
      )}
      <Animated.View style={[styles.fabWrapper, fabStyle]}>
        <Pressable
          onPress={handleFabPress}
          onPressIn={() => {
            fabPressScale.value = withSpring(0.94, ANIMATION.spring);
          }}
          onPressOut={() => {
            fabPressScale.value = withSpring(1, ANIMATION.spring);
          }}
          disabled={isOffline}
          accessibilityRole="button"
          accessibilityLabel="Create a new post"
          style={[styles.fabPill, isOffline && { opacity: 0.6 }]}
        >
          <View style={styles.fabIconWrap}>
            <Plus size={18} color={neutral.surface} strokeWidth={2.5} />
          </View>
          <Text style={styles.fabLabel}>Post</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}
