import React, { useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  ScrollView,
} from "react-native";
import { PenSquare, ChevronRight } from "lucide-react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { PostCard } from "@/components/feed/PostCard";
import { NewPostsBanner } from "@/components/feed/NewPostsBanner";
import { FeedComposerBar } from "./FeedComposerBar";
import { EventCardCompact } from "@/components/cards/EventCard";
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
  onCreatePost: () => void;
  upcomingEvents?: EventCardEvent[];
  pinnedAnnouncement?: AnnouncementCardAnnouncement | null;
  onEventPress?: (eventId: string) => void;
  onAnnouncementPress?: (announcementId: string) => void;
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
  onCreatePost,
  upcomingEvents,
  pinnedAnnouncement,
  onEventPress,
  onAnnouncementPress,
  userAvatarUrl,
  userName,
  isOffline = false,
}: FeedTabProps) {
  const { neutral, semantic } = useAppColorScheme();
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
    eventStripContent: {
      paddingHorizontal: SPACING.md,
    },
    eventCard: {
      width: 260,
      marginRight: SPACING.sm,
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
    emptyButton: {
      marginTop: SPACING.md,
      backgroundColor: s.info,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.lg,
      borderRadius: RADIUS.lg,
    },
    emptyButtonPressed: {
      opacity: 0.7,
    },
    emptyButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: n.surface,
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
  }));

  const renderItem = useCallback(
    ({ item }: { item: FeedPost }) => (
      <PostCard
        post={item}
        onPress={onPostPress}
        onLikeToggle={onLikeToggle}
        likeDisabled={isOffline}
      />
    ),
    [isOffline, onPostPress, onLikeToggle]
  );

  const keyExtractor = useCallback((item: FeedPost) => item.id, []);

  const ListHeaderComponent = useMemo(
    () => (
      <View>
        {upcomingEvents && upcomingEvents.length > 0 && (
          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>Coming Up</Text>
              <Pressable
                onPress={() => onEventPress?.(upcomingEvents[0].id)}
                style={styles.seeAllButton}
                accessibilityRole="button"
                accessibilityLabel="See all events"
              >
                <Text style={styles.seeAllText}>See all</Text>
                <ChevronRight size={14} color={semantic.info} />
              </Pressable>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.eventStripContent}
            >
              {upcomingEvents.map((event) => (
                <EventCardCompact
                  key={event.id}
                  event={event}
                  onPress={() => onEventPress?.(event.id)}
                  style={styles.eventCard}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {pinnedAnnouncement != null && (
          <View style={styles.pinnedWrapper}>
            <AnnouncementCardCompact
              announcement={pinnedAnnouncement}
              onPress={() => onAnnouncementPress?.(pinnedAnnouncement.id)}
              style={styles.pinnedCard}
            />
          </View>
        )}

        <View style={styles.composerWrapper}>
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
      upcomingEvents,
      pinnedAnnouncement,
      onEventPress,
      onAnnouncementPress,
      onCreatePost,
      isOffline,
      userAvatarUrl,
      userName,
      styles,
      semantic.info,
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
          <Pressable
            onPress={onCreatePost}
            style={({ pressed }) => [
              styles.emptyButton,
              pressed && styles.emptyButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Create the first post"
          >
            <Text style={styles.emptyButtonText}>Create a Post</Text>
          </Pressable>
        </View>
      ) : null,
    [loading, onCreatePost, styles, neutral.disabled]
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
    </View>
  );
}
