import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { View, Text, Pressable, LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useRouter, useFocusEffect, useNavigation } from "expo-router";
import { Bell, Search } from "lucide-react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  Easing,
  type SharedValue,
} from "react-native-reanimated";
import { useAuth } from "@/hooks/useAuth";
import { useEvents } from "@/hooks/useEvents";
import { promptAndSetRsvp } from "@/hooks/useRsvp";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useMembers } from "@/hooks/useMembers";
import { useOrgStats } from "@/hooks/useOrgStats";
import { useFeed } from "@/hooks/useFeed";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS, SHADOWS, ANIMATION } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { ErrorState, SkeletonList } from "@/components/ui";
import { useNetwork } from "@/contexts/NetworkContext";
import { useAutoRefetchOnReconnect } from "@/hooks/useAutoRefetchOnReconnect";
import { showToast } from "@/components/ui/Toast";
import { FeedTab } from "@/components/home/FeedTab";
import { OverviewTab } from "@/components/home/OverviewTab";
import { EventsTab } from "@/components/home/EventsTab";
import type { EventCardEvent } from "@/components/cards/EventCard";

type ActiveTab = "feed" | "overview" | "events";

const TAB_LABELS: { key: ActiveTab; label: string }[] = [
  { key: "feed", label: "Feed" },
  { key: "overview", label: "Overview" },
  { key: "events", label: "Events" },
];

const TAB_ORDER: ActiveTab[] = ["feed", "overview", "events"];

function computeGreeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 21) return "Good evening";
  return "Good night";
}

