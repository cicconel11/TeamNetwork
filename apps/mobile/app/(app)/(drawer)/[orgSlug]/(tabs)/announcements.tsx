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
import { NEUTRAL, SEMANTIC, SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { AnnouncementCard, type AnnouncementCardAnnouncement } from "@/components/cards/AnnouncementCard";
import { SkeletonList } from "@/components/ui/Skeleton";

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

  // Sort announcements: pinned first, then by created_at descending
  const sortedAnnouncements = useMemo(() => {
    return [...announcements].sort((a, b) => {
      // Pinned announcements come first
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      // Within same pin status, sort by created_at descending (newest first)
      const dateA = new Date(a.created_at || 0).getTime();
      const dateB = new Date(b.created_at || 0).getTime();
      return dateB - dateA;
    });
  }, [announcements]);

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
        icon: <ExternalLink size={20} color={NEUTRAL.foreground} />,
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

  const renderAnnouncement = ({ item }: { item: Announcement }) => {
    const cardAnnouncement: AnnouncementCardAnnouncement = {
      id: item.id,
      title: item.title,
      body: item.body,
      created_at: item.created_at,
      is_pinned: item.is_pinned,
    };

    return (
      <AnnouncementCard
        announcement={cardAnnouncement}
        onPress={() => router.push(`/(app)/${orgSlug}/announcements/${item.id}`)}
        style={styles.card}
        maxBodyLines={4}
      />
    );
  };

  if (loading && announcements.length === 0) {
    return (
      <View style={styles.container}>
        {/* Gradient Header */}
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <View style={styles.orgLogoButton} />
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Announcements</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.listContent}>
            <SkeletonList type="announcement" count={4} />
          </View>
        </View>
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
              <Text style={styles.headerMeta}>
                {sortedAnnouncements.length} {sortedAnnouncements.length === 1 ? "announcement" : "announcements"}
              </Text>
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
          data={sortedAnnouncements}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={renderAnnouncement}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={SEMANTIC.success}
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
    // Content sheet
    contentSheet: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
    },
    listContent: {
      padding: SPACING.md,
      paddingBottom: 40,
      flexGrow: 1,
    },
    // Cards
    card: {
      marginBottom: SPACING.md,
    },
    // Empty state
    emptyContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingVertical: 64,
    },
    emptyTitle: {
      ...TYPOGRAPHY.headlineMedium,
      color: NEUTRAL.foreground,
      marginBottom: SPACING.sm,
    },
    emptyText: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.muted,
    },
    // Loading/Error states
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 20,
      backgroundColor: NEUTRAL.background,
    },
    errorText: {
      ...TYPOGRAPHY.bodyMedium,
      color: SEMANTIC.error,
    },
  });
