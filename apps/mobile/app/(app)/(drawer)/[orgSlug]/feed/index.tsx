import { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useFocusEffect, useRouter, useNavigation } from "expo-router";
import { ExternalLink, Plus } from "lucide-react-native";
import * as Linking from "expo-linking";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useAuth } from "@/hooks/useAuth";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { SkeletonList } from "@/components/ui/Skeleton";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { useFeed } from "@/hooks/useFeed";
import { PostCard } from "@/components/feed/PostCard";
import { NewPostsBanner } from "@/components/feed/NewPostsBanner";
import type { FeedPost } from "@/types/feed";

export default function FeedScreen() {
  const { orgSlug, orgId, orgName, orgLogoUrl } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { permissions, isAdmin, isActiveMember } = useOrgRole();
  const canCreatePost = isAdmin || isActiveMember;
  const styles = useMemo(() => createStyles(), []);
  const {
    posts,
    loading,
    loadingMore,
    error,
    hasMore,
    pendingPosts,
    loadMore,
    refetch,
    refetchIfStale,
    acceptPendingPosts,
    toggleLike,
  } = useFeed(orgId);
  const [refreshing, setRefreshing] = useState(false);
  const isRefetchingRef = useRef(false);
  const flatListRef = useRef<FlatList>(null);

  const feedEnabled = isFeatureEnabled("socialFeedEnabled");

  // Safe drawer toggle (exact same as announcements.tsx)
  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available - no-op
    }
  }, [navigation]);

  // Admin overflow menu
  const adminMenuItems: OverflowMenuItem[] = useMemo(() => {
    if (!permissions.canUseAdminActions) return [];
    return [
      {
        id: "open-in-web",
        label: "Open in Web",
        icon: <ExternalLink size={20} color={NEUTRAL.foreground} />,
        onPress: () => {
          const webUrl = `https://www.myteamnetwork.com/${orgSlug}/feed`;
          Linking.openURL(webUrl);
        },
      },
    ];
  }, [permissions.canUseAdminActions, orgSlug]);

  // Refetch on tab focus if data is stale
  useFocusEffect(
    useCallback(() => {
      refetchIfStale();
    }, [refetchIfStale])
  );

  // Pull-to-refresh (exact same pattern as announcements)
  const handleRefresh = useCallback(async () => {
    if (isRefetchingRef.current) return;
    setRefreshing(true);
    isRefetchingRef.current = true;
    try {
      await refetch();
    } finally {
      setRefreshing(false);
      isRefetchingRef.current = false;
    }
  }, [refetch]);

  const handlePostPress = useCallback(
    (postId: string) => {
      router.push(`/(app)/(drawer)/${orgSlug}/feed/${postId}`);
    },
    [router, orgSlug]
  );

  const handleLikeToggle = useCallback(
    (postId: string) => {
      toggleLike(postId);
    },
    [toggleLike]
  );

  const handleAcceptPending = useCallback(() => {
    acceptPendingPosts();
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [acceptPendingPosts]);

  const handleCreatePost = useCallback(() => {
    router.push(`/(app)/(drawer)/${orgSlug}/feed/new`);
  }, [router, orgSlug]);

  const renderPost = useCallback(
    ({ item }: { item: FeedPost }) => (
      <PostCard
        post={item}
        onPress={handlePostPress}
        onLikeToggle={handleLikeToggle}
      />
    ),
    [handlePostPress, handleLikeToggle]
  );

  // Feature flag disabled
  if (!feedEnabled) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Feed is not available.</Text>
      </View>
    );
  }

  // Skeleton loading
  if (loading && posts.length === 0) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <View style={styles.orgLogoButton} />
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Feed</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.listContent}>
            <SkeletonList type="announcement" count={4} />
          </View>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            {/* Org Logo (opens drawer) */}
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image
                  source={orgLogoUrl}
                  style={styles.orgLogo}
                  contentFit="contain"
                  transition={200}
                />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "?"}</Text>
                </View>
              )}
            </Pressable>

            {/* Title */}
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Feed</Text>
              <Text style={styles.headerMeta}>
                {posts.length} {posts.length === 1 ? "post" : "posts"}
              </Text>
            </View>

            {/* Create post button — gated by role */}
            {canCreatePost && (
              <Pressable
                onPress={handleCreatePost}
                style={styles.createButton}
                accessibilityLabel="Create post"
                accessibilityRole="button"
              >
                <Plus size={22} color={APP_CHROME.headerTitle} />
              </Pressable>
            )}

            {/* Overflow Menu (admin only) */}
            {adminMenuItems.length > 0 && (
              <OverflowMenu items={adminMenuItems} accessibilityLabel="Feed options" />
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        {/* New posts banner */}
        {pendingPosts.length > 0 && (
          <NewPostsBanner count={pendingPosts.length} onPress={handleAcceptPending} />
        )}

        <FlatList
          ref={flatListRef}
          data={posts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={renderPost}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={SEMANTIC.success}
            />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator style={{ paddingVertical: SPACING.lg }} color={NEUTRAL.muted} />
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>No Posts Yet</Text>
              <Text style={styles.emptyText}>
                Start the conversation — share an update with your team.
              </Text>
              {canCreatePost && (
                <Pressable
                  onPress={handleCreatePost}
                  style={styles.emptyCreateButton}
                  accessibilityRole="button"
                >
                  <Text style={styles.emptyCreateButtonText}>Create Post</Text>
                </Pressable>
              )}
            </View>
          }
          initialNumToRender={8}
          maxToRenderPerBatch={5}
          windowSize={7}
          removeClippedSubviews={true}
        />
      </View>
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
    orgLogoButton: {
      width: 36,
      height: 36,
    },
    orgLogo: {
      width: 36,
      height: 36,
      borderRadius: 18,
    },
    orgAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: APP_CHROME.avatarBackground,
      alignItems: "center",
      justifyContent: "center",
    },
    orgAvatarText: {
      ...TYPOGRAPHY.titleSmall,
      fontWeight: "700",
      color: APP_CHROME.avatarText,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      ...TYPOGRAPHY.caption,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    createButton: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    contentSheet: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
    },
    listContent: {
      padding: SPACING.md,
      paddingBottom: 40,
      flexGrow: 1,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingVertical: 64,
    },
    emptyTitle: {
      ...TYPOGRAPHY.headlineMedium,
      color: NEUTRAL.foreground,
      marginBottom: SPACING.sm,
    },
    emptyText: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.muted,
      textAlign: "center",
      marginBottom: SPACING.lg,
    },
    emptyCreateButton: {
      backgroundColor: NEUTRAL.foreground,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.lg,
      borderRadius: RADIUS.md,
    },
    emptyCreateButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.surface,
      fontWeight: "600",
    },
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 20,
      backgroundColor: NEUTRAL.background,
    },
    errorText: {
      ...TYPOGRAPHY.bodyMedium,
      color: SEMANTIC.error,
    },
  });
