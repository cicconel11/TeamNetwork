import React from "react";
import { Platform, useWindowDimensions } from "react-native";
import { Drawer } from "expo-router/drawer";
import { DrawerContent } from "@/navigation/DrawerContent";
import { useThemedStyles } from "@/hooks/useThemedStyles";

const DRAWER_WIDTH_RATIO = 0.78;
const DRAWER_MAX_WIDTH = 320;

export function AppDrawer() {
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * DRAWER_WIDTH_RATIO, DRAWER_MAX_WIDTH);
  const styles = useThemedStyles((n) => ({
    drawer: {
      backgroundColor: n.dark950,
    },
    scene: {
      backgroundColor: n.dark950,
      overflow: "hidden" as const,
    },
  }));

  return (
    <Drawer
      screenOptions={{
        headerShown: false,
        drawerType: Platform.OS === "web" ? "slide" : "front",
        overlayColor: "rgba(0, 0, 0, 0.5)",
        swipeEnabled: Platform.OS !== "web",
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
