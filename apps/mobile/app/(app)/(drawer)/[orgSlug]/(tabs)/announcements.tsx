import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  RefreshControl,
  Pressable,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useFocusEffect, useRouter, useNavigation } from "expo-router";
import { ExternalLink } from "lucide-react-native";
import * as Linking from "expo-linking";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useUnreadAnnouncementCount } from "@/hooks/useUnreadAnnouncementCount";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useAuth } from "@/hooks/useAuth";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { useNetwork } from "@/contexts/NetworkContext";
import { useAutoRefetchOnReconnect } from "@/hooks/useAutoRefetchOnReconnect";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import type { Announcement } from "@teammeet/types";
import { getWebPath } from "@/lib/web-api";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { AnnouncementCard, type AnnouncementCardAnnouncement } from "@/components/cards/AnnouncementCard";
import { SkeletonList } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui";

function getAnnouncementSectionLabel(date: Date, now: Date): string {
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round(
    (startToday.getTime() - startDate.getTime()) / 86400000
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays >= 2 && diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: "long" });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

export default function AnnouncementsScreen() {
  const { orgSlug, orgId, orgName, orgLogoUrl } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { permissions } = useOrgRole();
  const { neutral, semantic } = useAppColorScheme();
  const { isOffline } = useNetwork();
  // Use orgId from context for data hook (eliminates redundant org fetch)
  const { announcements, loading, error, refetch, refetchIfStale } = useAnnouncements(orgId);
  const { markAsRead } = useUnreadAnnouncementCount(orgId);
  const [refreshing, setRefreshing] = useState(false);
  const isRefetchingRef = useRef(false);

  const styles = useThemedStyles((n, s) => ({
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
      flexDirection: "row" as const,
      alignItems: "center" as const,
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
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    orgAvatarText: {
      ...TYPOGRAPHY.titleSmall,
      fontWeight: "700" as const,
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
      backgroundColor: n.surface,
    },
    listContent: {
      paddingTop: SPACING.sm,
      paddingBottom: 40,
      flexGrow: 1,
    },
    sectionHeader: {
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.md,
      paddingBottom: SPACING.xs,
      backgroundColor: n.surface,
    },
    sectionHeaderText: {
      ...TYPOGRAPHY.labelSmall,
      fontWeight: "600" as const,
      color: n.muted,
      letterSpacing: 0.5,
      textTransform: "uppercase" as const,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      marginLeft: SPACING.md + 44 + SPACING.md,
      backgroundColor: n.divider,
    },
    feedItem: {
      paddingHorizontal: SPACING.md,
    },
    // Empty state
    emptyContainer: {
      flex: 1,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      paddingVertical: 64,
    },
    emptyTitle: {
      ...TYPOGRAPHY.headlineMedium,
      color: n.foreground,
      marginBottom: SPACING.sm,
    },
    emptyText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.muted,
    },
  }));

  // Newest first (pinned get their own section via announcementSections)
  const sortedAnnouncements = useMemo(() => {
    return [...announcements].sort((a, b) => {
      const dateA = new Date(a.created_at || 0).getTime();
      const dateB = new Date(b.created_at || 0).getTime();
      return dateB - dateA;
    });
  }, [announcements]);

  const announcementSections = useMemo(() => {
    const now = new Date();
    const byLabel = new Map<string, Announcement[]>();
    const labelOrder: string[] = [];

    const pinned = sortedAnnouncements
      .filter((a) => a.is_pinned)
      .sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime()
      );

    const rest = sortedAnnouncements.filter((a) => !a.is_pinned);

    for (const a of rest) {
      const d = new Date(a.created_at || 0);
      const label = getAnnouncementSectionLabel(d, now);
      if (!byLabel.has(label)) {
        byLabel.set(label, []);
        labelOrder.push(label);
      }
      byLabel.get(label)!.push(a);
    }

    for (const arr of byLabel.values()) {
      arr.sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime()
      );
    }

    const sections: { title: string; data: Announcement[] }[] = [];
    if (pinned.length > 0) {
      sections.push({ title: "Pinned", data: pinned });
    }
    for (const title of labelOrder) {
      const data = byLabel.get(title);
      if (data?.length) {
        sections.push({ title, data });
      }
    }
    return sections;
  }, [sortedAnnouncements]);

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
        icon: <ExternalLink size={20} color={neutral.foreground} />,
        onPress: () => {
          const webUrl = getWebPath(orgSlug, "announcements");
          Linking.openURL(webUrl);
        },
      },
    ];
  }, [permissions.canUseAdminActions, orgSlug, neutral.foreground]);

  // Refetch on tab focus if data is stale, and mark as read
  useFocusEffect(
    useCallback(() => {
      refetchIfStale();
      // Mark announcements as read when tab is focused
      markAsRead();
    }, [refetchIfStale, markAsRead])
  );

  useAutoRefetchOnReconnect(refetch);

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

  const renderAnnouncement = useCallback(
    ({ item }: { item: Announcement }) => {
      const cardAnnouncement: AnnouncementCardAnnouncement = {
        id: item.id,
        title: item.title,
        body: item.body,
        created_at: item.created_at,
        is_pinned: item.is_pinned,
      };

      return (
        <AnnouncementCard
          variant="feed"
          announcement={cardAnnouncement}
          onPress={() =>
            router.push(`/(app)/${orgSlug}/announcements/${item.id}`)
          }
          style={styles.feedItem}
        />
      );
    },
    [orgSlug, router, styles]
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string } }) => (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>{section.title}</Text>
      </View>
    ),
    [styles]
  );

  const itemSeparator = useCallback(
    () => <View style={styles.separator} />,
    [styles]
  );

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

  if (error && announcements.length === 0) {
    return (
      <View style={styles.container}>
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
          <ErrorState
            onRetry={handleRefresh}
            title="Unable to load announcements"
            isOffline={isOffline}
          />
        </View>
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
            <Pressable
              onPress={handleDrawerToggle}
              style={styles.orgLogoButton}
              accessibilityRole="button"
              accessibilityLabel={`Open navigation for ${orgName ?? "organization"}`}
            >
              {orgLogoUrl ? (
                <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "?"}</Text>
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
        <SectionList
          sections={announcementSections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={renderAnnouncement}
          renderSectionHeader={renderSectionHeader}
          ItemSeparatorComponent={itemSeparator}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={semantic.success}
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
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews={true}
        />
      </View>
    </View>
  );
}
