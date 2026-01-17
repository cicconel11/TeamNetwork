import { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useOrg } from "@/contexts/OrgContext";
import type { Announcement } from "@teammeet/types";

export default function AnnouncementsScreen() {
  const { orgSlug } = useOrg();
  const { announcements, loading, error, refetch, refetchIfStale } = useAnnouncements(orgSlug || "");
  const [refreshing, setRefreshing] = useState(false);
  const isRefetchingRef = useRef(false);

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
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  const renderAnnouncement = ({ item }: { item: Announcement }) => (
    <View style={styles.card}>
      {item.is_pinned && (
        <View style={styles.pinnedBadge}>
          <Text style={styles.pinnedText}>PINNED</Text>
        </View>
      )}
      <Text style={styles.cardTitle}>{item.title}</Text>
      <Text style={styles.cardDate}>{formatDate(item.created_at ?? "")}</Text>
      <Text style={styles.cardBody} numberOfLines={4}>
        {item.body}
      </Text>
    </View>
  );

  return (
    <FlatList
      data={announcements}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContent}
      renderItem={renderAnnouncement}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#2563eb" />
      }
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>No Announcements</Text>
          <Text style={styles.emptyText}>
            Check back later for news and updates.
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
    flexGrow: 1,
  },
  card: {
    backgroundColor: "white",
    padding: 16,
    borderRadius: 12,
    borderCurve: "continuous",
    marginBottom: 12,
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
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
    fontSize: 10,
    fontWeight: "600",
    color: "#d97706",
    textTransform: "uppercase",
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 4,
  },
  cardDate: {
    fontSize: 12,
    color: "#9ca3af",
    marginBottom: 8,
  },
  cardBody: {
    fontSize: 14,
    color: "#374151",
    lineHeight: 20,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 64,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: "#666",
  },
  errorText: {
    fontSize: 14,
    color: "#dc2626",
  },
});
