import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";

import { useRouter, useFocusEffect, useNavigation } from "expo-router";
import {
  Calendar,
  ChevronRight,
  Pin,
  Clock,
  MapPin,
  Users,
  Megaphone,
  GraduationCap,
} from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useEvents } from "@/hooks/useEvents";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useMembers } from "@/hooks/useMembers";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { normalizeRole, roleFlags } from "@teammeet/core";
import type { Organization } from "@teammeet/types";
import { APP_CHROME } from "@/lib/chrome";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";

// Hardcoded local colors matching Landing/Login palette (Uber-inspired)
const HOME_COLORS = {
  // Backgrounds
  background: "#f8fafc",  // slate-50 for 3-surface system

  // Text
  primaryText: "#0f172a",
  secondaryText: "#64748b",
  mutedText: "#94a3b8",

  // Borders & surfaces
  border: "#e2e8f0",
  card: "#ffffff",

  // CTAs
  primaryCTA: "#059669",
  primaryCTAText: "#ffffff",

  // States
  error: "#ef4444",
  errorBackground: "#fef2f2",
};

// Feature flag for activity feed (flip to true when ready)
const SHOW_ACTIVITY_FEED = false;

export default function HomeScreen() {
  const { orgSlug } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuth();
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

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const isRefetchingRef = useRef(false);

  const { events, refetch: refetchEvents, refetchIfStale: refetchEventsIfStale } = useEvents(orgSlug || "");
  const { announcements, refetch: refetchAnnouncements, refetchIfStale: refetchAnnouncementsIfStale } = useAnnouncements(orgSlug || "");
  const { members, refetch: refetchMembers, refetchIfStale: refetchMembersIfStale } = useMembers(orgSlug || "");
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
    if (!orgSlug || !user) {
      return;
    }

    try {
      // Fetch organization
      const { data: orgData, error: fetchError } = await supabase
        .from("organizations")
        .select("*")
        .eq("slug", orgSlug)
        .single();

      if (fetchError) throw fetchError;

      // Fetch user profile and role
      const { data: roleData } = await supabase
        .from("user_organization_roles")
        .select("role, user:users(name)")
        .eq("user_id", user.id)
        .eq("organization_id", orgData.id)
        .eq("status", "active")
        .single();

      if (isMountedRef.current) {
        setOrganization(orgData);
        setOrgId(orgData.id);

        if (roleData) {
          const normalized = normalizeRole(roleData.role);
          const flags = roleFlags(normalized);
          setIsAdmin(flags.isAdmin);

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
  }, [orgSlug, user]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchData();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchData]);

  useEffect(() => {
    setOrgId(null);
  }, [orgSlug]);

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
    const date = new Date(dateString);
    return date.toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  const formatNextEventTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatEventTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={HOME_COLORS.primaryCTA} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      </View>
    );
  }

  const firstName = userName?.split(" ")[0] || user?.email?.split("@")[0] || "there";

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
              {organization?.logo_url ? (
                <Image source={{ uri: organization.logo_url }} style={styles.orgLogo} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{organization?.name?.[0]}</Text>
                </View>
              )}
            </Pressable>

            {/* Text (left-aligned) */}
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {organization?.name}
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
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={HOME_COLORS.primaryCTA} />
          }
        >
        {/* Quick Access Section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Quick Access</Text>
          <View style={styles.quickActionsGrid}>
          <TouchableOpacity
            style={styles.actionTile}
            onPress={() => router.push(`/(app)/${orgSlug}/(tabs)/events`)}
            activeOpacity={0.7}
          >
            <View style={styles.actionTileIcon}>
              <Calendar size={22} color={HOME_COLORS.primaryText} strokeWidth={2.5} />
            </View>
            <Text style={styles.actionTileLabel}>Events</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionTile}
            onPress={() => router.push(`/(app)/${orgSlug}/(tabs)/announcements`)}
            activeOpacity={0.7}
          >
            <View style={styles.actionTileIcon}>
              <Megaphone size={22} color={HOME_COLORS.primaryText} strokeWidth={2.5} />
            </View>
            <Text style={styles.actionTileLabel}>Announcements</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionTile}
            onPress={() => router.push(`/(app)/${orgSlug}/(tabs)/members`)}
            activeOpacity={0.7}
          >
            <View style={styles.actionTileIcon}>
              <Users size={22} color={HOME_COLORS.primaryText} strokeWidth={2.5} />
            </View>
            <Text style={styles.actionTileLabel}>Members</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionTile}
            onPress={() => router.push(`/(app)/${orgSlug}/(tabs)/alumni`)}
            activeOpacity={0.7}
          >
            <View style={styles.actionTileIcon}>
              <GraduationCap size={22} color={HOME_COLORS.primaryText} strokeWidth={2.5} />
            </View>
            <Text style={styles.actionTileLabel}>Alumni</Text>
          </TouchableOpacity>
          </View>
        </View>

        {/* Upcoming Events (Feed-like) */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Upcoming Events</Text>
            <TouchableOpacity
              style={styles.seeAllButton}
              onPress={() => router.push(`/(app)/${orgSlug}/(tabs)/events`)}
            >
              <Text style={styles.seeAllText}>See all</Text>
              <ChevronRight size={16} color={HOME_COLORS.secondaryText} />
            </TouchableOpacity>
          </View>

          {upcomingEvents.length > 0 ? (
            <View style={styles.eventsStack}>
              {upcomingEvents.map((event, index) => (
                <TouchableOpacity
                  key={event.id}
                  style={[
                    styles.eventCard,
                    index === 0 && upcomingEvents.length === 1 && styles.eventCardElevated,
                  ]}
                  activeOpacity={0.7}
                >
                  <Text style={styles.eventTitle} numberOfLines={1}>
                    {event.title}
                  </Text>
                  <View style={styles.eventDetails}>
                    <View style={styles.eventDetail}>
                      <Clock size={14} color={HOME_COLORS.secondaryText} />
                      <Text style={styles.eventDetailText}>
                        {formatEventTime(event.start_date)}
                      </Text>
                    </View>
                    {event.location && (
                      <View style={styles.eventDetail}>
                        <MapPin size={14} color={HOME_COLORS.secondaryText} />
                        <Text style={styles.eventDetailText} numberOfLines={1}>
                          {event.location}
                        </Text>
                      </View>
                    )}
                  </View>
                  <TouchableOpacity style={styles.rsvpButton}>
                    <Text style={styles.rsvpButtonText}>RSVP</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Calendar size={24} color={HOME_COLORS.mutedText} />
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

            <TouchableOpacity style={styles.announcementCard} activeOpacity={0.7}>
              <View style={styles.pinnedBadge}>
                <Pin size={12} color={HOME_COLORS.primaryCTA} />
                <Text style={styles.pinnedText}>Pinned</Text>
              </View>
              <Text style={styles.announcementTitle} numberOfLines={1}>
                {pinnedAnnouncement.title}
              </Text>
              <Text style={styles.announcementPreview} numberOfLines={3}>
                {pinnedAnnouncement.body}
              </Text>
            </TouchableOpacity>
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
      backgroundColor: HOME_COLORS.background,
    },
    // Gradient header styles
    headerGradient: {
      paddingBottom: spacing.md,
    },
    headerSafeArea: {
      // SafeAreaView handles top inset
    },
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      minHeight: 40,
      gap: spacing.sm,
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
      fontSize: fontSize.base,
      fontWeight: fontWeight.bold,
      color: APP_CHROME.avatarText,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      fontSize: fontSize.xs,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: HOME_COLORS.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      marginTop: -16,
      overflow: "hidden",
    },
    content: {
      padding: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: 40,
      gap: spacing.sm,
    },
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
      backgroundColor: HOME_COLORS.background,
    },
    // Quick Actions (2x2 Grid)
    quickActionsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
    },
    actionTile: {
      flex: 1,
      flexBasis: "45%",
      minWidth: 140,
      backgroundColor: "transparent",
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      alignItems: "center",
      gap: spacing.xs,
    },
    actionTileIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: HOME_COLORS.background,
      alignItems: "center",
      justifyContent: "center",
    },
    actionTileLabel: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: HOME_COLORS.secondaryText,
    },
    // Section styles
    section: {
      gap: spacing.sm,
    },
    sectionLabel: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
      color: HOME_COLORS.mutedText,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: spacing.sm,
    },
    sectionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    sectionTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: HOME_COLORS.primaryText,
    },
    seeAllButton: {
      flexDirection: "row",
      alignItems: "center",
    },
    seeAllText: {
      fontSize: fontSize.sm,
      color: HOME_COLORS.secondaryText,
      fontWeight: fontWeight.medium,
    },
    // Events (stacked, feed-like)
    eventsStack: {
      gap: spacing.sm,
    },
    eventCard: {
      backgroundColor: HOME_COLORS.card,
      borderRadius: borderRadius.md,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: HOME_COLORS.border,
      padding: spacing.md,
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
    },
    eventCardElevated: {
      boxShadow: "0 2px 6px rgba(0, 0, 0, 0.08)",
    },
    eventTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: HOME_COLORS.primaryText,
      marginBottom: spacing.xs,
    },
    eventDetails: {
      gap: 4,
    },
    eventDetail: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    eventDetailText: {
      fontSize: fontSize.sm,
      color: HOME_COLORS.secondaryText,
      flex: 1,
    },
    rsvpButton: {
      backgroundColor: HOME_COLORS.primaryCTA,
      borderRadius: borderRadius.sm,
      paddingVertical: spacing.sm,
      alignItems: "center",
      marginTop: spacing.sm,
    },
    rsvpButtonText: {
      color: HOME_COLORS.primaryCTAText,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
    // Announcement card
    announcementCard: {
      backgroundColor: HOME_COLORS.card,
      borderRadius: borderRadius.md,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: HOME_COLORS.border,
      padding: spacing.md,
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
    },
    pinnedBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginBottom: spacing.xs,
    },
    pinnedText: {
      fontSize: fontSize.xs,
      color: HOME_COLORS.primaryCTA,
      fontWeight: fontWeight.medium,
    },
    announcementTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: HOME_COLORS.primaryText,
      marginBottom: spacing.xs,
    },
    announcementPreview: {
      fontSize: fontSize.sm,
      color: HOME_COLORS.secondaryText,
      lineHeight: 20,
    },
    // Empty state
    emptyCard: {
      backgroundColor: HOME_COLORS.card,
      borderRadius: borderRadius.md,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: HOME_COLORS.border,
      padding: spacing.lg,
      alignItems: "center",
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
    },
    emptyText: {
      fontSize: fontSize.sm,
      color: HOME_COLORS.mutedText,
      marginTop: spacing.sm,
    },
    // Activity (future)
    activityCard: {
      backgroundColor: HOME_COLORS.card,
      borderRadius: borderRadius.md,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: HOME_COLORS.border,
      padding: spacing.lg,
      alignItems: "center",
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
    },
    activityEmpty: {
      fontSize: fontSize.sm,
      color: HOME_COLORS.mutedText,
    },
    // Error state
    errorCard: {
      backgroundColor: HOME_COLORS.errorBackground,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: HOME_COLORS.error,
      padding: spacing.lg,
    },
    errorText: {
      fontSize: fontSize.base,
      color: HOME_COLORS.error,
      textAlign: "center",
    },
  });
