import React, { useMemo } from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Home, Calendar, Users, Megaphone, Plus } from "lucide-react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { APP_CHROME } from "@/lib/chrome";

const ICON_SIZE = 24;

// Tab configuration with a centered action button
const LEFT_TABS = [
  { route: "index", icon: Home, label: "Home" },
  { route: "events", icon: Calendar, label: "Events" },
] as const;

const RIGHT_TABS = [
  { route: "announcements", icon: Megaphone, label: "Announcements" },
  { route: "members", icon: Users, label: "Members" },
] as const;

interface TabBarProps extends BottomTabBarProps {
  onActionPress?: () => void;
}

export function TabBar({ state, descriptors, navigation, onActionPress }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(), []);
  const activeColor = APP_CHROME.tabBarActive;
  const inactiveColor = APP_CHROME.tabBarInactive;

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
      <TouchableOpacity
        key={route.key}
        accessibilityRole="button"
        accessibilityState={isFocused ? { selected: true } : {}}
        accessibilityLabel={options.tabBarAccessibilityLabel || tabConfig.label}
        onPress={onPress}
        style={styles.tab}
      >
        <IconComponent size={ICON_SIZE} color={color} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <View style={styles.tabBar}>
        <View style={styles.tabGroup}>
          {LEFT_TABS.map((tab) => renderTab(tab))}
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Quick actions"
          onPress={onActionPress}
          style={styles.actionButton}
          disabled={!onActionPress}
        >
          <Plus size={22} color={APP_CHROME.actionButtonIcon} />
        </TouchableOpacity>
        <View style={styles.tabGroup}>
          {RIGHT_TABS.map((tab) => renderTab(tab))}
        </View>
      </View>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      backgroundColor: APP_CHROME.tabBarBackground,
      borderTopWidth: 1,
      borderTopColor: APP_CHROME.tabBarBorder,
    },
    tabBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      height: 56,
      paddingHorizontal: 8,
    },
    tabGroup: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-evenly",
    },
    tab: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 8,
      paddingHorizontal: 16,
      minWidth: 44,
      minHeight: 44,
    },
    actionButton: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: APP_CHROME.actionButtonBackground,
      alignItems: "center",
      justifyContent: "center",
    },
  });
