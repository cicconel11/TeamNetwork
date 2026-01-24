import React from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import { Drawer } from "expo-router/drawer";
import { DrawerContent } from "@/navigation/DrawerContent";
import { NEUTRAL } from "@/lib/design-tokens";

const DRAWER_WIDTH_RATIO = 0.78;
const DRAWER_MAX_WIDTH = 320;

export function AppDrawer() {
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * DRAWER_WIDTH_RATIO, DRAWER_MAX_WIDTH);

  return (
    <Drawer
      screenOptions={{
        headerShown: false,
        drawerType: "slide",
        overlayColor: "rgba(0, 0, 0, 0.35)",
        swipeEnabled: true,
        swipeEdgeWidth: 40,
        drawerStyle: [
          styles.drawer,
          {
            width: drawerWidth,
          },
        ],
        sceneStyle: styles.scene,
      }}
      drawerContent={(props: any) => <DrawerContent {...props} />}
    >
      <Drawer.Screen
        name="(drawer)"
        options={{
          title: "Home",
        }}
      />
    </Drawer>
  );
}

const styles = StyleSheet.create({
  drawer: {
    backgroundColor: NEUTRAL.dark950,
  },
  scene: {
    backgroundColor: NEUTRAL.dark950,
  },
});