export default function HomeScreen() {
  const { orgSlug, orgId, orgName, orgLogoUrl } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuth();
  useOrgRole(); // subscribes to role changes; triggers re-render on role updates

  const { neutral, semantic } = useAppColorScheme();
  const { isOffline } = useNetwork();

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available in web preview / tests — no-op
    }
  }, [navigation]);

  const [activeTab, setActiveTab] = useState<ActiveTab>("feed");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const isRefetchingRef = useRef(false);

  // Tab pill animation
  const pillX = useSharedValue(0);
  const tabLayouts = useRef<Record<ActiveTab, number>>({
    feed: 0,
    overview: 0,
    events: 0,
  });

  // Tab crossfade shared values
  const feedOpacity = useSharedValue(1);
  const overviewOpacity = useSharedValue(0);
  const eventsOpacity = useSharedValue(0);

  const opacityMap: Record<ActiveTab, SharedValue<number>> = {
    feed: feedOpacity,
    overview: overviewOpacity,
    events: eventsOpacity,
  };

  const handleTabChange = useCallback(
    (tab: ActiveTab) => {
      setActiveTab(tab);

      // Animate pill to new tab — gentler spring, less overshoot
      pillX.value = withSpring(tabLayouts.current[tab], {
        damping: 22,
        stiffness: 220,
        mass: 0.8,
        overshootClamping: false,
      });

      // Crossfade tabs — linear timing so content never overshoots into neighbor
      TAB_ORDER.forEach((t) => {
        opacityMap[t].value = withTiming(t === tab ? 1 : 0, {
          duration: 180,
          easing: Easing.out(Easing.quad),
        });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pillX, feedOpacity, overviewOpacity, eventsOpacity]
  );

  const handleTabLayout = useCallback(
    (tab: ActiveTab, x: number) => {
      tabLayouts.current[tab] = x;
      // Initialise pill position for active tab once layout is known
      if (tab === activeTab) {
        pillX.value = x;
      }
    },
    [activeTab, pillX]
  );

  const { events, refetch: refetchEvents, refetchIfStale: refetchEventsIfStale } = useEvents(orgId);
  const { announcements, refetch: refetchAnnouncements, refetchIfStale: refetchAnnouncementsIfStale } = useAnnouncements(orgId);
  const { members, refetch: refetchMembers, refetchIfStale: refetchMembersIfStale } = useMembers(orgId);
  const {
    stats,
    loading: statsLoading,
    refetch: refetchStats,
    refetchIfStale: refetchStatsIfStale,
  } = useOrgStats(orgId);
  const {
    posts,
    loading: feedLoading,
    error: feedError,
    loadingMore,
    hasMore,
    pendingPosts,
    loadMore,
    refetch: refetchFeed,
    refetchIfStale: refetchFeedIfStale,
    acceptPendingPosts,
    toggleLike,
  } = useFeed(orgId);

  // Transition from loading → ready once org and user context are available.
  useEffect(() => {
    if (orgId && user) {
      setLoading(false);
    }
  }, [orgId, user]);

  const memberCount = members.length;

  useFocusEffect(
    useCallback(() => {
      refetchEventsIfStale();
      refetchAnnouncementsIfStale();
      refetchMembersIfStale();
      refetchStatsIfStale();
      refetchFeedIfStale();
    }, [refetchEventsIfStale, refetchAnnouncementsIfStale, refetchMembersIfStale, refetchStatsIfStale, refetchFeedIfStale])
  );

  const reconnectRefetch = useCallback(() => {
    refetchEvents();
    refetchAnnouncements();
    refetchMembers();
    refetchStats();
    refetchFeed();
  }, [refetchEvents, refetchAnnouncements, refetchMembers, refetchStats, refetchFeed]);
  useAutoRefetchOnReconnect(reconnectRefetch);

  const handleRefresh = async () => {
    if (isRefetchingRef.current) return;
    setRefreshing(true);
    isRefetchingRef.current = true;
    try {
      await Promise.all([
        refetchEvents(),
        refetchAnnouncements(),
        refetchMembers(),
        refetchStats(),
        refetchFeed(),
      ]);
    } finally {
      setRefreshing(false);
      isRefetchingRef.current = false;
    }
  };

  const handlePostPress = useCallback(
    (postId: string) => router.push(`/(app)/(drawer)/${orgSlug}/feed/${postId}`),
    [router, orgSlug]
  );

  const handleCreatePost = useCallback(
    () => {
      if (isOffline) {
        showToast("You're offline. Try again when connected.", "info");
        return;
      }
      router.push(`/(app)/(drawer)/${orgSlug}/feed/new`);
    },
    [isOffline, router, orgSlug]
  );

  const handleLikeToggle = useCallback(
    (postId: string) => {
      if (isOffline) {
        showToast("You're offline. Try again when connected.", "info");
        return;
      }
      toggleLike(postId);
    },
    [isOffline, toggleLike]
  );

  const handleNavigate = useCallback(
    (path: string) => router.push(path as any),
    [router]
  );

  const handleBellPress = useCallback(
    () => router.push(`/(app)/(drawer)/${orgSlug}/notifications` as any),
    [router, orgSlug]
  );

  const handleSearchPress = useCallback(
    () => router.push(`/(app)/(drawer)/${orgSlug}/search` as any),
    [router, orgSlug]
  );

  const handleHomeRsvp = useCallback(
    (eventId: string) => {
      if (!orgId || !user?.id) return;
      promptAndSetRsvp({
        eventId,
        organizationId: orgId,
        userId: user.id,
        onComplete: (result) => {
          if (result.ok) {
            void refetchEvents();
          }
        },
      });
    },
    [orgId, user?.id, refetchEvents]
  );

  // Derive user identity for child tabs
  const userMeta = useMemo(
    () => (user?.user_metadata ?? {}) as { name?: string; avatar_url?: string },
    [user]
  );
  const userName = userMeta.name ?? null;
  const userAvatarUrl = userMeta.avatar_url ?? null;

  // Greeting computed from time of day
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    return computeGreeting(hour);
  }, []);

  // First name only
  const firstName = useMemo(
    () => userName?.split(" ")[0] ?? null,
    [userName]
  );

  const { transformedEvents, recentAnnouncements, eventsCount } = useMemo(() => {
    const now = new Date();
    const upcoming = events.filter((e) => new Date(e.start_date) >= now);

    const transformed: EventCardEvent[] = upcoming.slice(0, 5).map((event) => ({
      id: event.id,
      title: event.title,
      start_date: event.start_date,
      end_date: event.end_date,
      location: event.location,
      rsvp_count: event.rsvp_count,
      user_rsvp_status: event.user_rsvp_status as EventCardEvent["user_rsvp_status"],
    }));

    const recent = announcements.slice(0, 3).map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      created_at: a.created_at,
      is_pinned: a.is_pinned,
    }));

    return {
      transformedEvents: transformed,
      recentAnnouncements: recent,
      eventsCount: upcoming.length,
    };
  }, [events, announcements]);

  const pinnedAnnouncement = useMemo(
    () => announcements.find((a) => a.is_pinned) ?? null,
    [announcements]
  );

  // Animated styles
  const pillAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
  }));

  const feedAnimatedStyle = useAnimatedStyle(() => ({
    opacity: feedOpacity.value,
  }));
  const overviewAnimatedStyle = useAnimatedStyle(() => ({
    opacity: overviewOpacity.value,
  }));
  const eventsAnimatedStyle = useAnimatedStyle(() => ({
    opacity: eventsOpacity.value,
  }));

  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    headerGradient: {
      paddingBottom: SPACING.xl,
    },
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 44,
      gap: SPACING.sm,
    },
    orgLogoButton: {
      width: 44,
      height: 44,
    },
    orgLogo: {
      width: 44,
      height: 44,
      borderRadius: 22,
    },
    orgAvatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: APP_CHROME.avatarBackground,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    orgAvatarText: {
      ...TYPOGRAPHY.titleSmall,
      fontWeight: "700" as const,
      color: APP_CHROME.avatarText,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerGreeting: {
      ...TYPOGRAPHY.headlineSmall,
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      ...TYPOGRAPHY.caption,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    headerIconButton: {
      width: 36,
      height: 36,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
      borderTopLeftRadius: RADIUS.xxl,
      borderTopRightRadius: RADIUS.xxl,
      overflow: "hidden" as const,
      marginTop: -SPACING.sm,
    },
    // Segmented control — lighter background, sliding pill
    segmentedControl: {
      flexDirection: "row" as const,
      backgroundColor: n.divider,
      borderRadius: RADIUS.lg,
      padding: SPACING.xxs,
      marginHorizontal: SPACING.md,
      marginTop: SPACING.sm,
      marginBottom: SPACING.sm,
      position: "relative" as const,
    },
    segmentPill: {
      position: "absolute" as const,
      top: SPACING.xxs,
      bottom: SPACING.xxs,
      // Width is set to 1/3 of the container; works because all three tabs are flex:1
      // We rely on translateX to move the pill; actual width is computed at render time.
      // Using percentage-like value: each tab occupies 33.33% of the container.
      width: "33.33%",
      borderRadius: RADIUS.md,
      backgroundColor: s.success,
      ...SHADOWS.sm,
    },
    segment: {
      flex: 1,
      paddingVertical: SPACING.sm,
      alignItems: "center" as const,
      borderRadius: RADIUS.md,
      zIndex: 1,
    },
    segmentText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.muted,
    },
    segmentTextActive: {
      color: n.surface,
      fontWeight: "600" as const,
    },
    // Tab crossfade container
    tabContentContainer: {
      flex: 1,
      position: "relative" as const,
    },
    tabPane: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    centered: {
      flex: 1,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      padding: SPACING.lg,
      backgroundColor: n.background,
    },
  }));

  if (loading) {
    return (
      <View style={styles.centered}>
        <SkeletonList type="announcement" count={3} />
      </View>
    );
  }

  if (feedError && posts.length === 0) {
    return (
      <View style={styles.centered}>
        <ErrorState
          onRetry={handleRefresh}
          title="Unable to load feed"
          isOffline={isOffline}
        />
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
        <SafeAreaView edges={["top"]}>
          <View style={styles.headerContent}>
            {/* Logo — opens drawer */}
            <Pressable
              onPress={handleDrawerToggle}
              style={styles.orgLogoButton}
              accessibilityRole="button"
              accessibilityLabel={`Open navigation for ${orgName ?? "organization"}`}
            >
              {orgLogoUrl ? (
                <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0]}</Text>
                </View>
              )}
            </Pressable>

            {/* Greeting block */}
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerGreeting} numberOfLines={1}>
                {greeting}{firstName ? `, ${firstName}` : ""}
              </Text>
              <Text style={styles.headerMeta}>
                {`${orgName} · ${memberCount} ${memberCount === 1 ? "member" : "members"}`}
              </Text>
            </View>

            {/* Search icon */}
            <Pressable
              onPress={handleSearchPress}
              style={styles.headerIconButton}
              accessibilityLabel="Search"
              accessibilityRole="button"
            >
              <Search size={22} color={APP_CHROME.headerMeta} />
            </Pressable>

            {/* Bell icon */}
            <Pressable
              onPress={handleBellPress}
              style={styles.headerIconButton}
              accessibilityLabel="Notifications"
              accessibilityRole="button"
            >
              <Bell size={22} color={APP_CHROME.headerMeta} />
            </Pressable>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet — overlaps gradient with rounded top corners */}
      <View style={styles.contentSheet}>
        {/* Animated sliding pill tab bar */}
        <View style={styles.segmentedControl}>
          {/* Sliding pill indicator */}
          <Animated.View style={[styles.segmentPill, pillAnimatedStyle]} />

          {TAB_LABELS.map(({ key, label }) => (
            <Pressable
              key={key}
              style={styles.segment}
              onPress={() => handleTabChange(key)}
              onLayout={(e: LayoutChangeEvent) => {
                handleTabLayout(key, e.nativeEvent.layout.x);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === key }}
            >
              <Text
                style={[
                  styles.segmentText,
                  activeTab === key && styles.segmentTextActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Tab content — all three always mounted, crossfade via opacity */}
        <View style={styles.tabContentContainer}>
          <Animated.View
            style={[styles.tabPane, feedAnimatedStyle]}
            pointerEvents={activeTab === "feed" ? "auto" : "none"}
          >
            <FeedTab
              posts={posts}
              pendingPosts={pendingPosts}
              loading={feedLoading}
              loadingMore={loadingMore}
              hasMore={hasMore}
              refreshing={refreshing}
              onRefresh={handleRefresh}
              onLoadMore={loadMore}
              onAcceptPending={acceptPendingPosts}
              onPostPress={handlePostPress}
              onLikeToggle={handleLikeToggle}
              onCreatePost={handleCreatePost}
              isOffline={isOffline}
              upcomingEvents={transformedEvents}
              pinnedAnnouncement={pinnedAnnouncement}
              onEventPress={(id: string) =>
                handleNavigate(`/(app)/(drawer)/${orgSlug}/events/${id}`)
              }
              onAnnouncementPress={(id: string) =>
                handleNavigate(`/(app)/(drawer)/${orgSlug}/announcements/${id}`)
              }
              userAvatarUrl={userAvatarUrl}
              userName={userName}
            />
          </Animated.View>

          <Animated.View
            style={[styles.tabPane, overviewAnimatedStyle]}
            pointerEvents={activeTab === "overview" ? "auto" : "none"}
          >
            <OverviewTab
              orgSlug={orgSlug}
              stats={stats}
              loading={statsLoading}
              refreshing={refreshing}
              onRefresh={handleRefresh}
              onNavigate={handleNavigate}
              onCreatePost={handleCreatePost}
            />
          </Animated.View>

          <Animated.View
            style={[styles.tabPane, eventsAnimatedStyle]}
            pointerEvents={activeTab === "events" ? "auto" : "none"}
          >
            <EventsTab
              orgSlug={orgSlug}
              events={transformedEvents}
              announcements={recentAnnouncements}
              refreshing={refreshing}
              onRefresh={handleRefresh}
              onNavigate={handleNavigate}
              onRsvp={handleHomeRsvp}
            />
          </Animated.View>
        </View>
      </View>
    </View>
  );
}
