import React, { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { ExternalLink, Plus, Settings, ShieldCheck } from "lucide-react-native";

import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { useNetwork } from "@/contexts/NetworkContext";
import { useAutoRefetchOnReconnect } from "@/hooks/useAutoRefetchOnReconnect";
import { ErrorState } from "@/components/ui";
import { useUnifiedCalendar } from "@/hooks/useUnifiedCalendar";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { SkeletonList } from "@/components/ui/Skeleton";
import { CalendarToolbar } from "@/components/calendar/calendar-toolbar";
import { MonthView } from "@/components/calendar/month-view";
import { TimeGridView } from "@/components/calendar/time-grid-view";
import { UnifiedCalendarFeed } from "@/components/calendar/unified-calendar-feed";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { getWebPath } from "@/lib/web-api";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import {
  getScheduleMySettingsPath,
  getScheduleSourcesPath,
} from "@/lib/schedules/mobile-schedule-settings";

function getWeekDates(date: Date): Date[] {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day;
  const sundayDate = new Date(d.setDate(diff));
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const nextDate = new Date(sundayDate);
    nextDate.setDate(nextDate.getDate() + i);
    dates.push(nextDate);
  }
  return dates;
}

function getThreeDayDates(date: Date): Date[] {
  const dates: Date[] = [];
  for (let i = 0; i < 3; i++) {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + i);
    dates.push(nextDate);
  }
  return dates;
}

export default function CalendarScreen() {
  const { orgSlug, orgId, orgName, orgLogoUrl } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { permissions } = useOrgRole();
  const { neutral, semantic } = useAppColorScheme();
  const { isOffline } = useNetwork();

  const {
    items,
    groups,
    filteredItems,
    loading,
    error,
    activeSource,
    setActiveSource,
    viewMode,
    setViewMode,
    selectedDate,
    setSelectedDate,
    refetch,
    refetchIfStale,
  } = useUnifiedCalendar(orgId);

  const [refreshing, setRefreshing] = useState(false);
  const isRefetchingRef = useRef(false);

  const styles = useThemedStyles((n) => ({
    container: {
      flex: 1,
      backgroundColor: n.surface,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
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
      fontVariant: ["tabular-nums"] as const,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    skeletonContainer: {
      padding: SPACING.md,
      paddingTop: SPACING.md,
    },
  }));

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available - no-op
    }
  }, [navigation]);

  const menuItems: OverflowMenuItem[] = useMemo(() => {
    const items: OverflowMenuItem[] = [
      {
        id: "my-schedule-settings",
        label: "My Schedule Settings",
        icon: <Settings size={20} color={neutral.foreground} />,
        onPress: () => {
          router.push(getScheduleMySettingsPath(orgSlug));
        },
      },
    ];

    if (!permissions.canUseAdminActions) {
      return items;
    }

    items.push(
      {
        id: "manage-sources",
        label: "Manage Sources",
        icon: <ShieldCheck size={20} color={neutral.foreground} />,
        onPress: () => {
          router.push(getScheduleSourcesPath(orgSlug));
        },
      },
      {
        id: "create-event",
        label: "Create Event",
        icon: <Plus size={20} color={semantic.success} />,
        onPress: () => {
          router.push(`/(app)/${orgSlug}/events/new`);
        },
      },
      {
        id: "open-in-web",
        label: "Open in Web",
        icon: <ExternalLink size={20} color={neutral.foreground} />,
        onPress: () => {
          const webUrl = getWebPath(orgSlug, "calendar");
          Linking.openURL(webUrl);
        },
      },
    );

    return items;
  }, [
    permissions.canUseAdminActions,
    orgSlug,
    router,
    semantic.success,
    neutral.foreground,
  ]);

  useFocusEffect(
    useCallback(() => {
      refetchIfStale();
    }, [refetchIfStale])
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

  const headerSubtitle = useMemo(() => {
    const count = items.length;
    if (count === 0) return "Calendar";
    return `${count} upcoming`;
  }, [items.length]);

  const renderHeader = (titleSubtitle: string) => (
    <LinearGradient
      colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
      style={styles.headerGradient}
    >
      <SafeAreaView edges={["top"]}>
        <View style={styles.headerContent}>
          <Pressable
            onPress={handleDrawerToggle}
            style={styles.orgLogoButton}
            accessibilityRole="button"
            accessibilityLabel={`Open navigation for ${orgName ?? "organization"}`}
          >
            {orgLogoUrl ? (
              <Image
                source={orgLogoUrl}
                style={styles.orgLogo}
                contentFit="contain"
                transition={200}
              />
            ) : (
              <View style={styles.orgAvatar}>
                <Text style={styles.orgAvatarText}>{orgName?.[0] || "C"}</Text>
              </View>
            )}
          </Pressable>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle} selectable>
              Calendar
            </Text>
            <Text style={styles.headerMeta}>{titleSubtitle}</Text>
          </View>
          {menuItems.length > 0 && (
            <OverflowMenu
              items={menuItems}
              accessibilityLabel="Calendar options"
            />
          )}
        </View>
      </SafeAreaView>
    </LinearGradient>
  );

  const visibleDates = useMemo(() => {
    switch (viewMode) {
      case "week":
        return getWeekDates(selectedDate);
      case "3day":
        return getThreeDayDates(selectedDate);
      case "day":
        return [selectedDate];
      default:
        return [];
    }
  }, [viewMode, selectedDate]);

  if (loading && items.length === 0) {
    return (
      <View style={styles.container}>
        {renderHeader("Loading…")}
        <Animated.View
          entering={FadeIn}
          exiting={FadeOut}
          style={[styles.contentSheet, styles.skeletonContainer]}
        >
          <SkeletonList type="event" count={4} />
        </Animated.View>
      </View>
    );
  }

  if (error && items.length === 0) {
    return (
      <View style={styles.container}>
        {renderHeader("Calendar")}
        <View style={styles.contentSheet}>
          <ErrorState
            onRetry={handleRefresh}
            title="Unable to load calendar"
            isOffline={isOffline}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {renderHeader(headerSubtitle)}
      <CalendarToolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        activeSource={activeSource}
        onSourceChange={setActiveSource}
      />
      <View style={styles.contentSheet}>
        {viewMode === "month" && (
          <MonthView
            items={filteredItems}
            selectedDate={selectedDate}
            onDayPress={(date) => {
              setSelectedDate(date);
              setViewMode("day");
            }}
            orgSlug={orgSlug}
          />
        )}

        {(viewMode === "week" || viewMode === "3day" || viewMode === "day") && (
          <TimeGridView
            items={filteredItems}
            visibleDates={visibleDates}
            orgSlug={orgSlug}
          />
        )}

        {viewMode === "list" && (
          <UnifiedCalendarFeed
            groups={groups}
            orgSlug={orgSlug}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            error={error}
            onRetry={refetch}
          />
        )}
      </View>
    </View>
  );
}
