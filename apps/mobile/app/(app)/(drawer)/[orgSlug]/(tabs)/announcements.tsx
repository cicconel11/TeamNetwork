import { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { useFocusEffect, useRouter, Stack } from "expo-router";
import { ExternalLink } from "lucide-react-native";
import * as Linking from "expo-linking";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import type { Announcement } from "@teammeet/types";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { spacing, borderRadius, fontSize, fontWeight, type ThemeColors } from "@/lib/theme";

export default function AnnouncementsScreen() {
  const { orgSlug } = useOrg();
  const router = useRouter();
  const { permissions } = useOrgRole();
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { announcements, loading, error, refetch, refetchIfStale } = useAnnouncements(orgSlug || "");
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
          // Open the announcements page in the web app for full admin capabilities
          const webUrl = `https://app.teammeet.com/${orgSlug}/announcements`;
          Linking.openURL(webUrl);
        },
      },
    ];
  }, [permissions.canUseAdminActions, orgSlug, colors.primary]);

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

  const renderAnnouncement = ({ item }: { item: Announcement }) => (
    <TouchableOpacity 
      style={styles.card}
      activeOpacity={0.7}
      onPress={() => router.push(`/(app)/${orgSlug}/announcements/${item.id}`)}
    >
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
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header with admin overflow menu */}
      <Stack.Screen
        options={{
          headerRight: () =>
            adminMenuItems.length > 0 ? (
              <OverflowMenu items={adminMenuItems} accessibilityLabel="Announcement options" />
            ) : null,
        }}
      />

      <FlatList
        data={announcements}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={renderAnnouncement}
        refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
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
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 20,
    },
    listContent: {
      padding: spacing.md,
      paddingBottom: 40,
      flexGrow: 1,
    },
    card: {
      backgroundColor: colors.card,
      padding: spacing.md,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      marginBottom: 12,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
    },
    pinnedBadge: {
      backgroundColor: colors.primaryLight,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 4,
      alignSelf: "flex-start",
      marginBottom: 8,
    },
    pinnedText: {
      fontSize: 10,
      fontWeight: fontWeight.semibold,
      color: colors.primaryDark,
      textTransform: "uppercase",
    },
    cardTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      marginBottom: spacing.xs,
    },
    cardDate: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      marginBottom: spacing.sm,
    },
    cardBody: {
      fontSize: fontSize.sm,
      color: colors.foreground,
      lineHeight: 20,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingVertical: 64,
    },
    emptyTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      marginBottom: spacing.sm,
    },
    emptyText: {
      fontSize: fontSize.sm,
      color: colors.muted,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: colors.error,
    },
  });
