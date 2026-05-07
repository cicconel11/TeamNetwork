import React from "react";
import { View, Pressable, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Home, Calendar, Users, Megaphone, Plus } from "lucide-react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { APP_CHROME } from "@/lib/chrome";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

const ICON_SIZE = 22;

// Tab configuration with a centered action button
const LEFT_TABS = [
  { route: "index", icon: Home, label: "Home" },
  { route: "calendar", icon: Calendar, label: "Calendar" },
] as const;

const RIGHT_TABS = [
  { route: "announcements", icon: Megaphone, label: "Announcements" },
  { route: "members", icon: Users, label: "Members" },
] as const;

interface TabBadges {
  announcements?: number;
}

interface TabBarProps extends BottomTabBarProps {
  onActionPress?: () => void;
  badges?: TabBadges;
}

export function TabBar({ state, descriptors, navigation, onActionPress, badges }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const { semantic } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    container: {
      backgroundColor: APP_CHROME.tabBarBackground,
      borderTopWidth: 1,
      borderTopColor: APP_CHROME.tabBarBorder,
    },
    tabBar: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      height: 60,
      paddingHorizontal: 4,
    },
    tabGroup: {
      flex: 1,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-evenly" as const,
    },
    tab: {
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingVertical: 6,
      paddingHorizontal: 2,
      minWidth: 0,
      minHeight: 44,
      flex: 1,
    },
    tabContent: {
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 3,
      width: "100%" as const,
      minWidth: 0,
    },
    iconContainer: {
      position: "relative" as const,
    },
    badge: {
      position: "absolute" as const,
      top: -4,
      right: -8,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: s.error,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingHorizontal: 4,
    },
    badgeText: {
      color: "#ffffff",
      fontSize: 10,
      fontWeight: "700" as const,
      lineHeight: 12,
    },
    tabLabel: {
      fontSize: 10,
      lineHeight: 12,
      fontWeight: "500" as const,
      letterSpacing: 0.1,
      textAlign: "center" as const,
      width: "100%" as const,
    },
    tabLabelCompact: {
      fontSize: 8,
      lineHeight: 10,
      letterSpacing: 0,
    },
    activeIndicator: {
      position: "absolute" as const,
      bottom: -8,
      width: 20,
      height: 3,
      borderRadius: 1.5,
      backgroundColor: APP_CHROME.tabBarActive,
    },
    actionButton: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: APP_CHROME.actionButtonBackground,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 4,
      boxShadow: "0px 4px 8px rgba(0,0,0,0.20)",
    },
  }));

  const activeColor = APP_CHROME.tabBarActive;
  const inactiveColor = APP_CHROME.tabBarInactive;

  const getBadgeCount = (routeName: string): number | undefined => {
    if (routeName === "announcements") {
      return badges?.announcements;
    }
    return undefined;
  };

  const renderTab = (
    tabConfig: (typeof LEFT_TABS)[number] | (typeof RIGHT_TABS)[number]
  ) => {
    const route = state.routes.find((r) => r.name === tabConfig.route);
    if (!route) return null;

    const actualIndex = state.routes.findIndex((r) => r.key === route.key);
    const { options } = descriptors[route.key];
    const isFocused = state.index === actualIndex;
    const color = isFocused ? activeColor : inactiveColor;
    const IconComponent = tabConfig.icon;
    const badgeCount = getBadgeCount(tabConfig.route);

    const onPress = () => {
      const event = navigation.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      });

      if (!isFocused && !event.defaultPrevented) {
        navigation.navigate(route.name);
      }
    };

    return (
      <Pressable
        key={route.key}
        accessibilityRole="button"
        accessibilityState={isFocused ? { selected: true } : {}}
        accessibilityLabel={
          badgeCount && badgeCount > 0
            ? `${options.tabBarAccessibilityLabel || tabConfig.label}, ${badgeCount} unread`
            : options.tabBarAccessibilityLabel || tabConfig.label
        }
        onPress={onPress}
        style={({ pressed }) => [styles.tab, pressed && { opacity: 0.7 }]}
      >
        <View style={styles.tabContent}>
          <View style={styles.iconContainer}>
            <IconComponent size={ICON_SIZE} color={color} strokeWidth={isFocused ? 2.5 : 2} />
            {badgeCount !== undefined && badgeCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {badgeCount > 9 ? "9+" : badgeCount}
                </Text>
              </View>
            )}
          </View>
          <Text
            style={[
              styles.tabLabel,
              { color },
              tabConfig.label.length > 11
                ? styles.tabLabelCompact
                : null,
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {tabConfig.label}
          </Text>
          {isFocused && <View style={styles.activeIndicator} />}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <View style={styles.tabBar}>
        <View style={styles.tabGroup}>
          {LEFT_TABS.map((tab) => {
            const rendered = renderTab(tab);
            return rendered;
          }).filter(Boolean)}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Quick actions"
          onPress={onActionPress}
          style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.7 }]}
          disabled={!onActionPress}
        >
          <Plus size={22} color={APP_CHROME.actionButtonIcon} strokeWidth={2.5} />
        </Pressable>
        <View style={styles.tabGroup}>
          {RIGHT_TABS.map((tab) => {
            const rendered = renderTab(tab);
            return rendered;
          }).filter(Boolean)}
        </View>
      </View>
    </View>
  );
}
