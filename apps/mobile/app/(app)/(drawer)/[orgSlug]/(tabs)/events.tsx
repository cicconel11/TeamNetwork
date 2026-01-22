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
import { Calendar, MapPin, Users, ExternalLink } from "lucide-react-native";
import * as Linking from "expo-linking";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useEvents, type Event } from "@/hooks/useEvents";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { spacing, borderRadius, fontSize, fontWeight, type ThemeColors } from "@/lib/theme";

// Hardcoded local colors matching Landing/Login palette (Uber-inspired)
const EVENTS_COLORS = {
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

type ViewMode = "upcoming" | "past";

export default function EventsScreen() {
  const { orgSlug, orgName, orgLogoUrl } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { isAdmin, permissions } = useOrgRole();
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
        id: "open-in-web",
        label: "Open in Web",
        icon: <ExternalLink size={20} color={EVENTS_COLORS.primaryCTA} />,
        onPress: () => {
          // Open the events page in the web app for full admin capabilities
          const webUrl = `https://app.teammeet.com/${orgSlug}/events`;
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

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  };

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
              {item.user_rsvp_status === "going"
                ? "Going"
                : item.user_rsvp_status === "maybe"
                ? "Maybe"
                : "Not Going"}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.eventDetails}>
        <View style={styles.detailRow}>
          <Calendar size={13} color={EVENTS_COLORS.secondaryText} />
          <Text style={styles.detailText}>
            {formatDate(item.start_date)} at {formatTime(item.start_date)}
            {item.end_date && ` - ${formatTime(item.end_date)}`}
          </Text>
        </View>

        {item.location && (
          <View style={styles.detailRow}>
            <MapPin size={13} color={EVENTS_COLORS.mutedText} />
            <Text style={styles.locationText} numberOfLines={1}>
              {item.location}
            </Text>
          </View>
        )}

        {item.rsvp_count !== undefined && (
          <View style={styles.detailRow}>
            <Users size={13} color={EVENTS_COLORS.mutedText} />
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
          <Calendar size={32} color={EVENTS_COLORS.mutedText} />
          <Text style={styles.emptyTitleSmall}>No events on {dateStr}</Text>
          <Text style={styles.emptySubtitleSmall}>Select "All" to see all upcoming events</Text>
        </View>
      );
    }

    // Full empty state for no events at all
    return (
      <View style={styles.emptyState}>
        <View style={styles.emptyCard}>
          <Calendar size={40} color={EVENTS_COLORS.mutedText} />
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
          colors={[EVENTS_COLORS.gradientStart, EVENTS_COLORS.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
                {orgLogoUrl ? (
                  <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "E"}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Events</Text>
              </View>
              <View style={styles.headerSpacer} />
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
        colors={[EVENTS_COLORS.gradientStart, EVENTS_COLORS.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            {/* Left: Drawer toggle */}
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "E"}</Text>
                </View>
              )}
            </Pressable>

            {/* Center: Title + subtitle */}
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Events</Text>
              <Text style={styles.headerMeta}>
                {headerSubtitle}
              </Text>
            </View>

            {/* Right: Admin menu or spacer */}
            <View style={styles.headerRight}>
              {adminMenuItems.length > 0 ? (
                <OverflowMenu items={adminMenuItems} accessibilityLabel="Event options" />
              ) : (
                <View style={styles.headerSpacer} />
              )}
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

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
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={EVENTS_COLORS.primaryCTA} />
        }
      />
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: EVENTS_COLORS.background,
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
    headerRight: {
      width: 40,
      alignItems: "flex-end",
    },
    headerSpacer: {
      width: 40,
    },
    // Toggle styles (segmented control - neutral style, green only on active text)
    toggleContainer: {
      flexDirection: "row",
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      backgroundColor: EVENTS_COLORS.card,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: EVENTS_COLORS.border,
      padding: 2,
    },
    toggleButton: {
      flex: 1,
      paddingVertical: spacing.sm,
      alignItems: "center",
      borderRadius: borderRadius.sm - 1,
    },
    toggleActive: {
      backgroundColor: EVENTS_COLORS.sectionBackground,
    },
    toggleText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: EVENTS_COLORS.mutedText,
    },
    toggleTextActive: {
      color: EVENTS_COLORS.primaryText,
      fontWeight: fontWeight.semibold,
    },
    // Date strip styles (calendar strip - minimal, green only on selected)
    dateStrip: {
      maxHeight: 72,
      marginBottom: spacing.xs,
    },
    dateStripContent: {
      paddingHorizontal: 16,
      gap: 4,
    },
    dateItem: {
      alignItems: "center",
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 8,
      minWidth: 44,
    },
    dateItemSelected: {
      backgroundColor: EVENTS_COLORS.primaryCTA,
    },
    dateDayName: {
      fontSize: 11,
      color: EVENTS_COLORS.mutedText,
      marginBottom: 2,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    dateDay: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: EVENTS_COLORS.primaryText,
    },
    dateTextSelected: {
      color: EVENTS_COLORS.primaryCTAText,
    },
    dateToday: {
      color: EVENTS_COLORS.primaryCTA,
      fontWeight: fontWeight.bold,
    },
    eventDot: {
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: EVENTS_COLORS.primaryCTA,
      marginTop: 3,
    },
    // List content
    listContent: {
      padding: 16,
      paddingTop: 12,
      paddingBottom: 40,
      flexGrow: 1,
    },
    // Event card styles (improved hierarchy)
    eventCard: {
      backgroundColor: EVENTS_COLORS.card,
      borderRadius: 12,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: EVENTS_COLORS.border,
      padding: 14,
      marginBottom: 16,
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
    },
    eventHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 10,
    },
    eventTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: EVENTS_COLORS.primaryText,
      flex: 1,
      lineHeight: 22,
    },
    rsvpBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: borderRadius.lg,
      backgroundColor: EVENTS_COLORS.border,
      marginLeft: spacing.sm,
    },
    rsvpGoing: {
      backgroundColor: "#d1fae5",
    },
    rsvpMaybe: {
      backgroundColor: "#fef3c7",
    },
    rsvpText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: EVENTS_COLORS.primaryText,
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
      fontSize: 13,
      color: EVENTS_COLORS.secondaryText,
      flex: 1,
      lineHeight: 18,
    },
    // Location uses lighter color for hierarchy
    locationText: {
      fontSize: 13,
      color: EVENTS_COLORS.mutedText,
      flex: 1,
      lineHeight: 18,
    },
    // RSVP button (outline style for reduced visual weight)
    rsvpButton: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: EVENTS_COLORS.primaryCTA,
      borderRadius: 8,
      paddingVertical: 7,
      alignItems: "center",
      marginTop: 10,
    },
    rsvpButtonText: {
      color: EVENTS_COLORS.primaryCTA,
      fontSize: 13,
      fontWeight: "500",
    },
    // Empty state styles
    emptyState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 48,
      paddingHorizontal: spacing.md,
    },
    emptyStateInline: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 32,
      paddingHorizontal: spacing.md,
    },
    emptyCard: {
      backgroundColor: EVENTS_COLORS.card,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: EVENTS_COLORS.border,
      padding: spacing.lg,
      alignItems: "center",
      width: "100%",
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
    },
    emptyTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: EVENTS_COLORS.primaryText,
      marginTop: spacing.md,
    },
    emptyTitleSmall: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: EVENTS_COLORS.secondaryText,
      marginTop: spacing.sm,
    },
    emptySubtitle: {
      fontSize: fontSize.sm,
      color: EVENTS_COLORS.secondaryText,
      marginTop: spacing.xs,
      textAlign: "center",
    },
    emptySubtitleSmall: {
      fontSize: fontSize.xs,
      color: EVENTS_COLORS.mutedText,
      marginTop: spacing.xs,
      textAlign: "center",
    },
    // Error state styles
    errorContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.md,
    },
    errorCard: {
      backgroundColor: EVENTS_COLORS.errorBackground,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: EVENTS_COLORS.error,
      padding: spacing.lg,
    },
    errorText: {
      color: EVENTS_COLORS.error,
      textAlign: "center",
      fontSize: fontSize.base,
    },
    // Loading state
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
      backgroundColor: EVENTS_COLORS.background,
    },
  });
