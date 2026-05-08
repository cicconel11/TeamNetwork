import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { View, Text, Pressable } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useRouter, useFocusEffect, useNavigation } from "expo-router";
import { Bell, Search } from "lucide-react-native";
import { useAuth } from "@/hooks/useAuth";
import { useEvents } from "@/hooks/useEvents";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useMembers } from "@/hooks/useMembers";
import { useFeed } from "@/hooks/useFeed";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { ErrorState, SkeletonList } from "@/components/ui";
import { useNetwork } from "@/contexts/NetworkContext";
import { useAutoRefetchOnReconnect } from "@/hooks/useAutoRefetchOnReconnect";
import { showToast } from "@/components/ui/Toast";
import { FeedTab } from "@/components/home/FeedTab";
import { EventStartingSoonBanner } from "@/components/home/event-starting-soon-banner";
import { useEventCheckInCount } from "@/hooks/useEventCheckInCount";
import { useNow } from "@/hooks/useNow";
import type { EventCardEvent } from "@/components/cards/EventCard";

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

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const isRefetchingRef = useRef(false);

  const { events, refetch: refetchEvents, refetchIfStale: refetchEventsIfStale } = useEvents(orgId);
  const { announcements, refetch: refetchAnnouncements, refetchIfStale: refetchAnnouncementsIfStale } = useAnnouncements(orgId);
  const { members, refetch: refetchMembers, refetchIfStale: refetchMembersIfStale } = useMembers(orgId);
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
      refetchFeedIfStale();
    }, [refetchEventsIfStale, refetchAnnouncementsIfStale, refetchMembersIfStale, refetchFeedIfStale])
  );

  const reconnectRefetch = useCallback(() => {
    refetchEvents();
    refetchAnnouncements();
    refetchMembers();
    refetchFeed();
  }, [refetchEvents, refetchAnnouncements, refetchMembers, refetchFeed]);
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

  const handleSeeAllEvents = useCallback(
    () => router.push(`/(app)/(drawer)/${orgSlug}/calendar` as any),
    [router, orgSlug]
  );

  const handleSeeAllAnnouncements = useCallback(
    () => router.push(`/(app)/(drawer)/${orgSlug}/announcements` as any),
    [router, orgSlug]
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

  // Soonest upcoming start drives the banner cadence — `useNow` re-renders
  // every second when within 15 minutes so the countdown ticks live.
  const soonestStart = useMemo(() => {
    if (events.length === 0) return null;
    const future = events
      .map((e) => e.start_date)
      .filter((s): s is string => !!s)
      .filter((s) => Date.parse(s) > 0);
    if (future.length === 0) return null;
    future.sort();
    return future[0];
  }, [events]);
  const now = useNow(soonestStart);

  const { upNextEvent, imminentEvent } = useMemo(() => {
    const upcoming = events
      .filter((e) => {
        // Include ongoing events: use end_date if present, else start_date.
        // An event still counts as "upcoming" until it has actually ended.
        const cutoff = e.end_date ?? e.start_date;
        if (!cutoff) return false;
        return new Date(cutoff) >= now;
      })
      .sort(
        (a, b) =>
          new Date(a.start_date).getTime() - new Date(b.start_date).getTime()
      );

    const nextRaw = upcoming[0] ?? null;
    const upNext: EventCardEvent | null = nextRaw
      ? {
          id: nextRaw.id,
          title: nextRaw.title,
          start_date: nextRaw.start_date,
          end_date: nextRaw.end_date,
          location: nextRaw.location,
          rsvp_count: nextRaw.rsvp_count,
          user_rsvp_status: nextRaw.user_rsvp_status as EventCardEvent["user_rsvp_status"],
        }
      : null;

    // Imminent = the soonest event whose start is within the next 30 minutes,
    // or one that has started but not ended. Drives the home pop-up banner.
    const cutoffMs = now.getTime() + 30 * 60 * 1000;
    const imminent =
      upcoming.find((e) => {
        const startMs = Date.parse(e.start_date);
        if (!Number.isFinite(startMs)) return false;
        return startMs <= cutoffMs;
      }) ?? null;

    return {
      upNextEvent: upNext,
      imminentEvent: imminent,
    };
  }, [events, now]);

  // Hide the "Up next" card when the banner is already showing the same event.
  const visibleUpNextEvent =
    upNextEvent && upNextEvent.id !== imminentEvent?.id ? upNextEvent : null;

  const { count: imminentCheckedInCount } = useEventCheckInCount(
    imminentEvent?.id ?? null,
  );

  const pinnedAnnouncement = useMemo(
    () => announcements.find((a) => a.is_pinned) ?? null,
    [announcements]
  );

  const styles = useThemedStyles((n) => ({
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
        {imminentEvent ? (
          <EventStartingSoonBanner
            eventId={imminentEvent.id}
            title={imminentEvent.title}
            location={imminentEvent.location}
            startAt={imminentEvent.start_date}
            attendingCount={imminentEvent.rsvp_count ?? 0}
            checkedInCount={imminentCheckedInCount}
            onPress={() =>
              handleNavigate(
                `/(app)/(drawer)/${orgSlug}/events/${imminentEvent.id}`,
              )
            }
          />
        ) : null}

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
          upNextEvent={visibleUpNextEvent}
          pinnedAnnouncement={pinnedAnnouncement}
          onEventPress={(id: string) =>
            handleNavigate(`/(app)/(drawer)/${orgSlug}/events/${id}`)
          }
          onAnnouncementPress={(id: string) =>
            handleNavigate(`/(app)/(drawer)/${orgSlug}/announcements/${id}`)
          }
          onSeeAllEvents={handleSeeAllEvents}
          onSeeAllAnnouncements={handleSeeAllAnnouncements}
          userAvatarUrl={userAvatarUrl}
          userName={userName}
        />
      </View>
    </View>
  );
}
