import React from "react";
import { View, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Home, Calendar, Users, Menu as MenuIcon, Megaphone } from "lucide-react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { colors } from "@/lib/theme";

const ICON_SIZE = 24;
const ACTIVE_COLOR = colors.primary;
const INACTIVE_COLOR = colors.mutedForeground;

// Tab configuration: 4 content areas + More utility
// Pattern: Home, Events, Announcements, Members, More
const TAB_CONFIG = [
  { route: "index", icon: Home, label: "Home" },
  { route: "events", icon: Calendar, label: "Events" },
  { route: "announcements", icon: Megaphone, label: "Announcements" },
  { route: "members", icon: Users, label: "Members" },
  { route: "menu", icon: MenuIcon, label: "More" },
] as const;

interface TabBarProps extends BottomTabBarProps {}

export function TabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();

  const renderTab = (tabConfig: (typeof TAB_CONFIG)[number]) => {
    const route = state.routes.find((r) => r.name === tabConfig.route);
    if (!route) return null;

    const actualIndex = state.routes.findIndex((r) => r.key === route.key);
    const { options } = descriptors[route.key];
    const isFocused = state.index === actualIndex;
    const color = isFocused ? ACTIVE_COLOR : INACTIVE_COLOR;
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
        {TAB_CONFIG.map((tab) => renderTab(tab))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tabBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    height: 56,
    paddingHorizontal: 8,
  },
  tab: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
    minWidth: 44,
    minHeight: 44,
  },
});
