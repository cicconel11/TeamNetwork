import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ScrollView,
  Alert,
} from "react-native";

import { useFocusEffect, useRouter, Stack } from "expo-router";
import { Calendar, MapPin, Users, Clock, ExternalLink } from "lucide-react-native";
import * as Linking from "expo-linking";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useEvents, type Event } from "@/hooks/useEvents";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { colors, spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";

type ViewMode = "upcoming" | "past";

export default function EventsScreen() {
  const { orgSlug } = useOrg();
  const router = useRouter();
  const { isAdmin, permissions } = useOrgRole();
  const { events, loading, error, refetch, refetchIfStale } = useEvents(orgSlug || "");
  const [viewMode, setViewMode] = useState<ViewMode>("upcoming");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null); // null = show all
  const [refreshing, setRefreshing] = useState(false);
  const isRefetchingRef = useRef(false);

  // Admin overflow menu items - only approved mobile-friendly actions
  const adminMenuItems: OverflowMenuItem[] = useMemo(() => {
    if (!permissions.canUseAdminActions) return [];
    
    return [
      {
        id: "open-in-web",
        label: "Open in Web",
        icon: <ExternalLink size={20} color={colors.primary} />,
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
          <Calendar size={14} color={colors.muted} />
          <Text style={styles.detailText}>
            {formatDate(item.start_date)} at {formatTime(item.start_date)}
            {item.end_date && ` - ${formatTime(item.end_date)}`}
          </Text>
        </View>

        {item.location && (
          <View style={styles.detailRow}>
            <MapPin size={14} color={colors.muted} />
            <Text style={styles.detailText} numberOfLines={1}>
              {item.location}
            </Text>
          </View>
        )}

        {item.rsvp_count !== undefined && (
          <View style={styles.detailRow}>
            <Users size={14} color={colors.muted} />
            <Text style={styles.detailText}>{item.rsvp_count} attending</Text>
          </View>
        )}
      </View>

      {!item.user_rsvp_status && (
        <TouchableOpacity style={styles.rsvpButton}>
          <Text style={styles.rsvpButtonText}>RSVP</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Calendar size={48} color={colors.mutedForeground} />
      <Text style={styles.emptyTitle}>
        {viewMode === "upcoming" ? "No upcoming events" : "No past events"}
      </Text>
      <Text style={styles.emptySubtitle}>
        {viewMode === "upcoming"
          ? "Check back later for new events"
          : "Past events will appear here"}
      </Text>
    </View>
  );

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Error loading events: {error}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header with admin overflow menu */}
      <Stack.Screen
        options={{
          headerRight: () =>
            adminMenuItems.length > 0 ? (
              <OverflowMenu items={adminMenuItems} accessibilityLabel="Event options" />
            ) : null,
        }}
      />

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
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  toggleContainer: {
    flexDirection: "row",
    margin: spacing.md,
    backgroundColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.xs,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderRadius: borderRadius.sm,
  },
  toggleActive: {
    backgroundColor: colors.card,
  },
  toggleText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.muted,
  },
  toggleTextActive: {
    color: colors.foreground,
  },
  dateStrip: {
    maxHeight: 80,
  },
  dateStripContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  dateItem: {
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    minWidth: 48,
  },
  dateItemSelected: {
    backgroundColor: colors.primary,
  },
  dateDayName: {
    fontSize: fontSize.xs,
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  dateDay: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  dateTextSelected: {
    color: "#ffffff",
  },
  dateToday: {
    color: colors.primary,
  },
  eventDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginTop: spacing.xs,
  },
  listContent: {
    padding: 16,
    paddingTop: 8,
    paddingBottom: 40,
    flexGrow: 1,
  },
  eventCard: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderCurve: "continuous",
    padding: spacing.md,
    marginBottom: 12,
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
  },
  eventHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  eventTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
    flex: 1,
  },
  rsvpBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.border,
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
    color: colors.foreground,
  },
  eventDetails: {
    gap: 6,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  detailText: {
    fontSize: fontSize.sm,
    color: colors.muted,
    flex: 1,
  },
  rsvpButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 12,
  },
  rsvpButtonText: {
    color: "#ffffff",
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
    marginTop: spacing.md,
  },
  emptySubtitle: {
    fontSize: fontSize.sm,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
  },
  errorText: {
    color: colors.error,
    textAlign: "center",
  },
});
