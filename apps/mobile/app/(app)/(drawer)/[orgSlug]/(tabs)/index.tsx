import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  StyleSheet,
  Pressable,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";

import { useRouter, useFocusEffect, useNavigation } from "expo-router";
import {
  Calendar,
  ChevronRight,
  Users,
  Megaphone,
  GraduationCap,
  RefreshCw,
} from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useEvents } from "@/hooks/useEvents";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useMembers } from "@/hooks/useMembers";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatShortWeekdayDate, formatTime, formatWeekdayDateTime } from "@/lib/date-format";
import { EventCard, type EventCardEvent } from "@/components/cards/EventCard";
import { AnnouncementCardCompact } from "@/components/cards/AnnouncementCard";
import { SkeletonEventCard, SkeletonAnnouncementCard } from "@/components/ui/Skeleton";

// Feature flag for activity feed (flip to true when ready)
const SHOW_ACTIVITY_FEED = false;

export default function HomeScreen() {
  const { orgSlug, orgId, orgName, orgLogoUrl } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { isAdmin } = useOrgRole();
  const styles = useMemo(() => createStyles(), []);
  const isMountedRef = useRef(true);

  // Safe drawer toggle - only dispatch if drawer is available
  const handleDrawerToggle = useCallback(() => {
    try {
      // Check if navigation has dispatch method (drawer navigator)
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available (web preview / tests) - no-op
    }
  }, [navigation]);

  const [userName, setUserName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const isRefetchingRef = useRef(false);

  // Use orgId from context for all data hooks (eliminates redundant org fetches)
  const { events, refetch: refetchEvents, refetchIfStale: refetchEventsIfStale } = useEvents(orgId);
  const { announcements, refetch: refetchAnnouncements, refetchIfStale: refetchAnnouncementsIfStale } = useAnnouncements(orgId);
  const { members, refetch: refetchMembers, refetchIfStale: refetchMembersIfStale } = useMembers(orgId);
  const userId = user?.id ?? null;

  // Get upcoming events (next 2)
  const now = new Date();
  const upcomingEvents = events
    .filter((e) => new Date(e.start_date) >= now)
    .slice(0, 2);

  // Get the next upcoming event for the overview card
  const nextEvent = upcomingEvents[0] || null;

  // Get pinned announcement
  const pinnedAnnouncement = announcements.find((a) => (a as any).is_pinned);

  const fetchData = useCallback(async () => {
    if (!orgId || !user) {
      return;
    }

    try {
      // Fetch user profile name (role comes from useOrgRole hook)
      const { data: roleData } = await supabase
        .from("user_organization_roles")
        .select("user:users(name)")
        .eq("user_id", user.id)
        .eq("organization_id", orgId)
        .eq("status", "active")
        .single();

      if (isMountedRef.current) {
        if (roleData) {
          const userData = roleData.user as { name: string | null } | null;
          setUserName(userData?.name || null);
        }
        setError(null);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError((e as Error).message);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [orgId, user]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchData();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchData]);

  useEffect(() => {
    setMemberCount(members.length);
  }, [members]);

  // Refetch on tab focus if data is stale
  useFocusEffect(
    useCallback(() => {
      refetchEventsIfStale();
      refetchAnnouncementsIfStale();
      refetchMembersIfStale();
    }, [refetchEventsIfStale, refetchAnnouncementsIfStale, refetchMembersIfStale])
  );

  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`organization:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "organizations",
          filter: `id=eq.${orgId}`,
        },
        () => {
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchData]);

  useEffect(() => {
    if (!orgId || !userId) return;
    const channel = supabase
      .channel(`organization-role:${orgId}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_organization_roles",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const nextOrgId = (payload.new as { organization_id?: string } | null)
            ?.organization_id;
          const previousOrgId = (payload.old as { organization_id?: string } | null)
            ?.organization_id;
          if (nextOrgId === orgId || previousOrgId === orgId) {
            fetchData();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, userId, fetchData]);

  const handleRefresh = async () => {
    if (isRefetchingRef.current) return;
    setRefreshing(true);
    isRefetchingRef.current = true;
    try {
      await Promise.all([
        fetchData(),
        refetchEvents(),
        refetchAnnouncements(),
        refetchMembers(),
      ]);
    } finally {
      setRefreshing(false);
      isRefetchingRef.current = false;
    }
  };

  const formatNextEventDate = (dateString: string) => {
    return formatShortWeekdayDate(dateString);
  };

  const formatNextEventTime = (dateString: string) => {
    return formatTime(dateString);
  };

  const formatEventTime = (dateString: string) => {
    return formatWeekdayDateTime(dateString);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={SEMANTIC.success} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <View style={styles.errorCard}>
          <RefreshCw size={40} color={NEUTRAL.border} />
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.retryButtonPressed,
            ]}
            onPress={handleRefresh}
            accessibilityLabel="Retry loading"
            accessibilityRole="button"
          >
            <RefreshCw size={16} color={NEUTRAL.surface} />
            <Text style={styles.retryButtonText}>Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const firstName = userName?.split(" ")[0] || user?.email?.split("@")[0] || "there";

  // Transform events to EventCard format
  const transformedEvents: EventCardEvent[] = upcomingEvents.map((event) => ({
    id: event.id,
    title: event.title,
    start_date: event.start_date,
    end_date: event.end_date,
    location: event.location,
    rsvp_count: (event as any).rsvp_count,
    user_rsvp_status: (event as any).user_rsvp_status,
  }));

  return (
    <View style={styles.container}>
      {/* Custom Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            {/* Logo */}
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0]}</Text>
                </View>
              )}
            </Pressable>

            {/* Text (left-aligned) */}
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {orgName}
              </Text>
              <Text style={styles.headerMeta}>
                {memberCount} {memberCount === 1 ? "member" : "members"} · {upcomingEvents.length} {upcomingEvents.length === 1 ? "event" : "events"}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={SEMANTIC.success} />
          }
        >
        {/* Quick Access Section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Quick Access</Text>
          <View style={styles.quickActionsGrid}>
          <Pressable
            style={({ pressed }) => [styles.actionTile, pressed && { opacity: 0.7 }]}
            onPress={() => router.push(`/(app)/${orgSlug}/(tabs)/events`)}
          >
            <View style={styles.actionTileIcon}>
              <Calendar size={22} color={NEUTRAL.foreground} strokeWidth={2} />
            </View>
            <Text style={styles.actionTileLabel}>Events</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.actionTile, pressed && { opacity: 0.7 }]}
            onPress={() => router.push(`/(app)/${orgSlug}/(tabs)/announcements`)}
          >
            <View style={styles.actionTileIcon}>
              <Megaphone size={22} color={NEUTRAL.foreground} strokeWidth={2} />
            </View>
            <Text style={styles.actionTileLabel}>News</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.actionTile, pressed && { opacity: 0.7 }]}
            onPress={() => router.push(`/(app)/${orgSlug}/(tabs)/members`)}
          >
            <View style={styles.actionTileIcon}>
              <Users size={22} color={NEUTRAL.foreground} strokeWidth={2} />
            </View>
            <Text style={styles.actionTileLabel}>Members</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.actionTile, pressed && { opacity: 0.7 }]}
            onPress={() => router.push(`/(app)/${orgSlug}/(tabs)/alumni`)}
          >
            <View style={styles.actionTileIcon}>
              <GraduationCap size={22} color={NEUTRAL.foreground} strokeWidth={2} />
            </View>
            <Text style={styles.actionTileLabel}>Alumni</Text>
          </Pressable>
          </View>
        </View>

        {/* Upcoming Events */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Upcoming Events</Text>
            <Pressable
              style={({ pressed }) => [styles.seeAllButton, pressed && { opacity: 0.7 }]}
              onPress={() => router.push(`/(app)/${orgSlug}/(tabs)/events`)}
            >
              <Text style={styles.seeAllText}>See all</Text>
              <ChevronRight size={16} color={NEUTRAL.secondary} />
            </Pressable>
          </View>

          {transformedEvents.length > 0 ? (
            <View style={styles.eventsStack}>
              {transformedEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onPress={() => router.push(`/(app)/${orgSlug}/events/${event.id}`)}
                  onRSVP={() => router.push(`/(app)/${orgSlug}/events/${event.id}`)}
                  accentColor={SEMANTIC.success}
                />
              ))}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Calendar size={24} color={NEUTRAL.muted} />
              <Text style={styles.emptyText}>No upcoming events</Text>
            </View>
          )}
        </View>

        {/* Pinned Announcement (Conditional - hidden if empty) */}
        {pinnedAnnouncement && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Pinned</Text>
            </View>

            <AnnouncementCardCompact
              announcement={{
                id: pinnedAnnouncement.id,
                title: pinnedAnnouncement.title,
                body: pinnedAnnouncement.body,
                created_at: pinnedAnnouncement.created_at,
                is_pinned: true,
              }}
              onPress={() => router.push(`/(app)/${orgSlug}/announcements/${pinnedAnnouncement.id}`)}
            />
          </View>
        )}

        {/* Latest Activity (hidden until ready) */}
        {SHOW_ACTIVITY_FEED && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Latest</Text>
            </View>

            <View style={styles.activityCard}>
              <Text style={styles.activityEmpty}>
                Activity feed coming soon
              </Text>
            </View>
          </View>
        )}
        </ScrollView>
      </View>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: NEUTRAL.background,
    },
    // Gradient header styles
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {
      // SafeAreaView handles top inset
    },
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
    contentSheet: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
    },
    content: {
      padding: SPACING.md,
      paddingTop: SPACING.sm,
      paddingBottom: 40,
      gap: SPACING.lg,
    },
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
      backgroundColor: NEUTRAL.background,
    },
    // Quick Actions (2x2 Grid)
    quickActionsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: SPACING.xs,
    },
    actionTile: {
      flex: 1,
      flexBasis: "45%",
      minWidth: 140,
      backgroundColor: "transparent",
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.sm,
      alignItems: "center",
      gap: SPACING.xs,
    },
    actionTileIcon: {
      width: 48,
      height: 48,
      borderRadius: RADIUS.lg,
      backgroundColor: NEUTRAL.background,
      alignItems: "center",
      justifyContent: "center",
    },
    actionTileLabel: {
      ...TYPOGRAPHY.labelSmall,
      color: NEUTRAL.secondary,
    },
    // Section styles
    section: {
      gap: SPACING.sm,
    },
    sectionLabel: {
      ...TYPOGRAPHY.overline,
      color: NEUTRAL.muted,
      marginBottom: SPACING.sm,
    },
    sectionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    sectionTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: NEUTRAL.foreground,
    },
    seeAllButton: {
      flexDirection: "row",
      alignItems: "center",
    },
    seeAllText: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.secondary,
    },
    // Events (stacked)
    eventsStack: {
      gap: SPACING.md,
    },
    // Empty state
    emptyCard: {
      backgroundColor: NEUTRAL.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      padding: SPACING.lg,
      alignItems: "center",
      ...SHADOWS.sm,
    },
    emptyText: {
      ...TYPOGRAPHY.bodySmall,
      color: NEUTRAL.muted,
      marginTop: SPACING.sm,
    },
    // Activity (future)
    activityCard: {
      backgroundColor: NEUTRAL.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      padding: SPACING.lg,
      alignItems: "center",
      ...SHADOWS.sm,
    },
    activityEmpty: {
      ...TYPOGRAPHY.bodySmall,
      color: NEUTRAL.muted,
    },
    // Error state
    errorCard: {
      backgroundColor: NEUTRAL.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      padding: SPACING.xl,
      alignItems: "center",
      ...SHADOWS.sm,
    },
    errorTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: NEUTRAL.foreground,
      marginTop: SPACING.sm,
    },
    errorText: {
      ...TYPOGRAPHY.bodySmall,
      color: NEUTRAL.muted,
      textAlign: "center",
      marginTop: SPACING.xs,
    },
    retryButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
      marginTop: SPACING.md,
      paddingVertical: SPACING.sm + 2,
      paddingHorizontal: SPACING.lg,
      borderRadius: RADIUS.md,
      backgroundColor: SEMANTIC.success,
    },
    retryButtonPressed: {
      opacity: 0.8,
    },
    retryButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.surface,
    },
  });
