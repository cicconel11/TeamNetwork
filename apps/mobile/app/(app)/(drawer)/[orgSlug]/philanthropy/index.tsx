import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useRouter, useNavigation } from "expo-router";
import { Calendar, Clock, Heart, MapPin, Plus, Sparkles } from "lucide-react-native";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { supabase } from "@/lib/supabase";
import { APP_CHROME } from "@/lib/chrome";
import { borderRadius, fontSize, fontWeight, spacing } from "@/lib/theme";
import type { Event, OrganizationDonationStat } from "@teammeet/types";

// Fixed color palette
const PHILANTHROPY_COLORS = {
  background: "#f8fafc",
  primaryText: "#0f172a",
  secondaryText: "#64748b",
  mutedText: "#94a3b8",
  border: "#e2e8f0",
  card: "#ffffff",
  primary: "#059669",
  primaryForeground: "#ffffff",
  error: "#ef4444",
  success: "#22c55e",
  warning: "#f59e0b",
  secondary: "#8b5cf6",
};

type PhilanthropyView = "upcoming" | "past";

export default function PhilanthropyScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
  const { isAdmin, isActiveMember } = useOrgRole();
  const styles = useMemo(() => createStyles(), []);
  const isMountedRef = useRef(true);

  // Safe drawer toggle - only dispatch if drawer is available
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
        const [{ data: eventsData, error: eventsError }, { data: donationData, error: donationError }, { data: orgData, error: orgError }] =
          await Promise.all([
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
    const eventsChannel = supabase
      .channel(`philanthropy-events:${orgId}`)
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

    const donationChannel = supabase
      .channel(`donation-stats:${orgId}`)
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

    const orgChannel = supabase
      .channel(`org-connect:${orgId}`)
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

  return (
    <View style={styles.container}>
      {/* Custom Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
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
                <Plus size={16} color={PHILANTHROPY_COLORS.primaryForeground} />
                <Text style={styles.addButtonText}>Add</Text>
              </Pressable>
            ) : null}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={PHILANTHROPY_COLORS.primary}
            />
          }
        >
          {error ? (
            <View style={styles.errorCard}>
              <Text selectable style={styles.errorText}>
                {error}
              </Text>
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
              <ActivityIndicator color={PHILANTHROPY_COLORS.primary} />
              <Text style={styles.loadingText}>Loading philanthropy events...</Text>
            </View>
          ) : (
            <>
              <View style={styles.summaryGrid}>
                <View style={styles.summaryCard}>
                  <View style={[styles.summaryIcon, { backgroundColor: `${PHILANTHROPY_COLORS.success}22` }]}>
                    <Heart size={18} color={PHILANTHROPY_COLORS.success} />
                  </View>
                  <Text style={styles.summaryValue}>{totalEvents}</Text>
                  <Text style={styles.summaryLabel}>Total Events</Text>
                </View>
                <View style={styles.summaryCard}>
                  <View style={[styles.summaryIcon, { backgroundColor: `${PHILANTHROPY_COLORS.primary}22` }]}>
                    <Calendar size={18} color={PHILANTHROPY_COLORS.primary} />
                  </View>
                  <Text style={styles.summaryValue}>{upcomingCount}</Text>
                  <Text style={styles.summaryLabel}>Upcoming</Text>
                </View>
                <View style={styles.summaryCard}>
                  <View style={[styles.summaryIcon, { backgroundColor: `${PHILANTHROPY_COLORS.secondary}22` }]}>
                    <Sparkles size={18} color={PHILANTHROPY_COLORS.secondary} />
                  </View>
                  <Text style={styles.summaryValue}>{pastCount}</Text>
                  <Text style={styles.summaryLabel}>Completed</Text>
                </View>
              </View>

              <View style={styles.donationRow}>
                <View style={styles.donationCard}>
                  <Text style={styles.donationLabel}>Stripe Donations</Text>
                  <Text style={styles.donationValue}>
                    ${totalRaised.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Text>
                  <Text style={styles.donationSubtext}>
                    {donationCount} contributions recorded
                  </Text>
                  <View
                    style={[
                      styles.statusBadge,
                      stripeConnected ? styles.statusConnected : styles.statusPending,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        stripeConnected ? styles.statusConnectedText : styles.statusPendingText,
                      ]}
                    >
                      {stripeConnected ? "Connected" : "Connect Stripe to accept donations"}
                    </Text>
                  </View>
                </View>
                <View style={styles.actionCard}>
                  <Text style={styles.actionTitle}>Donate</Text>
                  <Text style={styles.actionSubtitle}>
                    Record a contribution or share a donation link.
                  </Text>
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

              <View style={styles.filterRow}>
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
                        isSelected && { backgroundColor: PHILANTHROPY_COLORS.primary, borderColor: PHILANTHROPY_COLORS.primary },
                        pressed && styles.filterChipPressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          isSelected && { color: PHILANTHROPY_COLORS.primaryForeground },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {visibleEvents.length > 0 ? (
                <View style={styles.list}>
                  {visibleEvents.map((event) => (
                    <Pressable
                      key={event.id}
                      onPress={() => handleOpenEvent(event.id)}
                      style={({ pressed }) => [
                        styles.eventCard,
                        pressed && styles.eventCardPressed,
                      ]}
                    >
                      <View style={styles.eventDate}>
                        <Text style={styles.eventMonth}>
                          {formatMonth(event.start_date)}
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
                            <Clock size={14} color={PHILANTHROPY_COLORS.mutedText} />
                            <Text style={styles.eventMetaText}>
                              {formatTime(event.start_date)}
                            </Text>
                          </View>
                          {event.location ? (
                            <View style={styles.eventMetaItem}>
                              <MapPin size={14} color={PHILANTHROPY_COLORS.mutedText} />
                              <Text style={styles.eventMetaText} numberOfLines={1}>
                                {event.location}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>
                    {view === "past" ? "No past philanthropy events" : "No upcoming philanthropy events"}
                  </Text>
                  <Text style={styles.emptySubtitle}>
                    {view === "past"
                      ? "Completed events will appear here."
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
                </View>
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

function formatMonth(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", { month: "short" });
}

function formatTime(dateString: string) {
  return new Date(dateString).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: PHILANTHROPY_COLORS.background,
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
    addButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingVertical: spacing.xs + 2,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.md,
      backgroundColor: PHILANTHROPY_COLORS.primary,
    },
    addButtonPressed: {
      opacity: 0.9,
    },
    addButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: PHILANTHROPY_COLORS.primaryForeground,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: PHILANTHROPY_COLORS.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      marginTop: -16,
      overflow: "hidden",
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: spacing.xl,
      gap: spacing.lg,
    },
    errorCard: {
      backgroundColor: `${PHILANTHROPY_COLORS.error}14`,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: `${PHILANTHROPY_COLORS.error}55`,
      gap: spacing.sm,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: PHILANTHROPY_COLORS.error,
    },
    retryButton: {
      alignSelf: "flex-start",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: borderRadius.md,
      backgroundColor: PHILANTHROPY_COLORS.error,
    },
    retryButtonPressed: {
      opacity: 0.85,
    },
    retryButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: "#ffffff",
    },
    loadingState: {
      alignItems: "center",
      gap: spacing.sm,
    },
    loadingText: {
      fontSize: fontSize.sm,
      color: PHILANTHROPY_COLORS.secondaryText,
    },
    summaryGrid: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    summaryCard: {
      flex: 1,
      backgroundColor: PHILANTHROPY_COLORS.card,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: PHILANTHROPY_COLORS.border,
      padding: spacing.md,
      gap: spacing.xs,
      alignItems: "flex-start",
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
    },
    summaryIcon: {
      width: 36,
      height: 36,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    summaryValue: {
      fontSize: fontSize.xl,
      fontWeight: fontWeight.bold,
      color: PHILANTHROPY_COLORS.primaryText,
      fontVariant: ["tabular-nums"],
    },
    summaryLabel: {
      fontSize: fontSize.xs,
      color: PHILANTHROPY_COLORS.secondaryText,
    },
    donationRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.md,
    },
    donationCard: {
      flex: 1,
      minWidth: 220,
      backgroundColor: PHILANTHROPY_COLORS.card,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: PHILANTHROPY_COLORS.border,
      padding: spacing.md,
      gap: spacing.xs,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
    },
    donationLabel: {
      fontSize: fontSize.sm,
      color: PHILANTHROPY_COLORS.secondaryText,
    },
    donationValue: {
      fontSize: fontSize.xl,
      fontWeight: fontWeight.bold,
      color: PHILANTHROPY_COLORS.primaryText,
      fontVariant: ["tabular-nums"],
    },
    donationSubtext: {
      fontSize: fontSize.sm,
      color: PHILANTHROPY_COLORS.secondaryText,
    },
    statusBadge: {
      alignSelf: "flex-start",
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: 999,
      marginTop: spacing.xs,
    },
    statusBadgeText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
    },
    statusConnected: {
      backgroundColor: `${PHILANTHROPY_COLORS.success}22`,
    },
    statusConnectedText: {
      color: PHILANTHROPY_COLORS.success,
    },
    statusPending: {
      backgroundColor: `${PHILANTHROPY_COLORS.warning}22`,
    },
    statusPendingText: {
      color: PHILANTHROPY_COLORS.warning,
    },
    actionCard: {
      flex: 1,
      minWidth: 200,
      backgroundColor: PHILANTHROPY_COLORS.card,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: PHILANTHROPY_COLORS.border,
      padding: spacing.md,
      gap: spacing.xs,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
    },
    actionTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: PHILANTHROPY_COLORS.primaryText,
    },
    actionSubtitle: {
      fontSize: fontSize.sm,
      color: PHILANTHROPY_COLORS.secondaryText,
    },
    filterRow: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    filterChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: PHILANTHROPY_COLORS.border,
      backgroundColor: PHILANTHROPY_COLORS.card,
    },
    filterChipPressed: {
      opacity: 0.85,
    },
    filterChipText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: PHILANTHROPY_COLORS.primaryText,
    },
    list: {
      gap: spacing.md,
    },
    eventCard: {
      flexDirection: "row",
      gap: spacing.md,
      backgroundColor: PHILANTHROPY_COLORS.card,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: PHILANTHROPY_COLORS.border,
      padding: spacing.md,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
    },
    eventCardPressed: {
      opacity: 0.9,
    },
    eventDate: {
      width: 64,
      height: 64,
      borderRadius: borderRadius.lg,
      backgroundColor: `${PHILANTHROPY_COLORS.success}18`,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
    },
    eventMonth: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: PHILANTHROPY_COLORS.success,
      textTransform: "uppercase",
    },
    eventDay: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      color: PHILANTHROPY_COLORS.success,
      fontVariant: ["tabular-nums"],
    },
    eventContent: {
      flex: 1,
      gap: spacing.xs,
    },
    eventHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    eventTitle: {
      flex: 1,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: PHILANTHROPY_COLORS.primaryText,
    },
    eventBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: 999,
      backgroundColor: `${PHILANTHROPY_COLORS.success}22`,
    },
    eventBadgeText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
      color: PHILANTHROPY_COLORS.success,
    },
    eventDescription: {
      fontSize: fontSize.sm,
      color: PHILANTHROPY_COLORS.secondaryText,
    },
    eventMetaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    eventMetaItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      flexShrink: 1,
    },
    eventMetaText: {
      fontSize: fontSize.xs,
      color: PHILANTHROPY_COLORS.secondaryText,
      flexShrink: 1,
    },
    emptyCard: {
      backgroundColor: PHILANTHROPY_COLORS.card,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: PHILANTHROPY_COLORS.border,
      padding: spacing.lg,
      gap: spacing.sm,
      alignItems: "center",
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
    },
    emptyTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: PHILANTHROPY_COLORS.primaryText,
      textAlign: "center",
    },
    emptySubtitle: {
      fontSize: fontSize.sm,
      color: PHILANTHROPY_COLORS.secondaryText,
      textAlign: "center",
    },
    primaryButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      backgroundColor: PHILANTHROPY_COLORS.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.xs + 2,
      paddingHorizontal: spacing.md,
      borderCurve: "continuous",
    },
    primaryButtonPressed: {
      opacity: 0.9,
    },
    primaryButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: PHILANTHROPY_COLORS.primaryForeground,
    },
    secondaryButton: {
      paddingVertical: spacing.xs + 2,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: PHILANTHROPY_COLORS.border,
      backgroundColor: PHILANTHROPY_COLORS.card,
      alignSelf: "flex-start",
    },
    secondaryButtonPressed: {
      opacity: 0.85,
    },
    secondaryButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: PHILANTHROPY_COLORS.primaryText,
    },
  });
