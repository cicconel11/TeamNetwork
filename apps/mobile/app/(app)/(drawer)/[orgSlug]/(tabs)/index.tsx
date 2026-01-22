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
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { spacing, borderRadius, fontSize, fontWeight, type ThemeColors } from "@/lib/theme";

// Hardcoded local colors matching Landing/Login palette (Uber-inspired)
const HOME_COLORS = {
  // Header gradient
  gradientStart: "#134e4a",
  gradientEnd: "#0f172a",

  // Backgrounds
  background: "#ffffff",
  sectionBackground: "#f8fafc",

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
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  const formatDate = () => {
    return new Date().toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
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
        colors={[HOME_COLORS.gradientStart, HOME_COLORS.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            {/* Left: Logo (40px width) */}
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {organization?.logo_url ? (
                <Image source={{ uri: organization.logo_url }} style={styles.orgLogo} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{organization?.name?.[0]}</Text>
                </View>
              )}
            </Pressable>

            {/* Center: Org name + stats metadata */}
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {organization?.name}
              </Text>
              <Text style={styles.headerMeta}>
                {memberCount} {memberCount === 1 ? "member" : "members"} · {upcomingEvents.length} {upcomingEvents.length === 1 ? "event" : "events"}
              </Text>
            </View>

            {/* Right: Spacer (must match logo button width: 40px) */}
            <View style={styles.headerSpacer} />
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={HOME_COLORS.primaryCTA} />
        }
      >
        {/* Primary Action Card */}
        <View style={styles.actionCard}>
          <Text style={styles.actionCardTitle}>Quick actions</Text>
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => router.push(`/(app)/${orgSlug}/(tabs)/events`)}
            >
              <Calendar size={20} color={HOME_COLORS.primaryCTA} />
              <Text style={styles.actionButtonText}>Events</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => router.push(`/(app)/${orgSlug}/(tabs)/announcements`)}
            >
              <Pin size={20} color={HOME_COLORS.primaryCTA} />
              <Text style={styles.actionButtonText}>Announcements</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Upcoming Events */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Upcoming Events</Text>
            <TouchableOpacity
              style={styles.seeAllButton}
              onPress={() => router.push(`/(app)/${orgSlug}/(tabs)/events`)}
            >
              <Text style={styles.seeAllText}>See all</Text>
              <ChevronRight size={16} color={HOME_COLORS.primaryCTA} />
            </TouchableOpacity>
          </View>

          {upcomingEvents.length > 0 ? (
            upcomingEvents.map((event) => (
              <TouchableOpacity key={event.id} style={styles.eventCard} activeOpacity={0.7}>
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
            ))
          ) : (
            <View style={styles.emptyCard}>
              <Calendar size={24} color={HOME_COLORS.mutedText} />
              <Text style={styles.emptyText}>No upcoming events</Text>
            </View>
          )}
        </View>

        {/* Pinned Announcement */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Pinned</Text>
          </View>

          {pinnedAnnouncement ? (
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
          ) : (
            <View style={styles.emptyCard}>
              <Pin size={24} color={HOME_COLORS.mutedText} />
              <Text style={styles.emptyText}>No pinned announcements</Text>
            </View>
          )}
        </View>

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
  );
}

const createStyles = (colors: ThemeColors) =>
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
      paddingTop: spacing.sm,
      minHeight: 44,
    },
    orgLogoButton: {
      width: 40,
      height: 40,
    },
    orgLogo: {
      width: 40,
      height: 40,
      borderRadius: 20,
    },
    orgAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: "rgba(255, 255, 255, 0.2)",
      alignItems: "center",
      justifyContent: "center",
    },
    orgAvatarText: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      color: "#ffffff",
    },
    headerTextContainer: {
      flex: 1,
      alignItems: "center",
      marginHorizontal: spacing.sm,
    },
    headerTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: "#ffffff",
    },
    headerMeta: {
      fontSize: fontSize.xs,
      color: "rgba(255, 255, 255, 0.7)",
      marginTop: 2,
    },
    headerSpacer: {
      width: 40,
    },
    content: {
      padding: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: 40,
    },
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
      backgroundColor: HOME_COLORS.background,
    },
    // Action card styles
    actionCard: {
      backgroundColor: HOME_COLORS.card,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: HOME_COLORS.border,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    actionCardTitle: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: HOME_COLORS.secondaryText,
      marginBottom: spacing.sm,
    },
    actionButtons: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    actionButton: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      backgroundColor: HOME_COLORS.sectionBackground,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    actionButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: HOME_COLORS.primaryText,
    },
    section: {
      marginBottom: 24,
    },
    sectionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: HOME_COLORS.primaryText,
    },
    seeAllButton: {
      flexDirection: "row",
      alignItems: "center",
    },
    seeAllText: {
      fontSize: 14,
      color: HOME_COLORS.primaryCTA,
      fontWeight: "500",
    },
    eventCard: {
      backgroundColor: HOME_COLORS.card,
      borderRadius: 12,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: HOME_COLORS.border,
      padding: 16,
      marginBottom: 12,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
    },
    eventTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: HOME_COLORS.primaryText,
      marginBottom: 8,
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
      borderRadius: borderRadius.md,
      paddingVertical: 10,
      alignItems: "center",
      marginTop: 12,
    },
    rsvpButtonText: {
      color: HOME_COLORS.primaryCTAText,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
    announcementCard: {
      backgroundColor: HOME_COLORS.card,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: HOME_COLORS.border,
      padding: spacing.md,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
    },
    pinnedBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginBottom: 8,
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
      marginBottom: spacing.sm,
    },
    announcementPreview: {
      fontSize: fontSize.sm,
      color: HOME_COLORS.secondaryText,
      lineHeight: 20,
    },
    emptyCard: {
      backgroundColor: HOME_COLORS.card,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: HOME_COLORS.border,
      padding: spacing.lg,
      alignItems: "center",
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
    },
    emptyText: {
      fontSize: fontSize.sm,
      color: HOME_COLORS.mutedText,
      marginTop: spacing.sm,
    },
    activityCard: {
      backgroundColor: HOME_COLORS.card,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: HOME_COLORS.border,
      padding: spacing.lg,
      alignItems: "center",
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
    },
    activityEmpty: {
      fontSize: fontSize.sm,
      color: HOME_COLORS.mutedText,
    },
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
