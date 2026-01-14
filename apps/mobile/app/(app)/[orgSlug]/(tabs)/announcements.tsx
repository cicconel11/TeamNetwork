import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import type { Announcement } from "@teammeet/types";

export default function AnnouncementsScreen() {
  const { orgSlug } = useLocalSearchParams<{ orgSlug: string }>();
  const { announcements, loading, error, refetch } = useAnnouncements(orgSlug);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  if (loading && announcements.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  const renderAnnouncement = ({ item }: { item: Announcement }) => (
    <View style={styles.card}>
      {item.is_pinned && (
        <View style={styles.pinnedBadge}>
          <Text style={styles.pinnedText}>Pinned</Text>
        </View>
      )}
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.date}>{formatDate(item.created_at ?? "")}</Text>
      <Text style={styles.body} numberOfLines={4}>
        {item.body}
      </Text>
    </View>
  );

  return (
    <FlatList
      data={announcements}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      renderItem={renderAnnouncement}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={refetch} />
      }
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>No Announcements</Text>
          <Text style={styles.emptySubtitle}>
            Check back later for news and updates.
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorText: {
    color: "#dc2626",
    fontSize: 14,
  },
  list: {
    padding: 16,
    flexGrow: 1,
  },
  card: {
    backgroundColor: "white",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  pinnedBadge: {
    backgroundColor: "#fef3c7",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: "flex-start",
    marginBottom: 8,
  },
  pinnedText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#d97706",
    textTransform: "uppercase",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 4,
  },
  date: {
    fontSize: 12,
    color: "#999",
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    color: "#333",
    lineHeight: 20,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#666",
  },
});
