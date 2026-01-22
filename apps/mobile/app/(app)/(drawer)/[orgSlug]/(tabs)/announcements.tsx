import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useFocusEffect, useRouter, useNavigation } from "expo-router";
import { ExternalLink } from "lucide-react-native";
import * as Linking from "expo-linking";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useAuth } from "@/hooks/useAuth";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { supabase } from "@/lib/supabase";
import type { Announcement, Organization } from "@teammeet/types";
import { APP_CHROME } from "@/lib/chrome";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";

// Neutral color palette (matching Home/Events)
const ANNOUNCEMENTS_COLORS = {
  background: "#f8fafc",      // slate-50 (sheet)
  primaryText: "#0f172a",     // slate-900
  secondaryText: "#64748b",   // slate-500
  mutedText: "#94a3b8",       // slate-400
  border: "#e2e8f0",          // slate-200
  card: "#ffffff",            // white
  pinnedBadge: "#f1f5f9",     // slate-100
  pinnedText: "#475569",      // slate-600
  primaryCTA: "#059669",      // emerald-600 (for refresh tint)
  error: "#ef4444",
};

export default function AnnouncementsScreen() {
  const { orgSlug } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { permissions } = useOrgRole();
  const styles = useMemo(() => createStyles(), []);
  const { announcements, loading, error, refetch, refetchIfStale } = useAnnouncements(orgSlug || "");
  const [refreshing, setRefreshing] = useState(false);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const isRefetchingRef = useRef(false);
  const isMountedRef = useRef(true);

  // Fetch organization data for header
  const fetchOrg = useCallback(async () => {
    if (!orgSlug || !user) return;
    try {
      const { data } = await supabase
        .from("organizations")
        .select("*")
        .eq("slug", orgSlug)
        .single();
      if (isMountedRef.current && data) {
        setOrganization(data);
      }
    } catch {
      // Silently fail - header will show fallback
    }
  }, [orgSlug, user]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchOrg();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchOrg]);

  // Safe drawer toggle
  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available - no-op
    }
  }, [navigation]);

  // Admin overflow menu items - only approved mobile-friendly actions
  const adminMenuItems: OverflowMenuItem[] = useMemo(() => {
    if (!permissions.canUseAdminActions) return [];

    return [
      {
        id: "open-in-web",
        label: "Open in Web",
        icon: <ExternalLink size={20} color={ANNOUNCEMENTS_COLORS.primaryText} />,
        onPress: () => {
          const webUrl = `https://www.myteamnetwork.com/${orgSlug}/announcements`;
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
      await Promise.all([refetch(), fetchOrg()]);
    } finally {
      setRefreshing(false);
      isRefetchingRef.current = false;
    }
  }, [refetch, fetchOrg]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

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

  if (loading && announcements.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={ANNOUNCEMENTS_COLORS.primaryCTA} />
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

  return (
    <View style={styles.container}>
      {/* Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            {/* Org Logo (opens drawer) */}
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {organization?.logo_url ? (
                <Image source={{ uri: organization.logo_url }} style={styles.orgLogo} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{organization?.name?.[0] || "?"}</Text>
                </View>
              )}
            </Pressable>

            {/* Title */}
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Announcements</Text>
            </View>

            {/* Overflow Menu (admin only) */}
            {adminMenuItems.length > 0 && (
              <OverflowMenu items={adminMenuItems} accessibilityLabel="Announcement options" />
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        <FlatList
          data={announcements}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={renderAnnouncement}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={ANNOUNCEMENTS_COLORS.primaryCTA}
            />
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
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: APP_CHROME.gradientEnd,
    },
    // Gradient header styles
    headerGradient: {
      paddingBottom: spacing.xs,
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
    // Content sheet
    contentSheet: {
      flex: 1,
      backgroundColor: ANNOUNCEMENTS_COLORS.background,
      borderTopLeftRadius: borderRadius.xl,
      borderTopRightRadius: borderRadius.xl,
      marginTop: -8,
      overflow: "hidden",
    },
    listContent: {
      padding: spacing.md,
      paddingBottom: 40,
      flexGrow: 1,
    },
    // Cards
    card: {
      backgroundColor: ANNOUNCEMENTS_COLORS.card,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: ANNOUNCEMENTS_COLORS.border,
      padding: spacing.md,
      marginBottom: 12,
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
    },
    pinnedBadge: {
      backgroundColor: ANNOUNCEMENTS_COLORS.pinnedBadge,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 4,
      alignSelf: "flex-start",
      marginBottom: 8,
    },
    pinnedText: {
      fontSize: 10,
      fontWeight: fontWeight.semibold,
      color: ANNOUNCEMENTS_COLORS.pinnedText,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    cardTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: ANNOUNCEMENTS_COLORS.primaryText,
      marginBottom: spacing.xs,
    },
    cardDate: {
      fontSize: fontSize.xs,
      color: ANNOUNCEMENTS_COLORS.mutedText,
      marginBottom: spacing.sm,
    },
    cardBody: {
      fontSize: fontSize.sm,
      color: ANNOUNCEMENTS_COLORS.secondaryText,
      lineHeight: 20,
    },
    // Empty state
    emptyContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingVertical: 64,
    },
    emptyTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: ANNOUNCEMENTS_COLORS.primaryText,
      marginBottom: spacing.sm,
    },
    emptyText: {
      fontSize: fontSize.sm,
      color: ANNOUNCEMENTS_COLORS.mutedText,
    },
    // Loading/Error states
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 20,
      backgroundColor: ANNOUNCEMENTS_COLORS.background,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: ANNOUNCEMENTS_COLORS.error,
    },
  });
