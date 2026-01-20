import React from "react";
import { View, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Home, Calendar, Users, Menu as MenuIcon, Plus } from "lucide-react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

const ICON_SIZE = 24;
const CENTER_BUTTON_SIZE = 56;
const ACTIVE_COLOR = "#2563eb";
const INACTIVE_COLOR = "#94a3b8";
const CENTER_BUTTON_COLOR = "#2563eb";

// Deterministic tab configuration: ensures symmetric layout
// Pattern: Home, Events, [+], Members, Menu
const TAB_CONFIG = [
  { route: "index", icon: Home, label: "Home" },
  { route: "events", icon: Calendar, label: "Events" },
  // Center action button is rendered separately (not a tab)
  { route: "members", icon: Users, label: "Members" },
  { route: "menu", icon: MenuIcon, label: "Menu" },
] as const;

// Split into left/right groups around center button
const LEFT_TABS = TAB_CONFIG.slice(0, 2);
const RIGHT_TABS = TAB_CONFIG.slice(2);

interface TabBarProps extends BottomTabBarProps {
  onActionPress: () => void;
}

export function TabBar({ state, descriptors, navigation, onActionPress }: TabBarProps) {
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
        {/* Left tabs: Home, Events */}
        <View style={styles.tabGroup}>
          {LEFT_TABS.map((tab) => renderTab(tab))}
        </View>

        {/* Center action button - opens Quick Actions sheet */}
        <View style={styles.centerContainer}>
          <TouchableOpacity
            style={styles.centerButton}
            onPress={onActionPress}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Quick Actions"
          >
            <Plus size={28} color="#ffffff" strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        {/* Right tabs: Members, Menu */}
        <View style={styles.tabGroup}>
          {RIGHT_TABS.map((tab) => renderTab(tab))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  tabBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 56,
    paddingHorizontal: 8,
  },
  tabGroup: {
    flexDirection: "row",
    flex: 1,
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
  centerContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  centerButton: {
    width: CENTER_BUTTON_SIZE,
    height: CENTER_BUTTON_SIZE,
    borderRadius: CENTER_BUTTON_SIZE / 2,
    backgroundColor: CENTER_BUTTON_COLOR,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -20,
    boxShadow: "0 4px 12px rgba(37, 99, 235, 0.35)",
  },
});
