import React from "react";
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Home, Calendar, Users, Menu, Plus } from "lucide-react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

const ICON_SIZE = 24;
const CENTER_BUTTON_SIZE = 56;
const ACTIVE_COLOR = "#2563eb";
const INACTIVE_COLOR = "#94a3b8";
const CENTER_BUTTON_COLOR = "#2563eb";

interface TabBarProps extends BottomTabBarProps {
  onActionPress: () => void;
}

export function TabBar({ state, descriptors, navigation, onActionPress }: TabBarProps) {
  const insets = useSafeAreaInsets();

  // Tab configuration: maps route index to icon
  const getIcon = (routeName: string, focused: boolean) => {
    const color = focused ? ACTIVE_COLOR : INACTIVE_COLOR;

    switch (routeName) {
      case "(tabs)/index":
        return <Home size={ICON_SIZE} color={color} />;
      case "(tabs)/events":
        return <Calendar size={ICON_SIZE} color={color} />;
      case "(tabs)/members":
        return <Users size={ICON_SIZE} color={color} />;
      case "(tabs)/menu":
        return <Menu size={ICON_SIZE} color={color} />;
      default:
        return <Home size={ICON_SIZE} color={color} />;
    }
  };

  const getLabel = (routeName: string) => {
    switch (routeName) {
      case "(tabs)/index":
        return "Home";
      case "(tabs)/events":
        return "Events";
      case "(tabs)/members":
        return "Members";
      case "(tabs)/menu":
        return "Menu";
      default:
        return "";
    }
  };

  // Split routes into left (before center) and right (after center)
  const leftRoutes = state.routes.slice(0, 2);
  const rightRoutes = state.routes.slice(2);

  const renderTab = (route: typeof state.routes[0], index: number, isRight: boolean) => {
    const actualIndex = isRight ? index + 2 : index;
    const { options } = descriptors[route.key];
    const isFocused = state.index === actualIndex;

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
        accessibilityLabel={options.tabBarAccessibilityLabel}
        onPress={onPress}
        style={styles.tab}
      >
        {getIcon(route.name, isFocused)}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <View style={styles.tabBar}>
        {/* Left tabs */}
        <View style={styles.tabGroup}>
          {leftRoutes.map((route, index) => renderTab(route, index, false))}
        </View>

        {/* Center action button */}
        <View style={styles.centerContainer}>
          <TouchableOpacity
            style={styles.centerButton}
            onPress={onActionPress}
            activeOpacity={0.8}
          >
            <Plus size={28} color="#ffffff" strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        {/* Right tabs */}
        <View style={styles.tabGroup}>
          {rightRoutes.map((route, index) => renderTab(route, index, true))}
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
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
      },
      android: {
        elevation: 8,
      },
    }),
  },
});
