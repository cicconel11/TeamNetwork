import { useState } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Image,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useAlumni } from "@/hooks/useAlumni";

export default function AlumniScreen() {
  const { orgSlug } = useLocalSearchParams<{ orgSlug: string }>();
  const { alumni, loading, error, refetch } = useAlumni(orgSlug || "");
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (loading && alumni.length === 0) {
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

  const getInitials = (alum: (typeof alumni)[0]) => {
    const firstName = alum.first_name;
    const lastName = alum.last_name;
    if (firstName && lastName) {
      return (firstName[0] + lastName[0]).toUpperCase();
    }
    if (firstName) {
      return firstName[0].toUpperCase();
    }
    return "?";
  };

  const getDisplayName = (alum: (typeof alumni)[0]) => {
    if (alum.first_name && alum.last_name) {
      return `${alum.first_name} ${alum.last_name}`;
    }
    if (alum.first_name) {
      return alum.first_name;
    }
    return alum.email || "Unknown";
  };

  const getSubtitle = (alum: (typeof alumni)[0]) => {
    const parts: string[] = [];
    if (alum.position_title || alum.job_title) {
      parts.push(alum.position_title || alum.job_title || "");
    }
    if (alum.current_company) {
      if (parts.length > 0) {
        parts[0] = `${parts[0]} at ${alum.current_company}`;
      } else {
        parts.push(alum.current_company);
      }
    }
    return parts.join(" • ");
  };

  return (
    <FlatList
      data={alumni}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
      renderItem={({ item }) => (
        <View style={styles.alumniCard}>
          {item.photo_url ? (
            <Image source={{ uri: item.photo_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>{getInitials(item)}</Text>
            </View>
          )}
          <View style={styles.alumniInfo}>
            <Text style={styles.alumniName}>{getDisplayName(item)}</Text>
            {getSubtitle(item) ? (
              <Text style={styles.alumniSubtitle} numberOfLines={1}>
                {getSubtitle(item)}
              </Text>
            ) : null}
            <View style={styles.badgeRow}>
              {item.graduation_year && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    Class of {item.graduation_year}
                  </Text>
                </View>
              )}
              {item.industry && (
                <View style={[styles.badge, styles.industryBadge]}>
                  <Text style={[styles.badgeText, styles.industryBadgeText]}>
                    {item.industry}
                  </Text>
                </View>
              )}
            </View>
            {item.current_city && (
              <Text style={styles.location}>{item.current_city}</Text>
            )}
          </View>
        </View>
      )}
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>No Alumni</Text>
          <Text style={styles.emptyText}>
            No alumni have been added to this organization yet.
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
    padding: 24,
  },
  listContent: {
    padding: 16,
    flexGrow: 1,
  },
  alumniCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "white",
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginRight: 12,
  },
  avatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#e0e7ff",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: "600",
    color: "#4f46e5",
  },
  alumniInfo: {
    flex: 1,
  },
  alumniName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  alumniSubtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
    gap: 6,
  },
  badge: {
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: "500",
  },
  industryBadge: {
    backgroundColor: "#dbeafe",
  },
  industryBadgeText: {
    color: "#2563eb",
  },
  location: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 6,
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
    textAlign: "center",
  },
  errorText: {
    fontSize: 16,
    color: "#dc2626",
    textAlign: "center",
  },
});
