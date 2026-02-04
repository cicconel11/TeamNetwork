import { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  StyleSheet,
  Pressable,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useFocusEffect, useRouter, useNavigation } from "expo-router";
import {
  Bell,
  BellOff,
  CheckCheck,
  ChevronLeft,
  Circle,
  ExternalLink,
} from "lucide-react-native";
import * as Linking from "expo-linking";
import { useNotifications, type Notification } from "@/hooks/useNotifications";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { SkeletonList } from "@/components/ui/Skeleton";

// Relative time formatter
function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function NotificationsScreen() {
  const { orgSlug, orgId, orgName, orgLogoUrl } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { permissions } = useOrgRole();
  const styles = useMemo(() => createStyles(), []);

  const {
    notifications,
    loading,
    error,
    unreadCount,
    refetch,
    refetchIfStale,
    markAsRead,
    markAllAsRead,
    markAsUnread,
  } = useNotifications(orgId);

  const [refreshing, setRefreshing] = useState(false);
  const isRefetchingRef = useRef(false);

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

  // Navigate back
  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/(app)/${orgSlug}/(tabs)`);
    }
  }, [router, orgSlug]);

  // Overflow menu items
  const menuItems: OverflowMenuItem[] = useMemo(() => {
    const items: OverflowMenuItem[] = [];

    if (unreadCount > 0) {
      items.push({
        id: "mark-all-read",
        label: "Mark all as read",
        icon: <CheckCheck size={20} color={NEUTRAL.foreground} />,
        onPress: () => markAllAsRead(),
      });
    }

    if (permissions.canUseAdminActions) {
      items.push({
        id: "open-in-web",
        label: "Open in Web",
        icon: <ExternalLink size={20} color={NEUTRAL.foreground} />,
        onPress: () => {
          const webUrl = `https://www.myteamnetwork.com/${orgSlug}/notifications`;
          Linking.openURL(webUrl);
        },
      });
    }

    return items;
  }, [permissions.canUseAdminActions, orgSlug, unreadCount, markAllAsRead]);

  // Refetch on screen focus if stale
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

  const handleNotificationPress = useCallback(
    async (notification: Notification) => {
      // Mark as read when tapped
      if (!notification.isRead) {
        await markAsRead(notification.id);
      }
      // Future: navigate to notification detail or related content
    },
    [markAsRead]
  );

  const handleToggleRead = useCallback(
    async (notification: Notification) => {
      if (notification.isRead) {
        await markAsUnread(notification.id);
      } else {
        await markAsRead(notification.id);
      }
    },
    [markAsRead, markAsUnread]
  );

  const renderNotification = ({ item }: { item: Notification }) => {
    return (
      <Pressable
        onPress={() => handleNotificationPress(item)}
        style={({ pressed }) => [
          styles.notificationCard,
          !item.isRead && styles.notificationCardUnread,
          pressed && styles.notificationCardPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}${!item.isRead ? ", unread" : ""}`}
      >
        <View style={styles.notificationContent}>
          {/* Unread indicator */}
          <View style={styles.unreadIndicatorContainer}>
            {!item.isRead && (
              <View style={styles.unreadIndicator} />
            )}
          </View>

          {/* Main content */}
          <View style={styles.notificationMain}>
            <Text style={styles.notificationTitle} numberOfLines={2}>
              {item.title}
            </Text>
            {item.body && (
              <Text style={styles.notificationBody} numberOfLines={3}>
                {item.body}
              </Text>
            )}
            <View style={styles.notificationMeta}>
              <Text style={styles.notificationTime}>
                {formatRelativeTime(item.created_at)}
              </Text>
              {item.channel && (
                <>
                  <Text style={styles.metaDot}>·</Text>
                  <Text style={styles.notificationChannel}>{item.channel}</Text>
                </>
              )}
            </View>
          </View>

          {/* Read/Unread toggle */}
          <Pressable
            onPress={() => handleToggleRead(item)}
            style={styles.readToggle}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={item.isRead ? "Mark as unread" : "Mark as read"}
          >
            {item.isRead ? (
              <BellOff size={18} color={NEUTRAL.muted} />
            ) : (
              <Circle size={18} color={SEMANTIC.info} fill={SEMANTIC.infoLight} />
            )}
          </Pressable>
        </View>
      </Pressable>
    );
  };

  if (loading && notifications.length === 0) {
    return (
      <View style={styles.container}>
        {/* Gradient Header */}
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleBack} style={styles.backButton}>
                <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Notifications</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.listContent}>
            <SkeletonList type="notification" count={6} />
          </View>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        {/* Gradient Header */}
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleBack} style={styles.backButton}>
                <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Notifications</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              onPress={handleRefresh}
              style={styles.retryButton}
              accessibilityRole="button"
              accessibilityLabel="Retry"
            >
              <Text style={styles.retryButtonText}>Try again</Text>
            </Pressable>
          </View>
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
            {/* Back button */}
            <Pressable onPress={handleBack} style={styles.backButton}>
              <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
            </Pressable>

            {/* Org Logo (opens drawer) */}
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image
                  source={orgLogoUrl}
                  style={styles.orgLogo}
                  contentFit="contain"
                  transition={200}
                />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "?"}</Text>
                </View>
              )}
            </Pressable>

            {/* Title */}
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Notifications</Text>
              <Text style={styles.headerMeta}>
                {unreadCount > 0
                  ? `${unreadCount} unread`
                  : `${notifications.length} total`}
              </Text>
            </View>

            {/* Overflow Menu */}
            {menuItems.length > 0 && (
              <OverflowMenu items={menuItems} accessibilityLabel="Notification options" />
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={renderNotification}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={SEMANTIC.success}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconContainer}>
                <Bell size={48} color={NEUTRAL.muted} />
              </View>
              <Text style={styles.emptyTitle}>No Notifications</Text>
              <Text style={styles.emptyText}>
                You're all caught up! New notifications will appear here.
              </Text>
            </View>
          }
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
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
    backButton: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: -SPACING.xs,
    },
    orgLogoButton: {
      width: 32,
      height: 32,
    },
    orgLogo: {
      width: 32,
      height: 32,
      borderRadius: 16,
    },
    orgAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
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
    // Notification card
    notificationCard: {
      backgroundColor: NEUTRAL.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      marginBottom: SPACING.sm,
      ...SHADOWS.sm,
    },
    notificationCardUnread: {
      backgroundColor: SEMANTIC.infoLight,
      borderColor: SEMANTIC.info,
    },
    notificationCardPressed: {
      opacity: 0.7,
    },
    notificationContent: {
      flexDirection: "row",
      padding: SPACING.md,
    },
    unreadIndicatorContainer: {
      width: 12,
      alignItems: "center",
      paddingTop: 6,
    },
    unreadIndicator: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: SEMANTIC.info,
    },
    notificationMain: {
      flex: 1,
      paddingRight: SPACING.sm,
    },
    notificationTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: NEUTRAL.foreground,
      marginBottom: SPACING.xs,
    },
    notificationBody: {
      ...TYPOGRAPHY.bodySmall,
      color: NEUTRAL.secondary,
      marginBottom: SPACING.sm,
    },
    notificationMeta: {
      flexDirection: "row",
      alignItems: "center",
    },
    notificationTime: {
      ...TYPOGRAPHY.caption,
      color: NEUTRAL.muted,
    },
    metaDot: {
      ...TYPOGRAPHY.caption,
      color: NEUTRAL.muted,
      marginHorizontal: SPACING.xs,
    },
    notificationChannel: {
      ...TYPOGRAPHY.caption,
      color: NEUTRAL.muted,
      textTransform: "capitalize",
    },
    readToggle: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
    },
    // Empty state
    emptyContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingVertical: 64,
    },
    emptyIconContainer: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: NEUTRAL.background,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: SPACING.md,
    },
    emptyTitle: {
      ...TYPOGRAPHY.headlineMedium,
      color: NEUTRAL.foreground,
      marginBottom: SPACING.sm,
    },
    emptyText: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.muted,
      textAlign: "center",
      paddingHorizontal: SPACING.xl,
    },
    // Loading/Error states
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: SPACING.lg,
    },
    errorText: {
      ...TYPOGRAPHY.bodyMedium,
      color: SEMANTIC.error,
      textAlign: "center",
      marginBottom: SPACING.md,
    },
    retryButton: {
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.lg,
      backgroundColor: SEMANTIC.success,
      borderRadius: RADIUS.md,
    },
    retryButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.surface,
    },
  });
