import { useMemo, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Image,
  StyleSheet,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useAlumni } from "@/hooks/useAlumni";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import type { ThemeColors } from "@/lib/theme";

export default function AlumniScreen() {
  const { orgSlug } = useOrg();
  const { alumni, loading, error, refetch, refetchIfStale } = useAlumni(orgSlug || "");
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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

  if (loading && alumni.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
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
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
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

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
    },
    listContent: {
      padding: 16,
      paddingBottom: 40,
      flexGrow: 1,
    },
    alumniCard: {
      flexDirection: "row",
      alignItems: "flex-start",
      backgroundColor: colors.card,
      padding: 12,
      borderRadius: 12,
      borderCurve: "continuous",
      marginBottom: 12,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
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
      backgroundColor: colors.primaryLight,
      justifyContent: "center",
      alignItems: "center",
      marginRight: 12,
    },
    avatarText: {
      fontSize: 20,
      fontWeight: "600",
      color: colors.primaryDark,
    },
    alumniInfo: {
      flex: 1,
    },
    alumniName: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.foreground,
    },
    alumniSubtitle: {
      fontSize: 14,
      color: colors.muted,
      marginTop: 2,
    },
    badgeRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginTop: 8,
      gap: 6,
    },
    badge: {
      backgroundColor: colors.border,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 4,
    },
    badgeText: {
      fontSize: 12,
      color: colors.muted,
      fontWeight: "500",
    },
    industryBadge: {
      backgroundColor: colors.primaryLight,
    },
    industryBadgeText: {
      color: colors.primaryDark,
    },
    location: {
      fontSize: 12,
      color: colors.mutedForeground,
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
      color: colors.foreground,
      marginBottom: 8,
    },
    emptyText: {
      fontSize: 14,
      color: colors.muted,
      textAlign: "center",
    },
    errorText: {
      fontSize: 16,
      color: colors.error,
      textAlign: "center",
    },
  });
