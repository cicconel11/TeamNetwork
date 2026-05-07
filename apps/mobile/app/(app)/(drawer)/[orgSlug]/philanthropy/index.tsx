import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useRouter, useNavigation } from "expo-router";
import {
  Calendar,
  Clock,
  DollarSign,
  Heart,
  MapPin,
  Plus,
  Sparkles,
} from "lucide-react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS, SEMANTIC } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatMonthShort, formatTime } from "@/lib/date-format";
import type { Event, OrganizationDonationStat } from "@teammeet/types";

type PhilanthropyView = "upcoming" | "past";

// Accent color for philanthropy — heart/charity theme
const ACCENT = "#059669"; // emerald-600

export default function PhilanthropyScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
  const { isAdmin, isActiveMember } = useOrgRole();
  const { neutral, semantic } = useAppColorScheme();
  const isMountedRef = useRef(true);

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available - no-op
    }
  }, [navigation]);

  const [allEvents, setAllEvents] = useState<Event[]>([]);
  const [donationStats, setDonationStats] = useState<OrganizationDonationStat | null>(null);
  const [stripeConnected, setStripeConnected] = useState(false);
  const [view, setView] = useState<PhilanthropyView>("upcoming");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = isAdmin || isActiveMember;

  const fetchData = useCallback(
    async (isRefresh = false) => {
      if (!orgId) {
        if (isMountedRef.current) {
          setAllEvents([]);
          setDonationStats(null);
          setStripeConnected(false);
          setLoading(false);
          setRefreshing(false);
          setError(null);
        }
        return;
      }

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const [
          { data: eventsData, error: eventsError },
          { data: donationData, error: donationError },
          { data: orgData, error: orgError },
        ] = await Promise.all([
          supabase
            .from("events")
            .select("*")
            .eq("organization_id", orgId)
            .or("is_philanthropy.eq.true,event_type.eq.philanthropy"),
          supabase
            .from("organization_donation_stats")
            .select("*")
            .eq("organization_id", orgId)
            .maybeSingle(),
          supabase
            .from("organizations")
            .select("stripe_connect_account_id")
            .eq("id", orgId)
            .maybeSingle(),
        ]);

        if (eventsError) throw eventsError;
        if (donationError) throw donationError;
        if (orgError) throw orgError;

        if (isMountedRef.current) {
          setAllEvents((eventsData || []) as Event[]);
          setDonationStats((donationData as OrganizationDonationStat | null) || null);
          setStripeConnected(Boolean(orgData?.stripe_connect_account_id));
          setError(null);
        }
      } catch (fetchError) {
        if (isMountedRef.current) {
          setError((fetchError as Error).message || "Failed to load philanthropy data.");
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [orgId]
  );

  useEffect(() => {
    isMountedRef.current = true;
    fetchData();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchData]);

  useEffect(() => {
    if (!orgId) return;
    const eventsChannel = createPostgresChangesChannel(`philanthropy-events:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "events",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchData();
        }
      )
      .subscribe();

    const donationChannel = createPostgresChangesChannel(`donation-stats:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "organization_donation_stats",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchData();
        }
      )
      .subscribe();

    const orgChannel = createPostgresChangesChannel(`org-connect:${orgId}`)
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
      supabase.removeChannel(eventsChannel);
      supabase.removeChannel(donationChannel);
      supabase.removeChannel(orgChannel);
    };
  }, [orgId, fetchData]);

  const handleRefresh = useCallback(() => fetchData(true), [fetchData]);

  const now = useMemo(() => new Date(), [allEvents.length]);
  const upcomingEvents = useMemo(
    () => allEvents.filter((event) => new Date(event.start_date) >= now).sort(sortByStartAsc),
    [allEvents, now]
  );
  const pastEvents = useMemo(
    () => allEvents.filter((event) => new Date(event.start_date) < now).sort(sortByStartDesc),
    [allEvents, now]
  );
  const visibleEvents = view === "past" ? pastEvents : upcomingEvents;

  const totalEvents = allEvents.length;
  const upcomingCount = upcomingEvents.length;
  const pastCount = pastEvents.length;

  const totalRaised = (donationStats?.total_amount_cents ?? 0) / 100;
  const donationCount = donationStats?.donation_count ?? 0;

  const handleAddEvent = useCallback(() => {
    router.push(`/(app)/${orgSlug}/philanthropy/new`);
  }, [router, orgSlug]);

  const handleOpenEvent = useCallback(
    (eventId: string) => {
      router.push(`/(app)/${orgSlug}/events/${eventId}`);
    },
    [router, orgSlug]
  );

  const handleDonate = useCallback(() => {
    router.push(`/(app)/${orgSlug}/donations/new`);
  }, [router, orgSlug]);

  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {},
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
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
    headerTitle: {
      ...TYPOGRAPHY.headlineSmall,
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      ...TYPOGRAPHY.caption,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    addButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
      paddingVertical: SPACING.xs + 2,
      paddingHorizontal: SPACING.sm + 4,
      borderRadius: RADIUS.md,
      backgroundColor: ACCENT,
      borderCurve: "continuous" as const,
    },
    addButtonPressed: {
      opacity: 0.9,
    },
    addButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: "#ffffff",
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: 96,
      gap: SPACING.md,
    },
    // Error
    errorCard: {
      backgroundColor: `${s.error}14`,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      borderWidth: 1,
      borderColor: `${s.error}55`,
      gap: SPACING.sm,
    },
    errorText: {
      ...TYPOGRAPHY.bodySmall,
      color: s.error,
    },
    retryButton: {
      alignSelf: "flex-start" as const,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs + 2,
      borderRadius: RADIUS.md,
      backgroundColor: s.error,
    },
    retryButtonPressed: {
      opacity: 0.85,
    },
    retryButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: "#ffffff",
    },
    // Loading
    loadingState: {
      alignItems: "center" as const,
      gap: SPACING.sm,
      paddingTop: SPACING.xxl,
    },
    loadingText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
    },
    // Stats row — horizontal scroll of compact stat pills
    statsRow: {
      flexDirection: "row" as const,
      gap: SPACING.sm,
    },
    statCard: {
      flex: 1,
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.sm + 2,
      gap: SPACING.xs,
      boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
    },
    statIcon: {
      width: 32,
      height: 32,
      borderRadius: RADIUS.sm,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    statValue: {
      ...TYPOGRAPHY.headlineMedium,
      color: n.foreground,
      fontVariant: ["tabular-nums" as const],
    },
    statLabel: {
      ...TYPOGRAPHY.caption,
      color: n.secondary,
    },
    // Donations section
    donationsSection: {
      gap: SPACING.sm,
    },
    sectionLabel: {
      ...TYPOGRAPHY.overline,
      color: n.muted,
    },
    donationRow: {
      flexDirection: "row" as const,
      gap: SPACING.sm,
    },
    donationCard: {
      flex: 1,
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      gap: SPACING.sm,
      boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
    },
    donationHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
    },
    donationIconCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: `${ACCENT}14`,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    donationLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: n.secondary,
    },
    donationValue: {
      ...TYPOGRAPHY.displayMedium,
      color: n.foreground,
      fontVariant: ["tabular-nums" as const],
    },
    donationSubtext: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
    },
    statusBadge: {
      alignSelf: "flex-start" as const,
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xxs + 1,
      borderRadius: RADIUS.full,
    },
    statusBadgeText: {
      ...TYPOGRAPHY.labelSmall,
    },
    actionCard: {
      flex: 1,
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      gap: SPACING.sm,
      justifyContent: "space-between" as const,
      boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
    },
    actionContent: {
      gap: SPACING.xs,
    },
    actionTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: n.foreground,
    },
    actionSubtitle: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
    },
    secondaryButton: {
      alignSelf: "flex-start" as const,
      paddingVertical: SPACING.xs + 2,
      paddingHorizontal: SPACING.md,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    secondaryButtonPressed: {
      opacity: 0.85,
    },
    secondaryButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
    },
    // Filter pills
    filterRow: {
      flexDirection: "row" as const,
      gap: SPACING.sm,
    },
    filterChip: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs + 2,
      borderRadius: RADIUS.full,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    filterChipPressed: {
      opacity: 0.85,
    },
    filterChipText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
    },
    // Event list
    list: {
      gap: SPACING.sm,
    },
    eventCard: {
      flexDirection: "row" as const,
      gap: SPACING.md,
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
    },
    eventCardPressed: {
      opacity: 0.9,
    },
    eventDate: {
      width: 56,
      height: 56,
      borderRadius: RADIUS.lg,
      backgroundColor: `${ACCENT}12`,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    eventMonth: {
      ...TYPOGRAPHY.overline,
      color: ACCENT,
      fontSize: 10,
      letterSpacing: 0.8,
    },
    eventDay: {
      ...TYPOGRAPHY.headlineSmall,
      color: ACCENT,
      fontVariant: ["tabular-nums" as const],
    },
    eventContent: {
      flex: 1,
      gap: SPACING.xxs,
    },
    eventHeader: {
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      justifyContent: "space-between" as const,
      gap: SPACING.sm,
    },
    eventTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      flex: 1,
    },
    eventBadge: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xxs + 1,
      borderRadius: RADIUS.full,
      backgroundColor: `${ACCENT}14`,
    },
    eventBadgeText: {
      ...TYPOGRAPHY.labelSmall,
      color: ACCENT,
    },
    eventDescription: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
    },
    eventMetaRow: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: SPACING.sm,
      marginTop: SPACING.xxs,
    },
    eventMetaItem: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xxs,
      flexShrink: 1,
    },
    eventMetaText: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      flexShrink: 1,
    },
    // Empty state
    emptyCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.lg,
      gap: SPACING.md,
      alignItems: "center" as const,
    },
    emptyIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: `${ACCENT}14`,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    emptyTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: n.foreground,
      textAlign: "center" as const,
    },
    emptySubtitle: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
      textAlign: "center" as const,
    },
    primaryButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
      backgroundColor: ACCENT,
      borderRadius: RADIUS.md,
      borderCurve: "continuous" as const,
      paddingVertical: SPACING.xs + 2,
      paddingHorizontal: SPACING.md,
    },
    primaryButtonPressed: {
      opacity: 0.9,
    },
    primaryButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: "#ffffff",
    },
  }));

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0]}</Text>
                </View>
              )}
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Philanthropy</Text>
              <Text style={styles.headerMeta}>
                {totalEvents} {totalEvents === 1 ? "event" : "events"}
              </Text>
            </View>
            {canEdit ? (
              <Pressable
                onPress={handleAddEvent}
                style={({ pressed }) => [
                  styles.addButton,
                  pressed && styles.addButtonPressed,
                ]}
              >
                <Plus size={16} color="#ffffff" />
                <Text style={styles.addButtonText}>Add</Text>
              </Pressable>
            ) : null}
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={neutral.secondary}
            />
          }
        >
          {error ? (
            <View style={styles.errorCard}>
              <Text selectable style={styles.errorText}>{error}</Text>
              <Pressable
                onPress={handleRefresh}
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed && styles.retryButtonPressed,
                ]}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {loading && allEvents.length === 0 ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={ACCENT} />
              <Text style={styles.loadingText}>Loading philanthropy...</Text>
            </View>
          ) : (
            <>
              {/* Stats row */}
              <Animated.View entering={FadeInDown.duration(300)} style={styles.statsRow}>
                <View style={styles.statCard}>
                  <View style={[styles.statIcon, { backgroundColor: `${SEMANTIC.success}18` }]}>
                    <Heart size={16} color={SEMANTIC.success} />
                  </View>
                  <Text style={styles.statValue}>{totalEvents}</Text>
                  <Text style={styles.statLabel}>Total Events</Text>
                </View>
                <View style={styles.statCard}>
                  <View style={[styles.statIcon, { backgroundColor: `${ACCENT}18` }]}>
                    <Calendar size={16} color={ACCENT} />
                  </View>
                  <Text style={styles.statValue}>{upcomingCount}</Text>
                  <Text style={styles.statLabel}>Upcoming</Text>
                </View>
                <View style={styles.statCard}>
                  <View style={[styles.statIcon, { backgroundColor: `${SEMANTIC.info}18` }]}>
                    <Sparkles size={16} color={SEMANTIC.info} />
                  </View>
                  <Text style={styles.statValue}>{pastCount}</Text>
                  <Text style={styles.statLabel}>Completed</Text>
                </View>
              </Animated.View>

              {/* Donations + Action */}
              <Animated.View entering={FadeInDown.delay(80).duration(300)} style={styles.donationsSection}>
                <Text style={styles.sectionLabel}>Donations</Text>
                <View style={styles.donationRow}>
                  <View style={styles.donationCard}>
                    <View style={styles.donationHeader}>
                      <View style={styles.donationIconCircle}>
                        <DollarSign size={18} color={ACCENT} />
                      </View>
                      <Text style={styles.donationLabel}>Stripe Donations</Text>
                    </View>
                    <Text style={styles.donationValue}>
                      ${totalRaised.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </Text>
                    <Text style={styles.donationSubtext}>
                      {donationCount} {donationCount === 1 ? "contribution" : "contributions"} recorded
                    </Text>
                    <View
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor: stripeConnected
                            ? `${SEMANTIC.success}18`
                            : `${SEMANTIC.warning}18`,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusBadgeText,
                          {
                            color: stripeConnected
                              ? SEMANTIC.success
                              : SEMANTIC.warning,
                          },
                        ]}
                      >
                        {stripeConnected ? "Connected" : "Connect Stripe"}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.actionCard}>
                    <View style={styles.actionContent}>
                      <Text style={styles.actionTitle}>Donate</Text>
                      <Text style={styles.actionSubtitle}>
                        Record a contribution or share a donation link.
                      </Text>
                    </View>
                    <Pressable
                      onPress={handleDonate}
                      style={({ pressed }) => [
                        styles.secondaryButton,
                        pressed && styles.secondaryButtonPressed,
                      ]}
                    >
                      <Text style={styles.secondaryButtonText}>Open Donations</Text>
                    </Pressable>
                  </View>
                </View>
              </Animated.View>

              {/* Filter tabs */}
              <Animated.View entering={FadeInDown.delay(140).duration(300)} style={styles.filterRow}>
                {(
                  [
                    { value: "upcoming", label: "Upcoming" },
                    { value: "past", label: "Past" },
                  ] as Array<{ value: PhilanthropyView; label: string }>
                ).map((option) => {
                  const isSelected = view === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => setView(option.value)}
                      style={({ pressed }) => [
                        styles.filterChip,
                        isSelected && {
                          backgroundColor: ACCENT,
                          borderColor: ACCENT,
                        },
                        pressed && styles.filterChipPressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          isSelected && { color: "#ffffff" },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </Animated.View>

              {/* Event list */}
              {visibleEvents.length > 0 ? (
                <View style={styles.list}>
                  {visibleEvents.map((event, index) => (
                    <Animated.View
                      key={event.id}
                      entering={FadeInDown.delay(180 + index * 50).duration(300)}
                    >
                      <Pressable
                        onPress={() => handleOpenEvent(event.id)}
                        style={({ pressed }) => [
                          styles.eventCard,
                          pressed && styles.eventCardPressed,
                        ]}
                      >
                        <View style={styles.eventDate}>
                          <Text style={styles.eventMonth}>
                            {formatMonthShort(event.start_date)}
                          </Text>
                          <Text style={styles.eventDay}>
                            {new Date(event.start_date).getDate()}
                          </Text>
                        </View>
                        <View style={styles.eventContent}>
                          <View style={styles.eventHeader}>
                            <Text style={styles.eventTitle}>{event.title}</Text>
                            <View style={styles.eventBadge}>
                              <Text style={styles.eventBadgeText}>Philanthropy</Text>
                            </View>
                          </View>
                          {event.description ? (
                            <Text style={styles.eventDescription} numberOfLines={2}>
                              {event.description}
                            </Text>
                          ) : null}
                          <View style={styles.eventMetaRow}>
                            <View style={styles.eventMetaItem}>
                              <Clock size={13} color={neutral.muted} />
                              <Text style={styles.eventMetaText}>
                                {formatTime(event.start_date)}
                              </Text>
                            </View>
                            {event.location ? (
                              <View style={styles.eventMetaItem}>
                                <MapPin size={13} color={neutral.muted} />
                                <Text style={styles.eventMetaText} numberOfLines={1}>
                                  {event.location}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                        </View>
                      </Pressable>
                    </Animated.View>
                  ))}
                </View>
              ) : (
                <Animated.View entering={FadeIn.duration(300)} style={styles.emptyCard}>
                  <View style={styles.emptyIcon}>
                    <Heart size={28} color={ACCENT} />
                  </View>
                  <Text style={styles.emptyTitle}>
                    {view === "past"
                      ? "No past events"
                      : "No upcoming events"}
                  </Text>
                  <Text style={styles.emptySubtitle}>
                    {view === "past"
                      ? "Completed philanthropy events will appear here."
                      : "Add a new philanthropy event to get started."}
                  </Text>
                  {canEdit ? (
                    <Pressable
                      onPress={handleAddEvent}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        pressed && styles.primaryButtonPressed,
                      ]}
                    >
                      <Text style={styles.primaryButtonText}>Add Event</Text>
                    </Pressable>
                  ) : null}
                </Animated.View>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function sortByStartAsc(a: Event, b: Event) {
  return new Date(a.start_date).getTime() - new Date(b.start_date).getTime();
}

function sortByStartDesc(a: Event, b: Event) {
  return new Date(b.start_date).getTime() - new Date(a.start_date).getTime();
}
