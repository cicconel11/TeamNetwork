import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ScrollView,
  Pressable,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";

import { useFocusEffect, useRouter, useNavigation } from "expo-router";
import { Calendar, MapPin, Users, ExternalLink, Plus } from "lucide-react-native";
import * as Linking from "expo-linking";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useEvents, type Event } from "@/hooks/useEvents";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS, SHADOWS, RSVP_COLORS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { getRsvpLabel, formatEventDate, formatEventTime } from "@teammeet/core";

type ViewMode = "upcoming" | "past";

export default function EventsScreen() {
  const { orgSlug, orgName, orgLogoUrl } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { isAdmin, permissions } = useOrgRole();
  const styles = useMemo(() => createStyles(), []);
  const { events, loading, error, refetch, refetchIfStale } = useEvents(orgSlug || "");
  const [viewMode, setViewMode] = useState<ViewMode>("upcoming");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null); // null = show all
  const [refreshing, setRefreshing] = useState(false);
  const isRefetchingRef = useRef(false);

  // Safe drawer toggle - only dispatch if drawer is available
  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available (web preview / tests) - no-op
    }
  }, [navigation]);

  // Admin overflow menu items - only approved mobile-friendly actions
  const adminMenuItems: OverflowMenuItem[] = useMemo(() => {
    if (!permissions.canUseAdminActions) return [];

    return [
      {
        id: "create-event",
        label: "Create Event",
        icon: <Plus size={20} color={SEMANTIC.success} />,
        onPress: () => {
          router.push(`/(app)/${orgSlug}/events/new`);
        },
      },
      {
        id: "open-in-web",
        label: "Open in Web",
        icon: <ExternalLink size={20} color={NEUTRAL.foreground} />,
        onPress: () => {
          // Open the events page in the web app for full admin capabilities
          const webUrl = `https://www.myteamnetwork.com/${orgSlug}/events`;
          Linking.openURL(webUrl);
        },
      },
    ];
  }, [permissions.canUseAdminActions, orgSlug, router]);

  // Refetch on tab focus if data is stale
  useFocusEffect(
    useCallback(() => {
      refetchIfStale();
    }, [refetchIfStale])
  );

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

  // Memoize 'now' to prevent unnecessary re-renders
  const now = useMemo(() => new Date(), []);

  // Filter events by upcoming/past
  const filteredEvents = useMemo(() => {
    const currentTime = new Date();
    return events.filter((event) => {
      const eventDate = new Date(event.start_date);
      return viewMode === "upcoming" ? eventDate >= currentTime : eventDate < currentTime;
    });
  }, [events, viewMode]);

  // Get next 7 days for the date strip
  const weekDates = useMemo(() => {
    const dates: Date[] = [];
    const start = new Date();
    for (let i = 0; i < 7; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      dates.push(date);
    }
    return dates;
  }, []);

  // Check if a date has events
  const dateHasEvents = (date: Date) => {
    return events.some((event) => {
      const eventDate = new Date(event.start_date);
      return eventDate.toDateString() === date.toDateString();
    });
  };

  // Filter events for selected date (or show all if no date selected)
  const displayedEvents = useMemo(() => {
    if (selectedDate === null) {
      return filteredEvents; // Show all upcoming/past events
    }
    const selectedDateStr = selectedDate.toDateString();
    return filteredEvents.filter((event) => {
      const eventDate = new Date(event.start_date);
      return eventDate.toDateString() === selectedDateStr;
    });
  }, [filteredEvents, selectedDate]);


  const renderEventCard = ({ item }: { item: Event }) => (
    <TouchableOpacity 
      style={styles.eventCard} 
      activeOpacity={0.7}
      onPress={() => router.push(`/(app)/${orgSlug}/events/${item.id}`)}
    >
      <View style={styles.eventHeader}>
        <Text style={styles.eventTitle} numberOfLines={1}>
          {item.title}
        </Text>
        {item.user_rsvp_status && (
          <View
            style={[
              styles.rsvpBadge,
              item.user_rsvp_status === "going" && styles.rsvpGoing,
              item.user_rsvp_status === "maybe" && styles.rsvpMaybe,
            ]}
          >
            <Text style={styles.rsvpText}>
              {getRsvpLabel(item.user_rsvp_status)}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.eventDetails}>
        <View style={styles.detailRow}>
          <Calendar size={13} color={NEUTRAL.secondary} />
          <Text style={styles.detailText}>
            {formatEventDate(item.start_date)} at {formatEventTime(item.start_date)}
            {item.end_date && ` - ${formatEventTime(item.end_date)}`}
          </Text>
        </View>

        {item.location && (
          <View style={styles.detailRow}>
            <MapPin size={13} color={NEUTRAL.muted} />
            <Text style={styles.locationText} numberOfLines={1}>
              {item.location}
            </Text>
          </View>
        )}

        {item.rsvp_count !== undefined && (
          <View style={styles.detailRow}>
            <Users size={13} color={NEUTRAL.muted} />
            <Text style={styles.locationText}>{item.rsvp_count} attending</Text>
          </View>
        )}
      </View>

      {/* Only show RSVP button for upcoming events without an existing status */}
      {viewMode === "upcoming" && !item.user_rsvp_status && (
        <TouchableOpacity style={styles.rsvpButton}>
          <Text style={styles.rsvpButtonText}>RSVP</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  const renderEmptyState = () => {
    // Different empty states for date-filtered vs all events
    if (selectedDate !== null && viewMode === "upcoming") {
      // Inline empty state for specific date with no events
      const dateStr = selectedDate.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
      return (
        <View style={styles.emptyStateInline}>
          <Calendar size={32} color={NEUTRAL.muted} />
          <Text style={styles.emptyTitleSmall}>No events on {dateStr}</Text>
          <Text style={styles.emptySubtitleSmall}>Select "All" to see all upcoming events</Text>
        </View>
      );
    }

    // Full empty state for no events at all
    return (
      <View style={styles.emptyState}>
        <View style={styles.emptyCard}>
          <Calendar size={40} color={NEUTRAL.muted} />
          <Text style={styles.emptyTitle}>
            {viewMode === "upcoming" ? "No upcoming events" : "No past events"}
          </Text>
          <Text style={styles.emptySubtitle}>
            {viewMode === "upcoming"
              ? "Check back later for new events"
              : "Past events will appear here"}
          </Text>
        </View>
      </View>
    );
  };

  // Header subtitle text based on active tab
  const headerSubtitle = useMemo(() => {
    const currentTime = new Date();
    if (viewMode === "upcoming") {
      const count = events.filter((event) => new Date(event.start_date) >= currentTime).length;
      return `${count} upcoming`;
    } else {
      const count = events.filter((event) => new Date(event.start_date) < currentTime).length;
      return count > 0 ? `${count} past` : "Past events";
    }
  }, [events, viewMode]);

  if (error) {
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
                  <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "E"}</Text>
                  </View>
                )}
              </Pressable>

              {/* Text (left-aligned) */}
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Events</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.errorContainer}>
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>Error loading events: {error}</Text>
          </View>
        </View>
      </View>
    );
  }

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
                <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "E"}</Text>
                </View>
              )}
            </Pressable>

            {/* Text (left-aligned) */}
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Events</Text>
              <Text style={styles.headerMeta}>
                {headerSubtitle}
              </Text>
            </View>

            {/* Admin menu */}
            {adminMenuItems.length > 0 && (
              <OverflowMenu items={adminMenuItems} accessibilityLabel="Event options" />
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        {/* Toggle */}
        <View style={styles.toggleContainer}>
          <TouchableOpacity
            style={[styles.toggleButton, viewMode === "upcoming" && styles.toggleActive]}
            onPress={() => setViewMode("upcoming")}
          >
            <Text
              style={[styles.toggleText, viewMode === "upcoming" && styles.toggleTextActive]}
            >
              Upcoming
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleButton, viewMode === "past" && styles.toggleActive]}
            onPress={() => setViewMode("past")}
          >
            <Text style={[styles.toggleText, viewMode === "past" && styles.toggleTextActive]}>
              Past
            </Text>
          </TouchableOpacity>
        </View>

        {/* 7-Day Strip (only for upcoming view) */}
        {viewMode === "upcoming" && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.dateStrip}
            contentContainerStyle={styles.dateStripContent}
          >
            {/* All button */}
            <TouchableOpacity
              style={[styles.dateItem, selectedDate === null && styles.dateItemSelected]}
              onPress={() => setSelectedDate(null)}
            >
              <Text
                style={[
                  styles.dateDayName,
                  selectedDate === null && styles.dateTextSelected,
                ]}
              >
                All
              </Text>
              <Text
                style={[
                  styles.dateDay,
                  selectedDate === null && styles.dateTextSelected,
                ]}
              >
                {filteredEvents.length}
              </Text>
            </TouchableOpacity>

            {weekDates.map((date, index) => {
              const isSelected = selectedDate?.toDateString() === date.toDateString();
              const hasEvents = dateHasEvents(date);
              const isToday = date.toDateString() === now.toDateString();

              return (
                <TouchableOpacity
                  key={index}
                  style={[styles.dateItem, isSelected && styles.dateItemSelected]}
                  onPress={() => setSelectedDate(date)}
                >
                  <Text
                    style={[
                      styles.dateDayName,
                      isSelected && styles.dateTextSelected,
                      isToday && !isSelected && styles.dateToday,
                    ]}
                  >
                    {date.toLocaleDateString([], { weekday: "short" })}
                  </Text>
                  <Text
                    style={[
                      styles.dateDay,
                      isSelected && styles.dateTextSelected,
                      isToday && !isSelected && styles.dateToday,
                    ]}
                  >
                    {date.getDate()}
                  </Text>
                  {hasEvents && <View style={styles.eventDot} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* Events List */}
        <FlatList
          data={displayedEvents}
          renderItem={renderEventCard}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={SEMANTIC.success} />
          }
        />
      </View>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
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
    headerRight: {
      width: 36,
      alignItems: "flex-end",
    },
    headerSpacer: {
      width: 36,
    },
    // Content sheet
    contentSheet: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
    },
    // Toggle styles (segmented control)
    toggleContainer: {
      flexDirection: "row",
      marginHorizontal: SPACING.md,
      marginTop: SPACING.md,
      marginBottom: SPACING.sm,
      backgroundColor: NEUTRAL.surface,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      padding: 2,
    },
    toggleButton: {
      flex: 1,
      paddingVertical: SPACING.sm,
      alignItems: "center",
      borderRadius: RADIUS.sm,
    },
    toggleActive: {
      backgroundColor: NEUTRAL.background,
    },
    toggleText: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.muted,
    },
    toggleTextActive: {
      color: NEUTRAL.foreground,
      fontWeight: "600",
    },
    // Date strip styles
    dateStrip: {
      maxHeight: 76,
      marginBottom: SPACING.xs,
    },
    dateStripContent: {
      paddingHorizontal: SPACING.md,
      gap: SPACING.xs,
    },
    dateItem: {
      alignItems: "center",
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: RADIUS.md,
      minWidth: 48,
    },
    dateItemSelected: {
      backgroundColor: SEMANTIC.success,
    },
    dateDayName: {
      ...TYPOGRAPHY.overline,
      fontSize: 10,
      color: NEUTRAL.muted,
      marginBottom: 2,
    },
    dateDay: {
      ...TYPOGRAPHY.titleMedium,
      color: NEUTRAL.foreground,
    },
    dateTextSelected: {
      color: "#ffffff",
    },
    dateToday: {
      color: SEMANTIC.success,
      fontWeight: "700",
    },
    eventDot: {
      width: 5,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: SEMANTIC.success,
      marginTop: 4,
    },
    // List content
    listContent: {
      padding: SPACING.md,
      paddingTop: SPACING.sm,
      paddingBottom: 40,
      flexGrow: 1,
    },
    // Event card styles
    eventCard: {
      backgroundColor: NEUTRAL.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      padding: SPACING.md,
      marginBottom: SPACING.md,
      ...SHADOWS.sm,
    },
    eventHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: SPACING.sm,
    },
    eventTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: NEUTRAL.foreground,
      flex: 1,
    },
    rsvpBadge: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs,
      borderRadius: RADIUS.lg,
      backgroundColor: NEUTRAL.border,
      marginLeft: SPACING.sm,
    },
    rsvpGoing: {
      backgroundColor: RSVP_COLORS.going.background,
    },
    rsvpMaybe: {
      backgroundColor: RSVP_COLORS.maybe.background,
    },
    rsvpText: {
      ...TYPOGRAPHY.labelSmall,
      color: NEUTRAL.foreground,
    },
    eventDetails: {
      gap: 4,
    },
    detailRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    detailText: {
      ...TYPOGRAPHY.bodySmall,
      color: NEUTRAL.secondary,
      flex: 1,
    },
    locationText: {
      ...TYPOGRAPHY.bodySmall,
      color: NEUTRAL.muted,
      flex: 1,
    },
    // RSVP button
    rsvpButton: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: SEMANTIC.success,
      borderRadius: RADIUS.md,
      paddingVertical: 8,
      alignItems: "center",
      marginTop: SPACING.sm,
    },
    rsvpButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: SEMANTIC.success,
    },
    // Empty state styles
    emptyState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 48,
      paddingHorizontal: SPACING.md,
    },
    emptyStateInline: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 32,
      paddingHorizontal: SPACING.md,
    },
    emptyCard: {
      backgroundColor: NEUTRAL.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      padding: SPACING.lg,
      alignItems: "center",
      width: "100%",
      ...SHADOWS.sm,
    },
    emptyTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: NEUTRAL.foreground,
      marginTop: SPACING.md,
    },
    emptyTitleSmall: {
      ...TYPOGRAPHY.titleSmall,
      color: NEUTRAL.secondary,
      marginTop: SPACING.sm,
    },
    emptySubtitle: {
      ...TYPOGRAPHY.bodySmall,
      color: NEUTRAL.secondary,
      marginTop: SPACING.xs,
      textAlign: "center",
    },
    emptySubtitleSmall: {
      ...TYPOGRAPHY.caption,
      color: NEUTRAL.muted,
      marginTop: SPACING.xs,
      textAlign: "center",
    },
    // Error state styles
    errorContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: SPACING.md,
    },
    errorCard: {
      backgroundColor: SEMANTIC.errorLight,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: SEMANTIC.error,
      padding: SPACING.lg,
    },
    errorText: {
      ...TYPOGRAPHY.bodyMedium,
      color: SEMANTIC.error,
      textAlign: "center",
    },
    // Loading state
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
      backgroundColor: NEUTRAL.background,
    },
  });
