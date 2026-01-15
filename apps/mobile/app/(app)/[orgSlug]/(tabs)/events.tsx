import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { Calendar, MapPin, Users, Clock } from "lucide-react-native";
import { useEvents, type Event } from "@/hooks/useEvents";

type ViewMode = "upcoming" | "past";

export default function EventsScreen() {
  const { orgSlug } = useLocalSearchParams<{ orgSlug: string }>();
  const { events, loading, error, refetch } = useEvents(orgSlug || "");
  const [viewMode, setViewMode] = useState<ViewMode>("upcoming");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const now = new Date();

  // Filter events by upcoming/past
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      const eventDate = new Date(event.start_date);
      return viewMode === "upcoming" ? eventDate >= now : eventDate < now;
    });
  }, [events, viewMode, now]);

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

  // Filter events for selected date
  const eventsForSelectedDate = useMemo(() => {
    return filteredEvents.filter((event) => {
      const eventDate = new Date(event.start_date);
      return eventDate.toDateString() === selectedDate.toDateString();
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
    <TouchableOpacity style={styles.eventCard} activeOpacity={0.7}>
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
          <Clock size={14} color="#666" />
          <Text style={styles.detailText}>
            {formatTime(item.start_date)}
            {item.end_date && ` - ${formatTime(item.end_date)}`}
          </Text>
        </View>

        {item.location && (
          <View style={styles.detailRow}>
            <MapPin size={14} color="#666" />
            <Text style={styles.detailText} numberOfLines={1}>
              {item.location}
            </Text>
          </View>
        )}

        {item.rsvp_count !== undefined && (
          <View style={styles.detailRow}>
            <Users size={14} color="#666" />
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
      <Calendar size={48} color="#9ca3af" />
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
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Error loading events: {error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
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

      {/* 7-Day Strip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.dateStrip}
        contentContainerStyle={styles.dateStripContent}
      >
        {weekDates.map((date, index) => {
          const isSelected = date.toDateString() === selectedDate.toDateString();
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
                  isToday && styles.dateToday,
                ]}
              >
                {date.toLocaleDateString([], { weekday: "short" })}
              </Text>
              <Text
                style={[
                  styles.dateDay,
                  isSelected && styles.dateTextSelected,
                  isToday && styles.dateToday,
                ]}
              >
                {date.getDate()}
              </Text>
              {hasEvents && <View style={styles.eventDot} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Events List */}
      <FlatList
        data={viewMode === "upcoming" ? eventsForSelectedDate : filteredEvents}
        renderItem={renderEventCard}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmptyState}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refetch} tintColor="#2563eb" />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  toggleContainer: {
    flexDirection: "row",
    margin: 16,
    backgroundColor: "#e5e7eb",
    borderRadius: 8,
    padding: 4,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 6,
  },
  toggleActive: {
    backgroundColor: "#ffffff",
  },
  toggleText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#666",
  },
  toggleTextActive: {
    color: "#1a1a1a",
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
    backgroundColor: "#2563eb",
  },
  dateDayName: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  dateDay: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  dateTextSelected: {
    color: "#ffffff",
  },
  dateToday: {
    color: "#2563eb",
  },
  eventDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#2563eb",
    marginTop: 4,
  },
  listContent: {
    padding: 16,
    paddingTop: 8,
    flexGrow: 1,
  },
  eventCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  eventHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
    flex: 1,
  },
  rsvpBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "#e5e7eb",
    marginLeft: 8,
  },
  rsvpGoing: {
    backgroundColor: "#d1fae5",
  },
  rsvpMaybe: {
    backgroundColor: "#fef3c7",
  },
  rsvpText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#1a1a1a",
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
    fontSize: 14,
    color: "#666",
    flex: 1,
  },
  rsvpButton: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 12,
  },
  rsvpButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  errorText: {
    color: "#dc2626",
    textAlign: "center",
  },
});
